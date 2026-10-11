"use client";

/**
 * 플로팅 채팅 독 — 메신저처럼 여러 창을 동시에 띄운다.
 * "agent" 창은 브랜드↔에이전트 LLM 대화, 그 외 id는 크리에이터별 A2A 협상 로그.
 */

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useDemo, clickChip, sendFreeText, submitBudget } from "@/demo/engine/store";
import { BUDGET_PRESETS, creatorById } from "@/demo/engine/script";
import { Yarn } from "@/demo/character/Yarn";
import { A2ALog, FaceWithAgent, negotiationBadge } from "@/demo/ui/bits";
import { ProtocolView } from "@/demo/ui/ProtocolView";
import { LiveDot } from "@/demo/ui/primitives";
import { useUsdcBalance, formatUsdc } from "@/demo/wallet/balance";
import { useKnotSession } from "@/demo/auth/session";

function useAutoScroll(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" });
  }, [dep]);
  return ref;
}

function WindowFrame({
  title,
  sub,
  avatar,
  onClose,
  children,
  footer,
}: {
  title: string;
  sub: React.ReactNode;
  avatar: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 24, scale: 0.96 }}
      className="flex h-[440px] w-[324px] flex-col overflow-hidden rounded-2xl border border-[var(--k-line)] bg-white shadow-[0_16px_44px_rgba(0,0,0,0.14)]"
    >
      <div className="flex items-center gap-2.5 border-b border-[var(--k-line)] px-3.5 py-2.5">
        {avatar}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-bold leading-tight">{title}</div>
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--k-muted)]">{sub}</div>
        </div>
        <button
          onClick={onClose}
          className="rounded-md px-1.5 text-[16px] leading-none text-[var(--k-muted)] hover:bg-black/5 hover:text-[var(--k-ink)]"
        >
          ×
        </button>
      </div>
      {children}
      {footer}
    </motion.div>
  );
}

/**
 * 예산 프리셋 칩 아래 "직접 입력" 폼 — 총예산·딜당한도를 숫자로 직접 넣는다.
 * 지갑이 연결돼 있으면 실제 devnet USDC 보유액을 상한으로 검증한다 —
 * 없는 돈으로 캠페인을 만들 수 없어야 진짜다.
 */
function BudgetManualInput() {
  const [open, setOpen] = useState(false);
  const [total, setTotal] = useState("");
  const [cap, setCap] = useState("");
  const session = useKnotSession();
  const { balance: realUsdc } = useUsdcBalance(session?.wallet);
  const totalN = Number(total);
  const capN = Number(cap);
  const withinBalance = realUsdc === null || totalN <= realUsdc;
  const valid = total !== "" && cap !== "" && totalN > 0 && capN >= 5 && capN <= totalN && withinBalance;
  const error =
    total !== "" && cap !== "" && !valid
      ? !withinBalance
        ? `지갑 잔액(${formatUsdc(realUsdc ?? 0)} USDC)을 넘는 예산이에요`
        : capN < 5
          ? "딜당 한도는 최소 5 USDC예요"
          : "딜당 한도는 총예산보다 클 수 없어요"
      : null;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-2 text-[12px] font-semibold text-[var(--k-muted)] underline-offset-2 hover:text-[var(--k-ink)] hover:underline"
      >
        ✏️ 직접 입력할래요
      </button>
    );
  }
  const submit = () => {
    if (!valid) return;
    submitBudget(totalN, capN);
  };
  return (
    <div className="mt-2 rounded-xl border border-[var(--k-line)] bg-white p-2.5">
      <div className="flex items-center gap-1.5">
        <div className="flex-1">
          <div className="mb-0.5 text-[10.5px] font-semibold text-[var(--k-muted)]">총예산 (USDC)</div>
          <input
            type="number"
            min={1}
            value={total}
            onChange={(e) => setTotal(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === "Enter") submit();
            }}
            placeholder="1000"
            className="k-mono h-8 w-full rounded-lg border border-[var(--k-line-strong)] px-2 text-[13px] outline-none focus:border-[var(--k-ink)]"
          />
        </div>
        <div className="flex-1">
          <div className="mb-0.5 text-[10.5px] font-semibold text-[var(--k-muted)]">딜당 한도</div>
          <input
            type="number"
            min={1}
            value={cap}
            onChange={(e) => setCap(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === "Enter") submit();
            }}
            placeholder="450"
            className="k-mono h-8 w-full rounded-lg border border-[var(--k-line-strong)] px-2 text-[13px] outline-none focus:border-[var(--k-ink)]"
          />
        </div>
        <button
          onClick={submit}
          disabled={!valid}
          className="mt-[15px] h-8 rounded-lg bg-[var(--k-ink)] px-3 text-[12px] font-bold text-white disabled:opacity-30"
        >
          확인
        </button>
      </div>
      {error && <div className="mt-1.5 text-[11px] font-semibold text-red-500">{error}</div>}
      {realUsdc !== null && !error && (
        <div className="k-mono mt-1.5 text-[10.5px] text-[var(--k-muted)]">
          지갑 잔액 {formatUsdc(realUsdc)} USDC (devnet) 안에서 집행돼요
        </div>
      )}
    </div>
  );
}

