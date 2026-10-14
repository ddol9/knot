"""
데모/시연용 엔드포인트 (인증 불필요)
SKT 면접 등에서 빠른 시연용
"""

from datetime import date

from fastapi import APIRouter
from pydantic import BaseModel, Field

from libs.a2a.models import NegotiationMessageType, NegotiationPayload
from libs.agents.negotiation import (
    CreatorNegotiationContext,
    CreatorNegotiationDecision,
    evaluate_creator_message,
)
from libs.ai.gemini import creator_rationale
from libs.domain.models import (
    AgreementTerms,
    CreatorPolicy,
    Promotion,
    UsageRights,
)
from libs.settings.config import Settings

router = APIRouter(prefix="/api/v1/demo", tags=["Demo"])


class NegotiateRequest(BaseModel):
    amount: int = Field(..., ge=0, le=10000, description="제안 금액 (USDC)")
    category: str = Field(default="beauty", description="카테고리")
    creator_min_base: int = Field(default=650, alias="creatorMinBase", description="Creator 최소 금액")


class NegotiateResponse(BaseModel):
    brand_offer: dict = Field(alias="brandOffer")
    creator_response: dict = Field(alias="creatorResponse")
    policy_decision: dict = Field(alias="policyDecision")
    llm_info: dict = Field(alias="llmInfo")


def build_demo_router(settings: Settings) -> APIRouter:
    """데모 라우터 생성"""

    @router.post("/negotiate", response_model=NegotiateResponse)
    async def demo_negotiate(request: NegotiateRequest):
        """
        빠른 협상 시연 (인증 불필요)

        Brand가 제안하면 Creator Agent가 평가해서 응답
        """
        # Creator 정책 설정
        context = CreatorNegotiationContext(
            creatorAgentId="demo-creator",
            policy=CreatorPolicy(
                minBaseUsdc=request.creator_min_base,
                maxDeliverablesPerMonth=5,
                blockedIndustries=["gambling"],
                minDaysToPost=3,
                allowedUsageRights=[
                    UsageRights.ORGANIC_ONLY,
                    UsageRights.PAID_BOOST_30D,
                ],
            ),
            today=date.today(),
        )

        # Brand 제안 생성
        promotion = Promotion.model_validate({
            "promotionId": "demo-001",
            "brandId": "brand-demo",
            "brandAgentId": "brand-demo",
            "title": f"{request.category.capitalize()} 제품 홍보",
            "objective": "awareness",
            "category": request.category,
            "targetAudience": ["20-30s"],
            "budget": {"totalUsdc": 2000, "maxPerCreatorUsdc": 1000},
            "deliverables": [{"format": "reel", "count": 1}],
            "postingWindow": {"start": "2026-10-20", "end": "2026-10-25"},
            "usageRights": "paidBoost30d",
        })

        terms = AgreementTerms.model_validate({
            "compensation": {"structure": "flat", "baseAmountUsdc": request.amount},
            "deliverables": [{
                "format": "reel",
                "count": 1,
                "postWindow": {"start": "2026-10-20", "end": "2026-10-25"},
            }],
            "usageRights": "paidBoost30d",
            "milestones": [
                {"id": "contract", "trigger": "contractSigned", "releasePct": 30},
                {"id": "content", "trigger": "contentLiveVerified", "releasePct": 70},
            ],
        })

        # Creator Agent 평가
        payload = NegotiationPayload(
            schema="knot.negotiation.v1",
            type=NegotiationMessageType.OFFER,
            round=1,
            promotion=promotion,
            terms=terms,
            changedFields=[],
            rationale="Demo offer from brand",
        )

        decision = evaluate_creator_message(context, payload)

        # Vertex AI로 응답 생성
        llm_rationale = None
        llm_provider = "deterministic"
        llm_model = None
        llm_confidence = 0.0

        if settings.gemini_mode == "vertex":
            analysis = creator_rationale(
                settings=settings,
                context=context,
                payload=payload,
                decision=decision,
            )
            if analysis:
                llm_rationale = analysis.text
                llm_provider = analysis.provider
                llm_model = analysis.model
                # Confidence는 실제로는 LLM에서 반환해야 하지만 여기서는 시뮬레이션
                llm_confidence = 0.85 if analysis.provider == "vertex-gemini" else 0.0

        # 응답 구성
        return NegotiateResponse(
            brandOffer={
                "amount": request.amount,
                "category": request.category,
                "title": promotion.title,
                "deliverable": "릴스 1건",
                "usageRights": "30일 유료 부스팅",
            },
            creatorResponse={
                "decision": decision.type.value,
                "rationale": llm_rationale or decision.rationale,
                "counterAmount": (
                    decision.terms.compensation.base_amount_usdc if decision.terms else None
                ),
            },
            policyDecision={
                "allowed": decision.policy_decision.allowed,
                "violations": [
                    {"code": v.code, "field": v.field}
                    for v in decision.policy_decision.violations
                ],
            },
            llmInfo={
                "provider": llm_provider,
                "model": llm_model,
                "confidence": llm_confidence,
                "mode": settings.gemini_mode,
            },
        )

    return router
