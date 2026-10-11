"use client";

/** 캠페인 화면 — 상태에 따라 변신하는 단일 뷰. 피크민 탐험의 본진. */

import { motion, AnimatePresence } from "framer-motion";
import type { CampaignState, Deal } from "@/demo/engine/types";
import { useDemo, approveDeals } from "@/demo/engine/store";
import { creatorById, CREATORS, HERO_ID, REPORT_SUMMARY } from "@/demo/engine/script";
import { openReport } from "@/demo/reportClient";
import { Yarn, KnotTie, StarBurst, YarnMeter } from "@/demo/character/Yarn";
import { Button, Badge, SectionLabel, usdc } from "@/demo/ui/primitives";
import { A2ABubble, Face, FaceWithAgent, TxRow, negotiationBadge } from "@/demo/ui/bits";

const STEPS = [
  { key: "scouting", label: "탐색" },
  { key: "negotiating", label: "협상" },
  { key: "pending_approval", label: "승인" },
  { key: "knotting", label: "매듭" },
  { key: "active", label: "진행" },
  { key: "completed", label: "리포트" },
] as const;

function Stepper({ status }: { status: CampaignState["status"] }) {
  const idx = STEPS.findIndex((s) => s.key === status);
  return (
    <div className="flex items-center gap-1.5">
      {STEPS.map((s, i) => (
        <div key={s.key} className="flex items-center gap-1.5">
          <div
            className={`flex h-6 items-center rounded-full px-2.5 text-[11.5px] font-bold transition-colors ${
              i === idx
                ? "bg-[var(--k-ink)] text-white"
                : i < idx
                  ? "bg-black/[0.07] text-[var(--k-ink-soft)]"
                  : "text-[var(--k-muted)]"
            }`}
          >
            {i < idx ? "✓ " : ""}
            {s.label}
          </div>
          {i < STEPS.length - 1 && <div className="h-px w-3 bg-[var(--k-line-strong)]" />}
        </div>
      ))}
    </div>
  );
}

/* --------------------------------- 탐색 --------------------------------- */

