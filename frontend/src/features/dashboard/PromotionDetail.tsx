"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AgentCharacter } from "@/components/AgentCharacter";
import { Money } from "@/features/chat/Money";
import {
  type ApiAgreement,
  type ApiAgreementEscrowBundle,
  type ApiPromotion,
  type ApiTimelineEvent,
  type BrandPromotionDetail,
  ProductApiClient,
  ProductApiError,
} from "@/product/apiClient";

type PromotionDetailState = {
  detail: BrandPromotionDetail;
  escrowByAgreementId: Map<string, ApiAgreementEscrowBundle>;
};

export function BrandPromotionDetail({ promotionId }: { promotionId: string }) {
  const router = useRouter();
  const client = useMemo(() => new ProductApiClient(), []);
  const [state, setState] = useState<{
    loading: boolean;
    error: string | null;
    data: PromotionDetailState | null;
  }>({ loading: true, error: null, data: null });
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [waitingMessage, setWaitingMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const detail = await client.getBrandPromotionDetail(promotionId);
    const agreements = promotionAgreements(detail);
    const escrowEntries = await Promise.all(
      agreements.map(async (agreement) => {
        try {
          const bundle = await client.getAgreementEscrow(agreement.agreementId);
          return [agreement.agreementId, bundle] as const;
        } catch (caught) {
          if (caught instanceof ProductApiError && caught.status === 404) return null;
          throw caught;
        }
      }),
    );
    return {
      detail,
      escrowByAgreementId: new Map(escrowEntries.filter(Boolean) as Array<[string, ApiAgreementEscrowBundle]>),
    };
  }, [client, promotionId]);

  useEffect(() => {
    let active = true;
    load()
      .then((data) => {
        if (!active) return;
        setState({ loading: false, error: null, data });
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setState({ loading: false, error: readableError(caught), data: null });
      });
    return () => {
      active = false;
    };
  }, [load]);

  const refresh = useCallback(async () => {
    try {
      const data = await load();
      setState({ loading: false, error: null, data });
    } catch (caught) {
      setState({ loading: false, error: readableError(caught), data: null });
    }
  }, [load]);

  async function runPromotion() {
    setRunning(true);
    setRunError(null);
    setWaitingMessage(null);
    try {
      const flow = await client.runAgentForPromotion(promotionId);
      if (flow.negotiation) {
        router.push(`/brand/negotiations/${flow.negotiation.negotiationId}`);
        router.refresh();
        return;
      }
      setWaitingMessage("조건에 맞는 크리에이터가 아직 없습니다. 새 크리에이터가 들어오면 다시 탐색할 수 있습니다.");
      await refresh();
    } catch (caught) {
      setRunError(readableError(caught));
    } finally {
      setRunning(false);
    }
  }

  if (state.loading) {
    return <PanelMessage title="프로모션 상세 불러오는 중" body="협찬 프로젝트, 계약, 예치 상태를 조회하고 있습니다." />;
  }

  if (state.error || !state.data) {
    return <PanelMessage title="프로모션 상세를 불러오지 못했습니다" body={state.error ?? "다시 시도해주세요."} />;
  }

  const { detail, escrowByAgreementId } = state.data;
  const promotion = detail.promotion;
  const agreements = promotionAgreements(detail);
  const escrowSummary = summarizeEscrows(agreements, escrowByAgreementId);
  const primaryAgreement = agreements[0] ?? null;
  const latestEvent = detail.activity.at(-1) ?? null;

  return (
    <div className="flex flex-col gap-6 py-8">
      <section className="grid items-center gap-5 md:grid-cols-[1fr_auto]">
        <div>
          <Link href="/brand" className="font-mono text-xs uppercase text-muted">
            dashboard
          </Link>
          <h1 className="mt-2 text-5xl">{promotion.title}</h1>
          <p className="mt-2 max-w-3xl text-muted">{promotion.objective}</p>
          <p className="mt-2 break-all font-mono text-xs text-muted">{promotion.promotionId}</p>
        </div>
        <AgentCharacter
          agentId={promotion.brandAgentId}
          side="brand"
          category={promotion.category || "beauty"}
          pose="knock"
          size={140}
        />
      </section>

      <div className="grid gap-5 lg:grid-cols-3">
        <PromotionSummaryPanel promotion={promotion} />
        <AgentRunPanel
          promotion={promotion}
          activity={detail.activity}
          primaryAgreement={primaryAgreement}
          running={running}
          runError={runError}
          waitingMessage={waitingMessage}
          onRun={runPromotion}
        />
        <EscrowSummaryPanel
          agreementCount={agreements.length}
          escrowSummary={escrowSummary}
          primaryAgreement={primaryAgreement}
        />
      </div>

      <section className="sketch ink border border-border-subtle bg-surface p-5">
        <SectionHeader eyebrow="매니저 기록" title="체결된 협상과 상세보기" />
        {agreements.length ? (
          <div className="grid gap-3">
            {agreements.map((agreement) => (
              <AgreementRecord
                key={agreement.agreementId}
                agreement={agreement}
                escrowBundle={escrowByAgreementId.get(agreement.agreementId) ?? null}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title="아직 체결된 계약이 없습니다"
            body={
              latestEvent?.type === "MATCH_RUN_WAITING_FOR_CREATOR"
                ? "조건에 맞는 크리에이터가 들어오면 이 협찬 프로젝트에서 다시 탐색할 수 있습니다."
                : "매니저가 크리에이터를 선택하고 협상을 완료하면 이곳에 기록됩니다."
            }
          />
        )}
      </section>

      <section className="sketch-alt ink border border-border-subtle bg-surface-raised p-5">
      <SectionHeader eyebrow="진행 기록" title="실행 로그" />
        {detail.activity.length ? (
          <div className="grid gap-3">
            {detail.activity.map((event) => (
              <TimelineRow key={event.eventId} event={event} />
            ))}
          </div>
        ) : (
          <EmptyState title="아직 실행 로그가 없습니다" body="Promotion이 생성되면 Agent 실행 이벤트가 여기에 쌓입니다." />
        )}
      </section>
    </div>
  );
}

function PromotionSummaryPanel({ promotion }: { promotion: ApiPromotion & Record<string, unknown> }) {
  return (
    <section className="sketch ink border border-border-subtle bg-surface p-5">
      <SectionHeader eyebrow="Promotion" title="프로모션 조건" />
      <div className="grid gap-3">
        <Metric label="제품/프로모션" value={String(promotion.productName ?? promotion.title)} />
        <Metric label="카테고리" value={promotion.category || "미설정"} />
        <Metric label="작업" value={deliverableSummary(promotion.deliverables)} />
        <Metric label="사용권" value={promotion.usageRights} />
        <Metric label="마감" value={promotion.postingWindow.end} />
      </div>
    </section>
  );
}

function AgentRunPanel({
  promotion,
  activity,
  primaryAgreement,
  running,
  runError,
  waitingMessage,
  onRun,
}: {
  promotion: ApiPromotion & Record<string, unknown>;
  activity: ApiTimelineEvent[];
  primaryAgreement: ApiAgreement | null;
  running: boolean;
  runError: string | null;
  waitingMessage: string | null;
  onRun: () => void;
}) {
  const latest = activity.at(-1);
  return (
    <section className="sketch ink border border-border-subtle bg-surface p-5">
      <SectionHeader eyebrow="매니저 관리" title="실행 상태" />
      <div className="grid gap-3">
        <Metric label="브랜드 매니저" value={promotion.brandAgentId} />
        <Metric label="프로젝트 상태" value={promotionStatusLabel(promotion.status)} />
        <Metric label="마지막 이벤트" value={latest ? eventLabel(latest) : "실행 전"} />
        <Metric label="딜당 한도" value={`${promotion.budget.maxPerCreatorUsdc.toLocaleString()} USDC`} />
        <Metric label="총 예산" value={`${promotion.budget.totalUsdc.toLocaleString()} USDC`} />
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        {primaryAgreement ? (
          <Link href={`/brand/agreements/${primaryAgreement.agreementId}`} className="sketch-pill bg-accent px-4 py-2 text-background">
            협상 상세보기
          </Link>
        ) : (
          <button
            type="button"
            onClick={onRun}
            disabled={running}
            className="sketch-pill bg-accent px-4 py-2 text-background disabled:opacity-50"
          >
            {running ? "크리에이터 탐색 중…" : "크리에이터 탐색·협상 시작"}
          </button>
        )}
        <Link
          href={`/brand/campaign?promotionId=${encodeURIComponent(promotion.promotionId)}`}
          className="sketch-pill border border-border-subtle px-4 py-2"
        >
          여러 크리에이터와 동시 협상
        </Link>
      </div>
      {waitingMessage ? <p className="mt-3 text-sm text-muted">{waitingMessage}</p> : null}
      {runError ? <p className="mt-3 text-sm text-negative">{runError}</p> : null}
    </section>
  );
}

function EscrowSummaryPanel({
  agreementCount,
  escrowSummary,
  primaryAgreement,
}: {
  agreementCount: number;
  escrowSummary: ReturnType<typeof summarizeEscrows>;
  primaryAgreement: ApiAgreement | null;
}) {
  return (
    <section className="sketch ink border border-border-subtle bg-surface p-5">
      <SectionHeader eyebrow="정산" title="에스크로 요약" />
      <div className="grid gap-3">
        <Metric label="계약" value={`${agreementCount}건`} />
        <Metric label="계약 금액" value={primaryAgreement ? `${primaryAgreement.terms.compensation.baseAmountUsdc.toLocaleString()} USDC` : "계약 전"} />
        <Metric label="예치 총액" value={baseUnitsToUsdcLabel(escrowSummary.totalBaseUnits)} />
        <Metric label="지급 완료" value={baseUnitsToUsdcLabel(escrowSummary.releasedBaseUnits)} />
        <Metric label="예치 잔액" value={baseUnitsToUsdcLabel(escrowSummary.remainingBaseUnits)} />
        <Metric label="상태" value={escrowSummary.statusLabel} />
      </div>
      {primaryAgreement ? (
        <Link
          href={`/brand/agreements/${primaryAgreement.agreementId}`}
          className="sketch-pill mt-4 inline-flex border border-border-subtle px-4 py-2"
        >
          예치/정산 상세보기
        </Link>
      ) : null}
    </section>
  );
}

function AgreementRecord({
  agreement,
  escrowBundle,
}: {
  agreement: ApiAgreement & Record<string, unknown>;
  escrowBundle: ApiAgreementEscrowBundle | null;
}) {
  const escrow = escrowBundle?.escrow ?? null;
  const latestSettlement = escrowBundle?.settlements.at(-1) ?? null;
  return (
    <Link
      href={`/brand/agreements/${agreement.agreementId}`}
      className="sketch-alt ink grid gap-3 border border-border-subtle bg-surface-raised p-4 lg:grid-cols-[1fr_auto]"
    >
      <span className="min-w-0">
        <span className="block text-xl">{agreement.creatorDisplayName ?? agreement.creatorAgentId}</span>
        <span className="mt-1 block text-sm text-muted">
          {agreement.productName ?? agreement.promotionTitle ?? "프로모션"} · {deliverableSummary(agreement.terms.deliverables)}
        </span>
        <span className="mt-2 block break-all font-mono text-xs text-muted">{agreement.agreementId}</span>
      </span>
      <span className="grid gap-2 text-right">
        <Money usdc={agreement.terms.compensation.baseAmountUsdc} />
        <span className="font-mono text-xs text-muted">
          {agreementMoneyStateLabel(agreement, escrow, latestSettlement)}
        </span>
        <span className="font-mono text-xs text-muted">
          정산 {baseUnitsToUsdcLabel(escrow?.releasedAmountBaseUnits)} · 영수증 {latestSettlement?.signature ? "있음" : "없음"}
        </span>
      </span>
    </Link>
  );
}

function TimelineRow({ event }: { event: ApiTimelineEvent }) {
  return (
    <div className="sketch-alt ink flex flex-wrap items-center justify-between gap-3 border border-border-subtle bg-background p-3">
      <span>
        <span className="block text-sm font-semibold">{eventLabel(event)}</span>
        <span className="font-mono text-xs text-muted">{event.type}</span>
      </span>
      <span className="font-mono text-xs text-muted">{formatTime(event.createdAt)}</span>
    </div>
  );
}

function SectionHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="mb-4">
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted">{eyebrow}</p>
      <h2 className="mt-1 text-3xl">{title}</h2>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="sketch-alt ink border border-border-subtle bg-background p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 break-all font-mono text-sm">{value}</p>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="sketch-alt ink border border-dashed border-border-subtle bg-background p-5">
      <p className="text-xl">{title}</p>
      <p className="mt-2 text-sm text-muted">{body}</p>
    </div>
  );
}

