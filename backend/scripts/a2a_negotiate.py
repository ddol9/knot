#!/usr/bin/env python3
"""Brand Agent ↔ Creator Agent 협상을 터미널에서 관전한다.

두 프로세스가 실제 HTTP A2A로 대화하는 걸 확인하는 용도. 프론트/제품 API 불필요.

    # 1) 두 에이전트 띄우기 (backend/ 에서)
    KNOT_SERVICE_NAME=knot-creator-agent uvicorn apps.creator_agent.main:app --port 8081
    KNOT_SERVICE_NAME=knot-brand-agent   uvicorn apps.brand_agent.main:app   --port 8083

    # 2) 협상 실행
    python scripts/a2a_negotiate.py --open 500 --ceiling 700          # 500 → 650 수락
    python scripts/a2a_negotiate.py --open 400 --ceiling 600          # 못 맞추고 walk away
    python scripts/a2a_negotiate.py --category gambling               # 즉시 거절
    python scripts/a2a_negotiate.py --direct --open 500 --ceiling 700 # 브랜드 서버 없이

기본 크리에이터 = creator-agent-001 (크리에이터 에이전트에 등록된 정책: 최소 650 USDC).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx  # noqa: E402

from libs.a2a.client import CreatorA2AClient  # noqa: E402
from libs.agents.brand_negotiator import (  # noqa: E402
    BrandNegotiationResult,
    BrandNegotiationStrategy,
    BrandNegotiator,
    NegotiationTurn,
)
from libs.domain.models import CreatorPolicy, UsageRights  # noqa: E402

BRAND = "\033[94m"
CREATOR = "\033[92m"
DIM = "\033[90m"
BOLD = "\033[1m"
RED = "\033[91m"
RESET = "\033[0m"


def print_turn(turn: NegotiationTurn) -> None:
    color = BRAND if turn.role == "brand" else CREATOR
    who = "💼 Brand Agent" if turn.role == "brand" else "🎨 Creator Agent"
    print(f"\n{color}{BOLD}{who}{RESET}  {DIM}round {turn.round} · {turn.type.value}{RESET}")
    print(f"{color}   {turn.amount_usdc} USDC{RESET}")
    print(f"   {turn.message}")
    provider = turn.message_provider + (f" / {turn.message_model}" if turn.message_model else "")
    print(f"   {DIM}({provider}){RESET}")
    sys.stdout.flush()


def iter_sse(lines):  # type: ignore[no-untyped-def]
    """Yield (event, json) pairs from an SSE line stream."""
    event, data = None, []
    for line in lines:
        if line == "":
            if event and data:
                yield event, json.loads("".join(data))
            event, data = None, []
        elif line.startswith("event:"):
            event = line[6:].strip()
        elif line.startswith("data:"):
            data.append(line[5:].strip())


def print_result(result: BrandNegotiationResult) -> None:
    print(f"\n{BOLD}{'─' * 56}{RESET}")
    print(
        f"{BOLD}결과: {result.outcome}{RESET}  ({result.rounds} rounds, task {result.task_state})"
    )
    print(f"최종 금액: {result.final_amount_usdc} USDC")
    if result.agreement_id:
        print(f"agreementId: {result.agreement_id}")
        print(f"termsHash:   {result.terms_hash}")
    print(f"{BOLD}{'─' * 56}{RESET}\n")


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--creator", default="creator-agent-001")
    parser.add_argument("--open", type=int, default=500, help="브랜드 첫 제안 (USDC)")
    parser.add_argument("--ceiling", type=int, default=700, help="브랜드 비공개 상한 (USDC)")
    parser.add_argument("--concession", type=int, default=50, help="라운드마다 좁히는 갭 비율 %%")
    parser.add_argument("--category", default="beauty")
    parser.add_argument(
        "--creator-min",
        type=int,
        default=None,
        help="크리에이터 최소 금액 덮어쓰기 (embedded context로 전달)",
    )
    parser.add_argument("--brand-url", default="http://localhost:8083/brand/v1")
    parser.add_argument("--creator-url", default="http://localhost:8081/a2a/v1")
    parser.add_argument(
        "--direct",
        action="store_true",
        help="브랜드 서버 없이 이 프로세스가 브랜드 에이전트가 되어 크리에이터와 직접 통신",
    )
    parser.add_argument("--json", action="store_true", help="결과 JSON 출력")
    args = parser.parse_args()

    strategy = BrandNegotiationStrategy(
        openingAmountUsdc=args.open, ceilingUsdc=args.ceiling, concessionPct=args.concession
    )
    creator_policy = None
    if args.creator_min is not None:
        creator_policy = CreatorPolicy(
            minBaseUsdc=args.creator_min,
            blockedIndustries=["gambling", "cryptoTrading"],
            maxDeliverablesPerMonth=5,
            minDaysToPost=3,
            allowedUsageRights=[UsageRights.ORGANIC_ONLY, UsageRights.PAID_BOOST_30D],
        )

    brand_label = "(this process)" if args.direct else args.brand_url
    print(f"{BOLD}KNOT A2A 협상{RESET}  brand={brand_label}")
    print(f"{DIM}creator={args.creator_url} / {args.creator}{RESET}")
    print(
        f"{DIM}open {args.open} · ceiling {args.ceiling} (비공개) · "
        f"concession {args.concession}%{RESET}"
    )

    if args.direct:
        from datetime import date

        from apps.brand_agent.main import demo_promotion
        from libs.agents.negotiation import CreatorNegotiationContext

        client = CreatorA2AClient(args.creator_url, timeout_seconds=60)
        card = client.agent_card()
        print(f"{DIM}creator agent card: {card.get('name')}{RESET}")
        context = (
            CreatorNegotiationContext(
                creatorAgentId=args.creator, policy=creator_policy, today=date.today()
            )
            if creator_policy
            else None
        )
        result = BrandNegotiator(
            client,
            promotion=demo_promotion(category=args.category),
            creator_agent_id=args.creator,
            strategy=strategy,
            creator_context=context,
            on_turn=print_turn,
        ).run()
    else:
        params = {
            "creatorAgentId": args.creator,
            "category": args.category,
            "openingAmountUsdc": args.open,
            "ceilingUsdc": args.ceiling,
            "concessionPct": args.concession,
        }
        if args.creator_min is not None:
            params["creatorMinBaseUsdc"] = args.creator_min
        result = None
        try:
            with httpx.stream(
                "GET", f"{args.brand_url}/negotiations/stream", params=params, timeout=180
            ) as response:
                response.raise_for_status()
                for event, data in iter_sse(response.iter_lines()):
                    if event == "status":
                        card_name = (data.get("creatorAgentCard") or {}).get("name")
                        llm = data.get("llmMode")
                        print(f"{DIM}creator agent card: {card_name} · LLM {llm}{RESET}")
                    elif event == "turn":
                        print_turn(NegotiationTurn.model_validate(data))
                    elif event == "result":
                        result = BrandNegotiationResult.model_validate(data)
                    elif event == "error":
                        print(f"{RED}에러: {data.get('detail')}{RESET}")
                        return 1
        except httpx.HTTPError as exc:
            print(f"{RED}브랜드 에이전트 호출 실패: {exc}{RESET}")
            return 1
        if result is None:
            print(f"{RED}결과 이벤트를 받지 못했습니다{RESET}")
            return 1

    print_result(result)
    if args.json:
        dumped = result.model_dump(by_alias=True, mode="json")
        print(json.dumps(dumped, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
