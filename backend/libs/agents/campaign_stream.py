"""Run a CampaignRunner on a worker thread and iterate its events for SSE."""

from __future__ import annotations

import queue
import threading
from collections.abc import Callable, Iterator
from typing import Any

from libs.agents.brand_campaign import CampaignEvent, CampaignRunner
from libs.observability.tracing import bind, propagate

RunnerFactory = Callable[[Callable[[CampaignEvent], None]], CampaignRunner]


def campaign_event_stream(
    build_runner: RunnerFactory, *, status: dict[str, Any] | None = None
) -> Iterator[tuple[str, Any]]:
    """Yield (event, data) pairs: a `status` event first, then runner events, `error` on crash."""
    events: queue.Queue[tuple[str, Any]] = queue.Queue()

    def on_event(event: CampaignEvent) -> None:
        events.put((event.event, {"creatorAgentId": event.creator_agent_id, **event.data}))

    runner = build_runner(on_event)
    # Captured before the first yield: the caller's trace context may not survive the
    # next generator step (Starlette steps sync generators in separate context copies).
    trace_context = propagate()
    yield (
        "status",
        {"campaignId": runner.campaign_id, "traceId": runner.trace_id, **(status or {})},
    )

    def worker() -> None:
        with bind(trace_context):
            try:
                runner.run()
            except Exception as exc:  # surfaced to the client as an SSE error event
                events.put(("error", {"detail": str(exc)}))
            finally:
                events.put(("done", None))

    threading.Thread(target=worker, daemon=True).start()
    while True:
        event, data = events.get()
        if event == "done":
            return
        yield event, data
