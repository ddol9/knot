"use client";

import type { DiscoveryCandidate, DiscoveryReport } from "@/product/campaignTypes";

/** backend/libs/agents/matching.py `hard_filter_creator` 사유 코드. */
const HARD_FILTER_LABEL: Record<string, string> = {
  CREATOR_INACTIVE: "비활성 크리에이터",
  CATEGORY_MISMATCH: "카테고리 불일치",
  PROHIBITED_INDUSTRY: "거절 업종",
  RATE_EXCEEDS_MAX_PER_CREATOR: "금액 초과",
  SCHEDULE_UNAVAILABLE: "일정 불가",
  DELIVERABLE_FORMAT_UNSUPPORTED: "콘텐츠 형식 불가",
  USAGE_RIGHTS_UNSUPPORTED: "사용권 불일치",
  CAPACITY_UNAVAILABLE: "여력 없음",
};

function reasonLabel(reason: string) {
  return HARD_FILTER_LABEL[reason] ?? reason;
}

function statusPill(candidate: DiscoveryCandidate) {
  if (candidate.selected) return <Pill tone="positive">선정 · card UP</Pill>;
  if (!candidate.eligible) {
    return <Pill tone="negative">{candidate.hardFilterReasons.map(reasonLabel).join(", ") || "조건 불일치"}</Pill>;
  }
  if (candidate.cardStatus === "DOWN") {
    return (
      <span className="inline-flex flex-col gap-1">
        <Pill tone="negative">card DOWN</Pill>
        {candidate.cardError ? <span className="font-mono text-[10px] text-muted">{candidate.cardError}</span> : null}
      </span>
    );
  }
  if (candidate.cardStatus === "NO_SKILL") return <Pill tone="negative">협상 스킬 없음</Pill>;
  return <Pill tone="caution">후보 수 초과로 미선정</Pill>;
}

function healthLabel(candidate: DiscoveryCandidate) {
  const status = candidate.healthStatus ?? "UNKNOWN";
  const tone = status === "UP" ? "positive" : status === "DOWN" ? "negative" : "muted";
  const text = status === "UP" ? "살아있음" : status === "DOWN" ? "응답 없음" : "미확인";
  return <Pill tone={tone}>{text}</Pill>;
}

function trackRecordLabel(candidate: DiscoveryCandidate) {
  const record = candidate.trackRecord;
  if (!record || !record.attempts) return "이력 없음";
  return `${record.agreements}/${record.attempts} 합의 (${Math.round(record.agreementRate * 100)}%)`;
}

export function DiscoveryTable({ report, loading }: { report: DiscoveryReport | null; loading: boolean }) {
  return (
    <section className="sketch-alt ink border border-border-subtle bg-surface p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Discovery</p>
          <h2 className="mt-1 text-3xl">탐색 결과</h2>
        </div>
        {report ? (
          <span className="font-mono text-xs text-muted">
            조회 {report.queried} · 순위 {report.ranked} · 확인 {report.probed}
          </span>
        ) : null}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="border-b border-border-subtle px-2 py-1.5 font-normal">#</th>
              <th className="border-b border-border-subtle px-2 py-1.5 font-normal">에이전트</th>
              <th className="border-b border-border-subtle px-2 py-1.5 font-normal">카테고리</th>
              <th className="border-b border-border-subtle px-2 py-1.5 font-normal">공개 금액대</th>
              <th className="border-b border-border-subtle px-2 py-1.5 font-normal">점수</th>
              <th className="border-b border-border-subtle px-2 py-1.5 font-normal">생존 · 이력</th>
              <th className="border-b border-border-subtle px-2 py-1.5 font-normal">상태</th>
            </tr>
          </thead>
          <tbody>
            {!report ? (
              <tr>
                <td colSpan={7} className="px-2 py-4 text-sm text-muted">
                  {loading ? "크리에이터 에이전트를 탐색하고 있습니다…" : "캠페인을 시작하면 후보와 탈락 사유가 여기에 표시됩니다."}
                </td>
              </tr>
            ) : report.candidates.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-2 py-4 text-sm text-muted">
                  조건에 맞는 공개 프로필이 없습니다.
                </td>
              </tr>
            ) : (
              report.candidates.map((candidate) => (
                <tr key={candidate.creatorAgentId} className="align-top">
                  <td className="border-b border-border-subtle px-2 py-2 font-mono text-xs">{candidate.rank ?? "–"}</td>
                  <td className="border-b border-border-subtle px-2 py-2">
                    <span className="block">{candidate.displayName}</span>
                    <span className="block break-all font-mono text-[10px] text-muted">{candidate.creatorAgentId}</span>
                    {candidate.baseUrl ? (
                      <span className="block break-all font-mono text-[10px] text-muted">{candidate.baseUrl}</span>
                    ) : null}
                  </td>
                  <td className="border-b border-border-subtle px-2 py-2 text-xs">{candidate.categories.join(", ") || "–"}</td>
                  <td className="border-b border-border-subtle px-2 py-2 font-mono text-xs">{candidate.publicRateBand ?? "–"}</td>
                  <td className="border-b border-border-subtle px-2 py-2 font-mono text-xs">
                    {candidate.score != null ? candidate.score.toFixed(3) : "–"}
                    {candidate.rankScore != null && candidate.rankScore !== candidate.score ? (
                      <span className="block text-[10px] text-muted">순위 {candidate.rankScore.toFixed(3)}</span>
                    ) : null}
                  </td>
                  <td className="border-b border-border-subtle px-2 py-2 text-xs">
                    <span className="flex flex-col gap-1">
                      <span>
                        {healthLabel(candidate)}
                        {candidate.lastSeenAt ? (
                          <span className="ml-1 font-mono text-[10px] text-muted">{formatSeen(candidate.lastSeenAt)}</span>
                        ) : null}
                      </span>
                      <span className="font-mono text-[10px] text-muted">{trackRecordLabel(candidate)}</span>
                    </span>
                  </td>
                  <td className="border-b border-border-subtle px-2 py-2 text-xs">{statusPill(candidate)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function formatSeen(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

export function Pill({
  tone,
  children,
}: {
  tone: "positive" | "negative" | "caution" | "muted" | "accent";
  children: React.ReactNode;
}) {
  const toneClass =
    tone === "positive"
      ? "border-positive text-positive"
      : tone === "negative"
        ? "border-negative text-negative"
        : tone === "caution"
          ? "border-caution text-caution"
          : tone === "accent"
            ? "border-accent bg-accent text-background"
            : "border-border-subtle text-muted";
  return (
    <span className={`sketch-pill inline-block border px-2 py-0.5 text-[11px] font-semibold ${toneClass}`}>{children}</span>
  );
}