function Scouting({ c, brandColor }: { c: CampaignState; brandColor: string }) {
  return (
    <div className="k-card px-6 py-8">
      <div className="flex flex-col items-center">
        <motion.div
          animate={{ x: [-30, 30, -30] }}
          transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
        >
          <Yarn color={brandColor} mood="think" size={84} flip />
        </motion.div>
        <div className="mt-2 text-[15px] font-bold">크리에이터 네트워크 탐험 중…</div>
        <div className="text-[12.5px] text-[var(--k-muted)]">
          무드 태그 · 성과 데이터 · 일정으로 적합도를 계산해요
        </div>
      </div>
      <div className="mt-6 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <AnimatePresence>
          {c.discovered.map((id) => {
            const cr = creatorById(id);
            return (
              <motion.div
                key={id}
                initial={{ opacity: 0, scale: 0.7, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 260, damping: 18 }}
                className="rounded-xl border border-[var(--k-line)] bg-white px-4 py-3"
              >
                <div className="flex items-center gap-2.5">
                  <Face src={cr.photo} color={cr.color} size={30} alt={cr.handle} />
                  <div>
                    <div className="text-[13px] font-bold leading-tight">{cr.handle}</div>
                    <div className="text-[11px] text-[var(--k-muted)]">{cr.niche}</div>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[10.5px] text-[var(--k-muted)]">
                  <span>평균 뷰 <b className="k-mono text-[var(--k-ink)]">{cr.insights.avgViews}</b></span>
                  <span>30일 성장 <b className="k-mono text-[var(--k-ink)]">{cr.insights.growth30d}</b></span>
                  <span className="k-mono">{cr.profileUrl}</span>
                </div>
                <div className="mt-2.5 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/[0.06]">
                    <motion.div
                      className="h-full rounded-full bg-[var(--k-ink)]"
                      initial={{ width: 0 }}
                      animate={{ width: `${cr.fit}%` }}
                      transition={{ duration: 0.9, ease: "easeOut" }}
                    />
                  </div>
                  <span className="k-mono text-[12px] font-bold">{cr.fit}</span>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* --------------------------------- 협상 --------------------------------- */

function NegotiationLanes({
  c,
  onOpenLog,
}: {
  c: CampaignState;
  onOpenLog: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      {CREATORS.map((cr) => {
        const n = c.negotiations[cr.id];
        if (!n) return null;
        const last = n.messages.slice(-2);
        return (
          <div key={cr.id} className="k-card flex flex-col px-4 py-3.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FaceWithAgent
                  src={cr.photo}
                  color={cr.color}
                  size={32}
                  mood={n.status === "talking" ? "talk" : n.status === "agreed" ? "happy" : n.status === "blocked" ? "sad" : "idle"}
                />
                <div>
                  <div className="text-[13px] font-bold leading-tight">{cr.handle}</div>
                  <div className="text-[11px] text-[var(--k-muted)]">적합도 {cr.fit}</div>
                </div>
              </div>
              {negotiationBadge(n)}
            </div>
            <div className="mt-3 flex min-h-[120px] flex-1 flex-col gap-2.5 rounded-xl bg-[#fbfbfc] p-3">
              {last.length === 0 ? (
                <div className="m-auto text-[12px] text-[var(--k-muted)]">
                  {n.status === "queued" ? "협상 대기열" : "연결 중…"}
                </div>
              ) : (
                last.map((m) => <A2ABubble key={m.id} m={m} creatorId={cr.id} />)
              )}
            </div>
            {n.messages.length > 0 && (
              <button
                onClick={() => onOpenLog(cr.id)}
                className="mt-2.5 self-start text-[12px] font-bold text-[var(--k-ink-soft)] underline-offset-2 hover:underline"
              >
                전체 협상 로그 열기 ({n.messages.length})
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* --------------------------------- 승인 --------------------------------- */

function Approval({ c }: { c: CampaignState }) {
  const agreed = Object.values(c.negotiations).filter((n) => n.status === "agreed");
  const blocked = Object.values(c.negotiations).filter((n) => n.status === "blocked");
  const total = agreed.reduce((sum, n) => sum + (n.agreedUsdc ?? 0), 0);
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="k-card px-6 py-6">
      <div className="flex items-center gap-3">
        <span className="text-[26px]">🎒</span>
        <div>
          <div className="text-[17px] font-bold">에이전트가 딜 {agreed.length}건을 물어왔어요</div>
          <div className="text-[13px] text-[var(--k-muted)]">
            합계 <b className="k-mono text-[var(--k-ink)]">{usdc(total)}</b> — 예산{" "}
            {usdc(c.spec.budgetUsdc)}의 {Math.round((total / c.spec.budgetUsdc) * 100)}%
          </div>
        </div>
      </div>
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {agreed.map((n) => {
          const cr = creatorById(n.creatorId);
          const isHero = n.creatorId === HERO_ID;
          return (
            <div key={n.creatorId} className="rounded-xl border border-[var(--k-line)] px-4 py-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Face src={cr.photo} color={cr.color} size={26} alt={cr.handle} />
                  <b className="text-[13.5px]">{cr.handle}</b>
                </div>
                <span className="k-mono text-[15px] font-bold">{usdc(n.agreedUsdc ?? 0)}</span>
              </div>
              <div className="mt-2 space-y-1 text-[12px] text-[var(--k-ink-soft)]">
                <div>· {c.spec.contentType} · 마일스톤 30/70</div>
                {isHero && <div>· 성과 보너스: 조회수 15만 초과 시 +40</div>}
                <div>· {cr.fitReason}</div>
                <div className="text-[11px] text-[var(--k-muted)]">
                  평균 뷰 {cr.insights.avgViews} · 저장 {cr.insights.saves30d}/30일 · 성장{" "}
                  {cr.insights.growth30d} · <span className="k-mono">{cr.profileUrl}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {blocked.map((n) => (
        <div
          key={n.creatorId}
          className="mt-3 flex items-center justify-between rounded-xl border border-dashed border-[var(--k-line-strong)] px-4 py-2.5 opacity-70"
        >
          <span className="text-[12.5px]">
            <b>{creatorById(n.creatorId).handle}</b> — {n.blockedReason}
          </span>
          <Badge tone="danger">자율 철수</Badge>
        </div>
      ))}
      <div className="mt-5 flex items-center justify-between rounded-xl bg-black/[0.04] px-4 py-3">
        <div className="text-[12.5px] text-[var(--k-muted)]">
          승인하면 에스크로에 <b className="k-mono text-[var(--k-ink)]">{usdc(total)}</b>가 잠기고,
          마일스톤 달성 시 자동 릴리즈됩니다
        </div>
        <Button size="lg" onClick={approveDeals}>
          🪢 승인하고 매듭 묶기
        </Button>
      </div>
    </motion.div>
  );
}

/* --------------------------------- 매듭 --------------------------------- */

function Knotting({ brandColor }: { brandColor: string }) {
  const hero = creatorById(HERO_ID);
  return (
    <div className="k-card flex flex-col items-center px-6 py-12">
      <div className="flex items-center gap-2">
        <Yarn color={brandColor} mood="happy" size={76} flip />
        <KnotTie leftColor={brandColor} rightColor={hero.color} size={260} />
        <Yarn color={hero.color} mood="happy" size={76} />
      </div>
      <div className="mt-3 text-[16px] font-bold">두 에이전트를 매듭으로 묶는 중…</div>
      <div className="text-[12.5px] text-[var(--k-muted)]">
        계약 해시 고정 → 에스크로 예치 → A2A 태스크 브리프 전송
      </div>
    </div>
  );
}

/* --------------------------------- 진행 --------------------------------- */

function DealCard({ deal, burstSeq }: { deal: Deal; burstSeq: number }) {
  const cr = creatorById(deal.creatorId);
  const isHero = deal.creatorId === HERO_ID;
  return (
    <div className="k-card relative overflow-visible px-4 py-4">
      {isHero && <StarBurst trigger={burstSeq} />}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <FaceWithAgent src={cr.photo} color={cr.color} size={36} mood={deal.starPct >= 100 ? "happy" : "talk"} />
          <div>
            <div className="text-[14px] font-bold leading-tight">{cr.handle}</div>
            <div className="k-mono text-[12px] text-[var(--k-muted)]">
              {usdc(deal.amountUsdc)}
              {deal.bonusUsdc ? ` +${deal.bonusUsdc} 보너스` : ""}
            </div>
          </div>
        </div>
        <YarnMeter pct={deal.starPct} color={cr.color} size={58} />
      </div>
      <div className="mt-3 space-y-1.5">
        {deal.milestones.map((m) => (
          <div key={m.id} className="flex items-center gap-2 text-[12.5px]">
            <span
              className={`flex h-4.5 w-4.5 items-center justify-center rounded-full text-[10px] font-bold ${
                m.status === "released"
                  ? "bg-emerald-100 text-emerald-700"
                  : m.status === "review"
                    ? "bg-amber-100 text-amber-700"
                    : m.status === "active"
                      ? "bg-black/[0.08]"
                      : "bg-black/[0.04] text-[var(--k-muted)]"
              }`}
            >
              {m.status === "released" ? "✓" : m.status === "review" ? "…" : ""}
            </span>
            <span className={m.status === "locked" ? "text-[var(--k-muted)]" : ""}>
              {m.label} ({m.pct}%)
            </span>
            <span className="k-mono ml-auto text-[11.5px] text-[var(--k-muted)]">{m.usdc} USDC</span>
          </div>
        ))}
      </div>
      {deal.awaitingPost && (
        <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-dashed border-amber-300 bg-amber-50/60 px-2.5 py-1.5 text-[11.5px] text-amber-800">
          ⏳ 크리에이터의 게시물 URL 제출 대기 — 제출 전엔 정산이 진행되지 않아요
        </div>
      )}
      {deal.postUrl && (
        <div className="mt-2.5 truncate rounded-lg bg-black/[0.04] px-2.5 py-1.5 text-[11.5px]">
          📎 <span className="k-mono">{deal.postUrl}</span>
        </div>
      )}
      {deal.metrics && (
        <div className="mt-2.5 grid grid-cols-4 gap-1 rounded-lg border border-[var(--k-line)] px-2.5 py-2 text-center">
          {[
            ["조회수", deal.metrics.views],
            ["저장", deal.metrics.saves],
            ["CTR", deal.metrics.ctr],
            ["CPM", deal.metrics.cpmDelta],
          ].map(([k, v]) => (
            <div key={k}>
              <div className="text-[10px] text-[var(--k-muted)]">{k}</div>
              <div className="k-mono text-[12px] font-bold">{v}</div>
            </div>
          ))}
        </div>
      )}
      {deal.txs.length > 0 && (
        <div className="mt-2.5 divide-y divide-[var(--k-line)] border-t border-[var(--k-line)]">
          {deal.txs.map((t) => (
            <TxRow key={t.hash + t.label} label={t.label} hash={t.hash} />
          ))}
        </div>
      )}
    </div>
  );
}

function BriefCard({ c }: { c: CampaignState }) {
  if (!c.brief) return null;
  return (
    <div className="k-card px-4 py-4">
      <SectionLabel>A2A 태스크 브리프 — 매듭과 함께 전송됨</SectionLabel>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <div className="text-[12px] font-bold">✅ 기준 (criteria)</div>
          <ul className="mt-1.5 space-y-1 text-[12px] text-[var(--k-ink-soft)]">
            {c.brief.criteria.map((x) => (
              <li key={x}>· {x}</li>
            ))}
          </ul>
        </div>
        <div>
          <div className="text-[12px] font-bold">📋 태스크</div>
          <ul className="mt-1.5 space-y-1 text-[12px] text-[var(--k-ink-soft)]">
            {c.brief.tasks.map((x) => (
              <li key={x}>· {x}</li>
            ))}
          </ul>
        </div>
        <div>
          <div className="text-[12px] font-bold">🎞️ 레퍼런스</div>
          <ul className="mt-1.5 space-y-1 text-[12px] text-[var(--k-ink-soft)]">
            {c.brief.references.map((r) => (
              <li key={r.title}>
                · {r.title} <span className="k-mono text-[10.5px]">({r.length})</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- 리포트 --------------------------------- */

function Report({ c }: { c: CampaignState }) {
  const state = useDemo();
  const spent = c.deals.reduce((s, d) => s + d.amountUsdc + (d.bonusUsdc ?? 0), 0);
  const r = REPORT_SUMMARY;
  // "44.6만" vs "30만" → +49%
  const viewsDelta = Math.round((parseFloat(r.totalViews) / parseFloat(r.targetViews) - 1) * 100);
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="k-card px-6 py-5">
      <div className="flex items-center justify-between">
        <div className="text-[16px] font-bold">📊 캠페인 리포트 — 에이전트 귀환</div>
        <div className="flex items-center gap-2">
          <Badge tone="ok">완료</Badge>
          <Button variant="outline" size="sm" onClick={() => openReport(state)}>
            📄 리포트 다운로드
          </Button>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {[
          ["조회수 합계", r.totalViews, `목표 ${r.targetViews} · +${viewsDelta}%`],
          ["저장", r.totalSaves, "업계 평균 2.1배"],
          ["평균 CPM", r.cpmVsIndustry, "업계 대비"],
          ["집행", `${spent}/${r.budgetUsdc.toLocaleString()}`, `협상으로 ${r.savedPct}% 절약`],
        ].map(([k, v, sub]) => (
          <div key={k} className="rounded-xl bg-black/[0.03] px-3.5 py-3">
            <div className="text-[11.5px] text-[var(--k-muted)]">{k}</div>
            <div className="k-mono text-[19px] font-bold">{v}</div>
            <div className="text-[10.5px] text-[var(--k-muted)]">{sub}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-xl border border-[var(--k-line)] bg-[#fbfbfc] px-4 py-3 text-[13px] leading-relaxed">
        🧶 <b>타래의 제안</b> — 다음 캠페인은 나노 크리에이터 3명 분산이 CPM 18% 더 좋아요.
        오토파일럿을 켜두시면 한도 안에서 제가 알아서 돌겠습니다.
      </div>
    </motion.div>
  );
}

/* --------------------------------- 본체 --------------------------------- */

export function Expedition({ onOpenLog }: { onOpenLog: (id: string) => void }) {
  const s = useDemo();
  const c = s.campaign;
  const brandColor = s.brand?.color ?? "#d9a441";

  if (!c) {
    return (
      <div className="k-card flex flex-col items-center px-6 py-14 text-center">
        <Yarn color={brandColor} mood="idle" size={84} />
        <div className="mt-3 text-[15px] font-bold">아직 캠페인이 없어요</div>
        <div className="mt-1 text-[13px] text-[var(--k-muted)]">
          채팅에서 {s.brand?.agentName ?? "타래"}에게 캠페인을 만들어달라고 하세요 —
          선택지 몇 번이면 탐험이 시작됩니다
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[18px] font-bold tracking-tight">{c.spec.goal}</div>
          <div className="text-[12.5px] text-[var(--k-muted)]">
            {c.spec.contentType} · 총 {usdc(c.spec.budgetUsdc)} · 딜당 한도{" "}
            <b className="k-mono text-[var(--k-ink)]">{c.spec.maxPerDealUsdc}</b> · {c.spec.deadlineLabel}
          </div>
        </div>
        <Stepper status={c.status} />
      </div>

      {c.status === "scouting" && <Scouting c={c} brandColor={brandColor} />}
      {c.status === "negotiating" && <NegotiationLanes c={c} onOpenLog={onOpenLog} />}
      {c.status === "pending_approval" && (
        <>
          <Approval c={c} />
          <NegotiationLanes c={c} onOpenLog={onOpenLog} />
        </>
      )}
      {c.status === "knotting" && <Knotting brandColor={brandColor} />}
      {(c.status === "active" || c.status === "completed") && (
        <>
          {c.status === "completed" && <Report c={c} />}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {c.deals.map((d) => (
              <DealCard key={d.creatorId} deal={d} burstSeq={s.burstSeq} />
            ))}
          </div>
          <BriefCard c={c} />
        </>
      )}
    </div>
  );
}
