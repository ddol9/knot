"""Product API campaign: discovery -> parallel A2A negotiation -> agreements -> escrow lock.

The API acts as the brand agent runtime here (same repository and payment path as the
single-negotiation flow). Creator agents run in-process in `local` A2A mode with their
policies read from the seeded repository.
"""

import json

from fastapi.testclient import TestClient

from apps.api.main import create_app
from libs.repositories.firestore_paths import COLLECTIONS, FirestorePaths
from libs.repositories.seed import seed_demo_repository
from libs.repositories.store import InMemoryDocumentStore, KnotRepository
from libs.settings.config import Settings
from tests.test_api_escrow import install_confirmed_gateway


def _seeded(settings: Settings | None = None) -> tuple[TestClient, KnotRepository]:
    repository = KnotRepository(InMemoryDocumentStore())
    seed_demo_repository(repository)
    return TestClient(create_app(settings=settings, repository=repository)), repository


def _timeline_types(client: TestClient, promotion_id: str) -> list[str]:
    events = client.get(f"/api/v1/promotions/{promotion_id}/timeline").json()["data"]["events"]
    return [event["type"] for event in events]


def test_campaign_creates_agreements_and_locks_escrow_for_each(monkeypatch) -> None:
    install_confirmed_gateway(monkeypatch)
    client, repository = _seeded(
        Settings(web3_mode="gateway", web3_gateway_base_url="http://web3-gateway.test")
    )

    response = client.post(
        "/api/v1/promotions/promotion-001/campaigns",
        json={"targetCreatorCount": 2, "openingAmountUsdc": 400, "ceilingUsdc": 700},
    )
    assert response.status_code == 201, response.text
    data = response.json()["data"]
    campaign, agreements = data["campaign"], data["agreements"]

    # One trace id correlates the response, the request and the match run (knot.trace).
    trace_id = response.json()["meta"]["traceId"]
    assert trace_id and campaign["traceId"] == trace_id == response.headers["X-Trace-Id"]
    assert all(n["result"]["traceId"] == trace_id for n in campaign["negotiations"] if n["result"])

    assert campaign["outcome"] == "TARGET_REACHED"
    assert campaign["agreedCount"] == 2
    assert len(agreements) == 2
    assert set(campaign["agreementIds"]) == {a["agreementId"] for a in agreements}
    assert campaign["committedUsdc"] <= campaign["totalBudgetUsdc"] == 2000

    agreed = [n for n in campaign["negotiations"] if n["agreementId"]]
    assert len(agreed) == 2
    for negotiation in agreed:
        # Escrow was locked through the existing lock path with a confirmed receipt.
        assert negotiation["escrow"]["status"] == "LOCKED", negotiation["escrow"]
        assert negotiation["escrow"]["signature"] == "lock-signature-confirmed"
        agreement = repository.get_raw_document(
            FirestorePaths.agreement(negotiation["agreementId"])
        )
        assert agreement is not None
        # The lock path leaves the agreement itself FUNDING_REQUIRED (funding confirmation
        # is a separate step); the escrow document carries the lock.
        assert agreement["status"] == "FUNDING_REQUIRED"
        assert agreement["negotiationId"] == negotiation["negotiationId"]
        assert agreement["termsHash"] == negotiation["termsHash"]
        # Product read paths see the campaign's agreement like any other.
        escrow_view = client.get(f"/api/v1/agreements/{agreement['agreementId']}/escrow")
        assert escrow_view.status_code == 200
        assert escrow_view.json()["data"]["escrow"]["status"] == "LOCKED"
        milestones = repository.list_raw_documents(
            f"{COLLECTIONS.agreements}/{agreement['agreementId']}/{COLLECTIONS.milestones}"
        )
        assert {m["milestoneId"] for m in milestones} == {
            m["id"] for m in agreement["terms"]["milestones"]
        }
        negotiation_doc = repository.get_raw_document(
            FirestorePaths.negotiation(negotiation["negotiationId"])
        )
        assert negotiation_doc is not None and negotiation_doc["status"] == "AGREED"
        assert negotiation_doc["creatorPolicySnapshot"] == {"redacted": True}
        assert "ceilingUsdc" not in json.dumps(negotiation_doc)

    types = _timeline_types(client, "promotion-001")
    assert types.count("CAMPAIGN_STARTED") == 1
    assert types.count("AGREEMENT_CREATED") == 2
    assert types.count("ESCROW_LOCKED") == 2
    assert types.count("CAMPAIGN_COMPLETED") == 1

    run_doc = repository.get_raw_document(FirestorePaths.match_run(campaign["matchRunId"]))
    assert run_doc is not None
    assert run_doc["status"] == "AGREED"
    assert run_doc["campaignOutcome"] == "TARGET_REACHED"
    assert run_doc["traceId"] == trace_id
    assert run_doc["selectedCreatorAgentId"] in {n["creatorAgentId"] for n in agreed}
    candidates = repository.list_raw_documents(
        f"{COLLECTIONS.match_runs}/{campaign['matchRunId']}/candidates"
    )
    linked = [c for c in candidates if c.get("agreementId")]
    assert len(linked) == 2
    assert all(c["negotiationStatus"] == "AGREED" for c in linked)