function PanelMessage({ title, body }: { title: string; body: string }) {
  return (
    <div className="sketch ink border border-border-subtle bg-surface p-5">
      <p className="text-2xl">{title}</p>
      <p className="mt-2 text-sm text-muted">{body}</p>
    </div>
  );
}

function promotionAgreements(detail: BrandPromotionDetail) {
  return detail.agreements ?? (detail.agreement ? [detail.agreement] : []);
}

function summarizeEscrows(
  agreements: Array<ApiAgreement & Record<string, unknown>>,
  escrowByAgreementId: Map<string, ApiAgreementEscrowBundle>,
) {
  let total = BigInt(0);
  let released = BigInt(0);
  let created = 0;
  let funded = 0;

  for (const agreement of agreements) {
    const escrow = escrowByAgreementId.get(agreement.agreementId)?.escrow;
    if (!escrow) continue;
    created += 1;
    if (["FUNDED", "PARTIALLY_RELEASED", "RELEASED"].includes(escrow.status)) funded += 1;
    total += safeBigInt(escrow.lockedAmountBaseUnits);
    released += safeBigInt(escrow.releasedAmountBaseUnits);
  }

  const remaining = total - released;
  return {
    totalBaseUnits: total.toString(),
    releasedBaseUnits: released.toString(),
    remainingBaseUnits: remaining.toString(),
    statusLabel: created === 0 ? "예치 전" : `${funded}/${created}건 예치 완료`,
  };
}

