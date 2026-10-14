"""Governance on the campaign path: over-limit agreements wait in the approval queue.

With `max_auto_agreement_usdc=500`, a campaign on promotion-001 (opening 400, ceiling 700,
two creators) ends with one agreement auto-locked at 400 and one parked at 600 for a person.
A person then approves (escrow locks through the same path, idempotently) or rejects.
"""

import json

from fastapi.testclient import TestClient

from apps.api.main import create_app
from apps.brand_agent.main import demo_promotion
from libs.a2a.registry import record_negotiation_outcome
from libs.agents.brand_discovery import discover_creator_agents
from libs.policies.governance import FLAG_CONSECUTIVE_FAILURES, GovernanceRules
from libs.repositories.firestore_paths import COLLECTIONS, FirestorePaths
from libs.repositories.seed import seed_demo_repository
from libs.repositories.store import InMemoryDocumentStore, KnotRepository
from libs.settings.config import Settings
from tests.test_api_escrow import install_confirmed_gateway

# parallelism 1: rank order (agent-creator-1 at 400, then creator-agent-005 at 600) is stable.
CAMPAIGN = {
    "targetCreatorCount": 2,
    "parallelism": 1,
    "openingAmountUsdc": 400,
    "ceilingUsdc": 700,
}


def _gateway_client(monkeypatch) -> tuple[TestClient, KnotRepository]:  # type: ignore[no-untyped-def]
    install_confirmed_gateway(monkeypatch)
    repository = KnotRepository(InMemoryDocumentStore())
    seed_demo_repository(repository)
    settings = Settings(
        web3_mode="gateway",
        web3_gateway_base_url="http://web3-gateway.test",
        gov_max_auto_agreement_usdc=500,
    )
    return TestClient(create_app(settings=settings, repository=repository)), repository


def _timeline_types(client: TestClient, promotion_id: str) -> list[str]:
    events = client.get(f"/api/v1/promotions/{promotion_id}/timeline").json()["data"]["events"]
    return [event["type"] for event in events]


def _run_campaign(client: TestClient) -> tuple[dict, dict]:
    """Return (auto-locked negotiation, pending-approval negotiation)."""
    response = client.post("/api/v1/promotions/promotion-001/campaigns", json=CAMPAIGN)
    assert response.status_code == 201, response.text
    campaign = response.json()["data"]["campaign"]
    assert campaign["outcome"] == "TARGET_REACHED" and campaign["agreedCount"] == 2
    agreed = [n for n in campaign["negotiations"] if n["agreementId"]]
    locked = next(n for n in agreed if n["escrow"]["status"] == "LOCKED")
    pending = next(n for n in agreed if n["escrow"]["status"] == "PENDING_APPROVAL")
    return locked, pending


def test_over_limit_agreement_waits_for_a_person(monkeypatch) -> None:
    client, repository = _gateway_client(monkeypatch)
    locked, pending = _run_campaign(client)

    assert locked["committedUsdc"] == 400
    assert pending["committedUsdc"] == 600  # still counts as agreed and committed
    assert pending["escrow"]["reasons"] == ["GOV_SINGLE_AGREEMENT_OVER_AUTO_LIMIT"]
    approval_id = pending["escrow"]["approvalId"]

    # Nothing was locked for the pending one; the agreement is agreed but unfunded.
    unfunded = client.get(f"/api/v1/agreements/{pending['agreementId']}/escrow")
    assert unfunded.status_code == 200 and unfunded.json()["data"]["escrow"] is None
    agreement = repository.get_raw_document(FirestorePaths.agreement(pending["agreementId"]))
    assert agreement is not None
    assert agreement["status"] == "FUNDING_REQUIRED"
    assert agreement["approvalStatus"] == "PENDING" and agreement["approvalId"] == approval_id

    # The queue shows it with the governance reasons.
    listed = client.get("/api/v1/approvals", params={"status": "PENDING"}).json()["data"]
    assert [a["approvalId"] for a in listed["approvals"]] == [approval_id]
    approval = client.get(f"/api/v1/approvals/{approval_id}").json()["data"]["approval"]
    assert approval["type"] == "ESCROW_LOCK" and approval["status"] == "PENDING"
    assert approval["amountUsdc"] == 600 and approval["campaignCommittedUsdc"] == 1000
    assert approval["agreementId"] == pending["agreementId"]
    assert approval["creatorAgentId"] == pending["creatorAgentId"]
    assert approval["promotionId"] == "promotion-001"
    assert approval["ruleVersion"] == "governance-v1"

    types = _timeline_types(client, "promotion-001")
    assert types.count("AGREEMENT_CREATED") == 2
    assert types.count("APPROVAL_REQUIRED") == 1
    assert types.count("ESCROW_LOCKED") == 1


