"""KNOT Brand Agent service.

A standalone process that negotiates with the Creator Agent (apps/creator_agent)
over real HTTP A2A. POST /brand/v1/negotiations runs the whole tiki-taka and returns
the transcript, so two agent processes can be observed talking to each other
without the product API or the frontend in the loop.
"""

from __future__ import annotations

import json
import queue
import threading
from collections.abc import Callable, Iterator
from datetime import date, timedelta
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from apps.api.repository_factory import build_repository
from libs.a2a.agent_card import build_brand_agent_card
from libs.a2a.client import CreatorA2AClient, CreatorA2AClientError
from libs.a2a.models import NegotiationMessageType
from libs.agents.brand_campaign import (
    CampaignEvent,
    CampaignResult,
    CampaignRunner,
    CampaignStrategy,
    http_transport_factory,
)
from libs.agents.brand_negotiator import (
    BrandDisplayText,
    BrandNegotiationResult,
    BrandNegotiationStrategy,
    BrandNegotiator,
    NegotiationTurn,
)
from libs.agents.negotiation import CreatorNegotiationContext
from libs.ai.gemini import brand_message_display
from libs.domain.models import AgreementTerms, CreatorPolicy, Promotion, UsageRights
from libs.observability.middleware import add_request_context
from libs.repositories.store import KnotRepository
from libs.settings.config import Settings, get_settings


class NegotiationRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    creator_agent_id: str = Field(default="creator-agent-001", alias="creatorAgentId")
    strategy: BrandNegotiationStrategy
    # Either a full promotion or a quick demo one built from category/budget.
    promotion: Promotion | None = None
    category: str = "beauty"
    title: str | None = None
    max_per_creator_usdc: int | None = Field(default=None, alias="maxPerCreatorUsdc", ge=0)
    # Demo override: push a creator policy into the creator agent as embedded context.
    # Leave empty so the creator agent uses its own registered policy.
    creator_policy: CreatorPolicy | None = Field(default=None, alias="creatorPolicy")
    creator_max_rounds: int = Field(default=5, alias="creatorMaxRounds", ge=1)


class NegotiationResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    result: BrandNegotiationResult
    creator_agent_url: str = Field(alias="creatorAgentUrl")
    creator_agent_card: dict[str, object] | None = Field(default=None, alias="creatorAgentCard")


class CampaignRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    strategy: CampaignStrategy
    promotion: Promotion | None = None
    category: str = "beauty"
    title: str | None = None
    max_per_creator_usdc: int = Field(default=700, alias="maxPerCreatorUsdc", ge=0)
    total_usdc: int = Field(default=1400, alias="totalUsdc", ge=0)


class CampaignResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    result: CampaignResult


def demo_promotion(
    *,
    category: str = "beauty",
    title: str | None = None,
    max_per_creator_usdc: int = 1000,
    total_usdc: int | None = None,
    today: date | None = None,
) -> Promotion:
    today = today or date.today()
    start = today + timedelta(days=14)
    return Promotion.model_validate(
        {
            "promotionId": f"promo-{category}-demo",
            "brandId": "brand-demo",
            "brandAgentId": "brand-agent-demo",
            "title": title or f"{category.capitalize()} 제품 홍보",
            "objective": "awareness",
            "category": category,
            "targetAudience": ["20-30s"],
            "budget": {
                "totalUsdc": total_usdc or max_per_creator_usdc * 2,
                "maxPerCreatorUsdc": max_per_creator_usdc,
            },
            "deliverables": [{"format": "reel", "count": 1}],
            "postingWindow": {
                "start": start.isoformat(),
                "end": (start + timedelta(days=7)).isoformat(),
            },
            "usageRights": "paidBoost30d",
            "autonomy": {"maxNegotiationRounds": 5},
        }
    )


