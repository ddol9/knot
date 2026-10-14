import base64
import json
from datetime import date, timedelta

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from apps.api import routes as api_routes
from apps.api.main import create_app
from libs.domain.hashing import terms_hash
from libs.domain.models import AgreementTerms
from libs.payments.paysh import PayResult, pay_available
from libs.payments.settlement import lock_amount_base_units, milestone_amounts_base_units
from libs.repositories.firestore_paths import COLLECTIONS, FirestorePaths
from libs.repositories.seed import seed_demo_repository
from libs.repositories.store import InMemoryDocumentStore, KnotRepository
from libs.settings.config import Settings


class FakeHttpResponse:
    def __init__(self, payload: dict[str, object]) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, object]:
        return self._payload


class NoCreatorProfileScanStore(InMemoryDocumentStore):
    def list_documents(self, collection_path: str) -> list[dict[str, object]]:
        if collection_path == COLLECTIONS.creator_profiles:
            raise AssertionError("creatorProfiles collection scan is forbidden during discovery")
        return super().list_documents(collection_path)


def client_with_seed(settings: Settings | None = None) -> TestClient:
    store = InMemoryDocumentStore()
    repository = KnotRepository(store)
    seed_demo_repository(repository)
    return TestClient(create_app(settings=settings, repository=repository))


def client_and_repository_with_seed(
    settings: Settings | None = None,
) -> tuple[TestClient, KnotRepository]:
    store = InMemoryDocumentStore()
    repository = KnotRepository(store)
    seed_demo_repository(repository)
    return TestClient(create_app(settings=settings, repository=repository)), repository


def auth_headers(uid: str = "user-brand-1", email: str = "t1@knot.com") -> dict[str, str]:
    header = _b64({"alg": "none", "typ": "JWT"})
    payload = _b64(
        {
            "sub": uid,
            "user_id": uid,
            "email": email,
            "name": "KNOT Tester",
            "aud": "knot-dev-503505",
        }
    )
    return {"Authorization": f"Bearer {header}.{payload}."}


def _b64(payload: dict[str, object]) -> str:
    encoded = base64.urlsafe_b64encode(json.dumps(payload).encode("utf-8")).decode("ascii")
    return encoded.rstrip("=")


def set_creator_min_base(
    repository: KnotRepository,
    agent_id: str,
    min_base_usdc: int,
) -> None:
    policy = repository.get_raw_document(FirestorePaths.agent_policy(agent_id))
    assert policy is not None
    creator_policy = policy["creator"]
    assert isinstance(creator_policy, dict)
    repository.save_raw_document(
        FirestorePaths.agent_policy(agent_id),
        {
            **policy,
            "creator": {
                **creator_policy,
                "minBaseUsdc": min_base_usdc,
            },
        },
    )


def accepted_agreement(client: TestClient) -> dict[str, object]:
    match_run = client.post("/api/v1/promotions/promotion-001/matches:run").json()["data"][
        "matchRun"
    ]
    return client.post(f"/api/v1/match-runs/{match_run['matchRunId']}:start-negotiation").json()[
        "data"
    ]["agreement"]


def test_start_negotiation_path_action_alias() -> None:
    client = client_with_seed()
    match_run = client.post("/api/v1/promotions/promotion-001/matches:run").json()["data"][
        "matchRun"
    ]

    response = client.post(f"/api/v1/match-runs/{match_run['matchRunId']}/start-negotiation")

    assert response.status_code == 201
    assert response.json()["data"]["negotiation"]["status"] == "AGREED"


def fund_agreement_for_evidence(
    repository: KnotRepository,
    agreement: dict[str, object],
) -> dict[str, object]:
    terms = AgreementTerms.model_validate(agreement["terms"])
    locked_amount = lock_amount_base_units(terms)
    milestone_amounts = milestone_amounts_base_units(locked_amount, terms.milestones)
    escrow_id = f"escrow-{agreement['agreementId']}"
    now = "2026-07-31T00:00:00Z"
    escrow = {
        "escrowId": escrow_id,
        "agreementId": agreement["agreementId"],
        "promotionId": agreement["promotionId"],
        "brandAgentId": agreement["brandAgentId"],
        "creatorAgentId": agreement["creatorAgentId"],
        "network": "solanaTestnet",
        "programId": "program-test",
        "mint": "mint-test",
        "lockedAmountBaseUnits": str(locked_amount),
        "releasedAmountBaseUnits": "0",
        "platformFeeBps": 0,
        "termsHash": agreement["termsHash"],
        "milestoneAmounts": {
            milestone_id: str(amount) for milestone_id, amount in milestone_amounts.items()
        },
        "status": "LOCKED",
        "lockSignature": "evidence-lock-signature",
        "lockReceiptId": "receipt-evidence-lock",
        "paymentOperationId": "op-evidence-lock",
        "idempotencyKey": "evidence-lock",
        "createdAt": now,
        "updatedAt": now,
    }
    repository.save_raw_document(FirestorePaths.escrow(escrow_id), escrow)
    return escrow


def test_list_and_get_seeded_promotions() -> None:
    client = client_with_seed()

    list_response = client.get("/api/v1/promotions")
    assert list_response.status_code == 200
    promotions = list_response.json()["data"]["promotions"]
    assert "promotion-001" in [promotion["promotionId"] for promotion in promotions]

    get_response = client.get("/api/v1/promotions/promotion-001")
    assert get_response.status_code == 200
    assert get_response.json()["data"]["promotion"]["title"] == "Summer skincare launch"


def test_create_and_activate_promotion_records_timeline_events() -> None:
    client = client_with_seed()
    payload = {
        "promotionId": "promotion-api-001",
        "title": "Creator capsule launch",
        "objective": "awareness",
        "category": "beauty",
        "targetAudience": ["20s"],
        "budget": {"totalUsdc": 1500, "maxPerCreatorUsdc": 750},
        "deliverables": [{"format": "reel", "count": 1}],
        "postingWindow": {"start": "2026-08-05", "end": "2026-08-10"},
        "usageRights": "paidBoost30d",
        "constraints": {"requiredCategories": ["beauty"], "requiredDisclosures": ["ad"]},
    }

    create_response = client.post("/api/v1/promotions", json=payload)
    assert create_response.status_code == 201
    assert create_response.json()["data"]["promotion"]["status"] == "DRAFT"

    activate_response = client.post("/api/v1/promotions/promotion-api-001:activate")
    assert activate_response.status_code == 200
    assert activate_response.json()["data"]["promotion"]["status"] == "ACTIVE"

    timeline_response = client.get("/api/v1/promotions/promotion-api-001/timeline")
    assert timeline_response.status_code == 200
    assert [event["type"] for event in timeline_response.json()["data"]["events"]] == [
        "PROMOTION_CREATED",
        "PROMOTION_ACTIVATED",
    ]


def test_run_match_persists_run_candidates_and_timeline_event() -> None:
    client = client_with_seed()

    run_response = client.post("/api/v1/promotions/promotion-001/matches:run")
    assert run_response.status_code == 201
    match_run = run_response.json()["data"]["matchRun"]
    assert match_run["status"] == "COMPLETED"
    assert match_run["selectedCreatorAgentId"] == "agent-creator-1"

    candidates_response = client.get(f"/api/v1/match-runs/{match_run['matchRunId']}/candidates")
    assert candidates_response.status_code == 200
    candidates = candidates_response.json()["data"]["candidates"]
    assert candidates[0]["creatorAgentId"] == "agent-creator-1"
    assert candidates[0]["creatorId"] == "creator-1"
    assert candidates[0]["creatorProfilePath"] == "creatorProfiles/creator-1"
    assert candidates[0]["rank"] == 1
    assert candidates[0]["eligible"] is True
    assert candidates[0]["analysisProvider"] == "deterministic"
    assert candidates[0]["analysisModel"] is None
    assert candidates[0]["analysisFallbackReason"] == "gemini_mode_off"

    timeline_response = client.get("/api/v1/promotions/promotion-001/timeline")
    event_types = [event["type"] for event in timeline_response.json()["data"]["events"]]
    assert "API_PAYMENT" in event_types
    assert "MATCH_RUN_COMPLETED" in event_types


