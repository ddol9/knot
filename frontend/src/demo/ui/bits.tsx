"use client";

/** 양쪽 창에서 같이 쓰는 데모 전용 조각들 — 별 게이지, A2A 로그, tx 행. */

import { useId, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { A2AMessage, Negotiation } from "@/demo/engine/types";
import { creatorById } from "@/demo/engine/script";
import { Yarn } from "@/demo/character/Yarn";
import { withBase } from "./asset";
import { Badge } from "./primitives";

/* --------------------------------- 아바타 --------------------------------- */

/** 크리에이터 프로필 사진 — 실 색 링으로 소속 표시. */
export function Face({
  src,
  color,
  size = 32,
  alt = "",
}: {
  src: string;
  color: string;
  size?: number;
  alt?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={withBase(src)}
      alt={alt}
      width={size}
      height={size}
      className="shrink-0 rounded-full object-cover"
      style={{ boxShadow: `0 0 0 2px #fff, 0 0 0 3.5px ${color}` }}
    />
  );
}

/** 프로필 사진 + 우하단에 그 사람의 에이전트(실타래) 배지. */
export function FaceWithAgent({
  src,
  color,
  size = 36,
  mood = "idle",
}: {
  src: string;
  color: string;
  size?: number;
  mood?: import("@/demo/engine/types").Mood;
}) {
  return (
    <div className="relative shrink-0" style={{ width: size + 8, height: size + 4 }}>
      <Face src={src} color={color} size={size} />
      <div className="absolute -bottom-1 -right-1">
        <Yarn color={color} size={Math.round(size * 0.52)} mood={mood} />
      </div>
    </div>
  );
}

/* -------------------------------- 별 게이지 -------------------------------- */

const STAR_PATH =
  "M50 6 L61 36 L94 38 L68 58 L77 90 L50 71 L23 90 L32 58 L6 38 L39 36 Z";

export function StarMeter({ pct, size = 72 }: { pct: number; size?: number }) {
  const clipId = useId();
  const fillY = 100 - pct;
  return (
    <div className="relative inline-flex flex-col items-center">
      <svg viewBox="0 0 100 100" width={size} height={size}>
        <defs>
          <clipPath id={clipId}>
            <path d={STAR_PATH} />
          </clipPath>
        </defs>
        <path d={STAR_PATH} fill="#f1f1f3" stroke="#d9d9de" strokeWidth="2" />
        <g clipPath={`url(#${clipId})`}>
          <motion.rect
            x="0"
            width="100"
            height="100"
            fill="#f5b301"
            initial={false}
            animate={{ y: fillY }}
            transition={{ type: "spring", stiffness: 60, damping: 16 }}
          />
        </g>
        <path d={STAR_PATH} fill="none" stroke="#18181b" strokeWidth="2.5" strokeLinejoin="round" />
      </svg>
      <div className="k-mono -mt-1 text-[12px] font-bold">{pct}%</div>
    </div>
  );
}

/* -------------------------------- A2A 로그 -------------------------------- */

function speakerMeta(m: A2AMessage, creatorId: string) {
  const c = creatorById(creatorId);
  if (m.from === "brand") return { name: "타래", sub: "브랜드 에이전트", color: "#d9a441", align: "left" as const };
  if (m.from === "creator") return { name: c.name, sub: `${c.handle} 에이전트`, color: c.color, align: "right" as const };
  return { name: "정책 엔진", sub: "사람이 정한 한도", color: "#dc2626", align: "center" as const };
}

export function A2ABubble({ m, creatorId }: { m: A2AMessage; creatorId: string }) {
  const [open, setOpen] = useState(false);
  const meta = speakerMeta(m, creatorId);

  if (meta.align === "center") {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        className="mx-auto my-1 max-w-[92%] rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-center"
      >
        <div className="text-[12px] font-bold text-red-600">🛡️ {m.text}</div>
        {m.reasoning && (
          <div className="mt-1 text-[11.5px] leading-snug text-red-500/90">{m.reasoning}</div>
        )}
      </motion.div>
    );
  }

  const right = meta.align === "right";
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex flex-col ${right ? "items-end" : "items-start"}`}
    >
      <div className={`mb-0.5 flex items-baseline gap-1.5 ${right ? "flex-row-reverse" : ""}`}>
        <span className="text-[12px] font-bold">{meta.name}</span>
        <span className="text-[10.5px] text-[var(--k-muted)]">{meta.sub}</span>
      </div>
      <div
        className={`max-w-[86%] rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed ${
          right
            ? "rounded-tr-sm bg-white ring-1 ring-[var(--k-line)]"
            : "rounded-tl-sm text-white"
        }`}
        style={right ? { borderLeft: `3px solid ${meta.color}` } : { background: "var(--k-ink)" }}
      >
        {m.text}
        {typeof m.amountUsdc === "number" && (
          <span
            className={`k-mono ml-1.5 rounded-md px-1.5 py-0.5 text-[11.5px] font-bold ${
              right ? "bg-black/[0.06]" : "bg-white/15"
            }`}
          >
            {m.amountUsdc.toLocaleString()} USDC
          </span>
        )}
      </div>
      {m.reasoning && (
        <button
          onClick={() => setOpen((v) => !v)}
          className={`mt-1 text-[11px] font-semibold text-[var(--k-muted)] hover:text-[var(--k-ink)] ${right ? "text-right" : ""}`}
        >
          {open ? "▾ 판단 근거" : "▸ 왜 이렇게 판단했나요?"}
        </button>
      )}
      <AnimatePresence>
        {open && m.reasoning && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className={`max-w-[86%] overflow-hidden ${right ? "self-end" : ""}`}
          >
            <div className="mt-1 rounded-lg bg-black/[0.045] px-3 py-2 text-[12px] leading-snug text-[var(--k-ink-soft)]">
              🧠 {m.reasoning}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function A2ALog({ n }: { n: Negotiation }) {
  return (
    <div className="flex flex-col gap-3">
      {n.messages.map((m) => (
        <A2ABubble key={m.id} m={m} creatorId={n.creatorId} />
      ))}
      {n.status === "contacting" && (
        <div className="text-[12px] text-[var(--k-muted)]">연결 중…</div>
      )}
    </div>
  );
}

export function negotiationBadge(n: Negotiation) {
  switch (n.status) {
    case "agreed":
      return (
        <Badge tone="ok">
          🪢 체결 <span className="k-mono">{n.agreedUsdc?.toLocaleString()}</span>
        </Badge>
      );
    case "blocked":
      return <Badge tone="danger">🛡️ 정책 차단</Badge>;
    case "talking":
      return <Badge tone="warn">협상 중</Badge>;
    case "contacting":
      return <Badge>연결 중</Badge>;
    default:
      return <Badge>대기</Badge>;
  }
}

/* --------------------------------- tx 행 --------------------------------- */

export function TxRow({ label, hash }: { label: string; hash: string }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <span className="text-[12.5px] text-[var(--k-ink-soft)]">{label}</span>
      <span className="k-mono shrink-0 rounded-md bg-black/[0.05] px-1.5 py-0.5 text-[11px] text-[var(--k-muted)]">
        {hash}
      </span>
    </div>
  );
}
