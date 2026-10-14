#!/usr/bin/env python3
"""Vertex AI 다양한 협상 시나리오 테스트"""

from datetime import date

from libs.a2a.models import NegotiationMessageType, NegotiationPayload
from libs.agents.negotiation import CreatorNegotiationContext, evaluate_creator_message
from libs.ai.gemini import brand_message_display, creator_rationale
from libs.domain.models import AgreementTerms, CreatorPolicy, Promotion, UsageRights
from libs.settings.config import get_settings


def test_counter_scenario():
    """COUNTER: 금액이 최소치보다 낮아서 카운터 제안"""
    print("=" * 60)
    print("시나리오 1: COUNTER (금액 조정 요청)")
    print("=" * 60)

    settings = get_settings()
    context = CreatorNegotiationContext(
        creatorAgentId="test-creator",
        policy=CreatorPolicy(
            minBaseUsdc=650,
            maxDeliverablesPerMonth=5,
            blockedIndustries=[],
            minDaysToPost=3,
            allowedUsageRights=[UsageRights.PAID_BOOST_30D],
        ),
        today=date.today(),
    )

    promotion = Promotion.model_validate(
        {
            "promotionId": "promo-counter",
            "brandId": "brand-001",
            "brandAgentId": "test-brand",
            "title": "뷰티 제품 홍보",
            "objective": "awareness",
            "category": "beauty",
            "targetAudience": ["20-30s"],
            "budget": {"totalUsdc": 2000, "maxPerCreatorUsdc": 800},
            "deliverables": [{"format": "reel", "count": 1}],
            "postingWindow": {"start": "2026-08-15", "end": "2026-08-20"},
            "usageRights": "paidBoost30d",
        }
    )

    terms = AgreementTerms.model_validate(
        {
            "compensation": {"structure": "flat", "baseAmountUsdc": 500},
            "deliverables": [
                {
                    "format": "reel",
                    "count": 1,
                    "postWindow": {"start": "2026-08-15", "end": "2026-08-20"},
                }
            ],
            "usageRights": "paidBoost30d",
            "milestones": [
                {"id": "contract", "trigger": "contractSigned", "releasePct": 30},
                {"id": "content", "trigger": "contentLiveVerified", "releasePct": 70},
            ],
        }
    )

    payload = NegotiationPayload(
        schema="knot.negotiation.v1",
        type=NegotiationMessageType.OFFER,
        round=1,
        promotion=promotion,
        terms=terms,
        changedFields=[],
        rationale="Initial offer",
    )

    decision = evaluate_creator_message(context, payload)
    print(f"결정: {decision.type}")
    print(f"제안 금액: 500 USDC → 카운터 금액: {decision.terms.compensation.base_amount_usdc} USDC")
    print()

    analysis = creator_rationale(settings=settings, context=context, payload=payload, decision=decision)
    if analysis and analysis.provider == "vertex-gemini":
        print(f"✅ Creator Agent (Gemini): {analysis.text}")
    else:
        print(f"❌ Fallback: {decision.rationale}")
    print()