function eventLabel(event: ApiTimelineEvent) {
  if (event.type === "MATCH_RUN_WAITING_FOR_CREATOR") return "크리에이터 대기 중";
  if (event.type === "MATCH_RUN_COMPLETED") return "크리에이터 선택 완료";
  if (event.type === "NEGOTIATION_ACCEPT") return "협상 체결";
  if (event.type === "ESCROW_FUNDED" || event.type === "ESCROW_LOCKED") return "에스크로 예치";
  if (event.type === "API_PAYMENT") return "pay.sh 검증";
  return event.type;
}

function agreementMoneyStateLabel(
  agreement: ApiAgreement,
  escrow: ApiAgreementEscrowBundle["escrow"],
  latestSettlement: ApiAgreementEscrowBundle["settlements"][number] | null | undefined,
) {
  if (escrow?.status === "RELEASED") return "정산 완료";
  if (escrow?.status === "PARTIALLY_RELEASED") return "일부 정산 완료";
  if (latestSettlement?.signature) return `정산 기록 확인 가능 · ${agreementStatusLabel(agreement.status)}`;
  if (escrow?.status === "FUNDED" || escrow?.status === "LOCKED") return `예치 완료 · ${agreementStatusLabel(agreement.status)}`;
  if (escrow?.status) return `${escrowStatusLabel(escrow.status)} · ${agreementStatusLabel(agreement.status)}`;
  return `${agreementStatusLabel(agreement.status)} · 예치 전`;
}