def test_approving_locks_escrow_and_is_idempotent(monkeypatch) -> None:
    client, repository = _gateway_client(monkeypatch)
    _, pending = _run_campaign(client)
    approval_id = pending["escrow"]["approvalId"]

    response = client.post(f"/api/v1/approvals/{approval_id}:approve")
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["approval"]["status"] == "APPROVED"
    assert data["escrow"]["status"] == "LOCKED"
    assert data["escrow"]["signature"] == "lock-signature-confirmed"
    assert data["approval"]["escrow"]["escrowId"] == data["escrow"]["escrowId"]

    escrow_view = client.get(f"/api/v1/agreements/{pending['agreementId']}/escrow")
    assert escrow_view.status_code == 200
    escrow = escrow_view.json()["data"]["escrow"]
    assert escrow["status"] == "LOCKED"
    assert escrow["idempotencyKey"] == f"approval-{approval_id}"

    # Approve again (even with a different Idempotency-Key): same decision, same escrow.
    again = client.post(
        f"/api/v1/approvals/{approval_id}:approve", headers={"Idempotency-Key": "other-key"}
    )
    assert again.status_code == 200
    assert again.json()["data"]["approval"]["escrow"]["escrowId"] == escrow["escrowId"]
    assert len([e for e in repository.list_raw_documents(COLLECTIONS.escrows)]) == 2

    types = _timeline_types(client, "promotion-001")
    assert types.count("APPROVAL_GRANTED") == 1
    assert types.count("ESCROW_LOCKED") == 2
    assert types.index("APPROVAL_REQUIRED") < types.index("APPROVAL_GRANTED")
    agreement = repository.get_raw_document(FirestorePaths.agreement(pending["agreementId"]))
    assert agreement is not None and agreement["approvalStatus"] == "APPROVED"
    candidate = repository.get_raw_document(
        FirestorePaths.match_candidate(
            data["approval"]["matchRunId"], data["approval"]["creatorId"]
        )
    )
    assert candidate is not None and candidate["escrow"]["status"] == "LOCKED"
    assert (
        client.get("/api/v1/approvals", params={"status": "PENDING"}).json()["data"]["approvals"]
        == []
    )

    # Rejecting after approval is a state error.
    rejected = client.post(f"/api/v1/approvals/{approval_id}:reject", json={"reason": "late"})
    assert rejected.status_code == 409
    assert rejected.json()["detail"]["code"] == "INVALID_STATE_TRANSITION"


def test_rejecting_leaves_agreement_unfunded(monkeypatch) -> None:
    client, repository = _gateway_client(monkeypatch)
    _, pending = _run_campaign(client)
    approval_id = pending["escrow"]["approvalId"]

    response = client.post(
        f"/api/v1/approvals/{approval_id}:reject", json={"reason": "over this quarter's budget"}
    )
    assert response.status_code == 200, response.text
    approval = response.json()["data"]["approval"]
    assert approval["status"] == "REJECTED" and approval["reason"] == "over this quarter's budget"

    agreement = repository.get_raw_document(FirestorePaths.agreement(pending["agreementId"]))
    assert agreement is not None
    assert agreement["status"] == "FUNDING_REQUIRED"
    assert agreement["approvalStatus"] == "REJECTED"
    unfunded = client.get(f"/api/v1/agreements/{pending['agreementId']}/escrow")
    assert unfunded.status_code == 200 and unfunded.json()["data"]["escrow"] is None
    types = _timeline_types(client, "promotion-001")
    assert types.count("APPROVAL_REJECTED") == 1 and types.count("ESCROW_LOCKED") == 1

    # Reject twice is idempotent; approve afterwards is refused.
    assert (
        client.post(f"/api/v1/approvals/{approval_id}:reject", json={"reason": "x"}).status_code
        == 200
    )
    assert client.post(f"/api/v1/approvals/{approval_id}:approve").status_code == 409
    assert client.post(f"/api/v1/approvals/{approval_id}:reject", json={}).status_code == 422