def test_run_match_uses_indexed_discovery_without_creator_profile_scan() -> None:
    store = NoCreatorProfileScanStore()
    repository = KnotRepository(store)
    seed_demo_repository(repository)
    client = TestClient(create_app(repository=repository))

    run_response = client.post("/api/v1/promotions/promotion-001/matches:run")

    assert run_response.status_code == 201
    match_run = run_response.json()["data"]["matchRun"]
    assert match_run["discoveryLimit"] == 100
    assert match_run["discoveryReturnedCount"] == 6
    assert match_run["detailReadLimit"] == 20
    assert match_run["detailReadCount"] == 6


def test_run_match_uses_any_supported_format_not_only_primary_format() -> None:
    client = client_with_seed()
    payload = {
        "promotionId": "promotion-short-format",
        "title": "Shorts skincare launch",
        "objective": "short-form awareness",
        "category": "beauty",
        "targetAudience": ["skincare"],
        "budget": {"totalUsdc": 1000, "maxPerCreatorUsdc": 750},
        "deliverables": [
            {
                "format": "short",
                "count": 1,
                "postWindow": {"start": "2026-08-10", "end": "2026-08-10"},
                "revisionRounds": 1,
            }
        ],
        "postingWindow": {"start": "2026-08-10", "end": "2026-08-10"},
        "usageRights": "organicOnly",
        "constraints": {"requiredCategories": ["beauty"]},
    }
    create_response = client.post("/api/v1/promotions", json=payload)
    assert create_response.status_code == 201

    run_response = client.post("/api/v1/promotions/promotion-short-format/matches:run")

    assert run_response.status_code == 201
    match_run = run_response.json()["data"]["matchRun"]
    assert match_run["selectedCreatorAgentId"] == "agent-creator-1"
    assert match_run["discoveryReturnedCount"] >= 1


def test_canonical_match_run_alias_preserves_existing_matching_behavior() -> None:
    client = client_with_seed()

    run_response = client.post("/api/v1/promotions/promotion-001/match-runs")

    assert run_response.status_code == 201
    match_run = run_response.json()["data"]["matchRun"]
    assert match_run["promotionId"] == "promotion-001"
    assert match_run["status"] == "COMPLETED"

    timeline_response = client.get(f"/api/v1/match-runs/{match_run['matchRunId']}/timeline")
    events_response = client.get(f"/api/v1/match-runs/{match_run['matchRunId']}/events")
    assert timeline_response.status_code == 200
    assert events_response.status_code == 200
    assert [event["type"] for event in timeline_response.json()["data"]["events"]] == [
        event["type"] for event in events_response.json()["data"]["events"]
    ]


def test_match_run_start_is_idempotent_and_records_canonical_events() -> None:
    client = client_with_seed()
    headers = {"Idempotency-Key": "match-start-001"}

    first = client.post("/api/v1/promotions/promotion-001/match-runs", headers=headers)
    second = client.post("/api/v1/promotions/promotion-001/match-runs", headers=headers)

    assert first.status_code == 201
    assert second.status_code == 201
    first_run = first.json()["data"]["matchRun"]
    second_run = second.json()["data"]["matchRun"]
    assert second_run["matchRunId"] == first_run["matchRunId"]
    assert first_run["stateHistory"] == [
        "READY",
        "DISCOVERING",
        "RANKING",
        "SELECTING",
        "COMPLETED",
    ]

    events = client.get(f"/api/v1/match-runs/{first_run['matchRunId']}/events").json()["data"][
        "events"
    ]
    assert [event["type"] for event in events] == [
        "MATCH_RUN_READY",
        "MATCH_RUN_DISCOVERING",
        "MATCH_RUN_RANKING",
        "MATCH_RUN_SELECTING",
        "MATCH_RUN_COMPLETED",
    ]
    assert [event["sequence"] for event in events] == [1, 2, 3, 4, 5]


def test_match_run_cancel_handles_non_terminal_and_terminal_runs() -> None:
    client, repository = client_and_repository_with_seed()
    repository.save_raw_document(
        FirestorePaths.match_run("match-cancelable"),
        {
            "matchRunId": "match-cancelable",
            "promotionId": "promotion-001",
            "brandAgentId": "brand-agent-001",
            "status": "QUEUED",
            "createdAt": "2026-07-31T00:00:00Z",
        },
    )

    canceled = client.post("/api/v1/match-runs/match-cancelable:cancel")
    assert canceled.status_code == 200
    assert canceled.json()["data"]["matchRun"]["status"] == "CANCELED"
    cancel_events = client.get("/api/v1/match-runs/match-cancelable/events").json()["data"][
        "events"
    ]
    assert cancel_events[0]["type"] == "MATCH_RUN_CANCELED"

    completed = client.post("/api/v1/promotions/promotion-001/matches:run").json()["data"][
        "matchRun"
    ]
    rejected = client.post(f"/api/v1/match-runs/{completed['matchRunId']}:cancel")
    assert rejected.status_code == 409
    assert rejected.json()["detail"]["code"] == "INVALID_STATE_TRANSITION"


def test_run_match_records_skipped_paysh_event_when_resource_is_unconfigured() -> None:
    client, repository = client_and_repository_with_seed(
        Settings(paysh_mode="sandbox", paysh_resource_id="replace-me")
    )

    run_response = client.post("/api/v1/promotions/promotion-001/matches:run")
    assert run_response.status_code == 201
    match_run = run_response.json()["data"]["matchRun"]
    assert match_run["paidVerification"]["provider"] == "pay.sh"
    assert match_run["paidVerification"]["protocol"] == "x402"
    assert match_run["paidVerification"]["status"] == "SKIPPED"
    assert match_run["paidVerification"]["nonAuthoritative"] is True

    timeline = client.get("/api/v1/promotions/promotion-001/timeline").json()["data"]["events"]
    api_payment = next(event for event in timeline if event["type"] == "API_PAYMENT")
    assert api_payment["data"]["status"] == "SKIPPED"
    operations = repository.list_raw_documents(COLLECTIONS.payment_operations)
    assert operations[0]["operationType"] == "PAYSH_CANDIDATE_VERIFICATION"
    assert operations[0]["receiptId"] is None


