"""Who may run a campaign or decide an approval.

Campaign and approval routes follow the agent-runtime rule already used by
`/agreements/{id}/escrow:lock` and milestone release: a bearer token, when sent, must be
the onboarded Brand that owns the promotion (401 invalid, 403 other Brand); without one
the call is the anonymous dev path unless `KNOT_CAMPAIGN_AUTH_REQUIRED` turns it off (401).

Seed: `promotion-lip-balm` -> brand-1 -> user-brand-1; `promotion-snack` -> brand-2 ->
user-brand-2; `promotion-001` -> brand-001, owned by no user (the anonymous demo promotion).
"""

from fastapi.testclient import TestClient

from apps.api.main import create_app
from libs.repositories.firestore_paths import FirestorePaths
from libs.repositories.seed import seed_demo_repository
from libs.repositories.store import InMemoryDocumentStore, KnotRepository
from libs.settings.config import Settings
from tests.test_api_escrow import auth_headers

OWNER = auth_headers("user-brand-1", "t1@knot.com")
OTHER_BRAND = auth_headers("user-brand-2", "test2@knot.demo")
CREATOR = auth_headers("user-creator-1", "c1@knot.com")
STRANGER = auth_headers("user-nobody", "nobody@example.com")
BAD_TOKEN = {"Authorization": "Bearer not.a.token"}
CAMPAIGN = {"targetCreatorCount": 1, "parallelism": 1}


def _seeded(**overrides: object) -> tuple[TestClient, KnotRepository]:
    repository = KnotRepository(InMemoryDocumentStore())
    seed_demo_repository(repository)
    settings = Settings(auth_mode="emulator", firebase_project_id="knot-dev-503505", **overrides)
    return TestClient(create_app(settings=settings, repository=repository)), repository


def _approval(repository: KnotRepository, approval_id: str, promotion_id: str) -> None:
    repository.save_raw_document(
        FirestorePaths.approval(approval_id),
        {
            "approvalId": approval_id,
            "type": "ESCROW_LOCK",
            "status": "PENDING",
            "promotionId": promotion_id,
            "campaignId": f"campaign-{approval_id}",
            "agreementId": f"agreement-{approval_id}",
            "creatorAgentId": "agent-creator-1",
            "amountUsdc": 450,
            "campaignCommittedUsdc": 450,
            "reasons": ["GOV_SINGLE_AGREEMENT_OVER_AUTO_LIMIT"],
            "ruleVersion": "governance-v1",
            "createdAt": f"2026-10-14T00:00:0{approval_id[-1]}Z",
        },
    )


def _error_code(response) -> str:  # type: ignore[no-untyped-def]
    return response.json()["detail"]["code"]


# --- campaign routes ---------------------------------------------------------------------


def test_owner_brand_runs_streams_and_cancels_its_campaign() -> None:
    client, _ = _seeded()
    response = client.post(
        "/api/v1/promotions/promotion-lip-balm/campaigns", json=CAMPAIGN, headers=OWNER
    )
    assert response.status_code == 201, response.text
    assert response.json()["data"]["campaign"]["promotionId"] == "promotion-lip-balm"

    with client.stream(
        "GET",
        "/api/v1/promotions/promotion-lip-balm/campaigns/stream",
        params=CAMPAIGN,
        headers=OWNER,
    ) as stream:
        assert stream.status_code == 200
        assert stream.headers["content-type"].startswith("text/event-stream")
        body = "".join(stream.iter_text())
    assert "event: campaign_result" in body

    # Owner check happens before the campaign lookup: unknown campaign is still 404.
    cancel = client.post(
        "/api/v1/promotions/promotion-lip-balm/campaigns/nope:cancel", headers=OWNER
    )
    assert cancel.status_code == 404


