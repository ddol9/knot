#!/usr/bin/env python3
"""
터미널 기반 협상 시뮬레이터
Brand ↔ Creator Agent 협상을 실시간으로 시각화
"""

import sys
from datetime import date
from typing import Literal

from libs.a2a.models import NegotiationMessageType, NegotiationPayload
from libs.agents.negotiation import (
    CreatorNegotiationContext,
    evaluate_creator_message,
)
from libs.ai.gemini import creator_rationale
from libs.domain.models import (
    AgreementTerms,
    CreatorPolicy,
    Promotion,
    UsageRights,
)
from libs.settings.config import get_settings

# ANSI 색상 코드
class Colors:
    BRAND = "\033[94m"      # 파란색
    CREATOR = "\033[92m"    # 초록색
    SYSTEM = "\033[93m"     # 노란색
    ERROR = "\033[91m"      # 빨간색
    BOLD = "\033[1m"
    RESET = "\033[0m"

def print_header():
    print(f"\n{Colors.BOLD}{'='*60}{Colors.RESET}")
    print(f"{Colors.BOLD}🤖 KNOT AI Agent 협상 시뮬레이터{Colors.RESET}")
    print(f"{Colors.SYSTEM}Vertex AI Gemini + CoT 프롬프트{Colors.RESET}")
    print(f"{Colors.BOLD}{'='*60}{Colors.RESET}\n")

def print_brand_offer(promotion: Promotion, terms: AgreementTerms):
    print(f"\n{Colors.BRAND}{Colors.BOLD}💼 Brand Agent{Colors.RESET}")
    print(f"{Colors.BRAND}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━{Colors.RESET}")
    print(f"프로모션: {promotion.title}")
    print(f"카테고리: {promotion.category}")
    print(f"제안 금액: {terms.compensation.base_amount_usdc} USDC")
    print(f"콘텐츠: {terms.deliverables[0].format} {terms.deliverables[0].count}건")
    print(f"사용 권한: {terms.usage_rights.value}")

def print_creator_response(
    decision_type: NegotiationMessageType,
    rationale: str,
    counter_amount: int | None = None,
    confidence: float | None = None,
    thinking: dict | None = None,
):
    print(f"\n{Colors.CREATOR}{Colors.BOLD}🎨 Creator Agent{Colors.RESET}")
    print(f"{Colors.CREATOR}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━{Colors.RESET}")
    print(f"결정: {decision_type.value}")

    if thinking:
        print(f"\n{Colors.SYSTEM}[내부 추론 과정]{Colors.RESET}")
        print(f"  분석: {thinking.get('analysis', 'N/A')}")
        print(f"  위반: {thinking.get('violations', 'N/A')}")
        print(f"  톤: {thinking.get('tone', 'N/A')}")

    if confidence is not None:
        conf_color = Colors.CREATOR if confidence >= 0.7 else Colors.ERROR
        print(f"\n신뢰도: {conf_color}{confidence:.1%}{Colors.RESET}")

    if counter_amount:
        print(f"수정 제안 금액: {counter_amount} USDC")

    print(f"\n응답: {rationale}")

def print_policy_violations(violations: list):
    if violations:
        print(f"\n{Colors.ERROR}⚠️  정책 위반 사항:{Colors.RESET}")
        for v in violations:
            print(f"  - {v.code}: {v.field}")

