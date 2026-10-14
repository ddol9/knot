from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response

from libs.observability.tracing import (
    PARENT_SPAN_HEADER,
    TRACE_HEADER,
    TraceContext,
    is_valid_id,
    new_trace_id,
)
from libs.observability.tracing import (
    bind as bind_trace,
)


def add_request_context(app: FastAPI, service_name: str) -> None:
    """Tag every response with the service and bind one trace id per request.

    The trace id comes from `X-Trace-Id` (or `X-Request-Id`) when the caller sends one
    (the brand agent's A2A client does, so creator-side spans join the brand's trace),
    otherwise a fresh one is generated. It is exposed as `request.state.trace_id` and
    echoed back in the `X-Trace-Id` response header. No span is opened here: request
    handling itself is cheap and the agent runtime opens the spans that matter.
    """

    @app.middleware("http")
    async def request_context(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        incoming = request.headers.get(TRACE_HEADER) or request.headers.get("X-Request-Id")
        trace_id = incoming if is_valid_id(incoming) else new_trace_id()
        parent = request.headers.get(PARENT_SPAN_HEADER)
        context = TraceContext(trace_id=trace_id, span_id=parent if is_valid_id(parent) else None)
        request.state.trace_id = trace_id
        with bind_trace(context):
            response = await call_next(request)
        response.headers["X-KNOT-Service"] = service_name
        response.headers[TRACE_HEADER] = trace_id
        return response
