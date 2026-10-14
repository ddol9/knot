"""Shared Firestore registry across agent processes, against the Firestore emulator.

Run with the emulator up (ports from scripts/local/firebase.json):

    npx -y firebase-tools emulators:start --only firestore --project demo-knot \
        --config scripts/local/firebase.json
    FIRESTORE_EMULATOR_HOST=127.0.0.1:8780 pytest tests/test_firestore_emulator_agents.py

Everything that needs the emulator auto-skips without FIRESTORE_EMULATOR_HOST. The tests use
their own project id (KNOT_FIRESTORE_TEST_PROJECT, default demo-knot-test) and wipe it first,
so a running local stack on `demo-knot` is left alone.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from apps.api.repository_factory import build_repository
from apps.brand_agent.main import demo_promotion
from apps.creator_agent.main import create_app as create_creator_app
from libs.a2a.store import InMemoryA2ATaskStore
from libs.agents.brand_campaign import CampaignRunner, CampaignStrategy
from libs.agents.brand_discovery import discover_creator_agents
from libs.agents.brand_negotiator import InProcessTransport
from libs.agents.creator_context import repository_context_resolver
from libs.agents.discovery import FirestoreCreatorDiscoveryRepository, _public_filters
from libs.repositories.firestore_paths import COLLECTIONS, FirestorePaths
from libs.repositories.seed import seed_demo_repository
from libs.repositories.store import DocumentQueryFilter, InMemoryDocumentStore, KnotRepository
from libs.settings.config import Settings

EMULATOR_HOST = os.getenv("FIRESTORE_EMULATOR_HOST")
PROJECT = os.getenv("KNOT_FIRESTORE_TEST_PROJECT", "demo-knot-test")
A_URL = "http://127.0.0.1:8091/a2a/v1"
B_URL = "http://127.0.0.1:8092/a2a/v1"
B_TENANTS = ["creator-agent-003", "creator-agent-005"]

emulator = pytest.mark.skipif(
    not EMULATOR_HOST, reason="FIRESTORE_EMULATOR_HOST not set (Firestore emulator required)"
)


def _firestore_repository() -> KnotRepository:
    # A fresh client per call: each agent process has its own in the real stack.
    return build_repository(Settings(repository_backend="firestore", firestore_project_id=PROJECT))


def _wipe_project() -> None:
    url = f"http://{EMULATOR_HOST}/emulator/v1/projects/{PROJECT}/databases/(default)/documents"
    httpx.delete(url, timeout=30).raise_for_status()


@pytest.fixture
def seeded() -> KnotRepository:
    _wipe_project()
    repository = _firestore_repository()
    seed_demo_repository(repository, creator_agent_base_url=A_URL)
    return repository


# --- adapter against the real emulator ------------------------------------------------


@emulator
def test_adapter_round_trips_everything_the_agent_paths_use(seeded: KnotRepository) -> None:
    memory = KnotRepository(InMemoryDocumentStore())
    seed_demo_repository(memory, creator_agent_base_url=A_URL)

    for collection in (
        COLLECTIONS.users,
        COLLECTIONS.brands,
        COLLECTIONS.agents,
        COLLECTIONS.creator_profiles,
        COLLECTIONS.creator_discovery_profiles,
        COLLECTIONS.agent_registry,
        COLLECTIONS.agent_policies,
        COLLECTIONS.promotions,
    ):
        assert len(seeded.list_raw_documents(collection)) == len(
            memory.list_raw_documents(collection)
        ), collection

    # Seeding twice is idempotent (set semantics, same ids).
    seed_demo_repository(seeded, creator_agent_base_url=A_URL)
    assert len(seeded.list_creator_profiles()) == len(memory.list_creator_profiles()) == 12

    creator = seeded.get_creator_profile_by_agent_id("creator-agent-005")
    assert creator is not None and creator.creator_id == "creator-005"
    policy = seeded.get_agent_policy("creator-agent-005")
    assert policy is not None and policy.active
    assert seeded.get_agent_policy("nobody") is None

    entry = seeded.get_raw_document(FirestorePaths.agent_registry_entry("creator-agent-005"))
    assert entry == memory.get_raw_document(
        FirestorePaths.agent_registry_entry("creator-agent-005")
    )
    assert seeded.get_raw_document("agentRegistry/missing") is None

    # Nested maps, None, empty containers survive, and subcollections list independently.
    seeded.save_raw_document(
        "agreements/t-1/milestones/m-1",
        {"milestoneId": "m-1", "nested": {"a": [1, 2], "b": None}, "empty": {}, "list": []},
    )
    assert seeded.list_raw_documents("agreements/t-1/milestones") == [
        {"milestoneId": "m-1", "nested": {"a": [1, 2], "b": None}, "empty": {}, "list": []}
    ]
    assert seeded.get_raw_document("agreements/t-1") is None


@emulator
def test_discovery_query_matches_memory_store_on_emulator(seeded: KnotRepository) -> None:
    memory = KnotRepository(InMemoryDocumentStore())
    seed_demo_repository(memory, creator_agent_base_url=A_URL)
    promotion = demo_promotion(category="beauty", max_per_creator_usdc=700, total_usdc=1300)

    filters = _public_filters(promotion)
    ops = {f.op for f in filters}
    assert ops == {"==", "array_contains", "<="}  # the three operators the adapter must map
    on_firestore = seeded.query_raw_documents(
        COLLECTIONS.creator_discovery_profiles, filters, limit=100
    )
    in_memory = memory.query_raw_documents(
        COLLECTIONS.creator_discovery_profiles, filters, limit=100
    )
    by_id = {str(d["creatorId"]): d for d in on_firestore}
    assert by_id == {str(d["creatorId"]): d for d in in_memory}
    assert len(by_id) >= 2

    # Single-operator queries and the limit are honoured too.
    beauty = seeded.query_raw_documents(
        COLLECTIONS.creator_discovery_profiles,
        [DocumentQueryFilter("categoryKeys", "array_contains", "beauty")],
        limit=3,
    )
    assert len(beauty) == 3
    none_before_epoch = seeded.query_raw_documents(
        COLLECTIONS.creator_discovery_profiles,
        [DocumentQueryFilter("nextAvailableAt", "<=", "1999-01-01")],
        limit=10,
    )
    assert none_before_epoch == []

    # The projection search the brand funnel starts from gives the same candidate set.
    search_fs = FirestoreCreatorDiscoveryRepository(seeded).search(promotion, limit=20)
    search_mem = FirestoreCreatorDiscoveryRepository(memory).search(promotion, limit=20)
    assert sorted(str(p["creatorId"]) for p in search_fs.projections) == sorted(
        str(p["creatorId"]) for p in search_mem.projections
    )


# --- heartbeat → discovery → campaign across "processes" ----------------------------------


@emulator
def test_heartbeat_reaches_brand_discovery_and_campaign_feeds_track_record(
    seeded: KnotRepository,
) -> None:
    # Creator process B hosts two tenants at its own base URL and announces them on startup.
    creator_settings = Settings(
        service_name="knot-creator-b",
        creator_agent_base_url=B_URL,
        creator_agent_tenants=list(B_TENANTS),
    )
    creator_repository = _firestore_repository()
    app = create_creator_app(settings=creator_settings, repository=creator_repository)
    with TestClient(app) as client:
        assert client.get("/healthz").status_code == 200

    # The brand process has its own Firestore client and never saw the creator process.
    brand = _firestore_repository()
    for tenant in B_TENANTS:
        entry = brand.get_raw_document(FirestorePaths.agent_registry_entry(tenant))
        assert entry is not None
        assert entry["healthStatus"] == "UP"
        assert entry["baseUrl"] == B_URL
        assert entry["hostedBy"] == "knot-creator-b"
        assert entry["lastSeenAt"] and entry["lastHeartbeatAt"] == entry["lastSeenAt"]
        assert entry["publicationStatus"] == "PUBLISHED"  # static data untouched
    untouched = brand.get_raw_document(FirestorePaths.agent_registry_entry("agent-creator-1"))
    assert untouched is not None and "healthStatus" not in untouched
    assert untouched["baseUrl"] == A_URL

    promotion = demo_promotion(category="beauty", max_per_creator_usdc=700, total_usdc=1300)
    report, _ = discover_creator_agents(
        brand, promotion, limit=5, default_base_url=A_URL, card_probe=None
    )
    by_agent = {c.creator_agent_id: c for c in report.candidates}
    assert by_agent["creator-agent-005"].health_status == "UP"
    assert by_agent["creator-agent-005"].base_url == B_URL  # routed by the heartbeat, no env
    assert by_agent["creator-agent-005"].last_seen_at
    assert by_agent["agent-creator-1"].health_status == "UNKNOWN"
    assert by_agent["agent-creator-1"].base_url == A_URL

    # Campaign in-process (the transport is not what is under test) on the same Firestore.
    store = InMemoryA2ATaskStore({}, context_resolver=repository_context_resolver(brand))
    result = CampaignRunner(
        repository=brand,
        promotion=promotion,
        strategy=CampaignStrategy(
            targetCreatorCount=2, parallelism=1, openingAmountUsdc=400, ceilingUsdc=700
        ),
        transport_factory=lambda _url: InProcessTransport(store),
        default_base_url=A_URL,
        probe_cards=False,
    ).run()
    assert result.outcome == "TARGET_REACHED"
    done = [n for n in result.negotiations if n.status == "DONE"]
    assert len(done) == 2

    # A third client (next campaign / next process) reads the track record and the agreements.
    later = _firestore_repository()
    for negotiation in result.negotiations:
        entry = later.get_raw_document(
            FirestorePaths.agent_registry_entry(negotiation.creator_agent_id)
        )
        assert entry is not None
        stats = entry.get("negotiationStats")
        if negotiation.status == "DONE":
            assert isinstance(stats, dict)
            assert stats["attempts"] == 1 and stats["agreements"] == 1
            assert stats["lastOutcome"] == "AGREED"
        else:
            assert stats is None
    for negotiation in done:
        assert negotiation.agreement_id
        agreement = later.get_raw_document(FirestorePaths.agreement(negotiation.agreement_id))
        assert agreement is not None and agreement["agreementId"] == negotiation.agreement_id
        milestones = later.list_raw_documents(
            f"{FirestorePaths.agreement(negotiation.agreement_id)}/{COLLECTIONS.milestones}"
        )
        assert milestones, "agreement must carry milestones"
        assert sum(int(m["amountUsdc"]) for m in milestones) == negotiation.committed_usdc
        assert negotiation.negotiation_id
        assert later.get_raw_document(FirestorePaths.negotiation(negotiation.negotiation_id))
    match_run = later.get_raw_document(FirestorePaths.match_run(result.match_run_id))
    assert match_run is not None and match_run["status"] == "AGREED"
    assert sorted(match_run["agreementIds"]) == sorted(n.agreement_id for n in done)

    # Second discovery (new client) now orders with the track record it just wrote.
    report2, _ = discover_creator_agents(
        later, promotion, limit=5, default_base_url=A_URL, card_probe=None
    )
    agreed = {n.creator_agent_id for n in done}
    for candidate in report2.candidates:
        if candidate.creator_agent_id in agreed:
            assert candidate.track_record["attempts"] == 1
            assert candidate.track_record["agreements"] == 1


# --- composite index for the discovery query (no emulator needed) -------------------------


def test_discovery_query_has_a_matching_composite_index() -> None:
    """The emulator never enforces indexes; keep firestore.indexes.json in step with the query."""
    promotion = demo_promotion(category="beauty", max_per_creator_usdc=700, total_usdc=1300)
    filters = _public_filters(promotion)
    equality = sorted(f.field_path for f in filters if f.op == "==")
    array_contains = [f.field_path for f in filters if f.op == "array_contains"]
    ranges = [f.field_path for f in filters if f.op in ("<", "<=", ">", ">=")]
    assert len(array_contains) == 1 and len(ranges) == 1

    indexes_path = Path(__file__).resolve().parents[2] / "firestore.indexes.json"
    config = json.loads(indexes_path.read_text(encoding="utf-8"))
    for index in config["indexes"]:
        if index["collectionGroup"] != COLLECTIONS.creator_discovery_profiles:
            continue
        fields = index["fields"]
        index_equality = sorted(
            f["fieldPath"]
            for f in fields[:-1]
            if "order" in f and f["fieldPath"] not in array_contains
        )
        index_array = [f["fieldPath"] for f in fields if f.get("arrayConfig") == "CONTAINS"]
        if (
            index_equality == equality
            and index_array == array_contains
            and fields[-1]["fieldPath"] == ranges[0]
            and fields[-1].get("order") == "ASCENDING"
        ):
            return
    pytest.fail(
        "firestore.indexes.json has no composite index for the discovery query: "
        f"equality={equality} array_contains={array_contains} range={ranges}"
    )
