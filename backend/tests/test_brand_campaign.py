"""Discovery funnel + budget ledger + campaign fan-out.

In-process cases drive CampaignRunner against an InMemoryA2ATaskStore whose creator
policies come from the seeded repository (the same resolver the creator service uses).
The HTTP case boots two creator services hosting different tenants and runs the
brand service's campaign stream against them.
"""

import json
import socket
import threading
import time

import httpx
import uvicorn
from fastapi.testclient import TestClient

from apps.brand_agent.main import create_app as create_brand_app
from apps.brand_agent.main import demo_promotion
from apps.creator_agent.main import _firestore_context_resolver
from apps.creator_agent.main import create_app as create_creator_app
from libs.a2a.store import InMemoryA2ATaskStore
from libs.agents.brand_campaign import BudgetLedger, CampaignRunner, CampaignStrategy
from libs.agents.brand_discovery import discover_creator_agents
from libs.agents.brand_negotiator import InProcessTransport
from libs.agents.demo_context import demo_creator_contexts
from libs.repositories.seed import seed_demo_repository
from libs.repositories.store import InMemoryDocumentStore, KnotRepository
from libs.settings.config import Settings


def _seeded_repository() -> KnotRepository:
    repository = KnotRepository(InMemoryDocumentStore())
    seed_demo_repository(repository)
    return repository


def _creator_store(repository: KnotRepository) -> InMemoryA2ATaskStore:
    return InMemoryA2ATaskStore(
        demo_creator_contexts(), context_resolver=_firestore_context_resolver(repository)
    )


# --- discovery -------------------------------------------------------------------


def test_discovery_funnel_ranks_eligible_and_reports_rejections() -> None:
    repository = _seeded_repository()
    promotion = demo_promotion(category="beauty", max_per_creator_usdc=700, total_usdc=1300)

    def probe(base_url: str) -> dict:
        if "8092" in base_url:
            raise RuntimeError("connection refused")
        return {"skills": [{"id": "promotion-negotiation"}]}

    report, profiles = discover_creator_agents(
        repository,
        promotion,
        limit=5,
        default_base_url="http://127.0.0.1:8091/a2a/v1",
        endpoint_overrides={"creator-agent-003": "http://127.0.0.1:8092/a2a/v1"},
        card_probe=probe,
    )

    by_id = {c.creator_agent_id: c for c in report.candidates}
    # Rate card above maxPerCreator and unsupported usage rights fall out with reasons.
    assert by_id["creator-agent-004"].hard_filter_reasons == ["RATE_EXCEEDS_MAX_PER_CREATOR"]
    assert by_id["creator-agent-006"].hard_filter_reasons == ["USAGE_RIGHTS_UNSUPPORTED"]
    assert by_id["creator-agent-004"].rank is None
    # Endpoint override is honoured and a dead endpoint is probed out.
    assert by_id["creator-agent-003"].base_url == "http://127.0.0.1:8092/a2a/v1"
    assert by_id["creator-agent-003"].card_status == "DOWN"
    assert not by_id["creator-agent-003"].selected
    selected = [c.creator_agent_id for c in report.selected]
    assert set(selected) == {"agent-creator-1", "creator-agent-005", "creator-agent-001"}
    assert all(c.card_status == "UP" for c in report.selected)
    # Ranks are contiguous over eligible candidates only.
    assert [c.rank for c in report.candidates if c.eligible] == [1, 2, 3, 4]
    assert set(profiles) >= set(selected)
    # Discovery never exposes exact minimums, only the public band.
    assert by_id["creator-agent-001"].public_rate_band == "400_700"


def test_discovery_probe_rejects_agents_without_negotiation_skill() -> None:
    repository = _seeded_repository()
    promotion = demo_promotion(category="beauty", max_per_creator_usdc=700)
    report, _ = discover_creator_agents(
        repository,
        promotion,
        limit=2,
        default_base_url="http://x/a2a/v1",
        card_probe=lambda _url: {"skills": [{"id": "something-else"}]},
    )
    assert report.probed == 2
    assert report.selected == []
    assert {c.card_status for c in report.candidates if c.rank in (1, 2)} == {"NO_SKILL"}


# --- ledger ----------------------------------------------------------------------


def test_budget_ledger_never_exceeds_total_and_frees_remainder_on_commit() -> None:
    ledger = BudgetLedger(1300)
    assert ledger.reserve("a", 700)
    assert not ledger.reserve("b", 700)  # 1400 > 1300
    ledger.commit("a", 400)  # agreed below ceiling -> 300 freed
    assert ledger.reserve("b", 700)
    assert ledger.available_usdc == 200
    assert ledger.committed_excluding("b") == 400
    ledger.release("b")
    assert ledger.snapshot() == {
        "totalUsdc": 1300,
        "reservedUsdc": 0,
        "committedUsdc": 400,
        "availableUsdc": 900,
    }