def test_another_brands_token_is_forbidden_on_every_campaign_route() -> None:
    client, _ = _seeded()
    base = "/api/v1/promotions/promotion-lip-balm/campaigns"
    responses = [
        client.post(base, json=CAMPAIGN, headers=OTHER_BRAND),
        client.get(f"{base}/stream", params=CAMPAIGN, headers=OTHER_BRAND),
        client.post(f"{base}/nope:cancel", headers=OTHER_BRAND),
    ]
    for response in responses:
        assert response.status_code == 403, response.text
        assert _error_code(response) == "FORBIDDEN"
    # Nothing ran: the promotion timeline has no campaign events.
    events = client.get("/api/v1/promotions/promotion-lip-balm/timeline").json()["data"]["events"]
    assert not [e for e in events if e["type"].startswith("CAMPAIGN_")]


def test_ownership_is_by_brand_id_not_owner_uid() -> None:
    # promotion-001 belongs to brand-001; user-brand-1 is brand-1 even though the fixture
    # carries ownerUid=user-brand-1 on it. `/brand/promotions/{id}` draws the same line.
    client, _ = _seeded()
    response = client.post("/api/v1/promotions/promotion-001/campaigns", json={}, headers=OWNER)
    assert response.status_code == 403
    assert _error_code(response) == "FORBIDDEN"


def test_non_brand_tokens_are_rejected_like_brand_routes() -> None:
    client, _ = _seeded()
    url = "/api/v1/promotions/promotion-lip-balm/campaigns"
    creator = client.post(url, json=CAMPAIGN, headers=CREATOR)
    assert creator.status_code == 403 and _error_code(creator) == "FORBIDDEN"
    # An unknown uid is bootstrapped without a role, so it is also a 403, not a 500.
    stranger = client.post(url, json=CAMPAIGN, headers=STRANGER)
    assert stranger.status_code == 403 and _error_code(stranger) == "FORBIDDEN"
    invalid = client.post(url, json=CAMPAIGN, headers=BAD_TOKEN)
    assert invalid.status_code == 401 and _error_code(invalid) == "UNAUTHENTICATED"


def test_owner_token_on_unknown_promotion_is_404() -> None:
    client, _ = _seeded()
    response = client.post("/api/v1/promotions/nope/campaigns", json={}, headers=OWNER)
    assert response.status_code == 404


def test_anonymous_dev_path_still_runs_the_demo_promotion() -> None:
    # The seeded demo promotion has no owning user; without a header it keeps working.
    client, _ = _seeded()
    response = client.post("/api/v1/promotions/promotion-001/campaigns", json=CAMPAIGN)
    assert response.status_code == 201, response.text


def test_required_mode_turns_the_anonymous_path_into_401() -> None:
    client, repository = _seeded(campaign_auth_required=True)
    base = "/api/v1/promotions/promotion-lip-balm/campaigns"
    _approval(repository, "approval-a1", "promotion-lip-balm")
    anonymous = [
        client.post(base, json=CAMPAIGN),
        client.get(f"{base}/stream", params=CAMPAIGN),
        client.post(f"{base}/nope:cancel"),
        client.get("/api/v1/approvals"),
        client.get("/api/v1/approvals/approval-a1"),
        client.post("/api/v1/approvals/approval-a1:approve"),
        client.post("/api/v1/approvals/approval-a1:reject", json={"reason": "x"}),
    ]
    for response in anonymous:
        assert response.status_code == 401, response.text
        assert _error_code(response) == "UNAUTHENTICATED"
    # The owner is unaffected by the switch.
    owned = client.post(base, json=CAMPAIGN, headers=OWNER)
    assert owned.status_code == 201, owned.text
    assert client.get("/api/v1/approvals/approval-a1", headers=OWNER).status_code == 200


# --- approval routes ---------------------------------------------------------------------