def test_run_match_records_paysh_sandbox_receipt(monkeypatch) -> None:
    def fake_fetch(resource_id: str, *, sandbox: bool, timeout_seconds: int) -> PayResult:
        assert resource_id == "https://debugger.pay.sh/mpp/quote/AAPL"
        assert sandbox is True
        assert timeout_seconds == 7
        return PayResult(
            ok=True,
            returncode=0,
            body='{"receiptId": "receipt-pay-001", "result": {"ok": true}}',
            stderr="",
        )

    monkeypatch.setattr("apps.api.routes.fetch_paysh", fake_fetch)
    client, repository = client_and_repository_with_seed(
        Settings(
            paysh_mode="sandbox",
            paysh_resource_id="https://debugger.pay.sh/mpp/quote/AAPL",
            paysh_timeout_seconds=7,
        )
    )

    run_response = client.post("/api/v1/promotions/promotion-001/matches:run")
    assert run_response.status_code == 201
    match_run = run_response.json()["data"]["matchRun"]
    assert match_run["paidVerification"]["status"] == "SETTLED"
    assert match_run["paidVerification"]["externalReceiptId"] == "receipt-pay-001"
    assert match_run["paidVerification"]["receiptId"].startswith("receipt-paysh-")
    assert match_run["paidVerification"]["quote"] == {
        "amountUsdc": 0.02,
        "currency": "USDC",
        "validated": True,
    }
    assert match_run["paidVerification"]["scoreImpact"]["selectionChanged"] is False

    timeline = client.get("/api/v1/promotions/promotion-001/timeline").json()["data"]["events"]
    api_payment = next(event for event in timeline if event["type"] == "API_PAYMENT")
    assert api_payment["data"]["externalReceiptId"] == "receipt-pay-001"
    assert api_payment["data"]["selectedCreatorAgentId"] == "agent-creator-1"
    operations = repository.list_raw_documents(COLLECTIONS.payment_operations)
    receipts = repository.list_raw_documents(COLLECTIONS.transaction_receipts)
    assert len(operations) == 1
    assert len(receipts) == 1
    assert operations[0]["paymentType"] == "PAYSH_X402"
    assert operations[0]["paidVerification"]["resultDigest"].startswith("sha256:")
    assert receipts[0]["paymentType"] == "PAYSH_X402"
    assert receipts[0]["network"] == "pay.sh:sandbox"
    assert receipts[0]["status"] == "CONFIRMED"


def test_brand_agent_run_starts_a2a_and_projects_paysh_message(monkeypatch) -> None:
    def fake_fetch(resource_id: str, *, sandbox: bool, timeout_seconds: int) -> PayResult:
        assert resource_id == "https://debugger.pay.sh/mpp/quote/AAPL"
        assert sandbox is True
        return PayResult(
            ok=True,
            returncode=0,
            body='{"receiptId": "receipt-pay-agent-run", "result": {"ok": true}}',
            stderr="",
        )

    monkeypatch.setattr("apps.api.routes.fetch_paysh", fake_fetch)
    client, repository = client_and_repository_with_seed(
        Settings(
            auth_mode="emulator",
            firebase_project_id="knot-dev-503505",
            paysh_mode="sandbox",
            paysh_resource_id="https://debugger.pay.sh/mpp/quote/AAPL",
        )
    )
    repository.save_raw_document(
        FirestorePaths.user("legacy-brand-owner"),
        {
            "userId": "legacy-brand-owner",
            "uid": "legacy-brand-owner",
            "email": "legacy-brand@example.com",
            "role": "BRAND",
            "activeRole": "brand",
            "onboardingStatus": "COMPLETED",
            "status": "ACTIVE",
            "brandId": "brand-001",
            "agentId": "brand-agent-001",
        },
    )

    response = client.post(
        "/api/v1/brand/promotions/promotion-001/agent-run",
        headers={
            **auth_headers("legacy-brand-owner", "legacy-brand@example.com"),
            "Idempotency-Key": "agent-run-paysh-visible",
        },
    )

    assert response.status_code == 201, response.text
    flow = response.json()["data"]
    assert flow["waitingForCreator"] is False
    assert flow["matchRun"]["paidVerification"]["status"] == "SETTLED"
    assert flow["negotiation"]["status"] == "AGREED"
    assert flow["agreement"]["agreementId"].startswith("agreement-")

    second = client.post(
        "/api/v1/brand/promotions/promotion-001/agent-run",
        headers={
            **auth_headers("legacy-brand-owner", "legacy-brand@example.com"),
            "Idempotency-Key": "agent-run-paysh-visible",
        },
    )
    assert second.status_code == 201
    assert (
        second.json()["data"]["negotiation"]["negotiationId"]
        == flow["negotiation"]["negotiationId"]
    )

    messages = client.get(
        f"/api/v1/negotiations/{flow['negotiation']['negotiationId']}/messages"
    ).json()["data"]["messages"]
    pay_message = next(
        message for message in messages if message["messageId"].startswith("system-paysh-")
    )
    assert pay_message["role"] == "ROLE_SYSTEM"
    assert pay_message["payload"]["type"] == "VERIFICATION_EVENT"
    assert pay_message["payload"]["status"] == "SETTLED"
    assert pay_message["payload"]["externalReceiptId"] == "receipt-pay-agent-run"
    assert len(repository.list_raw_documents(COLLECTIONS.payment_operations)) == 1


@pytest.mark.integration
@pytest.mark.skipif(
    not pay_available(),
    reason="pay CLI/npx 미설치 (npm i -g @solana/pay)",
)
def test_run_match_pays_a_real_paysh_sandbox_call() -> None:
    """monkeypatch 없이 실제 pay CLI 로 x402 결제를 수행한다.

    해커톤 가산점의 근거가 되는 유일한 증거이므로 mock 을 쓰지 않는다.
    pay CLI 가 없는 환경에서는 skip 된다.
    """
    client, repository = client_and_repository_with_seed(
        Settings(
            paysh_mode="sandbox",
            paysh_resource_id="https://debugger.pay.sh/mpp/quote/AAPL",
            paysh_timeout_seconds=90,
        )
    )

    run_response = client.post("/api/v1/promotions/promotion-001/matches:run")
    assert run_response.status_code == 201, run_response.text
    paid = run_response.json()["data"]["matchRun"]["paidVerification"]
    assert paid["status"] == "SETTLED", paid

    receipts = repository.list_raw_documents(COLLECTIONS.transaction_receipts)
    assert len(receipts) == 1
    assert receipts[0]["paymentType"] == "PAYSH_X402"
    assert receipts[0]["network"] == "pay.sh:sandbox"
    assert receipts[0]["status"] == "CONFIRMED"

    operations = repository.list_raw_documents(COLLECTIONS.payment_operations)
    assert operations[0]["paidVerification"]["resultDigest"].startswith("sha256:")


def test_run_match_blocks_paysh_when_quote_exceeds_cap(monkeypatch) -> None:
    def fake_fetch(resource_id: str, *, sandbox: bool, timeout_seconds: int) -> PayResult:
        raise AssertionError("pay.sh must not be called when quote exceeds cap")

    monkeypatch.setattr("apps.api.routes.fetch_paysh", fake_fetch)
    client, repository = client_and_repository_with_seed(
        Settings(
            paysh_mode="sandbox",
            paysh_resource_id="https://debugger.pay.sh/mpp/quote/AAPL",
            paysh_quote_amount_usdc=0.03,
            paysh_max_call_amount_usdc=0.02,
        )
    )

    run_response = client.post("/api/v1/promotions/promotion-001/matches:run")
    assert run_response.status_code == 201
    paid = run_response.json()["data"]["matchRun"]["paidVerification"]
    assert paid["status"] == "SKIPPED"
    assert paid["detail"] == "pay.sh quote exceeds per-call spend cap."
    assert paid["continuation"] == "FREE_SIGNALS_ONLY"
    assert repository.list_raw_documents(COLLECTIONS.transaction_receipts) == []


