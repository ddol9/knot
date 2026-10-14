"""Registry liveness + negotiation track record, and how discovery uses them."""

from fastapi.testclient import TestClient

from apps.brand_agent.main import demo_promotion
from apps.creator_agent.main import create_app as create_creator_app
from libs.a2a.registry import (
    record_agent_heartbeat,
    record_agent_probe,
    record_negotiation_outcome,
    registry_health,
    track_record,
)
from libs.a2a.store import InMemoryA2ATaskStore
from libs.agents.brand_campaign import CampaignRunner, CampaignStrategy
from libs.agents.brand_discovery import discover_creator_agents, rank_score
from libs.agents.brand_negotiator import InProcessTransport
from libs.agents.creator_context import repository_context_resolver
from libs.repositories.firestore_paths import FirestorePaths
from libs.repositories.seed import seed_demo_repository
from libs.repositories.store import InMemoryDocumentStore, KnotRepository
from libs.settings.config import Settings

AGENT = "creator-agent-005"


def _seeded() -> KnotRepository:
    repository = KnotRepository(InMemoryDocumentStore())
    seed_demo_repository(repository)
    return repository


def _entry(repository: KnotRepository, agent_id: str = AGENT) -> dict:
    entry = repository.get_raw_document(FirestorePaths.agent_registry_entry(agent_id))
    assert entry is not None
    return entry


# --- registry writes ---------------------------------------------------------------------


def test_seeded_entry_has_no_operational_signal_yet() -> None:
    repository = _seeded()
    assert registry_health(_entry(repository))["healthStatus"] == "UNKNOWN"
    record = track_record(_entry(repository))
    assert record.attempts == 0 and record.agreement_rate == 0.5


def test_heartbeat_marks_tenant_alive_at_its_host() -> None:
    repository = _seeded()
    record_agent_heartbeat(
        repository,
        AGENT,
        base_url="http://127.0.0.1:8092/a2a/v1",
        hosted_by="creator-b",
        now="2026-10-14T10:00:00+00:00",
    )
    entry = _entry(repository)
    assert entry["healthStatus"] == "UP"
    assert entry["lastSeenAt"] == "2026-10-14T10:00:00+00:00"
    assert entry["baseUrl"] == "http://127.0.0.1:8092/a2a/v1"
    assert entry["hostedBy"] == "creator-b"
    # Static publication data is untouched.
    assert entry["publicationStatus"] == "PUBLISHED"
    assert entry["tenant"] == AGENT


def test_probe_records_down_then_up_without_losing_last_seen() -> None:
    repository = _seeded()
    record_agent_probe(repository, AGENT, status="UP", error=None, now="t1")
    assert _entry(repository)["lastSeenAt"] == "t1"
    record_agent_probe(repository, AGENT, status="DOWN", error="connection refused", now="t2")
    entry = _entry(repository)
    assert entry["healthStatus"] == "DOWN"
    assert entry["lastProbeError"] == "connection refused"
    assert entry["lastSeenAt"] == "t1"  # DOWN does not pretend we saw it
    record_agent_probe(repository, AGENT, status="NO_SKILL", error="no skill", now="t3")
    entry = _entry(repository)
    assert entry["healthStatus"] == "UP"  # it answered, it just can't negotiate
    assert entry["lastSeenAt"] == "t3" and entry["lastProbeStatus"] == "NO_SKILL"


def test_probe_on_unknown_agent_creates_an_unpublished_stub() -> None:
    repository = _seeded()
    record_agent_probe(repository, "ghost-agent", status="DOWN", error="x", now="t")
    stub = _entry(repository, "ghost-agent")
    assert stub["publicationStatus"] == "UNKNOWN" and stub["healthStatus"] == "DOWN"


def test_outcomes_accumulate_and_brand_cancel_is_not_an_attempt() -> None:
    repository = _seeded()
    for outcome in ("AGREED", "REJECTED", "ESCALATED", "CANCELED", "AGREED"):
        record = record_negotiation_outcome(repository, AGENT, outcome=outcome, now="t")
    assert record.attempts == 4
    assert record.agreements == 2 and record.rejections == 1 and record.escalations == 1
    assert record.canceled == 1
    assert record.last_outcome == "AGREED"
    assert record.agreement_rate == round(3 / 6, 4)
    assert track_record(_entry(repository)).model_dump() == record.model_dump()


# --- discovery ordering ----------------------------------------------------------------