def test_budget_ledger_waiter_retries_after_release() -> None:
    ledger = BudgetLedger(700)
    assert ledger.reserve("a", 700)
    outcome: list[str] = []
    waiter = threading.Thread(
        target=lambda: outcome.append(ledger.reserve_or_wait("b", 700, give_up=lambda: False))
    )
    waiter.start()
    time.sleep(0.1)
    assert outcome == []  # still waiting on "a"
    ledger.release("a")
    waiter.join(timeout=2)
    assert outcome == ["RESERVED"]


def test_budget_ledger_gives_up_when_nothing_in_flight() -> None:
    ledger = BudgetLedger(500)
    assert ledger.reserve_or_wait("a", 700, give_up=lambda: False) == "EXHAUSTED"
    assert ledger.reserve_or_wait("a", 100, give_up=lambda: True) == "STOPPED"


# --- campaign (in-process) ---------------------------------------------------------


def _run_campaign(*, total: int, target: int, opening: int = 400, ceiling: int = 700, **kw):
    repository = _seeded_repository()
    store = _creator_store(repository)
    promotion = demo_promotion(category="beauty", max_per_creator_usdc=700, total_usdc=total)
    events: list[tuple[str, str | None]] = []
    result = CampaignRunner(
        repository=repository,
        promotion=promotion,
        strategy=CampaignStrategy(
            targetCreatorCount=target,
            openingAmountUsdc=opening,
            ceilingUsdc=ceiling,
            parallelism=4,
            **kw,
        ),
        transport_factory=lambda _url: InProcessTransport(store),
        default_base_url="http://x/a2a/v1",
        on_event=lambda e: events.append((e.event, e.creator_agent_id)),
        probe_cards=False,
    ).run()
    return result, store, repository, events


def test_campaign_reaches_target_within_budget_and_skips_the_rest() -> None:
    result, store, repository, events = _run_campaign(total=1300, target=2)

    assert result.outcome == "TARGET_REACHED"
    assert result.agreed_count == 2
    assert result.committed_usdc <= result.total_budget_usdc
    agreed = {n.creator_agent_id: n for n in result.negotiations if n.status == "DONE"}
    # agent-creator-1 (min 300) accepts the 400 opener; creator-agent-005 (min 600) counters.
    assert agreed["agent-creator-1"].result.outcome == "AGREED"
    assert agreed["agent-creator-1"].committed_usdc == 400
    assert agreed["creator-agent-005"].result.outcome == "AGREED"
    assert agreed["creator-agent-005"].committed_usdc == 600
    assert result.committed_usdc == 1000
    skipped = [n for n in result.negotiations if n.status == "SKIPPED"]
    assert {n.skip_reason for n in skipped} == {"TARGET_REACHED"}
    # Every selected candidate got exactly one column of events, discovery came first.
    assert events[0][0] == "discovery" and events[-1][0] == "campaign_result"
    # Agreed tasks are COMPLETED on the creator side with term sheets.
    for negotiation in agreed.values():
        task = store.get_task(negotiation.result.task_id)
        assert task.status.state.value == "TASK_STATE_COMPLETED"
        assert task.artifacts[0].parts[0].data["result"] == "AGREED"
    # Match run + candidates persisted.
    run_doc = repository.get_raw_document(f"matchRuns/{result.match_run_id}")
    assert run_doc and run_doc["status"] == "TARGET_REACHED"
    candidates = repository.list_raw_documents(f"matchRuns/{result.match_run_id}/candidates")
    assert len(candidates) == len(result.discovery.candidates)
    assert any(c.get("outcome") == "AGREED" for c in candidates)


def test_campaign_budget_too_small_for_any_ceiling_reports_no_agreement() -> None:
    # Ceiling is capped to total (500) so one negotiation can still run.
    result, _, _, _ = _run_campaign(total=500, target=2)
    assert result.outcome == "PARTIAL"
    assert result.agreed_count == 1
    assert result.committed_usdc == 400
    assert [n.skip_reason for n in result.negotiations if n.status == "SKIPPED"] == [
        "BUDGET_EXHAUSTED"
    ] * 3


def test_campaign_with_no_matching_category_has_no_candidates() -> None:
    repository = _seeded_repository()
    promotion = demo_promotion(category="gambling", max_per_creator_usdc=700, total_usdc=1300)
    result = CampaignRunner(
        repository=repository,
        promotion=promotion,
        strategy=CampaignStrategy(targetCreatorCount=1, openingAmountUsdc=400, ceilingUsdc=700),
        transport_factory=lambda _url: InProcessTransport(_creator_store(repository)),
        default_base_url="http://x/a2a/v1",
        probe_cards=False,
    ).run()
    assert result.outcome == "NO_CANDIDATES"
    assert result.negotiations == []


# --- campaign over real HTTP, two creator services ------------------------------------