def test_run_match_blocks_paysh_when_resource_is_not_allowlisted(monkeypatch) -> None:
    def fake_fetch(resource_id: str, *, sandbox: bool, timeout_seconds: int) -> PayResult:
        raise AssertionError("pay.sh must not be called for non-allowlisted resources")

    monkeypatch.setattr("apps.api.routes.fetch_paysh", fake_fetch)
    client = client_with_seed(
        Settings(
            paysh_mode="sandbox",
            paysh_resource_id="https://not-pay.example/mpp/quote/AAPL",
            paysh_allowed_resource_prefixes=["https://debugger.pay.sh/mpp/quote/"],
        )
    )

    run_response = client.post("/api/v1/promotions/promotion-001/matches:run")
    assert run_response.status_code == 201
    paid = run_response.json()["data"]["matchRun"]["paidVerification"]
    assert paid["status"] == "SKIPPED"
    assert paid["detail"] == "PAYSH_RESOURCE_ID is not allowlisted."


def test_run_match_idempotency_does_not_double_pay(monkeypatch) -> None:
    calls: list[str] = []

    def fake_fetch(resource_id: str, *, sandbox: bool, timeout_seconds: int) -> PayResult:
        calls.append(resource_id)
        return PayResult(
            ok=True,
            returncode=0,
            body='{"receiptId": "receipt-pay-idempotent"}',
            stderr="",
        )

    monkeypatch.setattr("apps.api.routes.fetch_paysh", fake_fetch)
    client, repository = client_and_repository_with_seed(
        Settings(
            paysh_mode="sandbox",
            paysh_resource_id="https://debugger.pay.sh/mpp/quote/AAPL",
        )
    )
    headers = {"Idempotency-Key": "frontend-match-paid-once"}

    first = client.post("/api/v1/promotions/promotion-001/matches:run", headers=headers)
    second = client.post("/api/v1/promotions/promotion-001/matches:run", headers=headers)

    assert first.status_code == 201
    assert second.status_code == 201
    assert calls == ["https://debugger.pay.sh/mpp/quote/AAPL"]
    first_match_run = first.json()["data"]["matchRun"]
    second_match_run = second.json()["data"]["matchRun"]
    assert second_match_run["matchRunId"] == first_match_run["matchRunId"]
    assert len(repository.list_raw_documents(COLLECTIONS.payment_operations)) == 1
    assert len(repository.list_raw_documents(COLLECTIONS.transaction_receipts)) == 1


def test_run_match_normalizes_korean_category_aliases() -> None:
    client = client_with_seed()
    # 협상까지 가는 테스트라 postingWindow 는 오늘 기준 상대값이어야 한다.
    # 고정 날짜는 지나는 순간 creator 정책의 minDaysToPost 에 걸려 ESCALATED 가 된다.
    window_start = date.today() + timedelta(days=17)
    payload = {
        "promotionId": "promotion-korean-beauty",
        "title": "Korean skincare launch",
        "objective": "awareness",
        "category": "스킨케어",
        "targetAudience": ["20s"],
        "budget": {"totalUsdc": 1500, "maxPerCreatorUsdc": 800},
        "deliverables": [{"format": "reel", "count": 1}],
        "postingWindow": {
            "start": window_start.isoformat(),
            "end": (window_start + timedelta(days=5)).isoformat(),
        },
        "usageRights": "paidBoost30d",
        "constraints": {"requiredCategories": ["뷰티"], "requiredDisclosures": ["ad"]},
    }
    assert client.post("/api/v1/promotions", json=payload).status_code == 201

    run_response = client.post("/api/v1/promotions/promotion-korean-beauty/matches:run")

    assert run_response.status_code == 201
    match_run = run_response.json()["data"]["matchRun"]
    assert match_run["selectedCreatorAgentId"] == "agent-creator-1"
    start_response = client.post(f"/api/v1/match-runs/{match_run['matchRunId']}:start-negotiation")
    assert start_response.status_code == 201
    assert start_response.json()["data"]["negotiation"]["status"] == "AGREED"


def test_run_match_normalizes_korean_fashion_product_aliases() -> None:
    client, repository = client_and_repository_with_seed()
    creator = repository.get_creator_profile("creator-003")
    assert creator is not None
    repository.save_raw_document(
        FirestorePaths.creator_profile("creator-003"),
        {
            **creator.model_dump(mode="json", by_alias=True),
            "categories": ["fashion", "lifestyle"],
            "rateCard": {"minBaseUsdc": 10, "maxBaseUsdc": 50},
            "supportedDeliverableFormats": ["reel", "short", "post"],
        },
    )
    agent = repository.get_raw_document(FirestorePaths.agent("creator-agent-003"))
    assert agent is not None
    repository.save_raw_document(
        FirestorePaths.agent("creator-agent-003"),
        {
            **agent,
            "publicationStatus": "PUBLISHED",
            "acceptingOffers": True,
            "availability": "AVAILABLE",
        },
    )
    discovery = repository.get_raw_document(FirestorePaths.creator_discovery_profile("creator-003"))
    assert discovery is not None
    repository.save_raw_document(
        FirestorePaths.creator_discovery_profile("creator-003"),
        {
            **discovery,
            "categoryKeys": ["fashion", "lifestyle"],
            "primaryCategoryKey": "fashion",
            "formatKeys": ["reel", "short", "post"],
            "primaryFormatKey": "reel",
            "publicRateBand": "under_250",
            "agentStatus": "PUBLISHED",
            "acceptingOffers": True,
            "availability": "AVAILABLE",
            "capacityAvailable": True,
        },
    )
    payload = {
        "promotionId": "promotion-korean-fashion-sleeveless",
        "title": "RX 에어 메쉬 맨즈 슬리브리스",
        "objective": "awareness",
        "category": "남성 슬리브리스",
        "targetAudience": ["운동", "데일리"],
        "budget": {"totalUsdc": 20, "maxPerCreatorUsdc": 10},
        "deliverables": [{"format": "reel", "count": 1}],
        "postingWindow": {"start": "2026-08-17", "end": "2026-08-17"},
        "usageRights": "organicOnly",
        "constraints": {"requiredCategories": ["남성 슬리브리스"]},
    }
    assert client.post("/api/v1/promotions", json=payload).status_code == 201

    run_response = client.post("/api/v1/promotions/promotion-korean-fashion-sleeveless/matches:run")

    assert run_response.status_code == 201
    match_run = run_response.json()["data"]["matchRun"]
    assert match_run["status"] == "COMPLETED"
    assert match_run["selectedCreatorAgentId"] == "creator-agent-003"


def test_start_negotiation_reports_no_eligible_creator() -> None:
    client = client_with_seed()
    payload = {
        "promotionId": "promotion-no-eligible",
        "title": "Restricted Promotion",
        "objective": "awareness",
        "category": "도박",
        "targetAudience": ["20s"],
        "budget": {"totalUsdc": 100, "maxPerCreatorUsdc": 100},
        "deliverables": [{"format": "reel", "count": 1}],
        "postingWindow": {"start": "2026-08-05", "end": "2026-08-10"},
        "usageRights": "paidBoost30d",
        "constraints": {"requiredCategories": ["도박"], "requiredDisclosures": ["ad"]},
    }
    assert client.post("/api/v1/promotions", json=payload).status_code == 201
    match_run = client.post("/api/v1/promotions/promotion-no-eligible/matches:run").json()["data"][
        "matchRun"
    ]
    assert match_run["status"] == "WAITING_FOR_CREATOR"
    assert match_run["selectedCreatorAgentId"] is None
    assert match_run["stateHistory"] == [
        "READY",
        "DISCOVERING",
        "RANKING",
        "SELECTING",
        "WAITING_FOR_CREATOR",
    ]

    timeline_response = client.get("/api/v1/promotions/promotion-no-eligible/timeline")
    event_types = [event["type"] for event in timeline_response.json()["data"]["events"]]
    assert "MATCH_RUN_WAITING_FOR_CREATOR" in event_types

    response = client.post(f"/api/v1/match-runs/{match_run['matchRunId']}:start-negotiation")

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "NO_ELIGIBLE_CREATOR"


