"""Tiny tracer for the agent runtime: nested spans, JSON log lines, optional LangSmith.

Every campaign, negotiation, A2A message and LLM call opens a span. Spans nest through
contextvars (trace id + parent span id), including across threads via `propagate()` /
`bind()` / `propagate_to_thread()`, and across processes via the `X-Trace-Id` /
`X-Parent-Span-Id` headers that the A2A client sends and the request middleware reads.

On exit each span emits one JSON line to the `knot.trace` logger::

    {"traceId", "spanId", "parentSpanId", "name", "durationMs", "status", "error"?,
     "attrs", "events", "startedAt", "service"?}

Sinks are pluggable: the default writes those lines through logging; when
`LANGSMITH_API_KEY` (or `LANGCHAIN_API_KEY`) is set and `langsmith` imports, spans are
also exported as LangSmith runs. Nothing here depends on a package outside the standard
library.

Attribute names starting with `ceiling`, `min` or `policy` are private negotiation state
and are never emitted: the tracer drops them and lists the dropped keys under `redacted`.
"""

from __future__ import annotations

import contextvars
import json
import logging
import os
import re
import secrets
import sys
import threading
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from functools import wraps
from typing import Any
from uuid import uuid4

TRACE_LOGGER_NAME = "knot.trace"
TRACE_HEADER = "X-Trace-Id"
PARENT_SPAN_HEADER = "X-Parent-Span-Id"
REDACTED_PREFIXES = ("ceiling", "min", "policy")
_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{8,64}$")

logger = logging.getLogger(TRACE_LOGGER_NAME)


# --- configuration ------------------------------------------------------------------


@dataclass
class TracingConfig:
    enabled: bool = True
    sink: str = "log"  # log | langsmith
    project: str = "knot-agent-ops"
    service: str | None = None

    @classmethod
    def from_env(cls, service: str | None = None) -> TracingConfig:
        return cls(
            enabled=tracing_enabled_from_env(),
            sink=tracing_sink_from_env(),
            project=langsmith_project_from_env(),
            service=service or os.getenv("KNOT_SERVICE_NAME"),
        )


def tracing_enabled_from_env() -> bool:
    value = os.getenv("KNOT_TRACING")
    if value is None or not value.strip():
        return True
    return value.strip().lower() in {"1", "true", "yes", "on"}


def tracing_sink_from_env() -> str:
    value = (os.getenv("KNOT_TRACING_SINK") or "").strip().lower()
    if value in {"log", "langsmith"}:
        return value
    return "langsmith" if langsmith_api_key_from_env() else "log"


def langsmith_api_key_from_env() -> str | None:
    return os.getenv("LANGSMITH_API_KEY") or os.getenv("LANGCHAIN_API_KEY") or None


def langsmith_project_from_env() -> str:
    return os.getenv("LANGSMITH_PROJECT") or os.getenv("LANGCHAIN_PROJECT") or "knot-agent-ops"


_config: TracingConfig | None = None
_sink: _Sink | None = None
_lock = threading.Lock()


def configure(
    *,
    enabled: bool | None = None,
    sink: str | None = None,
    project: str | None = None,
    service: str | None = None,
) -> TracingConfig:
    """Set the tracer configuration (apps call this through `install_logging`)."""
    global _config, _sink
    with _lock:
        base = _config or TracingConfig.from_env()
        _config = TracingConfig(
            enabled=base.enabled if enabled is None else enabled,
            sink=base.sink if sink is None else sink,
            project=base.project if project is None else project,
            service=base.service if service is None else service,
        )
        _sink = None
    return _config


def reset() -> None:
    """Forget configuration and sink (tests)."""
    global _config, _sink
    with _lock:
        _config = None
        _sink = None
    _warned.clear()


def get_config() -> TracingConfig:
    global _config
    if _config is None:
        with _lock:
            if _config is None:
                _config = TracingConfig.from_env()
    return _config


def install_logging(settings: Any | None = None) -> None:
    """Make sure `knot.trace` JSON lines reach stderr at INFO under uvicorn.

    Uvicorn configures only its own loggers, so an app logger at INFO otherwise
    falls through to the root logger's last-resort handler (WARNING and above).
    This adds one message-only handler to `knot.trace` (idempotent), leaves
    propagation on so pytest's caplog still sees the records, and applies the
    tracing settings when they are given.
    """
    trace_logger = logging.getLogger(TRACE_LOGGER_NAME)
    trace_logger.setLevel(logging.INFO)
    if not any(getattr(h, "_knot_trace_handler", False) for h in trace_logger.handlers):
        handler = logging.StreamHandler(sys.stderr)
        handler.setFormatter(logging.Formatter("%(message)s"))
        handler._knot_trace_handler = True  # type: ignore[attr-defined]
        trace_logger.addHandler(handler)
    if settings is not None:
        configure(
            enabled=getattr(settings, "tracing_enabled", None),
            sink=getattr(settings, "tracing_sink", None),
            project=getattr(settings, "langsmith_project", None),
            service=getattr(settings, "service_name", None),
        )