def test_accept_scenario():
    """ACCEPT: 조건이 모두 만족"""
    print("=" * 60)
    print("시나리오 2: ACCEPT (조건 만족)")
    print("=" * 60)

    settings = get_settings()
    context = CreatorNegotiationContext(
        creatorAgentId="test-creator",
        policy=CreatorPolicy(
            minBaseUsdc=650,
            maxDeliverablesPerMonth=5,
            blockedIndustries=[],
            minDaysToPost=3,
            allowedUsageRights=[UsageRights.PAID_BOOST_30D],
        ),
        today=date.today(),
    )

    promotion = Promotion.model_validate(
        {
            "promotionId": "promo-accept",
            "brandId": "brand-001",
            "brandAgentId": "test-brand",
            "title": "패션 브랜드 협찬",
            "objective": "conversion",
            "category": "fashion",
            "targetAudience": ["20-40s", "fashion"],
            "budget": {"totalUsdc": 3000, "maxPerCreatorUsdc": 1000},
            "deliverables": [{"format": "post", "count": 1}],
            "postingWindow": {"start": "2026-08-20", "end": "2026-08-25"},
            "usageRights": "paidBoost30d",
        }
    )

    terms = AgreementTerms.model_validate(
        {
            "compensation": {"structure": "flat", "baseAmountUsdc": 800},  # 최소치 이상
            "deliverables": [
                {
                    "format": "post",
                    "count": 1,
                    "postWindow": {"start": "2026-08-20", "end": "2026-08-25"},
                }
            ],
            "usageRights": "paidBoost30d",
            "milestones": [
                {"id": "contract", "trigger": "contractSigned", "releasePct": 30},
                {"id": "content", "trigger": "contentLiveVerified", "releasePct": 70},
            ],
        }
    )

    payload = NegotiationPayload(
        schema="knot.negotiation.v1",
        type=NegotiationMessageType.OFFER,
        round=1,
        promotion=promotion,
        terms=terms,
        changedFields=[],
        rationale="Good offer from brand",
    )

    decision = evaluate_creator_message(context, payload)
    print(f"결정: {decision.type}")
    print(f"제안 금액: 800 USDC (최소 요구: 650 USDC)")
    print()

    analysis = creator_rationale(settings=settings, context=context, payload=payload, decision=decision)
    if analysis and analysis.provider == "vertex-gemini":
        print(f"✅ Creator Agent (Gemini): {analysis.text}")
    else:
        print(f"❌ Fallback: {decision.rationale}")
    print()


def test_brand_message():
    """Brand Agent 메시지 생성 테스트"""
    print("=" * 60)
    print("시나리오 3: Brand Agent 최초 OFFER 메시지")
    print("=" * 60)

    settings = get_settings()

    promotion = Promotion.model_validate(
        {
            "promotionId": "promo-brand",
            "brandId": "brand-001",
            "brandAgentId": "test-brand",
            "title": "여름 신제품 출시 캠페인",
            "objective": "awareness",
            "category": "beauty",
            "targetAudience": ["20s", "beauty"],
            "budget": {"totalUsdc": 5000, "maxPerCreatorUsdc": 1500},
            "deliverables": [{"format": "reel", "count": 1}],
            "postingWindow": {"start": "2026-09-01", "end": "2026-09-07"},
            "usageRights": "paidBoost30d",
        }
    )

    terms = AgreementTerms.model_validate(
        {
            "compensation": {"structure": "flat", "baseAmountUsdc": 750},
            "deliverables": [
                {
                    "format": "reel",
                    "count": 1,
                    "postWindow": {"start": "2026-09-01", "end": "2026-09-07"},
                }
            ],
            "usageRights": "paidBoost30d",
            "milestones": [
                {"id": "contract", "trigger": "contractSigned", "releasePct": 30},
                {"id": "content", "trigger": "contentLiveVerified", "releasePct": 70},
            ],
        }
    )

    print(f"프로모션: {promotion.title}")
    print(f"제안 금액: 750 USDC")
    print()

    analysis = brand_message_display(
        settings=settings,
        message_type=NegotiationMessageType.OFFER,
        terms=terms,
        promotion=promotion,
        fallback_message="750 USDC로 릴 1건 제안드립니다.",
        fallback_rationale="Initial offer within budget",
    )

    if analysis.provider == "vertex-gemini":
        print(f"✅ Brand Agent (Gemini): {analysis.text}")
    else:
        print(f"❌ Fallback: {analysis.text}")
    print()


def main():
    print("\n🚀 Vertex AI 협상 시나리오 테스트 시작\n")
    test_counter_scenario()
    test_accept_scenario()
    test_brand_message()
    print("✅ 모든 시나리오 테스트 완료!")


if __name__ == "__main__":
    main()
