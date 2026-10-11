"use client";

/**
 * 크리에이터 창(/c) — 브랜드 창의 실시간 미러.
 * 씬님(@ssin)이 로그인해 두고 자리 비운 사이, 에이전트 루프가
 * 제안을 받고 협상하고 계약하고 돈을 받아오는 걸 지켜보는 화면.
 */

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { submitPost, useDemo } from "@/demo/engine/store";
import { creatorById, HERO_ID, HERO_RULES } from "@/demo/engine/script";
import type { InboundOffer, Mood } from "@/demo/engine/types";
import { Yarn, KnotTie, StarBurst, YarnMeter } from "@/demo/character/Yarn";
import { Badge, SectionLabel, LiveDot, usdc } from "@/demo/ui/primitives";
import { IdentityBlock } from "@/demo/auth/IdentityBlock";
import { RealChainCard } from "@/demo/real/RealChainCard";
import { A2ALog, Face, TxRow } from "@/demo/ui/bits";
import { useUsdcBalance, formatUsdc } from "@/demo/wallet/balance";
import { useKnotSession } from "@/demo/auth/session";

const hero = creatorById(HERO_ID);

const OFFER_BADGE: Record<InboundOffer["status"], { label: string; tone: "neutral" | "ok" | "warn" }> = {
  new: { label: "NEW", tone: "warn" },
  negotiating: { label: "협상 중", tone: "warn" },
  agreed: { label: "합의", tone: "ok" },
  declined: { label: "거절됨", tone: "neutral" },
};

