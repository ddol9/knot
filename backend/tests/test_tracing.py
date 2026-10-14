"""Tracer: nesting, thread propagation, redaction, error status, sinks, middleware."""

import json
import logging
import sys
import types
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from libs.observability import tracing
from libs.observability.middleware import add_request_context
from libs.observability.tracing import (
    TraceContext,
    bind,
    current_trace_id,
    propagate,
    propagate_to_thread,
    span,
    start_trace,
    trace_headers,
)


@pytest.fixture(autouse=True)
def _log_sink(caplog):
    tracing.reset()
    tracing.configure(enabled=True, sink="log", service="test")
    caplog.set_level(logging.INFO, logger=tracing.TRACE_LOGGER_NAME)
    yield
    tracing.reset()


def _records(caplog) -> list[dict]:
    return [
        json.loads(r.getMessage())
        for r in caplog.records
        if r.name == tracing.TRACE_LOGGER_NAME and r.levelno == logging.INFO
    ]


def _by_name(caplog) -> dict[str, dict]:
    return {r["name"]: r for r in _records(caplog)}


def test_spans_nest_and_share_one_trace_id(caplog) -> None:
    with span("outer", a=1) as outer:
        with span("inner") as inner:
            inner.set(b=2)
            inner.event("tick", n=1)
    records = _by_name(caplog)
    assert set(records) == {"outer", "inner"}
    assert records["outer"]["parentSpanId"] is None
    assert records["inner"]["parentSpanId"] == records["outer"]["spanId"] == outer.span_id
    assert records["inner"]["traceId"] == records["outer"]["traceId"] == outer.trace_id
    assert records["inner"]["attrs"] == {"b": 2}
    assert records["inner"]["events"][0]["name"] == "tick"
    assert records["inner"]["events"][0]["n"] == 1
    assert records["outer"]["status"] == "ok" and records["outer"]["durationMs"] >= 0
    assert records["outer"]["service"] == "test"
    # Children are emitted before their parent (on exit), parent carries no child state.
    assert [r["name"] for r in _records(caplog)] == ["inner", "outer"]
    assert current_trace_id() is None


def test_worker_threads_inherit_the_trace_only_when_propagated(caplog) -> None:
    def work(i: int) -> str:
        with span("child", i=i):
            return current_trace_id() or ""

    with span("root") as root:
        with ThreadPoolExecutor(max_workers=2) as pool:
            inherited = list(pool.map(propagate_to_thread(work), [1, 2]))
            detached = list(pool.map(work, [3]))
    assert inherited == [root.trace_id, root.trace_id]
    assert detached[0] and detached[0] != root.trace_id
    children = [r for r in _records(caplog) if r["name"] == "child"]
    parents = {r["attrs"]["i"]: r["parentSpanId"] for r in children}
    assert parents[1] == parents[2] == root.span_id
    assert parents[3] is None
    # Explicit capture/bind works the same way.
    captured = propagate()
    assert captured is None
    with span("again") as again:
        captured = propagate()
    with bind(captured):
        assert current_trace_id() == again.trace_id


def test_private_negotiation_attrs_are_never_emitted(caplog) -> None:
    with span(
        "neg",
        ceilingUsdc=700,
        minBaseUsdc=300,
        policySnapshot={"ceilingUsdc": 1},
        nested={"policyRule": "x", "ok": True, "deep": [{"minDays": 3, "keep": 1}]},
        amountUsdc=400,
    ) as s:
        s.set(ceiling=1, fine="yes")
        s.event("turn", minDaysToPost=3, round=1)
    record = _by_name(caplog)["neg"]
    assert record["attrs"] == {
        "nested": {"ok": True, "deep": [{"keep": 1}]},
        "amountUsdc": 400,
        "fine": "yes",
    }
    assert set(record["redacted"]) == {
        "ceilingUsdc",
        "minBaseUsdc",
        "policySnapshot",
        "nested.policyRule",
        "nested.deep[].minDays",
        "ceiling",
    }
    assert record["events"][0]["redacted"] == ["minDaysToPost"]
    assert record["events"][0]["round"] == 1
    emitted = json.dumps({"attrs": record["attrs"], "events": record["events"]}).lower()
    assert "ceiling" not in emitted and "minbase" not in emitted and "policy" not in emitted


def test_exception_marks_span_error_and_reraises(caplog) -> None:
    with pytest.raises(ValueError, match="bad"):
        with span("boom"):
            raise ValueError("bad")
    record = _by_name(caplog)["boom"]
    assert record["status"] == "error"
    assert record["error"] == "ValueError: bad"