def test_campaign_skips_escrow_when_auto_escrow_is_off() -> None:
    client, repository = _seeded()
    promotion = repository.get_promotion("promotion-001")
    assert promotion is not None
    repository.save_promotion(
        promotion.model_copy(
            update={"autonomy": promotion.autonomy.model_copy(update={"auto_escrow": False})}
        )
    )
    # parallelism 1: with fan-out, two creators can both accept before the target stop
    # flag is set (the stop is checked between A2A sends), which would make the exact
    # count below timing-dependent.
    response = client.post(
        "/api/v1/promotions/promotion-001/campaigns",
        json={
            "targetCreatorCount": 1,
            "openingAmountUsdc": 400,
            "ceilingUsdc": 700,
            "parallelism": 1,
        },
    )
    assert response.status_code == 201, response.text
    campaign = response.json()["data"]["campaign"]
    assert campaign["agreedCount"] == 1
    agreed = next(n for n in campaign["negotiations"] if n["agreementId"])
    assert agreed["escrow"] == {"status": "SKIPPED", "reason": "AUTO_ESCROW_DISABLED"}
    agreement = repository.get_raw_document(FirestorePaths.agreement(agreed["agreementId"]))
    assert agreement is not None and agreement["status"] == "FUNDING_REQUIRED"
    types = _timeline_types(client, "promotion-001")
    assert "AGREEMENT_CREATED" in types and "ESCROW_LOCKED" not in types


def test_campaign_without_gateway_keeps_agreement_funding_required() -> None:
    client, repository = _seeded()  # web3_mode=local
    response = client.post(
        "/api/v1/promotions/promotion-001/campaigns",
        json={"targetCreatorCount": 1, "openingAmountUsdc": 400, "ceilingUsdc": 700},
    )
    assert response.status_code == 201, response.text
    agreed = next(
        n for n in response.json()["data"]["campaign"]["negotiations"] if n["agreementId"]
    )
    assert agreed["escrow"] == {"status": "SKIPPED", "reason": "WEB3_GATEWAY_REQUIRED"}
    assert repository.get_raw_document(FirestorePaths.agreement(agreed["agreementId"]))


def test_campaign_defaults_amounts_from_promotion_budget() -> None:
    client, _ = _seeded()
    # promotion-lip-balm: initialOffer 250, maxPerCreator 500 -> opening 250, ceiling 500.
    response = client.post("/api/v1/promotions/promotion-lip-balm/campaigns", json={})
    assert response.status_code == 201, response.text
    campaign = response.json()["data"]["campaign"]
    assert campaign["totalBudgetUsdc"] == 1000
    for negotiation in campaign["negotiations"]:
        assert negotiation["committedUsdc"] <= 500
        if negotiation["result"]:
            first_brand_turn = next(
                t for t in negotiation["result"]["turns"] if t["role"] == "brand"
            )
            assert first_brand_turn["amountUsdc"] == 250


