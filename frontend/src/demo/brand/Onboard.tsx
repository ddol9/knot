"use client";

/** 브랜드 에이전트 탄생 — URL 하나로 시작하는 첫 wow 모먼트. */

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useDemo, startScan, hatchDone } from "@/demo/engine/store";
import { buildBrandProfile } from "@/demo/engine/script";
import { Yarn } from "@/demo/character/Yarn";
import { Button, SectionLabel, Badge } from "@/demo/ui/primitives";

/** 실데이터가 도착하기 전까지 돌아가는 상태 문구 — 목업 미리보기는 절대 안 보여준다 */
const SCAN_PHRASES = [
  "페이지 구조 분석 중…",
  "카피 톤 읽는 중…",
  "제품 정보 추출 중…",
  "타깃 오디언스 추정 중…",
  "브랜드 컬러 뽑는 중…",
];

function ScanCard({
  revealed,
  label,
  children,
}: {
  revealed: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={false}
      animate={{ opacity: 1 }}
      className="k-card overflow-hidden px-4 py-3"
    >
      <SectionLabel>{label}</SectionLabel>
      <div className="mt-1.5 min-h-[26px]">
        <AnimatePresence mode="wait">
          {revealed ? (
            <motion.div
              key="v"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-[14px] font-medium"
            >
              {children}
            </motion.div>
          ) : (
            <motion.div key="s" exit={{ opacity: 0 }} className="k-shimmer h-[20px] w-3/4 rounded-md" />
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

export function Onboard() {
  const s = useDemo();
  const [url, setUrl] = useState("");
  const [tick, setTick] = useState(0);
  const waiting = s.stage === "scanning" && !s.brand;
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => setTick((v) => v + 1), 1600);
    return () => clearInterval(t);
  }, [waiting]);

  /* ---------- 1. 인트로: URL 입력 ---------- */
  if (s.stage === "intro") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-6">
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center">
          <Yarn color="#a1a1aa" mood="sleep" size={120} />
          <h1 className="mt-6 text-center text-[28px] font-bold tracking-tight">
            브랜드 웹사이트만 알려주세요
          </h1>
          <p className="mt-2 max-w-md text-center text-[15px] leading-relaxed text-[var(--k-muted)]">
            에이전트가 사이트를 읽고 브랜드를 통째로 이해합니다.
            그다음부터는 대화만 하면 돼요.
          </p>
          <div className="mt-8 flex w-full max-w-md items-center gap-2">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                if (e.key === "Enter") startScan(url || "moodbeam.kr");
              }}
              placeholder="moodbeam.kr"
              className="h-12 flex-1 rounded-xl border border-[var(--k-line-strong)] bg-white px-4 text-[15px] outline-none transition-colors focus:border-[var(--k-ink)]"
            />
            <Button size="lg" onClick={() => startScan(url || "moodbeam.kr")}>
              에이전트 만들기
            </Button>
          </div>
          <div className="mt-4 text-[12px] text-[var(--k-muted)]">
            knot — 브랜드와 크리에이터를 잇는 에이전트 커머스
          </div>
        </motion.div>
      </div>
    );
  }

  /* ---------- 2. 스캔: 실데이터 도착 전엔 전부 shimmer, 도착하면 카드가 하나씩 켜짐 ---------- */
  const previewUrl = s.scan?.url || "moodbeam.kr";
  const p = s.brand ?? buildBrandProfile(previewUrl);
  const step = s.scan?.step ?? 0;
  const arrived = !!s.brand;

  if (s.stage === "scanning") {
    const phrase = arrived
      ? "추출 완료 — 브랜드 프로필 구성 중"
      : SCAN_PHRASES[(step + tick) % SCAN_PHRASES.length];
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-6">
        <div className="w-full max-w-lg">
          <div className="flex items-center gap-4">
            <Yarn color={s.brand?.color ?? "#a1a1aa"} mood="think" size={72} />
            <div>
              <div className="text-[18px] font-bold">
                <span className="k-mono">{p.url}</span> 읽는 중…
              </div>
              <AnimatePresence mode="wait">
                <motion.div
                  key={phrase}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="text-[13px] text-[var(--k-muted)]"
                >
                  {phrase}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
          <div className="mt-6 grid grid-cols-1 gap-2.5">
            <ScanCard revealed={arrived && step >= 1} label="브랜드">
              <span className="flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.logo} alt="" width={22} height={22} className="rounded-[6px]" />
                <span>
                  <b>{p.name}</b> — {p.tagline}
                </span>
              </span>
            </ScanCard>
            <ScanCard revealed={arrived && step >= 2} label="톤 & 무드">
              <span className="flex gap-1.5">
                {p.tone.map((t) => (
                  <Badge key={t}>{t}</Badge>
                ))}
              </span>
            </ScanCard>
            <ScanCard revealed={arrived && step >= 3} label="제품">
              {p.products.map((pr) => pr.name).join(" · ")}
            </ScanCard>
            <ScanCard revealed={arrived && step >= 4} label="타깃">
              {p.audience}
            </ScanCard>
            <ScanCard revealed={arrived && step >= 5} label="브랜드 컬러">
              <span className="flex items-center gap-2">
                <span className="h-5 w-5 rounded-md border border-black/10" style={{ background: p.color }} />
                <span className="k-mono text-[13px]">{p.color}</span>
              </span>
            </ScanCard>
          </div>
        </div>
      </div>
    );
  }

  /* ---------- 3. 부화: 에이전트 탄생 ---------- */
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6">
      <motion.div
        initial={{ scale: 0.3, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 180, damping: 14 }}
        className="flex flex-col items-center"
      >
        <Yarn color={p.color} mood="happy" size={132} />
        <h1 className="mt-5 text-[26px] font-bold tracking-tight">
          {p.agentName}가 태어났어요
        </h1>
        <p className="mt-2 max-w-sm text-center text-[14.5px] leading-relaxed text-[var(--k-muted)]">
          {p.name}의 톤과 제품을 전부 이해한 브랜드 에이전트예요.
          캠페인 기획부터 협상, 정산까지 — 한도 안에서 스스로 움직입니다.
        </p>
        <Button size="lg" className="mt-7" onClick={hatchDone}>
          워크스페이스 열기 →
        </Button>
      </motion.div>
    </div>
  );
}