def test_select_candidate_reports_undiscovered_candidate() -> None:
    client = client_with_seed()
    match_run = client.post("/api/v1/promotions/promotion-001/matches:run").json()["data"][
        "matchRun"
    ]

    response = client.post(
        f"/api/v1/match-runs/{match_run['matchRunId']}/candidates/creator-agent-002:select"
    )

    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "RESOURCE_NOT_FOUND"


def test_start_negotiation_persists_messages_events_and_agreement() -> None:
    client, repository = client_and_repository_with_seed()
    match_run = client.post("/api/v1/promotions/promotion-001/matches:run").json()["data"][
        "matchRun"
    ]

    start_response = client.post(f"/api/v1/match-runs/{match_run['matchRunId']}:start-negotiation")

    assert start_response.status_code == 201
    body = start_response.json()["data"]
    negotiation = body["negotiation"]
    agreement = body["agreement"]
    assert negotiation["status"] == "AGREED"
    assert negotiation["matchRunId"] == match_run["matchRunId"]
    assert negotiation["matchCandidateId"] == "creator-1"
    assert negotiation["creatorAgentId"] == "agent-creator-1"
    assert agreement["status"] == "FUNDING_REQUIRED"
    assert agreement["artifactId"].startswith("artifact-")
    assert agreement["termsHash"].startswith("sha256:")
    assert agreement["canonicalTermsJson"].startswith("{")
    assert agreement["hashAlgorithm"] == "sha256"
    assert agreement["hashVersion"] == "knot.agreement-terms.v1"
    assert agreement["brandDisplayName"] == "Demo Skincare Brand"
    assert agreement["brandSnapshot"] == {
        "brandId": "brand-001",
        "displayName": "Demo Skincare Brand",
        "websiteUrl": None,
        "categories": [],
        "targetAudience": None,
        "description": None,
    }
    assert agreement["creatorSnapshot"]["displayName"] == "민지의 뷰티룸"
    assert agreement["creatorSnapshot"]["completedDealCount"] == 18
    assert agreement["promotionSnapshot"]["productName"] == "Summer skincare launch"
    # 계약금 20% + 잔금 80% 2분할 (docs/17 D3·N1)
    assert agreement["terms"]["milestones"] == [
        {"id": "deposit", "trigger": "creatorAccepted", "releasePct": 20},
        {"id": "content", "trigger": "contentLiveVerified", "releasePct": 80},
    ]

    negotiation_id = negotiation["negotiationId"]
    messages_response = client.get(f"/api/v1/negotiations/{negotiation_id}/messages")
    assert messages_response.status_code == 200
    messages = messages_response.json()["data"]["messages"]
    assert [message["role"] for message in messages] == ["ROLE_USER", "ROLE_AGENT"]
    assert [message["transport"] for message in messages] == [
        "IN_PROCESS_A2A",
        "IN_PROCESS_A2A",
    ]
    task_events = repository.list_raw_documents(
        f"{COLLECTIONS.a2a_tasks}/{negotiation['taskId']}/{COLLECTIONS.a2a_events}"
    )
    assert [event["type"] for event in task_events] == [
        "A2A_USER_MESSAGE",
        "A2A_AGENT_MESSAGE",
        "A2A_TASK_STATE",
    ]

    events_response = client.get(f"/api/v1/negotiations/{negotiation_id}/events")
    assert events_response.status_code == 200
    assert events_response.json()["data"]["events"][0]["type"] == "NEGOTIATION_ACCEPT"

    agreement_response = client.get(f"/api/v1/agreements/{agreement['agreementId']}")
    assert agreement_response.status_code == 200
    assert agreement_response.json()["data"]["agreement"]["agreementId"] == agreement["agreementId"]
    milestones = repository.list_raw_documents(
        f"{COLLECTIONS.agreements}/{agreement['agreementId']}/{COLLECTIONS.milestones}"
    )
    assert sorted(milestone["milestoneId"] for milestone in milestones) == ["content", "deposit"]
    release_pct_by_id = {item["milestoneId"]: item["releasePct"] for item in milestones}
    assert release_pct_by_id == {"deposit": 20, "content": 80}
    # 두 마일스톤 금액의 합이 락 금액과 같아야 한다 (release 가 locked 를 넘을 수 없다).
    assert sum(int(item["amountBaseUnits"]) for item in milestones) == int(
        lock_amount_base_units(AgreementTerms.model_validate(agreement["terms"]))
    )

    negotiation_agreement_response = client.get(f"/api/v1/negotiations/{negotiation_id}/agreement")
    assert negotiation_agreement_response.status_code == 200
    assert (
        negotiation_agreement_response.json()["data"]["agreement"]["agreementId"]
        == agreement["agreementId"]
    )


def test_start_negotiation_uses_saved_initial_offer_for_counter_flow() -> None:
    client, repository = client_and_repository_with_seed()
    set_creator_min_base(repository, "agent-creator-1", 650)
    promotion_path = FirestorePaths.promotion("promotion-001")
    promotion = repository.get_raw_document(promotion_path)
    assert promotion is not None
    repository.save_raw_document(promotion_path, {**promotion, "initialOffer": 300})
    match_run = client.post("/api/v1/promotions/promotion-001/matches:run").json()["data"][
        "matchRun"
    ]

    start_response = client.post(f"/api/v1/match-runs/{match_run['matchRunId']}:start-negotiation")

    assert start_response.status_code == 201, start_response.text
    body = start_response.json()["data"]
    assert body["negotiation"]["status"] == "AGREED"
    assert body["negotiation"]["currentRound"] == 3
    assert body["agreement"]["terms"]["compensation"]["baseAmountUsdc"] == 650
    messages = client.get(
        f"/api/v1/negotiations/{body['negotiation']['negotiationId']}/messages"
    ).json()["data"]["messages"]
    assert [message["payload"]["type"] for message in messages] == [
        "OFFER",
        "COUNTER",
        "COUNTER",
        "COUNTER",
        "ACCEPT",
        "ACCEPT",
    ]
    assert [
        message["payload"]["terms"]["compensation"]["baseAmountUsdc"] for message in messages
    ] == [300, 650, 475, 650, 650, 650]
    assert all(isinstance(message["payload"].get("display"), dict) for message in messages)


