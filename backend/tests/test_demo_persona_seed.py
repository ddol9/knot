from fastapi.testclient import TestClient

from apps.api.main import create_app
from libs.demo_seed.personas import (
    REQUIRED_CREATOR_CATEGORIES,
    build_demo_persona_documents,
    validate_demo_persona_documents,
)
from libs.repositories.store import InMemoryDocumentStore, KnotRepository
from libs.settings.config import Settings


def seeded_repository() -> KnotRepository:
    repository = KnotRepository(InMemoryDocumentStore())
    document_set = build_demo_persona_documents()
    for path, document in document_set.documents:
        repository.save_raw_document(path, document)
    return repository


def test_demo_persona_documents_cover_required_brands_creators_and_categories() -> None:
    document_set = build_demo_persona_documents()

    assert validate_demo_persona_documents(document_set) == []
    assert len(document_set.brand_ids) == 10
    assert len(document_set.creator_ids) >= 10

    by_path = {path: document for path, document in document_set.documents}
    category_counts = {
        category: sum(
            1
            for creator_id in document_set.creator_ids
            if category in by_path[f"creatorProfiles/{creator_id}"]["categories"]
        )
        for category in REQUIRED_CREATOR_CATEGORIES
    }
    assert all(count >= 2 for count in category_counts.values())


def test_demo_persona_discovery_matches_each_industry() -> None:
    repository = seeded_repository()
    client = TestClient(create_app(settings=Settings(), repository=repository))
    promotions = [
        "promotion-demo-cheriexx",
        "promotion-demo-samsung",
        "promotion-demo-thezonebio",
        "promotion-demo-upbit",
        "promotion-demo-neowiz",
    ]

    for promotion_id in promotions:
        response = client.post(f"/api/v1/promotions/{promotion_id}/matches:run")
        assert response.status_code == 201
        match_run = response.json()["data"]["matchRun"]
        assert match_run["status"] == "COMPLETED"
        assert match_run["selectedCreatorAgentId"]
        candidates_response = client.get(f"/api/v1/match-runs/{match_run['matchRunId']}/candidates")
        candidates = candidates_response.json()["data"]["candidates"]
        assert len(candidates) >= 1
        assert candidates[0]["eligible"] is True
        assert candidates[0]["explanation"]


def test_demo_persona_a2a_negotiation_creates_agreement() -> None:
    repository = seeded_repository()
    client = TestClient(create_app(settings=Settings(), repository=repository))
    match_run = client.post("/api/v1/promotions/promotion-demo-upbit/matches:run").json()["data"][
        "matchRun"
    ]

    response = client.post(f"/api/v1/match-runs/{match_run['matchRunId']}/start-negotiation")

    assert response.status_code == 201
    body = response.json()["data"]
    assert body["negotiation"]["status"] == "AGREED"
    assert body["agreement"]["agreementId"]
    assert body["agreement"]["terms"]["compensation"]["baseAmountUsdc"] >= 4