# --- ids and context -----------------------------------------------------------------


def new_trace_id() -> str:
    return uuid4().hex


def new_span_id() -> str:
    return secrets.token_hex(8)


def is_valid_id(value: str | None) -> bool:
    return bool(value) and _ID_PATTERN.match(value or "") is not None


@dataclass(frozen=True)
class TraceContext:
    trace_id: str
    span_id: str | None = None
    # The live parent span when it is in this process (lets sinks nest runs).
    span: Span | None = field(default=None, compare=False, repr=False)


_current: contextvars.ContextVar[TraceContext | None] = contextvars.ContextVar(
    "knot_trace_context", default=None
)


def current_context() -> TraceContext | None:
    return _current.get()


def current_trace_id() -> str | None:
    context = _current.get()
    return context.trace_id if context else None


def current_span() -> Span | None:
    context = _current.get()
    return context.span if context else None


def propagate() -> TraceContext | None:
    """Capture the current trace context to hand to another thread."""
    return _current.get()


@contextmanager
def bind(context: TraceContext | None) -> Iterator[TraceContext | None]:
    """Run the block under `context` (restores the previous context afterwards)."""
    previous = _current.get()
    token = _current.set(context)
    try:
        yield context
    finally:
        try:
            _current.reset(token)
        except ValueError:
            # The block spanned a generator step that ran in another context copy.
            _current.set(previous)


@contextmanager
def start_trace(trace_id: str | None = None, *, parent_span_id: str | None = None) -> Iterator[str]:
    """Bind a trace id with no live parent span; the next `span()` becomes the root."""
    resolved = trace_id if is_valid_id(trace_id) else new_trace_id()
    parent = parent_span_id if is_valid_id(parent_span_id) else None
    with bind(TraceContext(trace_id=resolved, span_id=parent)):
        yield resolved


def propagate_to_thread[**P, R](fn: Callable[P, R]) -> Callable[P, R]:
    """Wrap `fn` so a worker thread (e.g. ThreadPoolExecutor) inherits the caller's trace."""
    context = propagate()

    @wraps(fn)
    def run(*args: P.args, **kwargs: P.kwargs) -> R:
        with bind(context):
            return fn(*args, **kwargs)

    return run


def trace_headers() -> dict[str, str]:
    """Headers that carry the current trace to another service (A2A HTTP)."""
    context = _current.get()
    if context is None:
        return {}
    headers = {TRACE_HEADER: context.trace_id}
    if context.span_id:
        headers[PARENT_SPAN_HEADER] = context.span_id
    return headers


# --- spans ---------------------------------------------------------------------------


class Span:
    __slots__ = (
        "name",
        "trace_id",
        "span_id",
        "parent_span_id",
        "attrs",
        "events",
        "status",
        "error",
        "started_at",
        "_start",
        "_handle",
        "_redacted",
    )

    def __init__(
        self,
        name: str,
        *,
        trace_id: str,
        parent_span_id: str | None,
        attrs: dict[str, Any],
    ) -> None:
        self.name = name
        self.trace_id = trace_id
        self.span_id = new_span_id()
        self.parent_span_id = parent_span_id
        self.attrs: dict[str, Any] = {}
        self.events: list[dict[str, Any]] = []
        self.status = "ok"
        self.error: str | None = None
        self.started_at = datetime.now(UTC)
        self._start = time.perf_counter()
        self._handle: Any = None
        self._redacted: list[str] = []
        self.set(**attrs)

    def set(self, **attrs: Any) -> Span:
        clean, dropped = redact(attrs)
        self.attrs.update(clean)
        for key in dropped:
            if key not in self._redacted:
                self._redacted.append(key)
        return self

    def event(self, name: str, **attrs: Any) -> None:
        clean, dropped = redact(attrs)
        record: dict[str, Any] = {
            "name": name,
            "offsetMs": round((time.perf_counter() - self._start) * 1000, 2),
            **clean,
        }
        if dropped:
            record["redacted"] = dropped
        self.events.append(record)

    def fail(self, error: BaseException | str) -> None:
        self.status = "error"
        self.error = error if isinstance(error, str) else f"{type(error).__name__}: {error}"[:500]

    @property
    def duration_ms(self) -> float:
        return round((time.perf_counter() - self._start) * 1000, 2)

    def to_record(self, service: str | None = None) -> dict[str, Any]:
        record: dict[str, Any] = {
            "traceId": self.trace_id,
            "spanId": self.span_id,
            "parentSpanId": self.parent_span_id,
            "name": self.name,
            "durationMs": self.duration_ms,
            "status": self.status,
        }
        if self.error:
            record["error"] = self.error
        record["attrs"] = self.attrs
        if self._redacted:
            record["redacted"] = list(self._redacted)
        if self.events:
            record["events"] = self.events
        record["startedAt"] = self.started_at.isoformat()
        if service:
            record["service"] = service
        return record


