"use client";

/** 홈 — "오늘 에이전트가 뭘 했나" 중심의 커맨드 센터. */

import { motion, AnimatePresence } from "framer-motion";
import { useDemo } from "@/demo/engine/store";
import { Yarn } from "@/demo/character/Yarn";
import { useKnotSession } from "@/demo/auth/session";
import { useUsdcBalance, formatUsdc } from "@/demo/wallet/balance";
import { Stat, SectionLabel, Badge, Button, LiveDot } from "@/demo/ui/primitives";
import type { FeedTone, Mood } from "@/demo/engine/types";

function agentStatus(s: ReturnType<typeof useDemo>): { mood: Mood; line: string } {
  const c = s.campaign;
  if (s.autopilotRun && !s.autopilotRun.done)
    return { mood: "talk", line: "오토파일럿으로 캠페인 #2를 돌리는 중이에요" };
  if (s.autopilot) return { mood: "idle", line: "오토파일럿 가동 중 — 한도 안에서 알아서 움직여요" };
  if (!c) return { mood: "idle", line: "첫 캠페인을 기다리고 있어요. 채팅으로 시작해요!" };
  switch (c.status) {
    case "scouting":
      return { mood: "think", line: "크리에이터 네트워크를 탐험하는 중…" };
    case "negotiating":
      return { mood: "talk", line: "3명과 동시에 협상 중 — 한도 450 안에서만 움직여요" };
    case "pending_approval":
      return { mood: "alert", line: "딜 2건 물어왔어요! 승인이 필요해요" };
    case "knotting":
      return { mood: "happy", line: "매듭 묶는 중…" };
    case "active":
      return { mood: "talk", line: "캠페인 진행 중 — 마일스톤 검증하고 있어요" };
    case "completed":
      return { mood: "happy", line: "캠페인 완료! 리포트 가져왔어요" };
  }
}

const toneColor: Record<FeedTone, string> = {
  info: "text-[var(--k-ink-soft)]",
  ok: "text-emerald-700",
  warn: "text-amber-700",
  money: "text-[var(--k-money)] font-semibold",
};

export function Home({
  onGoCampaign,
  onOpenChat,
}: {
  onGoCampaign: () => void;
  onOpenChat: () => void;
}) {
  const s = useDemo();
  const c = s.campaign;
  const deals = c?.deals ?? [];
  const committed = deals.reduce((sum, d) => sum + d.amountUsdc, 0) + (s.autopilotRun?.spentUsdc ?? 0);
  const released = deals.reduce(
    (sum, d) =>
      sum +
      d.milestones.filter((m) => m.status === "released").reduce((a, m) => a + m.usdc, 0) +
      (d.bonusUsdc ?? 0),
    0,
  );
  const activeDeals =
    deals.filter((d) => d.starPct < 100).length + (s.autopilotRun?.dealCount ?? 0);
  const st = agentStatus(s);
  const session = useKnotSession();
  const { balance: walletUsdc } = useUsdcBalance(session?.wallet);

  return (
    <div className="space-y-4">
      {/* 에이전트 스트립 */}
      <div className="k-card flex items-center gap-4 px-5 py-4">
        <Yarn color={s.brand?.color ?? "#d9a441"} mood={st.mood} size={62} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-bold">{s.brand?.agentName ?? "타래"}</span>
            <Badge tone={s.autopilot ? "ink" : "ok"}>
              {s.autopilot ? "🚀 오토파일럿" : "수동 승인 모드"}
            </Badge>
          </div>
          <div className="mt-0.5 truncate text-[13px] text-[var(--k-muted)]">{st.line}</div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={onOpenChat}>
            💬 대화
          </Button>
          {c && (
            <Button size="sm" onClick={onGoCampaign}>
              캠페인 보기
            </Button>
          )}
        </div>
      </div>

      {/* KPI */}
      <div className="flex flex-wrap gap-2.5">
        <Stat
          label="지갑 잔액 · devnet"
          value={walletUsdc !== null ? formatUsdc(walletUsdc) : session?.wallet ? "…" : "—"}
          sub={session?.wallet ? "온체인 실시간 조회" : "지갑을 연결하면 표시돼요"}
          tone="money"
        />
        <Stat
          label="캠페인 예산"
          value={c ? c.spec.budgetUsdc.toLocaleString() : "—"}
          sub={`집행 확정 ${committed.toLocaleString()} USDC`}
        />
        <Stat label="활성 딜" value={activeDeals} sub={`체결 누적 ${deals.length + (s.autopilotRun?.dealCount ?? 0)}건`} />
        <Stat label="지급 완료" value={released.toLocaleString()} sub="에스크로 자동 릴리즈" tone="money" />
        <Stat
          label="사람 개입"
          value={s.autopilot ? "0회" : "승인 1회"}
          sub={s.autopilot ? "한도 내 전권 위임" : "딜 승인만 사람이"}
        />
      </div>

      {/* 오토파일럿 런 */}
      {s.autopilotRun && (
        <div className="k-card px-5 py-4">
          <div className="flex items-center justify-between">
            <SectionLabel>오토파일럿 — {s.autopilotRun.label}</SectionLabel>
            {!s.autopilotRun.done && <LiveDot />}
          </div>
          <div className="mt-2.5 space-y-1.5">
            <AnimatePresence>
              {s.autopilotRun.items.map((it) => (
                <motion.div
                  key={it.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  className={`text-[13px] ${toneColor[it.tone]}`}
                >
                  · {it.text}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* 활동 피드 */}
      <div className="k-card px-5 py-4">
        <SectionLabel>에이전트 활동</SectionLabel>
        <div className="mt-2.5">
          {s.feed.length === 0 && (
            <div className="py-6 text-center text-[13px] text-[var(--k-muted)]">
              아직 활동이 없어요 — 캠페인을 시작하면 여기가 실시간으로 채워집니다
            </div>
          )}
          <AnimatePresence initial={false}>
            {s.feed.map((f) => (
              <motion.div
                key={f.id}
                initial={{ opacity: 0, y: -10, height: 0 }}
                animate={{ opacity: 1, y: 0, height: "auto" }}
                className="overflow-hidden"
              >
                <div className="flex items-baseline gap-2.5 border-b border-[var(--k-line)] py-2 last:border-0">
                  <span className="text-[14px]">{f.icon}</span>
                  <span className={`flex-1 text-[13px] ${toneColor[f.tone]}`}>{f.text}</span>
                  <span className="k-mono shrink-0 text-[10.5px] text-[var(--k-muted)]">
                    {new Date(f.at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