/** 받은 오퍼함 — 무드빔 오퍼를 누르면 진행 중인 협상/계약 카드로 스크롤 */
function InboundOffers({ offers, onFocus }: { offers: InboundOffer[]; onFocus: (o: InboundOffer) => void }) {
  if (offers.length === 0) return null;
  return (
    <div className="k-card px-4 py-3.5">
      <SectionLabel>받은 오퍼</SectionLabel>
      <div className="mt-1.5 -mx-2 space-y-0.5">
        {offers.map((o) => (
          <button
            key={o.id}
            onClick={() => onFocus(o)}
            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-black/[0.03]"
          >
            {o.brandLogo.startsWith("/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={o.brandLogo} alt="" width={20} height={20} className="shrink-0 rounded-[6px]" />
            ) : (
              <span className="w-5 shrink-0 text-center text-[15px]">{o.brandLogo}</span>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-1.5">
                <span className="truncate text-[12.5px] font-bold">{o.brandName}</span>
                <span className="k-mono shrink-0 text-[11px] text-[var(--k-muted)]">{o.amountUsdc} USDC</span>
              </div>
              <div className="truncate text-[10.5px] text-[var(--k-muted)]">
                {o.format}
                {o.note ? ` · ${o.note}` : ""}
              </div>
            </div>
            <Badge tone={OFFER_BADGE[o.status].tone}>{OFFER_BADGE[o.status].label}</Badge>
          </button>
        ))}
      </div>
    </div>
  );
}

function useWalletDelta(value: number) {
  const prev = useRef(value);
  const [delta, setDelta] = useState<number | null>(null);
  useEffect(() => {
    const d = value - prev.current;
    prev.current = value;
    if (d > 0) {
      setDelta(d);
      const t = setTimeout(() => setDelta(null), 1800);
      return () => clearTimeout(t);
    }
  }, [value]);
  return delta;
}

export function CreatorApp() {
  const s = useDemo();
  const n = s.campaign?.negotiations[HERO_ID];
  const deal = s.campaign?.deals.find((d) => d.creatorId === HERO_ID);
  const status = s.campaign?.status;
  const walletDelta = useWalletDelta(s.creatorWalletUsdc);
  const session = useKnotSession();
  const { balance: realUsdc, delta: realDelta, failed: balanceFailed } = useUsdcBalance(session?.wallet);
  const logRef = useRef<HTMLDivElement>(null);
  const focusRef = useRef<HTMLDivElement>(null);
  const [postUrlInput, setPostUrlInput] = useState("");

  const focusOffer = (o: InboundOffer) => {
    if (o.id === "offer-moodbeam") focusRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [n?.messages.length]);

  const mood: Mood = !n || n.status === "queued"
    ? "sleep"
    : n.status === "contacting"
      ? "alert"
      : n.status === "talking"
        ? "talk"
        : deal && deal.starPct >= 100
          ? "happy"
          : n.status === "agreed"
            ? "happy"
            : "idle";

  return (
    <div className="flex min-h-screen flex-col">
      {/* 상단 바 */}
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-[var(--k-line)] bg-white/90 px-5 py-3 backdrop-blur">
        <span className="text-[17px] font-black tracking-tight">knot</span>
        <span className="rounded-md bg-black/[0.06] px-1.5 py-0.5 text-[10px] font-bold text-[var(--k-muted)]">
          CREATOR
        </span>
        <span className="flex items-center gap-1.5 text-[13px] font-bold">
          <Face src={hero.photo} color={hero.color} size={22} alt={hero.handle} />
          {hero.handle}
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-[var(--k-muted)]">
          <LiveDot /> 실시간 연결됨
        </span>
        <div className="ml-auto flex items-center gap-2">
          <IdentityBlock variant="header" />
        </div>
        <div className="relative flex items-center gap-2 rounded-xl border border-[var(--k-line)] bg-white px-3 py-1.5">
          {session?.wallet ? (
            <>
              <span className="text-[11px] font-bold text-[var(--k-muted)]">지갑 · devnet</span>
              <span className="k-mono text-[14px] font-bold">
                {realUsdc !== null
                  ? `${formatUsdc(realUsdc + Math.max(0, s.creatorWalletUsdc - 1240))} USDC`
                  : balanceFailed
                    ? "— (조회 실패)"
                    : "조회 중…"}
              </span>
              <AnimatePresence>
                {(realDelta || walletDelta) && (
                  <motion.span
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: -14 }}
                    exit={{ opacity: 0 }}
                    className="k-mono absolute -top-1 right-2 text-[12px] font-bold text-[var(--k-money)]"
                  >
                    +{formatUsdc((realDelta ?? 0) + (realDelta ? 0 : (walletDelta ?? 0)))}
                  </motion.span>
                )}
              </AnimatePresence>
            </>
          ) : (
            <>
              <span className="text-[11px] font-bold text-[var(--k-muted)]">정산 누적 · 시뮬레이션</span>
              <span className="k-mono text-[14px] font-bold">{usdc(s.creatorWalletUsdc)}</span>
              <AnimatePresence>
                {walletDelta && (
                  <motion.span
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: -14 }}
                    exit={{ opacity: 0 }}
                    className="k-mono absolute -top-1 right-2 text-[12px] font-bold text-[var(--k-money)]"
                  >
                    +{walletDelta}
                  </motion.span>
                )}
              </AnimatePresence>
            </>
          )}
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[880px] flex-1 flex-col gap-4 px-5 py-5 lg:flex-row">
        {/* 좌: 내 에이전트 + 규칙 */}
        <aside className="w-full shrink-0 space-y-3 lg:w-[250px]">
          <div className="k-card relative flex flex-col items-center px-4 py-5">
            <StarBurst trigger={s.burstSeq} />
            <Yarn color={hero.color} mood={mood} size={92} />
            <div className="mt-2 text-[15px] font-bold">{HERO_RULES.agentName}</div>
            <div className="flex items-center gap-1.5 text-[11.5px] text-[var(--k-muted)]">
              <Face src={hero.photo} color={hero.color} size={16} alt="" /> 씬님의 크리에이터 에이전트
            </div>
            <Badge className="mt-2" tone={mood === "sleep" ? "neutral" : mood === "alert" ? "warn" : "ok"}>
              {mood === "sleep"
                ? "😴 제안 대기 중"
                : mood === "alert"
                  ? "📡 브랜드 접근 감지!"
                  : n?.status === "talking"
                    ? "🤝 협상 중"
                    : deal
                      ? "🪢 계약 진행 중"
                      : "✅ 합의 완료"}
            </Badge>
          </div>

          <div className="k-card px-4 py-3.5">
            <SectionLabel>내가 정해둔 규칙</SectionLabel>
            <div className="mt-2 space-y-1.5 text-[12.5px] text-[var(--k-ink-soft)]">
              <div>
                · 최소 단가 <b className="k-mono text-[var(--k-ink)]">{HERO_RULES.minUsdc} USDC</b>
              </div>
              <div>· 일정 {HERO_RULES.weeklySlots}</div>
              <div>· 금지 카테고리: {HERO_RULES.blocked.join(" · ")}</div>
              <div>· {HERO_RULES.bonusAsk}</div>
            </div>
            <div className="mt-2.5 rounded-lg bg-black/[0.04] px-2.5 py-2 text-[11px] leading-snug text-[var(--k-muted)]">
              루프는 이 선 안에서만 움직여요. 선을 지키는 한, 잠든 사이에도 딜이 돼요.
            </div>
          </div>

          <InboundOffers offers={s.inboundOffers} onFocus={focusOffer} />
        </aside>

        {/* 우: 실황 */}
        <main className="min-w-0 flex-1 space-y-3">
          {/* 대기 */}
          {(!n || n.status === "queued") && (
            <div className="k-card flex flex-col items-center px-6 py-16 text-center">
              <motion.div
                animate={{ opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 3, repeat: Infinity }}
                className="text-[13px] text-[var(--k-muted)]"
              >
                루프가 브랜드 제안을 기다리고 있어요 · 네트워크에 프로필 공개 중
              </motion.div>
              <div className="mt-4 flex flex-wrap justify-center gap-x-6 gap-y-3 text-center">
                {[
                  ["팔로워", hero.followers],
                  ["참여율", hero.engagement],
                  ["평균 뷰", hero.insights.avgViews],
                  ["30일 성장", hero.insights.growth30d],
                  ["저장/30일", hero.insights.saves30d],
                ].map(([k, v]) => (
                  <div key={k}>
                    <div className="k-mono text-[18px] font-bold">{v}</div>
                    <div className="text-[11px] text-[var(--k-muted)]">{k}</div>
                  </div>
                ))}
              </div>
              <div className="k-mono mt-4 text-[11.5px] text-[var(--k-muted)]">{hero.profileUrl}</div>
            </div>
          )}

          {/* 접촉 + 협상 로그 */}
          {n && n.status !== "queued" && !deal && status !== "knotting" && (
            <>
              <motion.div
                ref={focusRef}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="k-card flex items-center gap-3 px-4 py-3"
              >
                <Yarn color={s.brand?.color ?? "#d9a441"} mood="talk" size={38} flip />
                <div className="flex-1">
                  <div className="text-[13.5px] font-bold">
                    {s.brand?.name ?? "무드빔"}의 에이전트 {s.brand?.agentName ?? "타래"}
                  </div>
                  <div className="text-[11.5px] text-[var(--k-muted)]">
                    A2A 채널로 협업 제안이 도착했어요
                  </div>
                </div>
                {n.status === "agreed" ? (
                  <Badge tone="ok">🪢 합의 — 브랜드 승인 대기</Badge>
                ) : (
                  <Badge tone="warn">협상 중</Badge>
                )}
              </motion.div>
              <div ref={logRef} className="k-card max-h-[420px] overflow-y-auto px-4 py-4">
                <A2ALog n={n} />
              </div>
              {n.status === "agreed" && (
                <div className="k-card flex items-center justify-between px-4 py-3">
                  <div className="text-[13px]">
                    합의 금액 <b className="k-mono">{usdc(n.agreedUsdc ?? 0)}</b> · 보너스 조항 포함 ·
                    마일스톤 30/70
                  </div>
                  <span className="text-[11.5px] text-[var(--k-muted)]">
                    브랜드가 승인하면 매듭이 묶여요
                  </span>
                </div>
              )}
            </>
          )}

          {/* 매듭 */}
          {status === "knotting" && (
            <div className="k-card flex flex-col items-center px-6 py-10">
              <div className="flex items-center gap-1">
                <Yarn color={hero.color} mood="happy" size={64} flip />
                <KnotTie leftColor={hero.color} rightColor={s.brand?.color ?? "#d9a441"} size={220} />
                <Yarn color={s.brand?.color ?? "#d9a441"} mood="happy" size={64} />
              </div>
              <div className="mt-2 text-[15px] font-bold">매듭이 묶이는 중 — 계약이 온체인에 고정돼요</div>
            </div>
          )}

          {/* 계약 진행 */}
          {deal && (
            <>
              <div ref={focusRef} className="k-card relative flex items-center gap-5 px-5 py-4">
                <StarBurst trigger={s.burstSeq} />
                <YarnMeter pct={deal.starPct} color={hero.color} size={86} />
                <div className="flex-1">
                  <div className="text-[15px] font-bold">
                    {s.brand?.name ?? "무드빔"} × {hero.handle}
                  </div>
                  <div className="k-mono text-[12px] text-[var(--k-muted)]">{deal.termsHash}</div>
                  <div className="mt-2 space-y-1">
                    {deal.milestones.map((m) => (
                      <div key={m.id} className="flex items-center gap-2 text-[12.5px]">
                        <span
                          className={
                            m.status === "released"
                              ? "text-emerald-600"
                              : m.status === "review"
                                ? "text-amber-600"
                                : "text-[var(--k-muted)]"
                          }
                        >
                          {m.status === "released" ? "✓" : m.status === "review" ? "◔" : "○"}
                        </span>
                        {m.label}
                        <span className="k-mono ml-auto text-[11.5px] text-[var(--k-muted)]">
                          {m.usdc} USDC
                        </span>
                      </div>
                    ))}
                    {deal.bonusUsdc && (
                      <div className="flex items-center gap-2 text-[12.5px] text-[var(--k-money)]">
                        <span>🎁</span> 성과 보너스 달성!
                        <span className="k-mono ml-auto text-[11.5px]">+{deal.bonusUsdc} USDC</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <RealChainCard role="creator" />

              {/* 게시물 제출 게이트 — 실제 URL을 내야 다음 스텝 */}
              {deal.awaitingPost && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="k-card border-amber-300 px-4 py-4"
                >
                  <div className="text-[13.5px] font-bold">🎬 릴스 업로드 완료했나요?</div>
                  <div className="mt-0.5 text-[12px] text-[var(--k-muted)]">
                    게시물 URL을 제출하면 검증 후 마일스톤 2 (280 USDC)가 릴리즈돼요. 제출 전엔
                    다음 스텝으로 넘어가지 않아요.
                  </div>
                  <div className="mt-3 flex gap-2">
                    <input
                      value={postUrlInput}
                      onChange={(e) => setPostUrlInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                        if (e.key === "Enter" && postUrlInput.trim()) submitPost(postUrlInput);
                      }}
                      placeholder="https://instagram.com/reel/…"
                      className="k-mono h-10 flex-1 rounded-xl border border-[var(--k-line-strong)] bg-white px-3 text-[13px] outline-none transition-colors focus:border-[var(--k-ink)]"
                    />
                    <button
                      onClick={() => postUrlInput.trim() && submitPost(postUrlInput)}
                      disabled={!postUrlInput.trim()}
                      className="h-10 rounded-xl bg-[var(--k-ink)] px-4 text-[13px] font-bold text-white transition-transform active:scale-95 disabled:opacity-40"
                    >
                      제출
                    </button>
                  </div>
                  {deal.verify && !deal.verify.every((c) => c.ok) && (
                    <div className="mt-3 space-y-1 rounded-lg bg-red-50 px-3 py-2.5">
                      {deal.verify.map((c) => (
                        <div
                          key={c.label}
                          className={`text-[12px] ${c.ok ? "text-emerald-700" : "text-red-600 font-semibold"}`}
                        >
                          {c.ok ? "✓" : "✗"} {c.label}
                        </div>
                      ))}
                      <div className="pt-0.5 text-[11px] text-red-500">
                        검증 실패 — URL을 확인하고 다시 제출해주세요
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
              {deal.verify && deal.verify.every((c) => c.ok) && !deal.awaitingPost && (
                <div className="k-card flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
                  {deal.verify.map((c) => (
                    <span key={c.label} className="text-[11.5px] text-emerald-700">
                      ✓ {c.label}
                    </span>
                  ))}
                </div>
              )}

              {/* 브리프 */}
              {s.campaign?.brief && (
                <div className="k-card px-4 py-3.5">
                  <SectionLabel>브랜드가 보낸 태스크 브리프</SectionLabel>
                  <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <div className="text-[12px] font-bold">✅ 지켜야 할 기준</div>
                      <ul className="mt-1 space-y-0.5 text-[12px] text-[var(--k-ink-soft)]">
                        {s.campaign.brief.criteria.map((x) => (
                          <li key={x}>· {x}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <div className="text-[12px] font-bold">🎞️ 레퍼런스 영상</div>
                      <ul className="mt-1 space-y-0.5 text-[12px] text-[var(--k-ink-soft)]">
                        {s.campaign.brief.references.map((r) => (
                          <li key={r.title} className="flex items-baseline gap-1">
                            <span className="truncate">▶ {r.title}</span>
                            <span className="k-mono shrink-0 text-[10.5px] text-[var(--k-muted)]">
                              {r.length} · {r.note}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              {/* 입금 내역 */}
              <div className="k-card px-4 py-3.5">
                <SectionLabel>정산 내역 (에스크로 자동 릴리즈)</SectionLabel>
                <div className="mt-1 divide-y divide-[var(--k-line)]">
                  {deal.txs.map((t) => (
                    <TxRow key={t.hash + t.label} label={t.label} hash={t.hash} />
                  ))}
                </div>
              </div>

              {deal.starPct >= 100 && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="k-card border-emerald-200 bg-emerald-50/60 px-5 py-4 text-center"
                >
                  <div className="text-[15px] font-bold text-emerald-800">
                    ⭐ 마일스톤 전체 달성 — {usdc(deal.amountUsdc + (deal.bonusUsdc ?? 0))} 정산 완료
                  </div>
                  <div className="mt-1 text-[12px] text-emerald-700">
                    씬님이 한 일: 릴스 1개. 루프가 한 일: 나머지 전부.
                  </div>
                </motion.div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