def test_disabled_tracer_keeps_ids_but_emits_nothing(caplog) -> None:
    tracing.configure(enabled=False)
    with span("quiet") as s:
        assert s.trace_id and s.span_id
        assert current_trace_id() == s.trace_id
    assert _records(caplog) == []


def test_langsmith_sink_falls_back_to_log_with_one_warning(caplog, monkeypatch) -> None:
    monkeypatch.setenv("LANGSMITH_API_KEY", "ls-test")
    monkeypatch.setitem(sys.modules, "langsmith", None)  # import raises ImportError
    tracing.configure(sink="langsmith")
    with span("one"):
        pass
    with span("two"):
        pass
    assert [r["name"] for r in _records(caplog)] == ["one", "two"]
    warnings = [
        r for r in caplog.records if r.levelno == logging.WARNING and "LangSmith" in r.getMessage()
    ]
    assert len(warnings) == 1


def test_langsmith_sink_mirrors_nested_runs(caplog, monkeypatch) -> None:
    calls: list[tuple[str, str]] = []

    class FakeRunTree:
        def __init__(self, name, run_type, inputs, project_name=None, parent=None):
            self.name, self.run_type, self.parent = name, run_type, parent
            self.project_name = project_name
            calls.append(("new", name))

        def create_child(self, name, run_type, inputs):
            return FakeRunTree(name, run_type, inputs, parent=self)

        def post(self):
            calls.append(("post", self.name))

        def end(self, outputs=None, error=None):
            self.outputs, self.error = outputs, error
            calls.append(("end", self.name))

        def patch(self):
            calls.append(("patch", self.name))

    monkeypatch.setitem(sys.modules, "langsmith", types.SimpleNamespace(RunTree=FakeRunTree))
    monkeypatch.setenv("LANGSMITH_API_KEY", "ls-test")
    tracing.configure(sink="langsmith", project="knot-test")
    with span("campaign.run") as outer:
        with span("llm.call", ceilingUsdc=1, model="m"):
            pass
    assert isinstance(outer._handle, FakeRunTree)
    assert outer._handle.project_name == "knot-test" and outer._handle.run_type == "chain"
    assert [c for c in calls if c[0] == "new"] == [("new", "campaign.run"), ("new", "llm.call")]
    assert ("end", "llm.call") in calls and ("patch", "campaign.run") in calls
    # The log line is still written, and redaction applies to the mirrored run too.
    assert [r["name"] for r in _records(caplog)] == ["llm.call", "campaign.run"]
    child_run = next(c for c in calls if c == ("new", "llm.call"))
    assert child_run
    assert "ceilingUsdc" not in json.dumps(outer._handle.outputs)


def test_start_trace_and_headers_carry_the_context() -> None:
    with start_trace("req-12345678") as trace_id:
        assert trace_id == "req-12345678" == current_trace_id()
        assert trace_headers() == {tracing.TRACE_HEADER: "req-12345678"}
        with span("s") as s:
            assert trace_headers() == {
                tracing.TRACE_HEADER: "req-12345678",
                tracing.PARENT_SPAN_HEADER: s.span_id,
            }
    with start_trace("bad id!") as generated:
        assert generated != "bad id!" and tracing.is_valid_id(generated)
    assert trace_headers() == {}


def test_request_middleware_binds_and_echoes_trace_id(caplog) -> None:
    app = FastAPI()
    add_request_context(app, service_name="svc")

    @app.get("/sync")
    def sync_endpoint() -> dict[str, str | None]:
        with span("inside"):
            return {"traceId": current_trace_id()}

    @app.get("/async")
    async def async_endpoint() -> dict[str, str | None]:
        return {"traceId": current_trace_id()}

    client = TestClient(app)
    response = client.get(
        "/sync", headers={"X-Trace-Id": "abcdef0123456789", "X-Parent-Span-Id": "0123456789abcdef"}
    )
    assert response.headers["X-Trace-Id"] == "abcdef0123456789"
    assert response.headers["X-KNOT-Service"] == "svc"
    assert response.json() == {"traceId": "abcdef0123456789"}
    inside = _by_name(caplog)["inside"]
    assert inside["traceId"] == "abcdef0123456789"
    assert inside["parentSpanId"] == "0123456789abcdef"

    fresh = client.get("/async")
    assert fresh.json()["traceId"] == fresh.headers["X-Trace-Id"]
    assert tracing.is_valid_id(fresh.headers["X-Trace-Id"])
    assert fresh.headers["X-Trace-Id"] != "abcdef0123456789"


def test_bind_restores_previous_context() -> None:
    with bind(TraceContext(trace_id="outer-trace-1")):
        with bind(TraceContext(trace_id="inner-trace-1")):
            assert current_trace_id() == "inner-trace-1"
        assert current_trace_id() == "outer-trace-1"
    assert current_trace_id() is None