def test_brand_campaign_streams_across_two_creator_services() -> None:
    token = "test-a2a-token"
    repository = _seeded_repository()

    port_a, port_b = _free_port(), _free_port()
    url_a = f"http://127.0.0.1:{port_a}/a2a/v1"
    url_b = f"http://127.0.0.1:{port_b}/a2a/v1"
    servers = []
    for port, url, tenants in (
        (port_a, url_a, ["agent-creator-1", "creator-agent-001"]),
        (port_b, url_b, ["creator-agent-005", "creator-agent-003"]),
    ):
        app = create_creator_app(
            settings=Settings(
                service_name="knot-creator-agent",
                creator_agent_base_url=url,
                a2a_service_token=token,
                creator_agent_tenants=tenants,
            ),
            task_store=InMemoryA2ATaskStore(
                {},
                context_resolver=_firestore_context_resolver(repository),
                allowed_tenants=set(tenants),
            ),
        )
        server = uvicorn.Server(
            uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
        )
        threading.Thread(target=server.run, daemon=True).start()
        servers.append(server)

    try:
        _wait_for_health(f"http://127.0.0.1:{port_a}/healthz")
        _wait_for_health(f"http://127.0.0.1:{port_b}/healthz")

        brand = TestClient(
            create_brand_app(
                settings=Settings(
                    service_name="knot-brand-agent",
                    creator_agent_base_url=url_a,
                    creator_a2a_timeout_seconds=5,
                    a2a_service_token=token,
                    creator_agent_endpoints={
                        "creator-agent-005": url_b,
                        "creator-agent-003": url_b,
                    },
                ),
                repository=repository,
            )
        )
        events: list[tuple[str, dict]] = []
        with brand.stream(
            "GET",
            "/brand/v1/campaigns/stream",
            params={
                "category": "beauty",
                "totalUsdc": 1300,
                "maxPerCreatorUsdc": 700,
                "targetCreatorCount": 2,
                "openingAmountUsdc": 400,
                "ceilingUsdc": 700,
                "parallelism": 2,
            },
        ) as stream:
            name, buf = None, []
            for line in stream.iter_lines():
                if line == "":
                    if name:
                        events.append((name, json.loads("".join(buf))))
                    name, buf = None, []
                elif line.startswith("event:"):
                    name = line[6:].strip()
                elif line.startswith("data:"):
                    buf.append(line[5:].strip())

        names = [e for e, _ in events]
        assert names[0] == "status" and names[1] == "discovery" and names[-1] == "campaign_result"
        discovery = events[1][1]["report"]
        selected = {c["creatorAgentId"]: c for c in discovery["candidates"] if c["selected"]}
        # Both services were probed and both answered.
        assert selected["creator-agent-005"]["baseUrl"] == url_b
        assert selected["agent-creator-1"]["baseUrl"] == url_a
        result = events[-1][1]["result"]
        assert result["outcome"] == "TARGET_REACHED"
        assert result["agreedCount"] == 2
        agreed = [
            n
            for n in result["negotiations"]
            if n["status"] == "DONE" and n["result"]["outcome"] == "AGREED"
        ]
        assert len(agreed) == 2
        assert result["committedUsdc"] == sum(n["committedUsdc"] for n in agreed)
        assert result["committedUsdc"] <= result["totalBudgetUsdc"]
        turn_agents = {d["creatorAgentId"] for e, d in events if e == "turn"}
        assert {n["creatorAgentId"] for n in agreed} <= turn_agents

        # Each agreed task lives in the service that hosts that tenant, and nowhere else.
        headers = {"A2A-Version": "1.0", "Authorization": f"Bearer {token}"}
        tasks_by_url = {
            url: {t["id"] for t in httpx.get(f"{url}/tasks", headers=headers).json()["tasks"]}
            for url in (url_a, url_b)
        }
        for negotiation in agreed:
            task_id = negotiation["result"]["taskId"]
            home = negotiation["baseUrl"]
            other = url_b if home == url_a else url_a
            assert task_id in tasks_by_url[home]
            assert task_id not in tasks_by_url[other]

        # A tenant the service does not host is refused with 409.
        refused = httpx.post(
            f"{url_a}/message:send",
            headers={**headers, "Content-Type": "application/a2a+json"},
            json={
                "tenant": "creator-agent-005",
                "message": {
                    "messageId": "m-1",
                    "contextId": "c-1",
                    "role": "ROLE_USER",
                    "parts": [{"mediaType": "application/json", "data": {"x": 1}}],
                },
            },
        )
        assert refused.status_code == 409

        # Campaign page served.
        assert "EventSource" in brand.get("/brand/v1/campaign").text
    finally:
        for server in servers:
            server.should_exit = True


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _wait_for_health(url: str, timeout_seconds: float = 10.0) -> None:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        try:
            if httpx.get(url, timeout=0.5).status_code == 200:
                return
        except httpx.HTTPError:
            pass
        time.sleep(0.1)
    raise RuntimeError(f"server at {url} did not become healthy")
