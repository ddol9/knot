"use client";

import Link from "next/link";
import type { CampaignResult } from "@/product/campaignTypes";
import { CAMPAIGN_OUTCOME_LABEL, NEGOTIATION_OUTCOME_LABEL, SKIP_REASON_LABEL } from "../useCampaignStream";
import { Pill } from "./DiscoveryTable";

const ESCROW_STATUS_LABEL: Record<string, string> = {
  LOCKED: "예치 완료",
  SKIPPED: "보류",
  FAILED: "실패",
  PENDING_APPROVAL: "🙋 사람 승인 대기",
};

export function CampaignResultBanner({ result, promotionId }: { result: CampaignResult; promotionId: string }) {
  const tone =
    result.outcome === "TARGET_REACHED"
      ? "positive"
      : result.outcome === "PARTIAL" || (result.outcome === "CANCELED" && result.agreedCount > 0)
        ? "caution"
        : "negative";
  const hasPendingApproval = result.negotiations.some((negotiation) => negotiation.escrow?.status === "PENDING_APPROVAL");
  return (
    <section className="sketch ink border border-border-subtle bg-surface-raised p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Result</p>
          <h2 className="mt-1 text-3xl">
            캠페인 종료 · <Pill tone={tone}>{CAMPAIGN_OUTCOME_LABEL[result.outcome] ?? result.outcome}</Pill>
          </h2>
        </div>
        <p className="font-mono text-sm">
          합의 {result.agreedCount}/{result.targetCreatorCount}명 · 확정 {result.committedUsdc.toLocaleString()}/
          {result.totalBudgetUsdc.toLocaleString()} USDC
        </p>
      </div>
      <p className="mt-2 break-all font-mono text-[10px] text-muted">
        campaignId {result.campaignId}
        {result.matchRunId ? ` · matchRunId ${result.matchRunId}` : ""}
      </p>

      <div className="mt-4 grid gap-2">
        {result.negotiations.map((negotiation) => {
          const outcome = negotiation.result?.outcome;
          return (
            <div
              key={negotiation.creatorAgentId}
              className="sketch-alt ink flex flex-wrap items-center justify-between gap-2 border border-border-subtle bg-background p-3"
            >
              <span className="min-w-0">
                <span className="block">{negotiation.displayName}</span>
                <span className="block font-mono text-[10px] text-muted">
                  {outcome
                    ? NEGOTIATION_OUTCOME_LABEL[outcome] ?? outcome
                    : negotiation.status === "SKIPPED"
                      ? (SKIP_REASON_LABEL as Record<string, string>)[negotiation.skipReason ?? ""] ??
                        `시작 안 함 · ${negotiation.skipReason ?? ""}`
                      : negotiation.status}
                  {negotiation.escrow
                    ? ` · 에스크로 ${ESCROW_STATUS_LABEL[negotiation.escrow.status] ?? negotiation.escrow.status}`
                    : ""}
                </span>
              </span>
              <span className="flex items-center gap-3 font-mono text-sm">
                {negotiation.committedUsdc ? `${negotiation.committedUsdc.toLocaleString()} USDC` : "–"}
                {negotiation.agreementId ? (
                  <Link
                    href={`/brand/agreements/${negotiation.agreementId}`}
                    className="sketch-pill border border-border-subtle px-3 py-1 text-xs"
                  >
                    합의서 보기
                  </Link>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <Link href={`/brand/promotions/${promotionId}`} className="sketch-pill bg-accent px-4 py-2 text-background">
          프로모션 상세로
        </Link>
        {hasPendingApproval ? (
          <Link href="/brand/approvals" className="sketch-pill border border-border-subtle px-4 py-2">
            🙋 승인 큐에서 결정
          </Link>
        ) : null}
        {result.agreementIds.length === 0 ? (
          <span className="self-center text-sm text-muted">체결된 합의서가 없습니다.</span>
        ) : null}
      </div>
    </section>
  );
}
