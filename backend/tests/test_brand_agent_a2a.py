"""Brand Agent ↔ Creator Agent negotiation loop.

In-process cases drive BrandNegotiator against InMemoryA2ATaskStore. The HTTP case
boots the real creator service with uvicorn and calls the brand service endpoint so
two agent processes negotiate over the wire.
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
from apps.creator_agent.main import create_app as create_creator_app
from libs.a2a.models import A2ATaskState, NegotiationMessageType
from libs.a2a.store import InMemoryA2ATaskStore
from libs.agents.brand_negotiator import (
    BrandNegotiationStrategy,
    BrandNegotiator,
    InProcessTransport,
)
from libs.agents.demo_context import demo_creator_contexts
from libs.settings.config import Settings

CREATOR = "creator-agent-001"  # demo policy: min 650 USDC, gambling blocked


def _negotiate(strategy: BrandNegotiationStrategy, *, category: str = "beauty"):
    store = InMemoryA2ATaskStore(demo_creator_contexts())
    negotiator = BrandNegotiator(
        InProcessTransport(store),
        promotion=demo_promotion(category=category),
        creator_agent_id=CREATOR,
        strategy=strategy,
    )
    return negotiator.run(), store


def test_counter_then_accept_within_ceiling() -> None:
    result, store = _negotiate(BrandNegotiationStrategy(openingAmountUsdc=500, ceilingUsdc=700))

    assert result.outcome == "AGREED"
    assert result.rounds == 2
    assert result.final_amount_usdc == 650
    assert result.agreement_id and result.terms_hash
    assert [(t.role, t.type, t.amount_usdc) for t in result.turns] == [
        ("brand", NegotiationMessageType.OFFER, 500),
        ("creator", NegotiationMessageType.COUNTER, 650),
        ("brand", NegotiationMessageType.ACCEPT, 650),
        ("creator", NegotiationMessageType.ACCEPT, 650),
    ]
    task = store.get_task(result.task_id)
    assert task.status.state == A2ATaskState.COMPLETED
    assert len(task.history) == 4
    assert task.artifacts[0].parts[0].data["result"] == "AGREED"


def test_brand_concedes_toward_creator_then_walks_away_at_ceiling() -> None:
    result, store = _negotiate(
        BrandNegotiationStrategy(openingAmountUsdc=500, ceilingUsdc=600, concessionPct=50)
    )

    assert result.outcome == "WALKED_AWAY"
    brand_amounts = [t.amount_usdc for t in result.turns if t.role == "brand"]
    # 500 → +75 (half of 150 gap) → 575 → capped at the private ceiling → 600 → no move
    assert brand_amounts == [500, 575, 600]
    assert all(
        t.type == NegotiationMessageType.COUNTER and t.amount_usdc == 650
        for t in result.turns
        if t.role == "creator"
    )
    assert result.agreement_id is None
    assert store.get_task(result.task_id).status.state == A2ATaskState.CANCELED
    assert result.task_state == "TASK_STATE_CANCELED"


def test_blocked_industry_is_rejected_in_round_one() -> None:
    result, _ = _negotiate(
        BrandNegotiationStrategy(openingAmountUsdc=900, ceilingUsdc=1000),
        category="gambling",
    )

    assert result.outcome == "REJECTED"
    assert result.rounds == 1
    assert [t.type for t in result.turns] == [
        NegotiationMessageType.OFFER,
        NegotiationMessageType.REJECT,
    ]


def test_round_limit_stops_the_loop() -> None:
    # Ceiling sits under the creator minimum, so the brand keeps conceding until the cap.
    result, _ = _negotiate(
        BrandNegotiationStrategy(
            openingAmountUsdc=100, ceilingUsdc=640, concessionPct=50, maxRounds=3
        )
    )

    assert result.outcome == "ROUND_LIMIT"
    assert result.rounds == 3
    assert result.task_state == "TASK_STATE_CANCELED"


def test_brand_service_negotiates_with_creator_service_over_http() -> None:
    port = _free_port()
    creator_url = f"http://127.0.0.1:{port}/a2a/v1"
    token = "test-a2a-token"

    creator_app = create_creator_app(
        settings=Settings(
            service_name="knot-creator-agent",
            creator_agent_base_url=creator_url,
            a2a_service_token=token,
        ),
        task_store=InMemoryA2ATaskStore(demo_creator_contexts()),
    )
    server = uvicorn.Server(
        uvicorn.Config(creator_app, host="127.0.0.1", port=port, log_level="warning")
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    try:
        _wait_for_health(f"http://127.0.0.1:{port}/healthz")

        brand = TestClient(
            create_brand_app(
                settings=Settings(
                    service_name="knot-brand-agent",
                    creator_agent_base_url=creator_url,
                    creator_a2a_timeout_seconds=5,
                    a2a_service_token=token,
                )
            )
        )
        response = brand.post(
            "/brand/v1/negotiations",
            json={
                "creatorAgentId": CREATOR,
                "strategy": {"openingAmountUsdc": 500, "ceilingUsdc": 700},
            },
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["creatorAgentCard"]["name"] == "KNOT Creator Negotiation Agent"
        result = body["result"]
        assert result["outcome"] == "AGREED"
        assert result["finalAmountUsdc"] == 650
        assert [t["type"] for t in result["turns"]] == ["OFFER", "COUNTER", "ACCEPT", "ACCEPT"]

        # The creator service really holds the task.
        task = httpx.get(
            f"{creator_url}/tasks/{result['taskId']}",
            headers={"A2A-Version": "1.0", "Authorization": f"Bearer {token}"},
        ).json()["task"]
        assert task["status"]["state"] == "TASK_STATE_COMPLETED"
        assert len(task["history"]) == 4

        # SSE stream: status, then alternating turns, then result.
        events: list[tuple[str, dict]] = []
        with brand.stream(
            "GET",
            "/brand/v1/negotiations/stream",
            params={"creatorAgentId": CREATOR, "openingAmountUsdc": 500, "ceilingUsdc": 700},
        ) as stream:
            assert stream.headers["content-type"].startswith("text/event-stream")
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
        assert [e for e, _ in events] == ["status", "turn", "turn", "turn", "turn", "result"]
        assert events[0][1]["creatorAgentCard"]["name"] == "KNOT Creator Negotiation Agent"
        assert [d["role"] for e, d in events if e == "turn"] == [
            "brand",
            "creator",
            "brand",
            "creator",
        ]
        assert events[-1][1]["outcome"] == "AGREED"

        # Watch page is served by the brand agent itself.
        page = brand.get("/brand/v1/watch")
        assert page.status_code == 200 and "EventSource" in page.text

        # Unknown tenant surfaces as a 502 from the brand side, not a crash.
        bad = brand.post(
            "/brand/v1/negotiations",
            json={
                "creatorAgentId": "creator-agent-nope",
                "strategy": {"openingAmountUsdc": 500, "ceilingUsdc": 700},
            },
        )
        assert bad.status_code == 502
    finally:
        server.should_exit = True
        thread.join(timeout=5)


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