def test_approval_list_is_scoped_to_the_callers_brand() -> None:
    client, repository = _seeded()
    _approval(repository, "approval-a1", "promotion-lip-balm")
    _approval(repository, "approval-a2", "promotion-snack")
    _approval(repository, "approval-a3", "promotion-001")

    def ids(headers: dict[str, str] | None = None) -> list[str]:
        response = client.get("/api/v1/approvals", headers=headers)
        assert response.status_code == 200, response.text
        return [a["approvalId"] for a in response.json()["data"]["approvals"]]

    assert ids(OWNER) == ["approval-a1"]
    assert ids(OTHER_BRAND) == ["approval-a2"]
    assert ids() == ["approval-a1", "approval-a2", "approval-a3"]  # anonymous dev path
    assert client.get("/api/v1/approvals", headers=CREATOR).status_code == 403
    assert client.get("/api/v1/approvals", headers=BAD_TOKEN).status_code == 401


def test_only_the_owning_brand_may_read_or_decide_an_approval() -> None:
    client, repository = _seeded()
    _approval(repository, "approval-a1", "promotion-lip-balm")
    other = [
        client.get("/api/v1/approvals/approval-a1", headers=OTHER_BRAND),
        client.post("/api/v1/approvals/approval-a1:approve", headers=OTHER_BRAND),
        client.post(
            "/api/v1/approvals/approval-a1:reject", json={"reason": "no"}, headers=OTHER_BRAND
        ),
    ]
    for response in other:
        assert response.status_code == 403, response.text
        assert _error_code(response) == "FORBIDDEN"
    still = repository.get_raw_document(FirestorePaths.approval("approval-a1"))
    assert still is not None and still["status"] == "PENDING" and "decidedBy" not in still
    assert client.get("/api/v1/approvals/nope", headers=OWNER).status_code == 404


def test_approve_records_who_decided_and_shows_it_on_the_timeline() -> None:
    client, repository = _seeded()  # web3 local: approve settles as SKIPPED, decision recorded
    _approval(repository, "approval-a1", "promotion-lip-balm")
    response = client.post("/api/v1/approvals/approval-a1:approve", headers=OWNER)
    assert response.status_code == 200, response.text
    approval = response.json()["data"]["approval"]
    assert approval["status"] == "APPROVED" and approval["decidedBy"] == "user-brand-1"
    stored = repository.get_raw_document(FirestorePaths.approval("approval-a1"))
    assert stored is not None and stored["decidedBy"] == "user-brand-1"

    events = client.get("/api/v1/promotions/promotion-lip-balm/timeline").json()["data"]["events"]
    granted = next(e for e in events if e["type"] == "APPROVAL_GRANTED")
    assert granted["data"]["decidedBy"] == "user-brand-1"
    assert granted["data"]["approvalId"] == "approval-a1"

    # Idempotent re-approval keeps the first decision's author.
    again = client.post("/api/v1/approvals/approval-a1:approve", headers=OWNER)
    assert again.status_code == 200
    assert again.json()["data"]["approval"]["decidedBy"] == "user-brand-1"


def test_reject_records_who_decided_and_anonymous_path_records_none() -> None:
    client, repository = _seeded()
    _approval(repository, "approval-a1", "promotion-lip-balm")
    _approval(repository, "approval-a3", "promotion-001")

    owned = client.post(
        "/api/v1/approvals/approval-a1:reject", json={"reason": "budget"}, headers=OWNER
    )
    assert owned.status_code == 200, owned.text
    assert owned.json()["data"]["approval"]["decidedBy"] == "user-brand-1"
    events = client.get("/api/v1/promotions/promotion-lip-balm/timeline").json()["data"]["events"]
    rejected = next(e for e in events if e["type"] == "APPROVAL_REJECTED")
    assert rejected["data"]["decidedBy"] == "user-brand-1"
    assert rejected["data"]["reason"] == "budget"

    anonymous = client.post("/api/v1/approvals/approval-a3:reject", json={"reason": "demo"})
    assert anonymous.status_code == 200, anonymous.text
    assert anonymous.json()["data"]["approval"]["decidedBy"] is None