@contextmanager
def span(name: str, **attrs: Any) -> Iterator[Span]:
    """Open a child span of the current context; emits one record on exit."""
    config = get_config()
    parent = _current.get()
    trace_id = parent.trace_id if parent else new_trace_id()
    parent_span_id = parent.span_id if parent else None
    current = Span(name, trace_id=trace_id, parent_span_id=parent_span_id, attrs=attrs)
    sink = _get_sink() if config.enabled else None
    if sink is not None:
        _safe(sink.on_start, current, parent.span if parent else None)
    token = _current.set(TraceContext(trace_id=trace_id, span_id=current.span_id, span=current))
    try:
        yield current
    except BaseException as exc:
        current.fail(exc)
        raise
    finally:
        _current.reset(token)
        if sink is not None:
            _safe(sink.on_end, current)


def redact(attrs: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """Drop private negotiation attributes (ceiling*/min*/policy*), recursively."""
    clean: dict[str, Any] = {}
    dropped: list[str] = []
    for key, value in attrs.items():
        if _is_private(key):
            dropped.append(key)
            continue
        clean[key] = _redact_value(value, key, dropped)
    return clean, dropped


def _is_private(key: str) -> bool:
    lowered = str(key).lower()
    return any(lowered.startswith(prefix) for prefix in REDACTED_PREFIXES)


def _redact_value(value: Any, path: str, dropped: list[str]) -> Any:
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for key, inner in value.items():
            if _is_private(str(key)):
                dropped.append(f"{path}.{key}")
                continue
            out[str(key)] = _redact_value(inner, f"{path}.{key}", dropped)
        return out
    if isinstance(value, list | tuple):
        return [_redact_value(item, f"{path}[]", dropped) for item in value]
    return value


# --- sinks ---------------------------------------------------------------------------


class _Sink:
    def on_start(self, span: Span, parent: Span | None) -> None:  # noqa: B027
        pass

    def on_end(self, span: Span) -> None:
        raise NotImplementedError


class LogSink(_Sink):
    """One JSON line per span on logger `knot.trace` at INFO."""

    def __init__(self, service: str | None = None) -> None:
        self.service = service

    def on_end(self, span: Span) -> None:
        logger.info(json.dumps(span.to_record(self.service), ensure_ascii=False, default=str))


class LangSmithSink(_Sink):
    """Mirror spans as LangSmith runs (RunTree), on top of the JSON log line."""

    def __init__(self, project: str, service: str | None = None) -> None:
        import importlib

        module = importlib.import_module("langsmith")
        self._run_tree = module.RunTree
        self.project = project
        self._log = LogSink(service)

    def on_start(self, span: Span, parent: Span | None) -> None:
        inputs = {"attrs": dict(span.attrs), "traceId": span.trace_id, "spanId": span.span_id}
        parent_handle = getattr(parent, "_handle", None) if parent is not None else None
        if parent_handle is not None:
            run = parent_handle.create_child(
                name=span.name, run_type=_run_type(span.name), inputs=inputs
            )
        else:
            run = self._run_tree(
                name=span.name,
                run_type=_run_type(span.name),
                inputs=inputs,
                project_name=self.project,
            )
        run.post()
        span._handle = run

    def on_end(self, span: Span) -> None:
        self._log.on_end(span)
        run = span._handle
        if run is None:
            return
        outputs = {"attrs": span.attrs, "events": span.events, "durationMs": span.duration_ms}
        run.end(outputs=outputs, error=span.error)
        run.patch()


def _run_type(name: str) -> str:
    if name.startswith("llm."):
        return "llm"
    if name.startswith("a2a."):
        return "tool"
    return "chain"


_warned: set[str] = set()


def _warn_once(key: str, message: str) -> None:
    if key in _warned:
        return
    _warned.add(key)
    logger.warning(message)


def _get_sink() -> _Sink:
    global _sink
    if _sink is not None:
        return _sink
    with _lock:
        if _sink is None:
            _sink = _build_sink(get_config())
    return _sink


def _build_sink(config: TracingConfig) -> _Sink:
    if config.sink == "langsmith":
        try:
            if not langsmith_api_key_from_env():
                raise RuntimeError("LANGSMITH_API_KEY (or LANGCHAIN_API_KEY) is not set")
            return LangSmithSink(config.project, config.service)
        except Exception as exc:
            _warn_once(
                "langsmith",
                f"tracing: LangSmith sink unavailable ({exc}); falling back to log sink",
            )
    elif config.sink != "log":
        _warn_once("sink", f"tracing: unknown sink {config.sink!r}; using log sink")
    return LogSink(config.service)


def _safe(fn: Callable[..., Any], *args: Any) -> None:
    try:
        fn(*args)
    except Exception as exc:  # a broken sink must never break a negotiation
        _warn_once(f"sink-error:{type(exc).__name__}", f"tracing sink failed: {exc!r}")