def test_campaign_stream_emits_agreement_and_escrow_events() -> None:
    client, _ = _seeded()
    events: list[tuple[str, dict]] = []
    with client.stream(
        "GET",
        "/api/v1/promotions/promotion-001/campaigns/stream",
        params={"targetCreatorCount": 1, "openingAmountUsdc": 400, "ceilingUsdc": 700},
    ) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        event, payload = None, ""
        for line in response.iter_lines():
            if line.startswith("event:"):
                event = line[6:].strip()
            elif line.startswith("data:"):
                payload = line[5:].strip()
            elif line == "" and event:
                events.append((event, json.loads(payload)))
                event, payload = None, ""
    names = [e for e, _ in events]
    assert names[0] == "status" and names[1] == "discovery" and names[-1] == "campaign_result"
    # The stream announces the trace id up front and the final payload repeats it.
    status_trace = events[0][1]["traceId"]
    assert status_trace == response.headers["X-Trace-Id"]
    assert events[-1][1]["traceId"] == status_trace
    assert events[-1][1]["result"]["traceId"] == status_trace
    assert "agreement_created" in names
    assert names.index("agreement_created") < names.index("escrow_skipped")
    created = next(d for e, d in events if e == "agreement_created")
    assert created["agreementId"] and created["termsHash"]
    skipped = next(d for e, d in events if e == "escrow_skipped")
    assert skipped["reason"] == "WEB3_GATEWAY_REQUIRED"


def test_campaign_unknown_promotion_is_404() -> None:
    client, _ = _seeded()
    assert client.post("/api/v1/promotions/nope/campaigns", json={}).status_code == 404
    assert client.get("/api/v1/promotions/nope/campaigns/stream").status_code == 404


# --- fan-out limits and cancellation -------------------------------------------------


def test_parallel_fan_out_never_agrees_past_the_target() -> None:
    # Every beauty creator accepts 800 at once, so without target slots three parallel
    # negotiations could all agree before the stop flag is seen.
    client, _ = _seeded()
    for _ in range(4):
        response = client.post(
            "/api/v1/promotions/promotion-001/campaigns",
            json={"targetCreatorCount": 1, "parallelism": 3, "openingAmountUsdc": 800},
        )
        assert response.status_code == 201, response.text
        campaign = response.json()["data"]["campaign"]
        assert campaign["agreedCount"] == 1, campaign["negotiations"]
        assert campaign["outcome"] == "TARGET_REACHED"
        skipped = {n["skipReason"] for n in campaign["negotiations"] if n["status"] == "SKIPPED"}
        assert skipped <= {"TARGET_REACHED"}


def test_cancel_campaign_stops_it_and_blocks_a_second_run(monkeypatch) -> None:
    import threading

    from libs.agents import brand_campaign

    client, _ = _seeded()
    started, release = threading.Event(), threading.Event()
    original_run = brand_campaign.CampaignRunner.run

    def gated_run(self):  # type: ignore[no-untyped-def]
        started.set()
        assert release.wait(5)
        return original_run(self)

    monkeypatch.setattr(brand_campaign.CampaignRunner, "run", gated_run)
    results: dict[str, object] = {}

    def run_first() -> None:
        results["response"] = client.post(
            "/api/v1/promotions/promotion-001/campaigns", json={"targetCreatorCount": 2}
        )

    worker = threading.Thread(target=run_first)
    worker.start()
    assert started.wait(5)

    # A second campaign for the same promotion is refused while one is running.
    second = client.post("/api/v1/promotions/promotion-001/campaigns", json={})
    assert second.status_code == 409
    assert second.json()["detail"]["code"] == "CAMPAIGN_ALREADY_RUNNING"
    stream = client.get("/api/v1/promotions/promotion-001/campaigns/stream")
    assert stream.status_code == 409

    campaign_id = second.json()["detail"]["detail"].split()[1]
    assert client.post("/api/v1/promotions/promotion-001/campaigns/nope:cancel").status_code == 404
    cancel = client.post(f"/api/v1/promotions/promotion-001/campaigns/{campaign_id}:cancel")
    assert cancel.status_code == 200
    assert cancel.json()["data"] == {"campaignId": campaign_id, "status": "CANCELING"}

    release.set()
    worker.join(10)
    first = results["response"]
    assert first.status_code == 201, first.text  # type: ignore[union-attr]
    campaign = first.json()["data"]["campaign"]  # type: ignore[union-attr]
    assert campaign["campaignId"] == campaign_id
    assert campaign["outcome"] == "CANCELED"
    assert campaign["agreedCount"] == 0
    assert {n["skipReason"] for n in campaign["negotiations"]} == {"CANCELED"}
    assert "CAMPAIGN_CANCEL_REQUESTED" in _timeline_types(client, "promotion-001")

    # Finished campaigns free the slot for the promotion.
    again = client.post("/api/v1/promotions/promotion-001/campaigns", json={})
    assert again.status_code == 201