function AgentChatWindow({ onClose }: { onClose: () => void }) {
  const s = useDemo();
  const session = useKnotSession();
  const { balance: brandUsdc } = useUsdcBalance(session?.wallet);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  // 한글 IME Enter가 keydown을 두 번 발화시키는 케이스 2차 방어
  const lastSent = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  const scrollRef = useAutoScroll(`${s.chat.length}-${s.agentTyping}`);
  const agentName = s.brand?.agentName ?? "타래";
  const color = s.brand?.color ?? "#d9a441";

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    const now = Date.now();
    if (t === lastSent.current.text && now - lastSent.current.at < 1500) return;
    lastSent.current = { text: t, at: now };
    setText("");
    inputRef.current?.focus();
    sendFreeText(t);
  };

  return (
    <WindowFrame
      title={agentName}
      sub={
        <>
          <LiveDot /> 브랜드 에이전트 · 온라인
        </>
      }
      avatar={<Yarn color={color} mood={s.agentTyping ? "think" : "idle"} size={30} />}
      onClose={onClose}
      footer={
        <div className="border-t border-[var(--k-line)] p-2.5">
          <div className="flex items-center gap-2 rounded-xl bg-black/[0.04] px-3 py-1">
            <input
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                if (e.key === "Enter") submit();
              }}
              placeholder={`${agentName}에게 무엇이든 물어보세요`}
              className="h-9 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-[var(--k-muted)]"
            />
            <button
              onClick={submit}
              className="text-[13px] font-bold text-[var(--k-ink)] disabled:opacity-30"
              disabled={!text.trim()}
            >
              ↑
            </button>
          </div>
        </div>
      }
    >
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3.5 py-3">
        {s.chat.map((m) => (
          <motion.div
            key={m.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div className="max-w-[88%]">
              <div
                className={`rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed ${
                  m.role === "user"
                    ? "rounded-br-sm bg-[var(--k-ink)] text-white"
                    : "rounded-bl-sm bg-black/[0.05]"
                }`}
              >
                {m.text}
              </div>
              {m.chips && m.chips.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {m.chips.map((c) => {
                    // 지갑이 연결돼 있으면 실보유액을 넘는 프리셋은 비활성화 — 없는 돈으로 캠페인 금지
                    const preset = BUDGET_PRESETS[c.id];
                    const unaffordable =
                      preset != null && brandUsdc !== null && preset.budgetUsdc > brandUsdc;
                    return (
                      <button
                        key={c.id}
                        onClick={() => !unaffordable && clickChip(c)}
                        disabled={unaffordable}
                        title={unaffordable ? `지갑 잔액(${formatUsdc(brandUsdc ?? 0)} USDC) 초과` : undefined}
                        className="rounded-full border border-[var(--k-ink)] bg-white px-3 py-1.5 text-[12.5px] font-semibold transition-all hover:bg-[var(--k-ink)] hover:text-white active:scale-95 disabled:cursor-not-allowed disabled:border-[var(--k-line-strong)] disabled:text-[var(--k-muted)] disabled:line-through disabled:hover:bg-white disabled:hover:text-[var(--k-muted)]"
                      >
                        {c.label}
                      </button>
                    );
                  })}
                </div>
              )}
              {m.chips && m.chips.length > 0 && m.chips[0].id.startsWith("budget-") && s.composeStep === "budget" && (
                <BudgetManualInput />
              )}
            </div>
          </motion.div>
        ))}
        {s.agentTyping && (
          <div className="flex items-center gap-1 rounded-2xl rounded-bl-sm bg-black/[0.05] px-3.5 py-3 w-fit">
            <span className="k-typing-dot h-1.5 w-1.5 rounded-full bg-[var(--k-muted)]" />
            <span className="k-typing-dot h-1.5 w-1.5 rounded-full bg-[var(--k-muted)]" />
            <span className="k-typing-dot h-1.5 w-1.5 rounded-full bg-[var(--k-muted)]" />
          </div>
        )}
      </div>
    </WindowFrame>
  );
}

function A2AWindow({ creatorId, onClose }: { creatorId: string; onClose: () => void }) {
  const s = useDemo();
  const n = s.campaign?.negotiations[creatorId];
  const c = creatorById(creatorId);
  const [tab, setTab] = useState<"chat" | "protocol">("chat");
  const scrollRef = useAutoScroll(n?.messages.length);
  if (!n) return null;
  return (
    <WindowFrame
      title={`A2A · ${c.handle}`}
      sub={<>에이전트 간 협상 채널 {negotiationBadge(n)}</>}
      avatar={<FaceWithAgent src={c.photo} color={c.color} mood={n.status === "talking" ? "talk" : n.status === "agreed" ? "happy" : "idle"} size={28} />}
      onClose={onClose}
    >
      <div className="flex gap-1 border-b border-[var(--k-line)] px-3.5 pt-1.5">
        {(
          [
            { id: "chat", label: "대화" },
            { id: "protocol", label: "프로토콜" },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-t-lg px-3 py-1.5 text-[12px] font-semibold transition-colors ${
              tab === t.id
                ? "border border-b-0 border-[var(--k-line)] bg-white text-[var(--k-ink)]"
                : "text-[var(--k-muted)] hover:text-[var(--k-ink)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "chat" ? (
        <div ref={scrollRef} className="flex-1 overflow-y-auto bg-[#fbfbfc] px-3.5 py-3">
          <A2ALog n={n} />
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          <ProtocolView n={n} />
        </div>
      )}
    </WindowFrame>
  );
}

export function ChatDock({
  windows,
  onClose,
}: {
  windows: string[];
  onClose: (id: string) => void;
}) {
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex items-end gap-3">
      <AnimatePresence>
        {windows.map((id) => (
          <div key={id} className="pointer-events-auto">
            {id === "agent" ? (
              <AgentChatWindow onClose={() => onClose(id)} />
            ) : (
              <A2AWindow creatorId={id} onClose={() => onClose(id)} />
            )}
          </div>
        ))}
      </AnimatePresence>
    </div>
  );
}
