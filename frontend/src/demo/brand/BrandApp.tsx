"use client";

/** 브랜드 워크스페이스 셸 — 좌측 네비 + 뷰 + 플로팅 채팅 독. */

import { useEffect, useRef, useState } from "react";
import {
  useDemo,
  resetDemo,
  playSequence,
  setAutopilot,
} from "@/demo/engine/store";
import { autopilotSequence } from "@/demo/engine/script";
import { Yarn } from "@/demo/character/Yarn";
import { LiveDot } from "@/demo/ui/primitives";
import { IdentityBlock } from "@/demo/auth/IdentityBlock";
import { Home } from "./Home";
import { Expedition } from "./Expedition";
import { Deals } from "./Deals";
import { Performance } from "./Performance";
import { BrandPage } from "./BrandPage";
import { ChatDock } from "./ChatDock";

type View = "home" | "campaign" | "deals" | "performance" | "brand";

const NAV: { key: View; label: string; icon: string }[] = [
  { key: "home", label: "홈", icon: "M3 10.5 12 3l9 7.5V21h-6v-6h-6v6H3z" },
  { key: "campaign", label: "캠페인", icon: "M12 2l2.4 6.9H21l-5.4 4.2 2 6.9-5.6-4.1L6.4 20l2-6.9L3 8.9h6.6z" },
  { key: "deals", label: "딜", icon: "M4 5h16v4H4zm0 6h16v4H4zm0 6h10v2H4z" },
  { key: "performance", label: "성과", icon: "M4 20v-8h3.4v8H4zm6.3 0V4h3.4v16h-3.4zm6.3 0v-5h3.4v5h-3.4z" },
  { key: "brand", label: "브랜드", icon: "M4 21V5l8-3 8 3v16h-6v-5h-4v5H4zm5-10h2V9H9v2zm4 0h2V9h-2v2zM9 15h2v-2H9v2zm4 0h2v-2h-2v2z" },
];

