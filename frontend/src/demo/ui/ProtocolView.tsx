"use client";

/**
 * A2A 프로토콜 인스펙터 — 협상 대사를 creator_agent(backend/apps/creator_agent)의
 * 실제 wire 포맷(HTTP+JSON 바인딩, POST /a2a/v1/message:send + task 응답)으로 보여준다.
 * 상단에는 /api/knot/a2a가 프록시한 agent-card.json 요약 + LIVE 배지.
 */

import { useEffect, useState } from "react";
import type { A2AMessage, Negotiation } from "@/demo/engine/types";
import { withBase } from "./asset";

type AgentCard = {
  name: string;
  description: string;
  version: string;
  supportedInterfaces: { url: string; protocolBinding: string; protocolVersion: string }[];
  skills: { id: string; name: string; tags: string[] }[];
};

type CardState = { live: boolean; card: AgentCard } | null;

let cardPromise: Promise<CardState> | null = null;

function fetchCard(): Promise<CardState> {
  cardPromise ??= fetch(withBase("/api/knot/a2a"))
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  return cardPromise;
}

/* ------------------------------ wire 프레임 빌드 ------------------------------ */

type WireFrame = {
  id: string;
  /** 요청/응답/정책 홀드 */
  kind: "request" | "response" | "policy";
  title: string;
  headers: string[];
  body: Record<string, unknown>;
};

function negotiationType(m: A2AMessage, i: number, n: Negotiation): string {
  if (n.status === "agreed" && i === n.messages.length - 1) return "ACCEPT";
  if (m.from === "brand" && i === 0) return "OFFER";
  return "COUNTER";
}

function buildParts(m: A2AMessage, i: number, n: Negotiation) {
  const parts: Record<string, unknown>[] = [{ mediaType: "text/plain", text: m.text }];
  if (typeof m.amountUsdc === "number") {
    parts.push({
      mediaType: "application/json",
      raw: {
        schema: "knot.negotiation.v1",
        type: negotiationType(m, i, n),
        round: Math.floor(i / 2) + 1,
        terms: { amountUsdc: m.amountUsdc, currency: "USDC" },
        rationale: m.reasoning ?? "",
      },
    });
  }
  return parts;
}

function buildFrames(n: Negotiation): WireFrame[] {
  const taskId = `task-${n.creatorId}`;
  const contextId = `ctx-${n.creatorId}`;
  const tenant = `creator-agent-${n.creatorId}`;
  return n.messages.map((m, i) => {
    const message = {
      messageId: m.id,
      contextId,
      taskId,
      role: m.from === "creator" ? "ROLE_AGENT" : "ROLE_USER",
      parts: buildParts(m, i, n),
    };
    if (m.from === "brand") {
      return {
        id: m.id,
        kind: "request" as const,
        title: "POST /a2a/v1/message:send",
        headers: ["A2A-Version: 1.0", "Content-Type: application/a2a+json"],
        body: {
          tenant,
          message,
          configuration: { acceptedOutputModes: ["application/json"] },
          metadata: {},
        },
      };
    }
    if (m.from === "policy") {
      return {
        id: m.id,
        kind: "policy" as const,
        title: "POLICY HOLD · 로컬 한도 가드",
        headers: [],
        body: {
          task: { id: taskId, contextId, status: { state: "TASK_STATE_INPUT_REQUIRED" } },
          policy: { decision: "hold", reason: m.text, detail: m.reasoning ?? null },
        },
      };
    }
    const state =
      n.status === "agreed" && i === n.messages.length - 1
        ? "TASK_STATE_COMPLETED"
        : "TASK_STATE_WORKING";
    return {
      id: m.id,
      kind: "response" as const,
      title: "200 OK · task",
      headers: ["Content-Type: application/a2a+json"],
      body: { task: { id: taskId, contextId, status: { state, message } } },
    };
  });
}

/* --------------------------------- 컴포넌트 --------------------------------- */

const KIND_META = {
  request: { label: "REQ", color: "#d9a441", dir: "브랜드 → 크리에이터 에이전트" },
  response: { label: "RES", color: "#4ade80", dir: "크리에이터 에이전트 → 브랜드" },
  policy: { label: "POL", color: "#f87171", dir: "정책 엔진 (로컬)" },
} as const;

function Frame({ f, defaultOpen }: { f: WireFrame; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const meta = KIND_META[f.kind];
  return (
    <div className="overflow-hidden rounded-lg border border-white/10">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 bg-white/[0.04] px-2.5 py-1.5 text-left hover:bg-white/[0.08]"
      >
        <span
          className="k-mono rounded px-1 py-0.5 text-[9.5px] font-bold"
          style={{ background: `${meta.color}22`, color: meta.color }}
        >
          {meta.label}
        </span>
        <span className="k-mono flex-1 truncate text-[11px] font-semibold text-zinc-200">
          {f.title}
        </span>
        <span className="text-[10px] text-zinc-500">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="border-t border-white/10 px-2.5 py-2">
          <div className="mb-1 text-[10px] text-zinc-500">{meta.dir}</div>
          {f.headers.map((h) => (
            <div key={h} className="k-mono text-[10.5px] leading-relaxed text-sky-300/80">
              {h}
            </div>
          ))}
          <pre className="k-mono mt-1 overflow-x-auto whitespace-pre text-[10.5px] leading-relaxed text-zinc-300">
            {JSON.stringify(f.body, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

export function ProtocolView({ n }: { n: Negotiation }) {
  const [cardState, setCardState] = useState<CardState>(null);
  useEffect(() => {
    let alive = true;
    fetchCard().then((c) => alive && setCardState(c));
    return () => {
      alive = false;
    };
  }, []);

  const frames = buildFrames(n);
  const card = cardState?.card;

  return (
    <div className="flex h-full flex-col bg-[#101014] text-zinc-200">
      <div className="border-b border-white/10 px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-[12px] font-bold">
            {card?.name ?? "KNOT Creator Negotiation Agent"}
          </span>
          {cardState &&
            (cardState.live ? (
              <span className="k-mono flex items-center gap-1 rounded-full bg-emerald-400/15 px-1.5 py-0.5 text-[9px] font-bold text-emerald-300">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                LIVE
              </span>
            ) : (
              <span className="k-mono rounded-full bg-white/10 px-1.5 py-0.5 text-[9px] font-bold text-zinc-400">
                STATIC
              </span>
            ))}
          <span className="k-mono ml-auto text-[10px] text-zinc-500">
            v{card?.version ?? "1.0.0"}
          </span>
        </div>
        {card && (
          <>
            <div className="k-mono mt-1 truncate text-[10px] text-zinc-500">
              {card.supportedInterfaces?.[0]?.url}
              {" · "}
              {card.supportedInterfaces?.[0]?.protocolBinding}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {card.skills?.flatMap((s) => s.tags).map((t) => (
                <span
                  key={t}
                  className="k-mono rounded bg-white/[0.07] px-1.5 py-0.5 text-[9.5px] text-zinc-400"
                >
                  {t}
                </span>
              ))}
            </div>
          </>
        )}
      </div>
      <div className="flex-1 space-y-1.5 overflow-y-auto px-2.5 py-2.5">
        {frames.length === 0 && (
          <div className="px-1 py-2 text-[11.5px] text-zinc-500">
            아직 교환된 A2A 메시지가 없습니다.
          </div>
        )}
        {frames.map((f, i) => (
          <Frame key={f.id} f={f} defaultOpen={i === frames.length - 1} />
        ))}
      </div>
    </div>
  );
}