def test_start_negotiation_uses_gemini_for_brand_chat_display(monkeypatch) -> None:
    generated: list[str] = []
    examples = {
        "OFFER": (
            "제품 착용샷 1건 기준으로 300 USDC를 제안합니다. "
            "일정과 사용 범위는 공개 조건에 맞춰 정리했습니다."
        ),
        "COUNTER": (
            "예산 안에서 475 USDC까지 조정해 다시 제안합니다. "
            "산출물과 게시 일정은 기존 조건을 유지합니다."
        ),
        "ACCEPT": "제안해주신 650 USDC 조건이 브랜드 권한 범위 안이라 이 조건으로 확정하겠습니다.",
    }

    def fake_brand_message_display(**kwargs: object) -> api_routes.AnalysisText:
        message_type = kwargs["message_type"]
        assert hasattr(message_type, "value")
        generated.append(str(message_type.value))
        return api_routes.AnalysisText(
            text=examples[str(message_type.value)],
            provider="vertex-gemini",
            model="gemini-2.5-flash",
        )

    monkeypatch.setattr(api_routes, "brand_message_display", fake_brand_message_display)
    client, repository = client_and_repository_with_seed()
    set_creator_min_base(repository, "agent-creator-1", 650)
    promotion_path = FirestorePaths.promotion("promotion-001")
    promotion = repository.get_raw_document(promotion_path)
    assert promotion is not None
    repository.save_raw_document(promotion_path, {**promotion, "initialOffer": 300})
    match_run = client.post("/api/v1/promotions/promotion-001/matches:run").json()["data"][
        "matchRun"
    ]

    start_response = client.post(f"/api/v1/match-runs/{match_run['matchRunId']}:start-negotiation")

    assert start_response.status_code == 201, start_response.text
    messages = client.get(
        f"/api/v1/negotiations/{start_response.json()['data']['negotiation']['negotiationId']}/messages"
    ).json()["data"]["messages"]
    brand_messages = [message for message in messages if message["role"] == "ROLE_USER"]
    assert generated == ["OFFER", "COUNTER", "ACCEPT"]
    assert [message["payload"]["display"]["messageProvider"] for message in brand_messages] == [
        "vertex-gemini",
        "vertex-gemini",
        "vertex-gemini",
    ]
    assert [message["payload"]["display"]["message"] for message in brand_messages] == [
        examples["OFFER"],
        examples["COUNTER"],
        examples["ACCEPT"],
    ]


def test_agreement_document_rejects_artifact_terms_hash_mismatch() -> None:
    terms = {
        "compensation": {"structure": "flat", "baseAmountUsdc": 500, "performancePct": 0},
        "deliverables": [
            {
                "format": "reel",
                "count": 1,
                "postWindow": {"start": "2026-08-01", "end": "2026-08-10"},
                "revisionRounds": 1,
            }
        ],
        "usageRights": "organicOnly",
        "milestones": [{"id": "content", "trigger": "contentLiveVerified", "releasePct": 100}],
        "constraints": {"requiredDisclosures": ["ad"], "prohibitedClaims": []},
    }

    with pytest.raises(HTTPException) as raised:
        api_routes._agreement_document(
            negotiation={
                "negotiationId": "negotiation-hash",
                "promotionId": "promotion-hash",
                "brandAgentId": "brand-agent-hash",
                "creatorAgentId": "creator-agent-hash",
            },
            decision={
                "type": "ACCEPT",
                "agreementId": "agreement-hash",
                "terms": terms,
                "termsHash": "sha256:not-the-canonical-hash",
            },
            artifact_id="artifact-hash",
            task_id="task-hash",
            created_at="2026-07-31T00:00:00Z",
        )

    assert raised.value.status_code == 409
    assert raised.value.detail["code"] == "TERMS_HASH_MISMATCH"