def test_unknown_approval_is_404(monkeypatch) -> None:
    client, _ = _gateway_client(monkeypatch)
    assert client.get("/api/v1/approvals/nope").status_code == 404
    assert client.post("/api/v1/approvals/nope:approve").status_code == 404
    assert client.post("/api/v1/approvals/nope:reject", json={"reason": "x"}).status_code == 404


def test_stream_emits_approval_required(monkeypatch) -> None:
    client, _ = _gateway_client(monkeypatch)
    names: list[str] = []
    payloads: dict[str, dict] = {}
    with client.stream(
        "GET", "/api/v1/promotions/promotion-001/campaigns/stream", params=CAMPAIGN
    ) as response:
        assert response.status_code == 200
        event, payload = None, ""
        for line in response.iter_lines():
            if line.startswith("event:"):
                event = line[6:].strip()
            elif line.startswith("data:"):
                payload = line[5:].strip()
            elif line == "" and event:
                names.append(event)
                payloads[event] = json.loads(payload)
                event, payload = None, ""
    assert "approval_required" in names and "escrow_locked" in names
    required = payloads["approval_required"]
    assert required["approvalId"].startswith("approval-") and required["amountUsdc"] == 600
    assert required["reasons"] == ["GOV_SINGLE_AGREEMENT_OVER_AUTO_LIMIT"]


def test_default_limits_lock_both_agreements(monkeypatch) -> None:
    # Default 800/2000: 400 + 600 both lock without a person (regression guard).
    install_confirmed_gateway(monkeypatch)
    repository = KnotRepository(InMemoryDocumentStore())
    seed_demo_repository(repository)
    client = TestClient(
        create_app(
            settings=Settings(web3_mode="gateway", web3_gateway_base_url="http://w"),
            repository=repository,
        )
    )
    campaign = client.post("/api/v1/promotions/promotion-001/campaigns", json=CAMPAIGN).json()[
        "data"
    ]["campaign"]
    statuses = [n["escrow"]["status"] for n in campaign["negotiations"] if n["agreementId"]]
    assert statuses == ["LOCKED", "LOCKED"]
    assert client.get("/api/v1/approvals").json()["data"]["approvals"] == []


# --- discovery surfaces anomalies -------------------------------------------------------


def test_discovery_flags_and_demotes_an_agent_that_keeps_failing() -> None:
    repository = KnotRepository(InMemoryDocumentStore())
    seed_demo_repository(repository)
    promotion = demo_promotion(category="beauty", max_per_creator_usdc=700, total_usdc=1300)
    baseline, _ = discover_creator_agents(
        repository, promotion, limit=5, default_base_url="http://a", card_probe=None
    )
    top = next(c for c in baseline.candidates if c.rank == 1)
    assert top.creator_agent_id == "agent-creator-1" and "flag" not in top.track_record

    for outcome in ("WALKED_AWAY", "REJECTED", "ESCALATED"):
        record_negotiation_outcome(repository, "agent-creator-1", outcome=outcome, now="t")
    report, _ = discover_creator_agents(
        repository,
        promotion,
        limit=5,
        default_base_url="http://a",
        card_probe=None,
        governance=GovernanceRules(maxConsecutiveFailures=3),
    )
    flagged = next(c for c in report.candidates if c.creator_agent_id == "agent-creator-1")
    assert flagged.track_record["flag"]["code"] == FLAG_CONSECUTIVE_FAILURES
    assert flagged.health_status != "DOWN"
    assert flagged.rank_score < top.rank_score * 0.75
    assert flagged.rank > 1  # demoted...
    assert flagged.eligible and flagged.selected  # ...but not excluded
