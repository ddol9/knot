"use client";

/** 딜 테이블 — 유일하게 CRM스러운 화면. 여기서 'Attio보다 이쁘다'를 증명한다. */

import { useDemo } from "@/demo/engine/store";
import { AUTOPILOT_CREATOR, creatorById } from "@/demo/engine/script";
import { RealChainCard } from "@/demo/real/RealChainCard";
import { Face } from "@/demo/ui/bits";
import { Badge, SectionLabel } from "@/demo/ui/primitives";

export function Deals() {
  const s = useDemo();
  const deals = s.campaign?.deals ?? [];

  const rows = deals.map((d) => {
    const cr = creatorById(d.creatorId);
    const releasedPct = d.milestones
      .filter((m) => m.status === "released")
      .reduce((a, m) => a + m.pct, 0);
    return {
      key: d.creatorId,
      avatar: <Face src={cr.photo} color={cr.color} size={28} alt={cr.handle} />,
      handle: cr.handle,
      niche: cr.niche,
      status:
        d.starPct >= 100 ? (
          <Badge tone="ok">정산 완료</Badge>
        ) : (
          <Badge tone="warn">진행 중</Badge>
        ),
      amount: d.amountUsdc + (d.bonusUsdc ?? 0),
      bonus: d.bonusUsdc,
      releasedPct,
      star: d.starPct,
      txs: d.txs.length,
    };
  });

  if (s.autopilotRun && s.autopilotRun.dealCount > 0) {
    const ap = AUTOPILOT_CREATOR;
    rows.push({
      key: ap.id,
      avatar: <Face src={ap.photo} color={ap.color} size={28} alt={ap.handle} />,
      handle: ap.handle,
      niche: ap.niche,
      status: <Badge tone="ink">🚀 자동 진행</Badge>,
      amount: ap.amountUsdc,
      bonus: null,
      releasedPct: 30,
      star: 30,
      txs: 2,
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="text-[18px] font-bold tracking-tight">딜</div>
        <div className="text-[12.5px] text-[var(--k-muted)]">
          에이전트가 체결한 계약 전체 — 금액·해시·릴리즈는 온체인 에스크로 기준
        </div>
      </div>
      <RealChainCard role="brand" />
      <div className="k-card overflow-hidden">
        {rows.length === 0 ? (
          <div className="px-5 py-10 text-center text-[13px] text-[var(--k-muted)]">
            아직 체결된 딜이 없어요 — 탐험이 끝나면 여기에 쌓입니다
          </div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[var(--k-line)] text-[11px] uppercase tracking-[0.06em] text-[var(--k-muted)]">
                <th className="px-4 py-2.5 font-bold">크리에이터</th>
                <th className="px-3 py-2.5 font-bold">상태</th>
                <th className="px-3 py-2.5 text-right font-bold">금액</th>
                <th className="px-3 py-2.5 font-bold">릴리즈</th>
                <th className="px-3 py-2.5 text-right font-bold">타래</th>
                <th className="px-4 py-2.5 text-right font-bold">tx</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.key}
                  className="border-b border-[var(--k-line)] transition-colors last:border-0 hover:bg-black/[0.02]"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      {r.avatar}
                      <div>
                        <div className="text-[13.5px] font-bold leading-tight">{r.handle}</div>
                        <div className="text-[11px] text-[var(--k-muted)]">{r.niche}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3">{r.status}</td>
                  <td className="k-mono px-3 py-3 text-right text-[13px] font-bold">
                    {r.amount.toLocaleString()}
                    {r.bonus ? <span className="text-[10.5px] text-[var(--k-money)]"> +{r.bonus}</span> : null}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-black/[0.06]">
                        <div
                          className="h-full rounded-full bg-[var(--k-money)] transition-all duration-700"
                          style={{ width: `${r.releasedPct}%` }}
                        />
                      </div>
                      <span className="k-mono text-[11px] text-[var(--k-muted)]">{r.releasedPct}%</span>
                    </div>
                  </td>
                  <td className="k-mono px-3 py-3 text-right text-[12.5px]">
                    {r.star >= 100 ? "🧶 100" : r.star}
                  </td>
                  <td className="k-mono px-4 py-3 text-right text-[12.5px] text-[var(--k-muted)]">{r.txs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {rows.length > 0 && (
        <div className="k-card px-4 py-3">
          <SectionLabel>정산 레일</SectionLabel>
          <div className="mt-1.5 text-[12.5px] text-[var(--k-ink-soft)]">
            USDC-SPL (Solana devnet) · Anchor 마일스톤 에스크로 · 조건 충족 시 사람 개입 없이 자동
            릴리즈
          </div>
        </div>
      )}
    </div>
  );
}