function promotionStatusLabel(status: string) {
  const normalized = status.toUpperCase();
  if (normalized === "DRAFT") return "작성 중";
  if (normalized === "ACTIVE") return "진행 중";
  if (normalized === "AGREED") return "계약 완료";
  if (normalized === "PAUSED") return "일시 중지";
  if (normalized === "CLOSED") return "종료";
  return status;
}

function agreementStatusLabel(status: string) {
  const normalized = status.toUpperCase();
  if (normalized === "FUNDING_REQUIRED") return "예치 필요";
  if (normalized === "FUNDED") return "예치 완료";
  if (normalized === "PARTIALLY_RELEASED") return "일부 정산 완료";
  if (normalized === "RELEASED") return "정산 완료";
  if (normalized === "AGREED") return "합의 완료";
  if (normalized === "CANCELLED") return "취소됨";
  return status;
}

function escrowStatusLabel(status: string) {
  const normalized = status.toUpperCase();
  if (normalized === "CREATED") return "예치 준비 중";
  if (normalized === "LOCKED" || normalized === "FUNDED") return "예치 완료";
  if (normalized === "PARTIALLY_RELEASED") return "일부 정산 완료";
  if (normalized === "RELEASED") return "정산 완료";
  if (normalized === "REFUNDED") return "환불 완료";
  return status;
}

function deliverableSummary(deliverables: Array<{ format: string; count: number }> | undefined) {
  if (!deliverables?.length) return "작업 조건 미정";
  const summary = deliverables
    .filter((deliverable) => deliverable.count > 0)
    .map((deliverable) => `${formatDeliverable(deliverable.format)} ${deliverable.count}개`)
    .join(", ");
  return summary || "작업 조건 미정";
}

function formatDeliverable(format: string) {
  const labels: Record<string, string> = {
    reel: "릴스",
    short: "숏츠",
    post: "게시글",
    story: "스토리",
  };
  return labels[format] ?? format;
}

function baseUnitsToUsdcLabel(value: string | undefined) {
  if (!value) return "-";
  const raw = Number(value);
  if (!Number.isFinite(raw)) return value;
  return `${(raw / 1_000_000).toLocaleString()} USDC`;
}

function safeBigInt(value: string | undefined) {
  if (!value) return BigInt(0);
  try {
    return BigInt(value);
  } catch {
    return BigInt(0);
  }
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function readableError(caught: unknown) {
  if (caught instanceof ProductApiError) return caught.message;
  if (caught instanceof Error) return caught.message;
  return String(caught);
}