def test_start_negotiation_uses_creator_a2a_http_when_configured(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class FakeHttpClient:
        def __init__(self, *args: object, **kwargs: object) -> None:
            captured["timeout"] = kwargs.get("timeout")
            return None

        def __enter__(self) -> "FakeHttpClient":
            return self

        def __exit__(self, *args: object) -> None:
            return None

        def get(
            self,
            url: str,
            *,
            headers: dict[str, str],
        ) -> FakeHttpResponse:
            captured["agent_card_url"] = url
            captured["agent_card_headers"] = headers
            return FakeHttpResponse(
                {
                    "name": "KNOT Creator Negotiation Agent",
                    "version": "1.0.0",
                    "supportedInterfaces": [
                        {
                            "url": "http://creator-agent.test/a2a/v1",
                            "protocolBinding": "HTTP+JSON",
                            "protocolVersion": "1.0",
                            "tenant": "agent-creator-1",
                        }
                    ],
                }
            )

        def post(
            self,
            url: str,
            *,
            headers: dict[str, str],
            json: dict[str, object],
        ) -> FakeHttpResponse:
            captured["url"] = url
            captured["headers"] = headers
            captured["request"] = json
            message = json["message"]
            assert isinstance(message, dict)
            data = message["parts"][0]["data"]  # type: ignore[index]
            assert isinstance(data, dict)
            terms = data["terms"]
            agreement_terms = AgreementTerms.model_validate(terms)
            decision = {
                "schema": "knot.negotiation.v1",
                "type": "ACCEPT",
                "round": 1,
                "terms": terms,
                "changedFields": [],
                "rationale": "Accepted through Creator A2A HTTP.",
                "policyDecision": {
                    "allowed": True,
                    "ruleVersion": "creator-policy-v1",
                    "violations": [],
                },
                "agreementId": "agreement-http-001",
                "termsHash": terms_hash(agreement_terms),
            }
            response_message = {
                "messageId": "message-http-agent-001",
                "contextId": message["contextId"],
                "taskId": "task-http-001",
                "role": "ROLE_AGENT",
                "parts": [{"mediaType": "application/json", "data": decision}],
            }
            artifact = {
                "artifactId": "artifact-http-001",
                "name": "Negotiation Result",
                "parts": [
                    {
                        "mediaType": "application/json",
                        "data": {
                            "schema": "knot.term-sheet.v1",
                            "result": "AGREED",
                            "agreementId": "agreement-http-001",
                            "terms": terms,
                            "termsHash": decision["termsHash"],
                            "rationale": decision["rationale"],
                        },
                    }
                ],
            }
            return FakeHttpResponse(
                {
                    "task": {
                        "id": "task-http-001",
                        "contextId": message["contextId"],
                        "status": {"state": "TASK_STATE_COMPLETED", "message": response_message},
                        "artifacts": [artifact],
                        "history": [message, response_message],
                    }
                }
            )

    monkeypatch.setattr("libs.a2a.client.httpx.Client", FakeHttpClient)
    client = client_with_seed(
        Settings(
            creator_a2a_mode="http",
            creator_agent_base_url="http://creator-agent.test/a2a/v1",
            creator_a2a_timeout_seconds=60,
        )
    )
    match_run = client.post("/api/v1/promotions/promotion-001/matches:run").json()["data"][
        "matchRun"
    ]

    response = client.post(f"/api/v1/match-runs/{match_run['matchRunId']}:start-negotiation")

    assert response.status_code == 201, response.text
    body = response.json()["data"]
    assert captured["agent_card_url"] == (
        "http://creator-agent.test/a2a/v1/.well-known/agent-card.json"
    )
    # The A2A client also carries the request trace (X-Trace-Id, X-Parent-Span-Id) so the
    # creator agent's spans join the same trace; those are asserted loosely here.
    card_headers = dict(captured["agent_card_headers"])  # type: ignore[call-overload]
    assert card_headers.pop("X-Trace-Id", None)
    card_headers.pop("X-Parent-Span-Id", None)
    assert card_headers == {"A2A-Version": "1.0"}
    assert captured["url"] == "http://creator-agent.test/a2a/v1/message:send"
    send_headers = dict(captured["headers"])  # type: ignore[call-overload]
    assert send_headers.pop("X-Trace-Id", None) == response.headers["X-Trace-Id"]
    send_headers.pop("X-Parent-Span-Id", None)  # only present when sent from inside a span
    assert send_headers == {
        "A2A-Version": "1.0",
        "Content-Type": "application/a2a+json",
    }
    assert captured["timeout"] == 60
    assert captured["request"]["tenant"] == "agent-creator-1"  # type: ignore[index]
    metadata = captured["request"]["metadata"]  # type: ignore[index]
    assert metadata["creatorNegotiationContext"]["creatorAgentId"] == "agent-creator-1"  # type: ignore[index]
    assert body["negotiation"]["taskId"] == "task-http-001"
    assert body["negotiation"]["brandDisplayName"] == "Demo Skincare Brand"
    assert body["negotiation"]["creatorSnapshot"]["displayName"] == "민지의 뷰티룸"
    assert body["negotiation"]["creatorPolicySnapshot"] == {"redacted": True}
    assert body["agreement"]["agreementId"] == "agreement-http-001"
    assert body["agreement"]["brandSnapshot"]["displayName"] == "Demo Skincare Brand"
    assert body["agreement"]["creatorSnapshot"]["displayName"] == "민지의 뷰티룸"
    messages = client.get(
        f"/api/v1/negotiations/{body['negotiation']['negotiationId']}/messages"
    ).json()["data"]["messages"]
    assert [message["role"] for message in messages] == ["ROLE_USER", "ROLE_AGENT"]
    assert [message["transport"] for message in messages] == ["HTTP_A2A", "HTTP_A2A"]
    assert [message["a2aEndpoint"] for message in messages] == [
        "http://creator-agent.test/a2a/v1",
        "http://creator-agent.test/a2a/v1",
    ]
    assert messages[1]["a2aMessage"]["parts"][0]["data"]["rationale"] == (
        "Accepted through Creator A2A HTTP."
    )


def test_start_negotiation_http_failure_does_not_create_fake_agreement(monkeypatch) -> None:
    class BrokenHttpClient:
        def __init__(self, *args: object, **kwargs: object) -> None:
            return None

        def __enter__(self) -> "BrokenHttpClient":
            return self

        def __exit__(self, *args: object) -> None:
            return None

        def get(self, *args: object, **kwargs: object) -> object:
            import httpx

            raise httpx.ConnectError("creator unavailable")

        def post(self, *args: object, **kwargs: object) -> object:
            import httpx

            raise httpx.ConnectError("creator unavailable")

    monkeypatch.setattr("libs.a2a.client.httpx.Client", BrokenHttpClient)
    client, repository = client_and_repository_with_seed(
        Settings(creator_a2a_mode="http", creator_agent_base_url="http://creator-agent.test/a2a/v1")
    )
    match_run = client.post("/api/v1/promotions/promotion-001/matches:run").json()["data"][
        "matchRun"
    ]

    response = client.post(f"/api/v1/match-runs/{match_run['matchRunId']}:start-negotiation")

    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "A2A_CREATOR_AGENT_UNAVAILABLE"
    assert repository.list_raw_documents(COLLECTIONS.agreements) == []


def test_start_negotiation_counter_a2a_task_continues_with_brand_accept(monkeypatch) -> None:
    class CounterHttpClient:
        post_count = 0

        def __init__(self, *args: object, **kwargs: object) -> None:
            return None

        def __enter__(self) -> "CounterHttpClient":
            return self

        def __exit__(self, *args: object) -> None:
            return None

        def get(
            self,
            url: str,
            *,
            headers: dict[str, str],
        ) -> object:
            assert url == "http://creator-agent.test/a2a/v1/.well-known/agent-card.json"
            assert {k: v for k, v in headers.items() if not k.startswith("X-")} == {
                "A2A-Version": "1.0"
            }
            return FakeHttpResponse(
                {
                    "name": "KNOT Creator Negotiation Agent",
                    "version": "1.0.0",
                    "supportedInterfaces": [
                        {
                            "url": "http://creator-agent.test/a2a/v1",
                            "protocolBinding": "HTTP+JSON",
                            "protocolVersion": "1.0",
                            "tenant": "agent-creator-1",
                        }
                    ],
                    "skills": [{"id": "promotion-negotiation"}],
                }
            )

        def post(
            self,
            url: str,
            *,
            headers: dict[str, str],
            json: dict[str, object],
        ) -> object:
            CounterHttpClient.post_count += 1
            message = json["message"]
            assert isinstance(message, dict)
            data = message["parts"][0]["data"]  # type: ignore[index]
            assert isinstance(data, dict)
            terms = dict(data["terms"])  # type: ignore[arg-type]
            compensation = dict(terms["compensation"])  # type: ignore[index]
            compensation["baseAmountUsdc"] = 650
            terms["compensation"] = compensation

            if CounterHttpClient.post_count == 3:
                assert message["taskId"] == "task-http-counter"
                assert message["contextId"]
                assert data["type"] == "ACCEPT"
                agreement_terms = AgreementTerms.model_validate(terms)
                decision = {
                    "schema": "knot.negotiation.v1",
                    "type": "ACCEPT",
                    "round": 3,
                    "terms": terms,
                    "changedFields": ["compensation.baseAmountUsdc"],
                    "rationale": "Creator accepted Brand policy-approved counter.",
                    "policyDecision": {
                        "allowed": True,
                        "ruleVersion": "creator-policy-v1",
                        "violations": [],
                    },
                    "agreementId": "agreement-http-counter",
                    "termsHash": terms_hash(agreement_terms),
                }
                response_message = {
                    "messageId": "message-http-agent-final",
                    "contextId": message["contextId"],
                    "taskId": "task-http-counter",
                    "role": "ROLE_AGENT",
                    "parts": [{"mediaType": "application/json", "data": decision}],
                }
                artifact = {
                    "artifactId": "artifact-http-counter",
                    "name": "Negotiation Result",
                    "parts": [
                        {
                            "mediaType": "application/json",
                            "data": {
                                "schema": "knot.term-sheet.v1",
                                "result": "AGREED",
                                "agreementId": "agreement-http-counter",
                                "terms": terms,
                                "termsHash": decision["termsHash"],
                                "rationale": decision["rationale"],
                            },
                        }
                    ],
                }
                return FakeHttpResponse(
                    {
                        "task": {
                            "id": "task-http-counter",
                            "contextId": message["contextId"],
                            "status": {
                                "state": "TASK_STATE_COMPLETED",
                                "message": response_message,
                            },
                            "artifacts": [artifact],
                            "history": [],
                        }
                    }
                )

            decision = {
                "schema": "knot.negotiation.v1",
                "type": "COUNTER",
                "round": data["round"],
                "terms": terms,
                "changedFields": ["compensation.baseAmountUsdc"],
                "rationale": "Counter through Creator A2A HTTP.",
                "policyDecision": {
                    "allowed": False,
                    "ruleVersion": "creator-policy-v1",
                    "violations": [
                        {
                            "code": "CREATOR_MIN_BASE_NOT_MET",
                            "field": "terms.compensation.baseAmountUsdc",
                            "message": "below minimum",
                        }
                    ],
                },
            }
            response_message = {
                "messageId": f"message-http-agent-counter-{CounterHttpClient.post_count}",
                "contextId": message["contextId"],
                "taskId": "task-http-counter",
                "role": "ROLE_AGENT",
                "parts": [{"mediaType": "application/json", "data": decision}],
            }
            return FakeHttpResponse(
                {
                    "task": {
                        "id": "task-http-counter",
                        "contextId": message["contextId"],
                        "status": {
                            "state": "TASK_STATE_INPUT_REQUIRED",
                            "message": response_message,
                        },
                        "artifacts": [],
                        "history": [message, response_message],
                    }
                }
            )

    monkeypatch.setattr("libs.a2a.client.httpx.Client", CounterHttpClient)
    client, repository = client_and_repository_with_seed(
        Settings(creator_a2a_mode="http", creator_agent_base_url="http://creator-agent.test/a2a/v1")
    )
    match_run = client.post("/api/v1/promotions/promotion-001/matches:run").json()["data"][
        "matchRun"
    ]

    response = client.post(f"/api/v1/match-runs/{match_run['matchRunId']}:start-negotiation")

    assert response.status_code == 201, response.text
    body = response.json()["data"]
    assert body["negotiation"]["status"] == "AGREED"
    assert body["negotiation"]["currentRound"] == 3
    assert body["agreement"]["agreementId"] == "agreement-http-counter"
    assert len(repository.list_raw_documents(COLLECTIONS.agreements)) == 1
    messages = client.get(
        f"/api/v1/negotiations/{body['negotiation']['negotiationId']}/messages"
    ).json()["data"]["messages"]
    assert [message["role"] for message in messages] == [
        "ROLE_USER",
        "ROLE_AGENT",
        "ROLE_USER",
        "ROLE_AGENT",
        "ROLE_USER",
        "ROLE_AGENT",
    ]


def test_submit_and_verify_evidence_persists_policy_result_and_timeline_event() -> None:
    client, repository = client_and_repository_with_seed()
    agreement = accepted_agreement(client)
    escrow = fund_agreement_for_evidence(repository, agreement)

    submit_response = client.post(
        f"/api/v1/agreements/{agreement['agreementId']}/evidence",
        json={
            "url": "https://social.example/post/with-brand-and-ad",
            "submittedByAgentId": agreement["creatorAgentId"],
            "milestoneId": "content",
        },
    )
    assert submit_response.status_code == 201
    evidence = submit_response.json()["data"]["evidence"]
    assert evidence["status"] == "SUBMITTED"
    assert evidence["milestoneId"] == "content"
    assert evidence["milestoneSnapshot"]["releasePct"] == 80
    assert evidence["escrowId"] == escrow["escrowId"]
    assert evidence["url"] == "https://social.example/post/with-brand-and-ad"
    assert str(evidence["sourceDigest"]).startswith("sha256:")

    verify_response = client.post(f"/api/v1/evidence/{evidence['evidenceId']}:verify")
    assert verify_response.status_code == 200
    verified = verify_response.json()["data"]["evidence"]
    assert verified["status"] == "PASSED"
    assert verified["policyDecision"]["allowed"] is True
    assert verified["policyDecision"]["ruleVersion"] == "verification-v1"

    get_response = client.get(f"/api/v1/evidence/{evidence['evidenceId']}")
    assert get_response.status_code == 200
    assert get_response.json()["data"]["evidence"]["status"] == "PASSED"

    verification_results = repository.list_raw_documents(COLLECTIONS.verification_results)
    assert len(verification_results) == 1
    assert verification_results[0]["status"] == "VERIFIED"
    assert verification_results[0]["sourceDigest"] == evidence["sourceDigest"]
    assert verification_results[0]["provider"] == "deterministic-url-policy"

    timeline_response = client.get("/api/v1/promotions/promotion-001/timeline")
    event_types = [event["type"] for event in timeline_response.json()["data"]["events"]]
    assert "EVIDENCE_SUBMITTED" in event_types
    assert "EVIDENCE_VERIFIED" in event_types


def test_verify_evidence_missing_disclosure_asks_for_revision_instead_of_rejecting() -> None:
    """공시 누락은 고칠 수 있으므로 재제출을 요구한다 — 태그 하나로 전액을 잃지 않는다."""
    client, repository = client_and_repository_with_seed()
    agreement = accepted_agreement(client)
    fund_agreement_for_evidence(repository, agreement)
    evidence = client.post(
        f"/api/v1/agreements/{agreement['agreementId']}/evidence",
        json={
            "url": "https://social.example/post/missing-disclosure",
            "submittedByAgentId": agreement["creatorAgentId"],
            "milestoneId": "content",
        },
    ).json()["data"]["evidence"]

    response = client.post(f"/api/v1/evidence/{evidence['evidenceId']}:verify")

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["outcome"] == "REVISION_REQUIRED"
    assert data["reasonCodes"] == ["EVIDENCE_DISCLOSURE_MISSING"]
    assert data["revisionsRemaining"] == 1
    # 릴리즈되지 않았으므로 status 는 여전히 통과가 아니다.
    assert data["evidence"]["status"] == "FAILED"
    assert data["autoSettlement"]["attempted"] is False

    verification_results = repository.list_raw_documents(COLLECTIONS.verification_results)
    assert verification_results[0]["status"] == "REVISION_REQUIRED"


def test_verify_evidence_hard_violation_returns_problem() -> None:
    """브랜드 언급 자체가 없으면 확정 위반이다 → 409, 환불 경로 진입 대상."""
    client, repository = client_and_repository_with_seed()
    agreement = accepted_agreement(client)
    fund_agreement_for_evidence(repository, agreement)
    evidence = client.post(
        f"/api/v1/agreements/{agreement['agreementId']}/evidence",
        json={
            "url": "https://social.example/post/missing-brand",
            "submittedByAgentId": agreement["creatorAgentId"],
            "milestoneId": "content",
        },
    ).json()["data"]["evidence"]

    response = client.post(f"/api/v1/evidence/{evidence['evidenceId']}:verify")

    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail["code"] == "EVIDENCE_VERIFICATION_FAILED"
    assert detail["outcome"] == "REJECTED"
    assert detail["reasonCodes"] == ["EVIDENCE_BRAND_MENTION_MISSING"]
    assert detail["evidence"]["status"] == "FAILED"

    get_response = client.get(f"/api/v1/evidence/{evidence['evidenceId']}")
    assert get_response.json()["data"]["evidence"]["status"] == "FAILED"
    verification_results = repository.list_raw_documents(COLLECTIONS.verification_results)
    assert verification_results[0]["status"] == "REJECTED"


def test_submit_evidence_rejects_wrong_creator_agent() -> None:
    client, repository = client_and_repository_with_seed()
    agreement = accepted_agreement(client)
    fund_agreement_for_evidence(repository, agreement)

    response = client.post(
        f"/api/v1/agreements/{agreement['agreementId']}/evidence",
        json={
            "url": "https://social.example/post/with-brand-and-ad",
            "submittedByAgentId": "creator-agent-003",
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "POLICY_VIOLATION"


def test_submit_evidence_requires_funded_escrow() -> None:
    client = client_with_seed()
    agreement = accepted_agreement(client)

    response = client.post(
        f"/api/v1/agreements/{agreement['agreementId']}/evidence",
        json={
            "url": "https://social.example/post/with-brand-and-ad",
            "submittedByAgentId": agreement["creatorAgentId"],
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "ESCROW_REQUIRED"


def test_submit_evidence_rejects_unsafe_source_url() -> None:
    client, repository = client_and_repository_with_seed()
    agreement = accepted_agreement(client)
    fund_agreement_for_evidence(repository, agreement)

    response = client.post(
        f"/api/v1/agreements/{agreement['agreementId']}/evidence",
        json={
            "url": "http://localhost/post/with-brand-and-ad",
            "submittedByAgentId": agreement["creatorAgentId"],
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "UNSAFE_SOURCE_URL"


def test_submit_evidence_rejects_duplicate_milestone_submission() -> None:
    client, repository = client_and_repository_with_seed()
    agreement = accepted_agreement(client)
    fund_agreement_for_evidence(repository, agreement)
    payload = {
        "url": "https://social.example/post/with-brand-and-ad",
        "submittedByAgentId": agreement["creatorAgentId"],
    }
    first = client.post(f"/api/v1/agreements/{agreement['agreementId']}/evidence", json=payload)
    second = client.post(f"/api/v1/agreements/{agreement['agreementId']}/evidence", json=payload)

    assert first.status_code == 201
    assert second.status_code == 409
    assert second.json()["detail"]["code"] == "EVIDENCE_ALREADY_SUBMITTED"
