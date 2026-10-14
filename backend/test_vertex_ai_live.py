#!/usr/bin/env python3
"""Vertex AI / Gemini 실제 호출 테스트"""

from datetime import date

from libs.a2a.models import NegotiationMessageType, NegotiationPayload
from libs.agents.negotiation import CreatorNegotiationContext, evaluate_creator_message
from libs.ai.gemini import creator_rationale
from libs.domain.models import AgreementTerms, CreatorPolicy, Promotion, UsageRights
from libs.settings.config import get_settings


def main():
    settings = get_settings()
    print(f"KNOT_GEMINI_MODE: {settings.gemini_mode}")
    print(f"GOOGLE_CLOUD_PROJECT: {settings.firestore_project_id}")
    print(f"GEMINI_MODEL: {settings.gemini_model}")
    print()

    # Creator 컨텍스트 생성
    context = CreatorNegotiationContext(
        creatorAgentId="test-creator",
        policy=CreatorPolicy(
            minBaseUsdc=650,
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

    # Brand offer 생성 (낮은 금액 - 테스트용)
    promotion_data = {
        "promotionId": "test-promo-001",
        "brandId": "brand-001",
        "brandAgentId": "test-brand",
        "title": "뷰티 제품 홍보",
        "objective": "awareness",
        "category": "beauty",
        "targetAudience": ["20-30s", "skincare"],
        "budget": {"totalUsdc": 2000, "maxPerCreatorUsdc": 800},
        "deliverables": [{"format": "reel", "count": 1}],
        "postingWindow": {"start": "2026-08-15", "end": "2026-08-20"},
        "usageRights": "paidBoost30d",
    }
    promotion = Promotion.model_validate(promotion_data)

    terms_data = {
        "compensation": {
            "structure": "flat",
            "baseAmountUsdc": 500,  # 최소 650보다 낮음 -> COUNTER 예상
            "performancePct": 0,
        },
        "deliverables": [
            {
                "format": "reel",
                "count": 1,
                "postWindow": {"start": "2026-08-15", "end": "2026-08-20"},
                "revisionRounds": 1,
            }
        ],
        "usageRights": "paidBoost30d",
        "milestones": [
            {"id": "contract", "trigger": "contractSigned", "releasePct": 30},
            {"id": "content", "trigger": "contentLiveVerified", "releasePct": 70},
        ],
    }
    terms = AgreementTerms.model_validate(terms_data)

    payload = NegotiationPayload(
        schema="knot.negotiation.v1",
        type=NegotiationMessageType.OFFER,
        round=1,
        promotion=promotion,
        terms=terms,
        changedFields=[],
        rationale="Initial offer from brand",
    )

    # Creator decision (deterministic)
    decision = evaluate_creator_message(context, payload)
    print(f"Decision type: {decision.type}")
    print(f"Deterministic rationale: {decision.rationale}")
    print()

    # Vertex AI 호출
    print("Calling Vertex AI for creator rationale...")
    analysis = creator_rationale(
        settings=settings,
        context=context,
        payload=payload,
        decision=decision,
    )

    if analysis:
        print(f"Provider: {analysis.provider}")
        print(f"Model: {analysis.model}")
        print(f"Fallback reason: {analysis.fallback_reason}")
        print(f"Generated rationale (Korean):")
        print(f"  {analysis.text}")
        print()

        if analysis.provider == "vertex-gemini":
            print("✅ Vertex AI 호출 성공!")
        else:
            print(f"⚠️  Fallback 사용됨: {analysis.fallback_reason}")
    else:
        print("❌ No rationale returned")


if __name__ == "__main__":
    main()
