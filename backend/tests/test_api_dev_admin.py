import base64
import json

from fastapi.testclient import TestClient

from apps.api.main import create_app
from libs.demo_seed.personas import build_demo_persona_documents
from libs.repositories.firestore_paths import COLLECTIONS, FirestorePaths
from libs.repositories.store import InMemoryDocumentStore, KnotRepository
from libs.settings.config import Settings


def client_and_repository(
    *,
    enabled: bool = True,
    allowlist: list[str] | None = None,
) -> tuple[TestClient, KnotRepository]:
    repository = KnotRepository(InMemoryDocumentStore())
    settings = Settings(
        auth_mode="emulator",
        firebase_project_id="knot-dev-503505",
        dev_admin_enabled=enabled,
        dev_admin_allowlist=allowlist or [],
    )
    return TestClient(create_app(repository=repository, settings=settings)), repository


def headers(
    uid: str = "admin-uid",
    email: str = "admin@example.com",
    admin: bool = True,
) -> dict[str, str]:
    payload = {
        "sub": uid,
        "user_id": uid,
        "email": email,
        "name": "Admin Tester",
        "aud": "knot-dev-503505",
    }
    if admin:
        payload["admin"] = True
    return {"Authorization": f"Bearer {_jwt(payload)}"}


def _jwt(payload: dict[str, object]) -> str:
    header = _b64({"alg": "none", "typ": "JWT"})
    return f"{header}.{_b64(payload)}."


def _b64(payload: dict[str, object]) -> str:
    encoded = base64.urlsafe_b64encode(json.dumps(payload).encode("utf-8")).decode("ascii")
    return encoded.rstrip("=")


def test_dev_admin_rejects_when_disabled_or_non_admin() -> None:
    disabled_client, _ = client_and_repository(enabled=False)
    enabled_client, _ = client_and_repository(enabled=True)

    disabled = disabled_client.get("/api/v1/dev-admin/overview", headers=headers())
    non_admin = enabled_client.get(
        "/api/v1/dev-admin/overview",
        headers=headers(uid="user-uid", email="user@example.com", admin=False),
    )

    assert disabled.status_code == 403
    assert non_admin.status_code == 403


def test_dev_admin_allows_strict_allowlist_without_admin_claim() -> None:
    client, _ = client_and_repository(allowlist=["ops@example.com"])

    response = client.get(
        "/api/v1/dev-admin/overview",
        headers=headers(uid="ops-uid", email="ops@example.com", admin=False),
    )

    assert response.status_code == 200
    assert response.json()["data"]["overview"]["actorUid"] == "ops-uid"


def test_dev_admin_overview_user_list_and_disable_enable_write_audit() -> None:
    client, repository = client_and_repository()
    repository.save_raw_document(
        FirestorePaths.user("target-uid"),
        {
            "uid": "target-uid",
            "email": "target@example.com",
            "displayName": "Target",
            "status": "ACTIVE",
            "createdAt": "2026-07-27T00:00:00Z",
            "updatedAt": "2026-07-27T00:00:00Z",
        },
    )

    overview = client.get("/api/v1/dev-admin/overview", headers=headers())
    users = client.get("/api/v1/dev-admin/users", headers=headers())
    detail = client.get("/api/v1/dev-admin/users/target-uid", headers=headers())
    disabled = client.post("/api/v1/dev-admin/users/target-uid:disable", headers=headers())
    enabled = client.post("/api/v1/dev-admin/users/target-uid:enable", headers=headers())

    assert overview.status_code == 200
    assert users.status_code == 200
    assert detail.status_code == 200
    assert disabled.json()["data"]["user"]["status"] == "DISABLED"
    assert enabled.json()["data"]["user"]["status"] == "ACTIVE"
    actions = {
        event["action"]
        for event in repository.list_raw_documents(COLLECTIONS.audit_events)
    }
    assert "DEV_ADMIN_USER_DISABLED" in actions
    assert "DEV_ADMIN_USER_ENABLED" in actions


def test_dev_admin_demo_personas_lists_seed_profiles_with_login_state() -> None:
    client, repository = client_and_repository()
    document_set = build_demo_persona_documents()
    for path, document in document_set.documents:
        repository.save_raw_document(path, document)

    response = client.get("/api/v1/dev-admin/demo-personas", headers=headers())

    assert response.status_code == 200
    personas = response.json()["data"]["personas"]
    assert personas["brandCount"] == 10
    assert personas["creatorCount"] == len(document_set.creator_ids)
    assert personas["loginPasswordHint"] == "000000"
    assert all(item["login"]["canLogin"] for item in personas["brands"])
    assert all(item["login"]["canLogin"] for item in personas["creators"])


def test_dev_admin_delete_dry_run_and_blocks_real_user_confirm() -> None:
    client, repository = client_and_repository()
    repository.save_raw_document(
        FirestorePaths.user("real-uid"),
        {"uid": "real-uid", "email": "real@example.com", "status": "ACTIVE"},
    )

    dry_run = client.post("/api/v1/dev-admin/users/real-uid:delete", headers=headers(), json={})
    blocked = client.post(
        "/api/v1/dev-admin/users/real-uid:delete",
        headers={**headers(), "Idempotency-Key": "delete-real"},
        json={"confirm": True},
    )

    assert dry_run.status_code == 200
    assert dry_run.json()["data"]["deletionJob"]["status"] == "DRY_RUN"
    assert blocked.status_code == 409
    assert blocked.json()["detail"]["code"] == "REAL_USER_DELETE_FORBIDDEN"
    assert repository.get_raw_document(FirestorePaths.user("real-uid"))["status"] == "ACTIVE"  # type: ignore[index]


def test_dev_admin_deletes_only_demo_tagged_user_projection_and_retains_financial_records() -> None:
    client, repository = client_and_repository()
    repository.save_raw_document(
        FirestorePaths.user("demo-uid"),
        {
            "uid": "demo-uid",
            "email": "demo@example.com",
            "displayName": "Demo",
            "status": "ACTIVE",
            "environment": "demo",
            "seedBatchId": "batch-1",
        },
    )
    repository.save_raw_document(
        FirestorePaths.transaction_receipt("receipt-1"),
        {"receiptId": "receipt-1", "status": "CONFIRMED"},
    )

    response = client.post(
        "/api/v1/dev-admin/users/demo-uid:delete",
        headers={**headers(), "Idempotency-Key": "delete-demo"},
        json={"confirm": True},
    )

    assert response.status_code == 200
    job = response.json()["data"]["deletionJob"]
    assert job["status"] == "COMPLETED"
    stored = repository.get_raw_document(FirestorePaths.user("demo-uid"))
    assert stored is not None
    assert stored["status"] == "DELETED"
    assert stored["email"] is None
    assert repository.get_raw_document(FirestorePaths.transaction_receipt("receipt-1")) is not None


def test_dev_admin_demo_seed_and_scoped_reset() -> None:
    client, repository = client_and_repository()

    seed = client.post(
        "/api/v1/dev-admin/demo:seed",
        headers=headers(),
        json={"seedBatchId": "seed-a"},
    )
    reset = client.post(
        "/api/v1/dev-admin/demo:reset",
        headers=headers(),
        json={"seedBatchId": "seed-a"},
    )

    assert seed.status_code == 201
    assert reset.status_code == 200
    assert reset.json()["data"]["job"]["affectedUserCount"] == 1
    seeded_user = repository.get_raw_document(FirestorePaths.user("demo-user-seed-a"))
    assert seeded_user is not None
    assert seeded_user["status"] == "DELETED"