def test_rank_score_is_neutral_without_history_and_penalises_down() -> None:
    assert rank_score(0.8, health_status="UNKNOWN", agreement_rate=0.5) == 0.8
    assert rank_score(0.8, health_status="UP", agreement_rate=1.0) > 0.8
    assert rank_score(0.8, health_status="DOWN", agreement_rate=0.5) < 0.8
    # A bad track record alone is a nudge, not a ban.
    assert rank_score(0.8, health_status="UP", agreement_rate=0.0) > 0.7


def test_discovery_orders_by_liveness_and_track_record_and_records_probes() -> None:
    repository = _seeded()
    promotion = demo_promotion(category="beauty", max_per_creator_usdc=700, total_usdc=1300)
    baseline, _ = discover_creator_agents(
        repository, promotion, limit=5, default_base_url="http://a", card_probe=None
    )
    ranks = {c.creator_agent_id: c.rank for c in baseline.candidates if c.eligible}
    assert ranks["agent-creator-1"] == 1 and ranks[AGENT] == 2

    # The top agent was seen DOWN and keeps rejecting; it should drop below its peers.
    record_agent_probe(repository, "agent-creator-1", status="DOWN", error="refused", now="t")
    for _ in range(4):
        record_negotiation_outcome(repository, "agent-creator-1", outcome="REJECTED", now="t")

    def probe(_base_url: str) -> dict:
        return {"skills": [{"id": "promotion-negotiation"}]}

    report, _ = discover_creator_agents(
        repository, promotion, limit=5, default_base_url="http://a", card_probe=probe
    )
    by_id = {c.creator_agent_id: c for c in report.candidates}
    assert by_id["agent-creator-1"].health_status == "DOWN"
    assert by_id["agent-creator-1"].track_record["agreementRate"] < 0.5
    assert by_id["agent-creator-1"].rank_score < by_id["agent-creator-1"].score
    assert by_id["agent-creator-1"].rank > by_id[AGENT].rank
    # The matching score itself is unchanged; only the order moved.
    assert by_id["agent-creator-1"].score == next(
        c.score for c in baseline.candidates if c.creator_agent_id == "agent-creator-1"
    )
    # Probing it again and finding it UP is written back.
    assert by_id["agent-creator-1"].card_status == "UP"
    assert _entry(repository, "agent-creator-1")["healthStatus"] == "UP"
    assert _entry(repository, AGENT)["lastProbeStatus"] == "UP"


# --- campaign feeds the registry --------------------------------------------------------


def test_campaign_writes_track_record_for_agents_it_negotiated_with() -> None:
    repository = _seeded()
    store = InMemoryA2ATaskStore({}, context_resolver=repository_context_resolver(repository))
    promotion = demo_promotion(category="beauty", max_per_creator_usdc=700, total_usdc=1300)
    result = CampaignRunner(
        repository=repository,
        promotion=promotion,
        strategy=CampaignStrategy(
            targetCreatorCount=2, parallelism=1, openingAmountUsdc=400, ceilingUsdc=700
        ),
        transport_factory=lambda _url: InProcessTransport(store),
        default_base_url="http://in-process",
        probe_cards=False,
    ).run()
    assert result.outcome == "TARGET_REACHED"
    for negotiation in result.negotiations:
        record = track_record(_entry(repository, negotiation.creator_agent_id))
        if negotiation.status == "DONE":
            assert record.attempts == 1 and record.agreements == 1
            assert record.last_outcome == "AGREED"
        else:
            assert record.attempts == 0 and record.last_outcome is None


# --- creator agent heartbeat ------------------------------------------------------------


def test_creator_agent_announces_hosted_tenants_on_startup() -> None:
    repository = _seeded()
    settings = Settings(
        service_name="creator-b",
        creator_agent_base_url="http://127.0.0.1:8092/a2a/v1",
        creator_agent_tenants=["creator-agent-003", AGENT],
    )
    with TestClient(create_creator_app(settings=settings, repository=repository)) as client:
        assert client.get("/healthz").status_code == 200
    for tenant in ("creator-agent-003", AGENT):
        entry = _entry(repository, tenant)
        assert entry["healthStatus"] == "UP"
        assert entry["baseUrl"] == "http://127.0.0.1:8092/a2a/v1"
        assert entry["hostedBy"] == "creator-b"
        assert entry["lastSeenAt"]
    # Tenants this process does not host are left alone.
    assert "lastSeenAt" not in _entry(repository, "agent-creator-1")