def run_simulation(
    role: Literal["brand", "creator"],
    amount: int,
    category: str = "beauty",
):
    """협상 시뮬레이션 실행"""
    settings = get_settings()

    print_header()
    print(f"{Colors.SYSTEM}설정: Gemini Mode = {settings.gemini_mode}{Colors.RESET}")
    print(f"{Colors.SYSTEM}모델: {settings.gemini_model}{Colors.RESET}\n")

    # Creator 정책 설정
    context = CreatorNegotiationContext(
        creatorAgentId="creator-demo",
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

    # Brand 제안 생성
    promotion = Promotion.model_validate({
        "promotionId": "demo-001",
        "brandId": "brand-001",
        "brandAgentId": "brand-demo",
        "title": f"{category.capitalize()} 제품 홍보",
        "objective": "awareness",
        "category": category,
        "targetAudience": ["20-30s"],
        "budget": {"totalUsdc": 2000, "maxPerCreatorUsdc": 1000},
        "deliverables": [{"format": "reel", "count": 1}],
        "postingWindow": {"start": "2026-10-20", "end": "2026-10-25"},
        "usageRights": "paidBoost30d",
    })

    terms = AgreementTerms.model_validate({
        "compensation": {"structure": "flat", "baseAmountUsdc": amount},
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

    # Brand 제안 표시
    print_brand_offer(promotion, terms)

    # Creator Agent 평가
    payload = NegotiationPayload(
        schema="knot.negotiation.v1",
        type=NegotiationMessageType.OFFER,
        round=1,
        promotion=promotion,
        terms=terms,
        changedFields=[],
        rationale="Initial offer from brand",
    )

    print(f"\n{Colors.SYSTEM}⏳ Creator Agent가 평가 중...{Colors.RESET}")
    decision = evaluate_creator_message(context, payload)

    # 정책 위반 표시
    if decision.policy_decision.violations:
        print_policy_violations(decision.policy_decision.violations)

    # Vertex AI로 응답 생성
    if settings.gemini_mode == "vertex":
        print(f"{Colors.SYSTEM}⏳ Vertex AI로 응답 생성 중 (CoT)...{Colors.RESET}")
        analysis = creator_rationale(
            settings=settings,
            context=context,
            payload=payload,
            decision=decision,
        )

        if analysis and analysis.provider == "vertex-gemini":
            # Thinking 정보 추출 (실제로는 _generate_json에서 반환된 데이터 필요)
            # 여기서는 시뮬레이션
            thinking = {
                "analysis": f"{amount} USDC vs 최소 {context.policy.min_base_usdc} USDC",
                "violations": str([v.code for v in decision.policy_decision.violations]),
                "tone": decision.type.value,
            }

            print_creator_response(
                decision_type=decision.type,
                rationale=analysis.text,
                counter_amount=decision.terms.compensation.base_amount_usdc if decision.terms else None,
                confidence=0.85,  # 실제로는 LLM에서 반환
                thinking=thinking,
            )
        else:
            print(f"\n{Colors.ERROR}Vertex AI 응답 실패, deterministic 응답 사용{Colors.RESET}")
            print_creator_response(
                decision_type=decision.type,
                rationale=decision.rationale,
                counter_amount=decision.terms.compensation.base_amount_usdc if decision.terms else None,
            )
    else:
        print(f"\n{Colors.ERROR}Gemini mode=off, deterministic 응답만 사용{Colors.RESET}")
        print_creator_response(
            decision_type=decision.type,
            rationale=decision.rationale,
            counter_amount=decision.terms.compensation.base_amount_usdc if decision.terms else None,
        )

    print(f"\n{Colors.BOLD}{'='*60}{Colors.RESET}\n")

def interactive_mode():
    """대화형 모드"""
    print_header()
    print("대화형 모드로 시작합니다.")
    print("Ctrl+C로 종료\n")

    while True:
        try:
            print(f"\n{Colors.SYSTEM}제안 금액 (USDC):{Colors.RESET} ", end="")
            amount_str = input().strip()
            if not amount_str:
                continue

            amount = int(amount_str)

            print(f"{Colors.SYSTEM}카테고리 (beauty/fashion/food):{Colors.RESET} ", end="")
            category = input().strip() or "beauty"

            run_simulation(role="brand", amount=amount, category=category)

        except KeyboardInterrupt:
            print(f"\n\n{Colors.SYSTEM}종료합니다.{Colors.RESET}\n")
            break
        except ValueError:
            print(f"{Colors.ERROR}올바른 숫자를 입력하세요{Colors.RESET}")

def main():
    if len(sys.argv) > 1 and sys.argv[1] == "interactive":
        interactive_mode()
    elif len(sys.argv) >= 3:
        # CLI 모드: python negotiate_cli.py brand 500
        role = sys.argv[1]
        amount = int(sys.argv[2])
        category = sys.argv[3] if len(sys.argv) > 3 else "beauty"
        run_simulation(role, amount, category)
    else:
        print("사용법:")
        print("  python negotiate_cli.py interactive        # 대화형 모드")
        print("  python negotiate_cli.py brand 500          # 500 USDC 제안")
        print("  python negotiate_cli.py brand 700 fashion  # 700 USDC, fashion 카테고리")

if __name__ == "__main__":
    main()
