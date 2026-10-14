#!/usr/bin/env python3
"""브랜드 에이전트 캠페인(탐색 → 다중 A2A 협상)을 터미널에서 관전한다.

# 크리에이터 에이전트 2개 (테넌트 분할) + 브랜드 에이전트
# 크리에이터 A (:8091): KNOT_CREATOR_AGENT_TENANTS=agent-creator-1,creator-agent-001,...
# 크리에이터 B (:8092): KNOT_CREATOR_AGENT_TENANTS=creator-agent-003,creator-agent-005
# 브랜드   (:8083): CREATOR_AGENT_BASE_URL=http://127.0.0.1:8091/a2a/v1
#                  KNOT_CREATOR_AGENT_ENDPOINTS=creator-agent-003=http://127.0.0.1:8092/a2a/v1,...
# 전체 커맨드는 scripts/local/a2a_multi_agent.sh 참고.

python scripts/a2a_campaign.py --category beauty --total 1300 --target 2
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx  # noqa: E402

BRAND = "\033[94m"
CREATOR = "\033[92m"
DIM = "\033[90m"
BOLD = "\033[1m"
RED = "\033[91m"
YEL = "\033[93m"
RESET = "\033[0m"


def iter_sse(lines):  # type: ignore[no-untyped-def]
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


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--category", default="beauty")
    parser.add_argument("--total", type=int, default=1300, help="총예산 USDC")
    parser.add_argument("--max-per-creator", type=int, default=700)
    parser.add_argument("--target", type=int, default=2, help="목표 합의 인원")
    parser.add_argument("--candidates", type=int, default=5, help="탐색 상위 후보 수")
    parser.add_argument("--open", type=int, default=400)
    parser.add_argument("--ceiling", type=int, default=700, help="크리에이터당 비공개 상한")
    parser.add_argument("--concession", type=int, default=50)
    parser.add_argument("--parallelism", type=int, default=3)
    parser.add_argument("--brand-url", default="http://127.0.0.1:8083/brand/v1")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    params = {
        "category": args.category,
        "totalUsdc": args.total,
        "maxPerCreatorUsdc": args.max_per_creator,
        "targetCreatorCount": args.target,
        "maxCandidates": args.candidates,
        "openingAmountUsdc": args.open,
        "ceilingUsdc": args.ceiling,
        "concessionPct": args.concession,
        "parallelism": args.parallelism,
    }
    print(f"{BOLD}KNOT 캠페인{RESET}  brand={args.brand_url}")
    print(
        f"{DIM}{args.category} · 총예산 {args.total} · 1인 상한 {args.max_per_creator} · "
        f"목표 {args.target}명 · open {args.open} · ceiling {args.ceiling} (비공개){RESET}"
    )

    final = None
    try:
        with httpx.stream(
            "GET", f"{args.brand_url}/campaigns/stream", params=params, timeout=600
        ) as response:
            response.raise_for_status()
            for event, data in iter_sse(response.iter_lines()):
                agent = data.get("creatorAgentId")
                if event == "status":
                    print(
                        f"{DIM}campaign {data.get('campaignId')} · LLM {data.get('llmMode')}{RESET}"
                    )
                elif event == "discovery":
                    r = data["report"]
                    print(
                        f"\n{BOLD}🔎 탐색{RESET}  queried {r['queried']} · "
                        f"ranked {r['ranked']} · probed {r['probed']}"
                    )
                    for c in r["candidates"]:
                        if c["selected"]:
                            tag = f"{CREATOR}선정 · card UP{RESET}"
                        elif not c["eligible"]:
                            tag = f"{RED}{', '.join(c['hardFilterReasons'])}{RESET}"
                        elif c["cardStatus"] in ("DOWN", "NO_SKILL"):
                            err = c.get("cardError") or ""
                            tag = f"{RED}card {c['cardStatus']}{RESET} {DIM}{err}{RESET}"
                        else:
                            tag = f"{YEL}미선정{RESET}"
                        rank = c["rank"] if c["rank"] is not None else "-"
                        band = c.get("publicRateBand") or ""
                        health = {"UP": "🟢", "DOWN": "🔴"}.get(c.get("healthStatus"), "⚪")
                        tr = c.get("trackRecord") or {}
                        hist = (
                            f"{tr['agreements']}/{tr['attempts']}" if tr.get("attempts") else "-/-"
                        )
                        print(
                            f"  {rank:>2}  {c['creatorAgentId']:<18} {band:<9} "
                            f"{c['score']:.3f} {health}{hist:<5} {c['baseUrl']:<32} {tag}"
                        )
                elif event == "negotiation_started":
                    led = data["ledger"]
                    print(
                        f"\n{BRAND}▶ {agent}{RESET} 협상 시작  예약 {data['reservedUsdc']}  "
                        f"{DIM}장부: 예약 {led['reservedUsdc']} / 확정 {led['committedUsdc']} / "
                        f"가용 {led['availableUsdc']}{RESET}"
                    )
                elif event == "negotiation_skipped":
                    print(f"\n{YEL}⏭ {agent}{RESET} 시작 안 함: {data['reason']}")
                elif event == "negotiation_error":
                    print(f"\n{RED}⚠ {agent}{RESET} {data['detail']}")
                elif event == "turn":
                    color = BRAND if data["role"] == "brand" else CREATOR
                    who = "💼" if data["role"] == "brand" else "🎨"
                    print(
                        f"  {color}{who} [{agent}] r{data['round']} {data['type']:<7} "
                        f"{data['amountUsdc']:>4} USDC{RESET}  {data['message']}"
                    )
                elif event == "negotiation_result":
                    r, led = data["result"], data["ledger"]
                    print(
                        f"{BOLD}■ {agent}{RESET} {r['outcome']} {r['finalAmountUsdc']} USDC  "
                        f"{DIM}장부: 확정 {led['committedUsdc']} / "
                        f"가용 {led['availableUsdc']}{RESET}"
                    )
                elif event == "agreement_created":
                    print(
                        f"  {BOLD}📄 [{agent}] 합의서{RESET} {data['agreementId']}  "
                        f"{data['amountUsdc']} USDC · {data['deliverableSummary']}  "
                        f"{DIM}termsHash {str(data['termsHash'])[:16]}…{RESET}"
                    )
                elif event == "escrow_locked":
                    print(
                        f"  {CREATOR}🔒 [{agent}] 에스크로 잠금{RESET} {data.get('escrowId')}  "
                        f"{DIM}{data.get('signature') or ''}{RESET}"
                    )
                elif event in ("escrow_skipped", "escrow_failed"):
                    color = YEL if event == "escrow_skipped" else RED
                    print(
                        f"  {color}🔓 [{agent}] 에스크로 {data.get('status')}{RESET} "
                        f"{data.get('reason')} {DIM}{data.get('detail') or ''}{RESET}"
                    )
                elif event == "campaign_result":
                    final = data["result"]
                elif event == "error":
                    print(f"{RED}에러: {data.get('detail')}{RESET}")
                    return 1
    except httpx.HTTPError as exc:
        print(f"{RED}브랜드 에이전트 호출 실패: {exc}{RESET}")
        return 1

    if final is None:
        print(f"{RED}campaign_result 이벤트를 받지 못했습니다{RESET}")
        return 1
    print(f"\n{BOLD}{'─' * 60}{RESET}")
    print(
        f"{BOLD}결과: {final['outcome']}{RESET}  "
        f"{final['agreedCount']}/{final['targetCreatorCount']}명 합의 · "
        f"확정 {final['committedUsdc']} / {final['totalBudgetUsdc']} USDC"
    )
    for n in final["negotiations"]:
        r = n.get("result") or {}
        escrow = n.get("escrow") or {}
        tail = ""
        if n.get("agreementId"):
            tail = f"  agreement {n['agreementId']}  escrow {escrow.get('status')}"
        print(
            f"  {n['creatorAgentId']:<18} {n['status']:<8} "
            f"{r.get('outcome') or n.get('skipReason') or '':<16} "
            f"{n['committedUsdc']:>4} USDC{tail}"
        )
    print(f"matchRunId: {final['matchRunId']}")
    print(f"{BOLD}{'─' * 60}{RESET}")
    if args.json:
        print(json.dumps(final, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