def create_app(
    settings: Settings | None = None, repository: KnotRepository | None = None
) -> FastAPI:
    settings = settings or get_settings(service_name="knot-brand-agent")
    repository = repository or build_repository(settings)
    app = FastAPI(title="KNOT Brand Agent", version=settings.schema_version)
    app.state.repository = repository
    # The watch page may be opened from file:// or the Next dev server.
    app.add_middleware(
        CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
    )
    add_request_context(app, service_name=settings.service_name)

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

    @app.get("/brand/v1/.well-known/agent-card.json")
    def agent_card() -> dict[str, object]:
        return build_brand_agent_card(base_url=settings.brand_agent_base_url)

    @app.post("/brand/v1/negotiations", response_model=NegotiationResponse)
    def negotiate(request: NegotiationRequest) -> NegotiationResponse:
        card, negotiator = _prepare(settings, request)
        try:
            result = negotiator.run()
        except CreatorA2AClientError as exc:
            raise HTTPException(status_code=502, detail=f"Creator A2A failed: {exc}") from exc
        return NegotiationResponse(
            result=result,
            creatorAgentUrl=settings.creator_agent_base_url,
            creatorAgentCard=card,
        )

    @app.get("/brand/v1/negotiations/stream")
    def negotiate_stream(
        creator_agent_id: str = Query(default="creator-agent-001", alias="creatorAgentId"),
        opening_amount_usdc: int = Query(default=500, alias="openingAmountUsdc", ge=0),
        ceiling_usdc: int = Query(default=700, alias="ceilingUsdc", ge=0),
        concession_pct: int = Query(default=50, alias="concessionPct", ge=1, le=100),
        max_rounds: int | None = Query(default=None, alias="maxRounds", ge=1, le=5),
        category: str = "beauty",
        max_per_creator_usdc: int | None = Query(default=None, alias="maxPerCreatorUsdc", ge=0),
        creator_min_base_usdc: int | None = Query(default=None, alias="creatorMinBaseUsdc", ge=0),
    ) -> StreamingResponse:
        """Server-Sent Events: one `turn` event per message, then `result` (or `error`)."""
        creator_policy = None
        if creator_min_base_usdc is not None:
            creator_policy = CreatorPolicy(
                minBaseUsdc=creator_min_base_usdc,
                blockedIndustries=["gambling", "cryptoTrading"],
                maxDeliverablesPerMonth=5,
                minDaysToPost=3,
                allowedUsageRights=[UsageRights.ORGANIC_ONLY, UsageRights.PAID_BOOST_30D],
            )
        request = NegotiationRequest(
            creatorAgentId=creator_agent_id,
            strategy=BrandNegotiationStrategy(
                openingAmountUsdc=opening_amount_usdc,
                ceilingUsdc=ceiling_usdc,
                concessionPct=concession_pct,
                maxRounds=max_rounds,
            ),
            category=category,
            maxPerCreatorUsdc=max_per_creator_usdc,
            creatorPolicy=creator_policy,
        )
        return StreamingResponse(
            _stream_negotiation(settings, request),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @app.post("/brand/v1/campaigns", response_model=CampaignResponse)
    def campaign(request: CampaignRequest) -> CampaignResponse:
        """Discover matching creator agents and negotiate with several of them at once."""
        runner = _campaign_runner(settings, repository, request)
        return CampaignResponse(result=runner.run())

    @app.get("/brand/v1/campaigns/stream")
    def campaign_stream(
        category: str = "beauty",
        title: str | None = None,
        max_per_creator_usdc: int = Query(default=700, alias="maxPerCreatorUsdc", ge=0),
        total_usdc: int = Query(default=1400, alias="totalUsdc", ge=0),
        target_creator_count: int = Query(default=2, alias="targetCreatorCount", ge=1),
        max_candidates: int = Query(default=5, alias="maxCandidates", ge=1, le=20),
        parallelism: int = Query(default=3, ge=1, le=10),
        opening_amount_usdc: int = Query(default=400, alias="openingAmountUsdc", ge=0),
        ceiling_usdc: int = Query(default=700, alias="ceilingUsdc", ge=0),
        concession_pct: int = Query(default=50, alias="concessionPct", ge=1, le=100),
        max_rounds: int | None = Query(default=None, alias="maxRounds", ge=1, le=5),
    ) -> StreamingResponse:
        """SSE: discovery, per-candidate negotiation events, then campaign_result."""
        request = CampaignRequest(
            strategy=CampaignStrategy(
                targetCreatorCount=target_creator_count,
                maxCandidates=max_candidates,
                parallelism=parallelism,
                openingAmountUsdc=opening_amount_usdc,
                ceilingUsdc=ceiling_usdc,
                concessionPct=concession_pct,
                maxRounds=max_rounds,
            ),
            category=category,
            title=title,
            maxPerCreatorUsdc=max_per_creator_usdc,
            totalUsdc=total_usdc,
        )
        return StreamingResponse(
            _stream_campaign(settings, repository, request),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @app.get("/brand/v1/campaign")
    def campaign_page() -> FileResponse:
        return FileResponse(_STATIC_DIR / "campaign.html", media_type="text/html")

    @app.get("/brand/v1/watch")
    def watch_page() -> FileResponse:
        return FileResponse(_STATIC_DIR / "watch.html", media_type="text/html")

    return app


_STATIC_DIR = Path(__file__).resolve().parent / "static"


def _prepare(
    settings: Settings,
    request: NegotiationRequest,
    on_turn: Callable[[NegotiationTurn], None] | None = None,
) -> tuple[dict[str, object], BrandNegotiator]:
    client = CreatorA2AClient(
        settings.creator_agent_base_url,
        timeout_seconds=settings.creator_a2a_timeout_seconds,
        service_token=settings.a2a_service_token,
    )
    try:
        card = client.agent_card()
    except CreatorA2AClientError as exc:
        raise HTTPException(
            status_code=502, detail=f"Creator agent card discovery failed: {exc}"
        ) from exc

    promotion = request.promotion or demo_promotion(
        category=request.category,
        title=request.title,
        max_per_creator_usdc=request.max_per_creator_usdc or 1000,
    )
    creator_context = None
    if request.creator_policy is not None:
        creator_context = CreatorNegotiationContext(
            creatorAgentId=request.creator_agent_id,
            policy=request.creator_policy,
            today=date.today(),
            maxRounds=request.creator_max_rounds,
        )
    negotiator = BrandNegotiator(
        client,
        promotion=promotion,
        creator_agent_id=request.creator_agent_id,
        strategy=request.strategy,
        creator_context=creator_context,
        display_provider=_display_provider(settings, promotion),
        on_turn=on_turn,
    )
    return card, negotiator


def _sse(event: str, data: object) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _stream_negotiation(settings: Settings, request: NegotiationRequest) -> Iterator[str]:
    events: queue.Queue[tuple[str, object]] = queue.Queue()

    def on_turn(turn: NegotiationTurn) -> None:
        events.put(("turn", turn.model_dump(by_alias=True, mode="json")))

    try:
        card, negotiator = _prepare(settings, request, on_turn)
    except HTTPException as exc:
        yield _sse("error", {"detail": exc.detail})
        return

    yield _sse(
        "status",
        {
            "brandAgentId": negotiator.promotion.brand_agent_id,
            "creatorAgentId": request.creator_agent_id,
            "creatorAgentUrl": settings.creator_agent_base_url,
            "creatorAgentCard": card,
            "strategy": request.strategy.model_dump(by_alias=True),
            "llmMode": settings.gemini_mode,
        },
    )

    def worker() -> None:
        try:
            result = negotiator.run()
            events.put(("result", result.model_dump(by_alias=True, mode="json")))
        except Exception as exc:  # surfaced to the client as an SSE error event
            events.put(("error", {"detail": str(exc)}))
        finally:
            events.put(("done", None))

    threading.Thread(target=worker, daemon=True).start()
    while True:
        event, data = events.get()
        if event == "done":
            return
        yield _sse(event, data)


def _campaign_runner(
    settings: Settings,
    repository: KnotRepository,
    request: CampaignRequest,
    on_event: Callable[[CampaignEvent], None] | None = None,
) -> CampaignRunner:
    promotion = request.promotion or demo_promotion(
        category=request.category,
        title=request.title,
        max_per_creator_usdc=request.max_per_creator_usdc,
        total_usdc=request.total_usdc,
    )
    return CampaignRunner(
        repository=repository,
        promotion=promotion,
        strategy=request.strategy,
        transport_factory=http_transport_factory(
            timeout_seconds=settings.creator_a2a_timeout_seconds,
            service_token=settings.a2a_service_token,
        ),
        default_base_url=settings.creator_agent_base_url,
        endpoint_overrides=settings.creator_agent_endpoints,
        display_provider=_display_provider(settings, promotion),
        on_event=on_event,
    )


def _stream_campaign(
    settings: Settings, repository: KnotRepository, request: CampaignRequest
) -> Iterator[str]:
    events: queue.Queue[tuple[str, object]] = queue.Queue()

    def on_event(event: CampaignEvent) -> None:
        events.put((event.event, {"creatorAgentId": event.creator_agent_id, **event.data}))

    runner = _campaign_runner(settings, repository, request, on_event)
    yield _sse("status", {"campaignId": runner.campaign_id, "llmMode": settings.gemini_mode})

    def worker() -> None:
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
        yield _sse(event, data)


def _display_provider(settings: Settings, promotion: Promotion):  # type: ignore[no-untyped-def]
    if settings.gemini_mode != "vertex":
        return None

    def provide(
        message_type: NegotiationMessageType, terms: AgreementTerms, fallback: str
    ) -> BrandDisplayText:
        generated = brand_message_display(
            settings=settings,
            message_type=message_type,
            terms=terms,
            promotion=promotion,
            fallback_message=fallback,
            fallback_rationale=fallback,
        )
        return BrandDisplayText(
            text=generated.text, provider=generated.provider, model=generated.model
        )

    return provide


app = create_app()