export function BrandApp() {
  const s = useDemo();
  const [view, setView] = useState<View>("home");
  const [windows, setWindows] = useState<string[]>([]);
  const prevStatus = useRef<string | null>(null);
  const openedOnce = useRef(false);

  const openWindow = (id: string) =>
    setWindows((w) => (w.includes(id) ? w : [...w.slice(-1), id]));
  const closeWindow = (id: string) => setWindows((w) => w.filter((x) => x !== id));

  // 워크스페이스 진입 시 에이전트 채팅 자동 오픈
  useEffect(() => {
    if (!openedOnce.current) {
      openedOnce.current = true;
      setWindows(["agent"]);
    }
  }, []);

  // 상태 전환에 따른 자동 뷰 이동
  const status = s.campaign?.status ?? null;
  useEffect(() => {
    if (status === prevStatus.current) return;
    const prev = prevStatus.current;
    prevStatus.current = status;
    if (status === "scouting") setView("campaign");
    if (status === "completed" && prev) setView("campaign");
  }, [status]);

  const autopilotBusy = Boolean(s.autopilotRun && !s.autopilotRun.done);

  return (
    <div className="flex min-h-screen">
      {/* 사이드바 */}
      <aside className="sticky top-0 flex h-screen w-[196px] shrink-0 flex-col border-r border-[var(--k-line)] bg-white px-3 py-4">
        <div className="flex items-center gap-2 px-2">
          <span className="text-[19px] font-black tracking-tight">knot</span>
          <span className="rounded-md bg-black/[0.06] px-1.5 py-0.5 text-[10px] font-bold text-[var(--k-muted)]">
            BRAND
          </span>
        </div>
        <div className="mt-2 flex items-center gap-2 px-2">
          {s.brand?.logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={s.brand.logo} alt="" width={20} height={20} className="rounded-[6px]" />
          )}
          <div className="min-w-0 truncate text-[11.5px] text-[var(--k-muted)]">
            {s.brand?.name} · <span className="k-mono">{s.brand?.url}</span>
          </div>
        </div>

        <nav className="mt-6 space-y-1">
          {NAV.map((n) => (
            <button
              key={n.key}
              onClick={() => setView(n.key)}
              className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[13.5px] font-semibold transition-colors ${
                view === n.key
                  ? "bg-[var(--k-ink)] text-white"
                  : "text-[var(--k-ink-soft)] hover:bg-black/[0.05]"
              }`}
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
                <path d={n.icon} />
              </svg>
              {n.label}
              {n.key === "campaign" && status === "pending_approval" && (
                <span className="ml-auto flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                  1
                </span>
              )}
            </button>
          ))}
          <button
            onClick={() => openWindow("agent")}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[13.5px] font-semibold text-[var(--k-ink-soft)] transition-colors hover:bg-black/[0.05]"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
              <path d="M4 4h16v12H8l-4 4z" />
            </svg>
            에이전트 채팅
            {s.agentTyping && <LiveDot color="#f59e0b" />}
          </button>
          <a
            href="/b/graph"
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[13.5px] font-semibold text-[var(--k-ink-soft)] transition-colors hover:bg-black/[0.05]"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
              <circle cx="5" cy="12" r="3" />
              <circle cx="19" cy="5" r="3" />
              <circle cx="19" cy="19" r="3" />
              <path d="M7.5 10.5 16.5 6M7.5 13.5l9 4.5" stroke="currentColor" strokeWidth="1.6" />
            </svg>
            그래프 뷰
            <span className="ml-auto rounded bg-black/[0.07] px-1 text-[9.5px] font-bold text-[var(--k-muted)]">β</span>
          </a>
        </nav>

        <div className="mt-auto space-y-2">
          <IdentityBlock variant="sidebar" />
          {/* 오토파일럿 */}
          <div className="rounded-xl border border-[var(--k-line)] px-3 py-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-bold">오토파일럿</span>
              <button
                onClick={() => {
                  if (s.autopilot) {
                    setAutopilot(false);
                    return;
                  }
                  if (!autopilotBusy) playSequence(autopilotSequence(s.brand));
                }}
                disabled={autopilotBusy}
                className={`relative h-5 w-9 rounded-full transition-colors disabled:opacity-40 ${
                  s.autopilot ? "bg-[var(--k-ink)]" : "bg-black/[0.15]"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                    s.autopilot ? "left-[18px]" : "left-0.5"
                  }`}
                />
              </button>
            </div>
            <div className="mt-1 text-[10.5px] leading-snug text-[var(--k-muted)]">
              {s.autopilot
                ? "한도 안에서 전권 위임 중"
                : "켜면 승인까지 에이전트가 대신해요"}
            </div>
          </div>
          <div className="flex items-center gap-2 px-2">
            <Yarn color={s.brand?.color ?? "#d9a441"} size={26} mood={s.agentTyping ? "think" : "idle"} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11.5px] font-bold">{s.brand?.agentName ?? "타래"}</div>
              <div className="flex items-center gap-1 text-[10px] text-[var(--k-muted)]">
                <LiveDot /> 가동 중
              </div>
            </div>
            <button
              onClick={resetDemo}
              title="데모 리셋"
              className="rounded-md px-1.5 py-1 text-[10.5px] text-[var(--k-muted)] hover:bg-black/[0.05] hover:text-[var(--k-ink)]"
            >
              ↺
            </button>
          </div>
        </div>
      </aside>

      {/* 본문 */}
      <main className="min-w-0 flex-1 px-5 py-5 lg:px-8 lg:py-7">
        <div className="mx-auto max-w-[980px]">
          {view === "home" && (
            <Home onGoCampaign={() => setView("campaign")} onOpenChat={() => openWindow("agent")} />
          )}
          {view === "campaign" && <Expedition onOpenLog={openWindow} />}
          {view === "deals" && <Deals />}
          {view === "performance" && <Performance />}
          {view === "brand" && <BrandPage />}
        </div>
      </main>

      <ChatDock windows={windows} onClose={closeWindow} />
    </div>
  );
}
