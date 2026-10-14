from collections.abc import Callable
from datetime import date

from fastapi import FastAPI, Header, HTTPException, Request

from apps.api.repository_factory import build_repository
from libs.a2a.agent_card import build_creator_agent_card
from libs.a2a.models import A2A_VERSION, A2ASendRequest
from libs.a2a.store import A2ATaskError, InMemoryA2ATaskStore
from libs.agents.demo_context import demo_creator_contexts
from libs.agents.negotiation import CreatorNegotiationContext
from libs.ai.gemini import creator_rationale
from libs.observability.middleware import add_request_context
from libs.repositories.store import KnotRepository
from libs.settings.config import Settings, get_settings


def create_app(
    settings: Settings | None = None,
    task_store: InMemoryA2ATaskStore | None = None,
) -> FastAPI:
    settings = settings or get_settings(service_name="knot-creator-agent")
    app = FastAPI(title="KNOT Creator Agent", version=settings.schema_version)
    add_request_context(app, service_name=settings.service_name)
    app.state.task_store = task_store or _build_task_store(settings)

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok", "service": settings.service_name}

    @app.get("/readyz")
    def readyz() -> dict[str, str]:
        return {"status": "ready", "service": settings.service_name}

    @app.get("/version")
    def version() -> dict[str, str]:
        return {
            "service": settings.service_name,
            "gitSha": settings.git_sha,
            "buildTime": settings.build_time,
            "schemaVersion": settings.schema_version,
        }

    @app.get("/a2a/v1/.well-known/agent-card.json")
    def agent_card() -> dict[str, object]:
        card = build_creator_agent_card(base_url=settings.creator_agent_base_url)
        if settings.creator_agent_tenants:
            card["hostedTenants"] = list(settings.creator_agent_tenants)
        return card

    @app.post("/a2a/v1/message:send")
    def message_send(
        request: Request,
        payload: dict[str, object],
        a2a_version: str | None = Header(default=None, alias="A2A-Version"),
        content_type: str | None = Header(default=None, alias="Content-Type"),
        authorization: str | None = Header(default=None, alias="Authorization"),
    ) -> dict[str, object]:
        _validate_a2a_headers(a2a_version=a2a_version, content_type=content_type)
        _validate_service_auth(settings=settings, authorization=authorization)
        send_request = A2ASendRequest.model_validate(payload)
        _register_embedded_context(request, send_request)
        try:
            task = request.app.state.task_store.send_message(
                send_request.tenant, send_request.message
            )
        except A2ATaskError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        return {"task": task.model_dump(by_alias=True, mode="json")}

    @app.post("/a2a/v1/message:stream")
    def message_stream(
        request: Request,
        payload: dict[str, object],
        a2a_version: str | None = Header(default=None, alias="A2A-Version"),
        content_type: str | None = Header(default=None, alias="Content-Type"),
        authorization: str | None = Header(default=None, alias="Authorization"),
    ) -> dict[str, object]:
        return message_send(request, payload, a2a_version, content_type, authorization)

    @app.get("/a2a/v1/tasks")
    def list_tasks(
        request: Request,
        authorization: str | None = Header(default=None, alias="Authorization"),
    ) -> dict[str, object]:
        _validate_service_auth(settings=settings, authorization=authorization)
        tasks = request.app.state.task_store.list_tasks()
        return {"tasks": [task.model_dump(by_alias=True, mode="json") for task in tasks]}

    @app.get("/a2a/v1/tasks/{task_id}")
    def get_task(
        request: Request,
        task_id: str,
        authorization: str | None = Header(default=None, alias="Authorization"),
    ) -> dict[str, object]:
        _validate_service_auth(settings=settings, authorization=authorization)
        try:
            task = request.app.state.task_store.get_task(task_id)
        except A2ATaskError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return {"task": task.model_dump(by_alias=True, mode="json")}

    @app.post("/a2a/v1/tasks/{task_id}:subscribe")
    def subscribe_task(
        request: Request,
        task_id: str,
        authorization: str | None = Header(default=None, alias="Authorization"),
    ) -> dict[str, object]:
        return get_task(request, task_id, authorization)

    @app.post("/a2a/v1/tasks/{task_id}:cancel")
    def cancel_task(
        request: Request,
        task_id: str,
        authorization: str | None = Header(default=None, alias="Authorization"),
    ) -> dict[str, object]:
        _validate_service_auth(settings=settings, authorization=authorization)
        try:
            task = request.app.state.task_store.cancel_task(task_id)
        except A2ATaskError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return {"task": task.model_dump(by_alias=True, mode="json")}

    return app


def _register_embedded_context(request: Request, send_request: A2ASendRequest) -> None:
    embedded_context = send_request.metadata.get("creatorNegotiationContext")
    if embedded_context is None:
        return
    if not isinstance(embedded_context, dict):
        raise HTTPException(status_code=400, detail="creatorNegotiationContext must be an object")
    try:
        context = CreatorNegotiationContext.model_validate(embedded_context)
        request.app.state.task_store.register_context(send_request.tenant, context)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


def _validate_a2a_headers(a2a_version: str | None, content_type: str | None) -> None:
    if a2a_version != A2A_VERSION:
        raise HTTPException(status_code=400, detail="A2A-Version 1.0 is required")
    if content_type and not content_type.startswith("application/a2a+json"):
        raise HTTPException(status_code=415, detail="Content-Type application/a2a+json is required")


def _validate_service_auth(*, settings: Settings, authorization: str | None) -> None:
    if settings.a2a_service_token is None:
        return
    expected = f"Bearer {settings.a2a_service_token}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="Creator A2A service authentication failed")


def _build_task_store(settings: Settings) -> InMemoryA2ATaskStore:
    # Memory (seeded) or Firestore: every creator in the repository is a tenant here.
    # Demo contexts stay as a fallback for tenants the repository does not know.
    repository = build_repository(settings)
    return InMemoryA2ATaskStore(
        demo_creator_contexts(),
        context_resolver=_firestore_context_resolver(repository),
        allowed_tenants=(
            set(settings.creator_agent_tenants) if settings.creator_agent_tenants else None
        ),
        rationale_provider=lambda context, payload, decision: creator_rationale(
            settings=settings,
            context=context,
            payload=payload,
            decision=decision,
        ),
    )


def _firestore_context_resolver(
    repository: KnotRepository,
) -> Callable[[str], CreatorNegotiationContext | None]:
    def resolve(tenant: str) -> CreatorNegotiationContext | None:
        creator = repository.get_creator_profile_by_agent_id(tenant)
        if creator is None or not creator.active:
            return None
        policy = repository.get_agent_policy(tenant)
        if policy is None or not policy.active:
            return None
        return CreatorNegotiationContext(
            creatorAgentId=tenant,
            policy=policy.creator,
            today=date.today(),
            currentMonthDeliverables=creator.active_deliverables_this_month,
        )

    return resolve


app = create_app()
