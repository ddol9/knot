"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { AuthGate } from "@/auth/AuthGate";
import { ProductApiClient, ProductApiError } from "@/product/apiClient";
import {
  APPROVAL_STATUSES,
  APPROVAL_STATUS_LABEL,
  type ApprovalDoc,
  type ApprovalEscrowSummary,
  type ApprovalStatus,
  approvalRejectReason,
  escrowReasonLabel,
  governanceReasonLabel,
} from "@/product/approvalTypes";
import { Pill } from "../campaign/components/DiscoveryTable";

/**
 * /brand/approvals — 거버넌스가 에스크로 락을 사람 뒤로 미룬 합의(승인 큐)를 사람이 승인/거절한다.
 * 합의와 예산 확정은 그대로이고 자금 잠금만 여기서 결정된다(docs/09 부록 5).
 */
export default function Page() {
  return (
    <AuthGate expectedRole="BRAND" requireCompleted>
      {() => (
        <Suspense fallback={null}>
          <ApprovalsPage />
        </Suspense>
      )}
    </AuthGate>
  );
}

/** 목록 요청 1건의 결과. `requestKey`가 현재 요청과 다르면 아직 불러오는 중이다. */
type ListResult = { requestKey: string; approvals: ApprovalDoc[]; error: string | null };

function ApprovalsPage() {
  const client = useMemo(() => new ProductApiClient(), []);
  const searchParams = useSearchParams();
  const focusId = searchParams.get("focus")?.trim() || null;
  const [status, setStatus] = useState<ApprovalStatus>("PENDING");
  const [reloadCount, setReloadCount] = useState(0);
  const [result, setResult] = useState<ListResult | null>(null);
  const [promotionTitles, setPromotionTitles] = useState<Record<string, string>>({});

  const requestKey = `${status}:${reloadCount}`;
  const loading = result?.requestKey !== requestKey;
  const approvals = result?.requestKey === requestKey ? result.approvals : [];
  const loadError = result?.requestKey === requestKey ? result.error : null;
  const refresh = useCallback(() => setReloadCount((count) => count + 1), []);

  useEffect(() => {
    let active = true;
    client
      .listApprovals(status)
      .then((list) => {
        if (!active) return;
        // 오래된 것부터 오므로 큐는 그대로, 이력은 최근 결정이 위로.
        setResult({ requestKey, approvals: status === "PENDING" ? list : [...list].reverse(), error: null });
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setResult({ requestKey, approvals: [], error: readableError(caught) });
      });
    return () => {
      active = false;
    };
  }, [client, requestKey, status]);

  // 프로모션 제목은 보조 정보라 실패해도 조용히 id만 보여준다.
  useEffect(() => {
    let active = true;
    client
      .listBrandPromotions()
      .then((promotions) => {
        if (!active) return;
        setPromotionTitles(Object.fromEntries(promotions.map((promotion) => [promotion.promotionId, promotion.title])));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [client]);

  function replace(updated: ApprovalDoc) {
    setResult((current) =>
      current
        ? {
            ...current,
            approvals: current.approvals.map((item) => (item.approvalId === updated.approvalId ? updated : item)),
          }
        : current,
    );
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-6 py-8">
      <section>
        <Link href="/brand" className="font-mono text-xs uppercase text-muted">
          brand
        </Link>
        <h1 className="mt-2 text-5xl">🙋 사람 승인 대기</h1>
        <p className="mt-2 max-w-3xl text-muted">
          에이전트는 한도 안에서만 스스로 예치합니다. 단건 또는 캠페인 누적 금액이 자동 승인 한도를 넘은 합의는 여기서
          사람이 결정합니다. 합의와 예산 확정은 이미 끝났고, 승인하면 같은 경로로 에스크로에 예치하고 거절하면 자금은
          잠기지 않습니다.
        </p>
      </section>

      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="승인 상태">
        {APPROVAL_STATUSES.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={status === item}
            onClick={() => setStatus(item)}
            className={`sketch-pill border px-3 py-1 text-xs ${
              status === item ? "border-foreground bg-surface-raised" : "border-border-subtle text-muted"
            }`}
          >
            {APPROVAL_STATUS_LABEL[item]}
          </button>
        ))}
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="sketch-pill ml-auto border border-border-subtle px-3 py-1 text-xs disabled:opacity-50"
        >
          {loading ? "불러오는 중…" : "새로고침"}
        </button>
      </div>

      {loadError ? (
        <div className="sketch-alt ink border border-negative bg-background p-4 text-sm text-negative">{loadError}</div>
      ) : null}

      {!loading && approvals.length === 0 && !loadError ? (
        <div className="sketch-alt ink border border-dashed border-border-subtle bg-background p-5">
          <p className="text-xl">{status === "PENDING" ? "기다리는 승인이 없습니다" : `${APPROVAL_STATUS_LABEL[status]} 이력이 없습니다`}</p>
          <p className="mt-2 text-sm text-muted">
            캠페인에서 한도를 넘는 합의가 생기면 여기에 쌓입니다. 한도는 백엔드 <code>KNOT_GOV_MAX_AUTO_*</code> 설정입니다.
          </p>
        </div>
      ) : null}

      <div className="grid gap-4">
        {approvals.map((approval) => (
          <ApprovalCard
            key={approval.approvalId}
            approval={approval}
            promotionTitle={promotionTitles[approval.promotionId]}
            focused={approval.approvalId === focusId}
            client={client}
            onChange={replace}
          />
        ))}
      </div>
    </div>
  );
}

function ApprovalCard({
  approval,
  promotionTitle,
  focused,
  client,
  onChange,
}: {
  approval: ApprovalDoc;
  promotionTitle?: string;
  focused: boolean;
  client: ProductApiClient;
  onChange: (updated: ApprovalDoc) => void;
}) {
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [escrow, setEscrow] = useState<ApprovalEscrowSummary | null>(approval.escrow ?? null);
  const pending = approval.status === "PENDING";

  async function approve() {
    setBusy("approve");
    setError(null);
    try {
      const response = await client.approveApproval(approval.approvalId);
      setEscrow(response.escrow ?? response.approval.escrow ?? null);
      onChange(response.approval);
    } catch (caught: unknown) {
      // 락 실패는 409로 오고 승인은 PENDING으로 남는다 — 다시 시도할 수 있다.
      setError(`승인이 반영되지 않았습니다: ${readableError(caught)}`);
    } finally {
      setBusy(null);
    }
  }

  async function reject() {
    const trimmed = reason.trim();
    if (!trimmed) {
      setError("거절 사유를 적어 주세요.");
      return;
    }
    setBusy("reject");
    setError(null);
    try {
      const updated = await client.rejectApproval(approval.approvalId, trimmed);
      onChange(updated);
      setRejecting(false);
    } catch (caught: unknown) {
      setError(`거절이 반영되지 않았습니다: ${readableError(caught)}`);
    } finally {
      setBusy(null);
    }
  }

  const statusTone = approval.status === "APPROVED" ? "positive" : approval.status === "REJECTED" ? "negative" : "caution";
  const rejectReason = approvalRejectReason(approval);

  return (
    <article
      id={approval.approvalId}
      className={`sketch ink border bg-surface p-5 ${focused ? "border-accent" : "border-border-subtle"}`}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted">
            {approval.type} · {approval.ruleVersion}
          </p>
          <p className="mt-1 text-3xl">{approval.amountUsdc.toLocaleString()} USDC</p>
          <p className="mt-1 text-sm text-muted">
            캠페인 누적 확정 {approval.campaignCommittedUsdc.toLocaleString()} USDC · 크리에이터 {approval.creatorId}
            <span className="font-mono text-[10px]"> ({approval.creatorAgentId})</span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 text-right">
          <Pill tone={statusTone}>{APPROVAL_STATUS_LABEL[approval.status] ?? approval.status}</Pill>
          <span className="font-mono text-[10px] text-muted">생성 {formatDateTime(approval.createdAt)}</span>
          {approval.decidedAt ? (
            <span className="font-mono text-[10px] text-muted">결정 {formatDateTime(approval.decidedAt)}</span>
          ) : null}
        </div>
      </header>

      <ul className="mt-3 list-disc pl-5 text-sm">
        {approval.reasons.map((code) => (
          <li key={code}>
            {governanceReasonLabel(code)} <span className="font-mono text-[10px] text-muted">{code}</span>
          </li>
        ))}
      </ul>

      <p className="mt-3 flex flex-wrap gap-3 break-all font-mono text-[10px] text-muted">
        <Link href={`/brand/promotions/${approval.promotionId}`} className="underline underline-offset-2">
          {promotionTitle ? `${promotionTitle} · ` : ""}
          {approval.promotionId}
        </Link>
        <Link href={`/brand/agreements/${approval.agreementId}`} className="underline underline-offset-2">
          합의서 {approval.agreementId}
        </Link>
        <span>campaign {approval.campaignId}</span>
        <span>{approval.approvalId}</span>
      </p>

      {pending ? (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={busy != null}
              onClick={() => void approve()}
              className="sketch-pill bg-accent px-4 py-2 text-background disabled:opacity-50"
            >
              {busy === "approve" ? "예치 중…" : "승인 · 에스크로 예치"}
            </button>
            {rejecting ? null : (
              <button
                type="button"
                disabled={busy != null}
                onClick={() => setRejecting(true)}
                className="sketch-pill border border-border-subtle px-4 py-2 disabled:opacity-50"
              >
                거절
              </button>
            )}
          </div>
          {rejecting ? (
            <div className="sketch-alt ink flex flex-col gap-2 border border-dashed border-border-subtle bg-background p-3">
              <label className="text-sm" htmlFor={`reject-${approval.approvalId}`}>
                거절 사유 (합의서에 남습니다)
              </label>
              <textarea
                id={`reject-${approval.approvalId}`}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={2}
                className="border border-border-subtle bg-surface px-3 py-2 text-sm"
                placeholder="예: 이번 분기 예산 초과 — 다음 캠페인으로 이월"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy != null}
                  onClick={() => void reject()}
                  className="sketch-pill border border-negative px-4 py-2 text-negative disabled:opacity-50"
                >
                  {busy === "reject" ? "거절 중…" : "거절 확정"}
                </button>
                <button
                  type="button"
                  disabled={busy != null}
                  onClick={() => {
                    setRejecting(false);
                    setError(null);
                  }}
                  className="sketch-pill border border-border-subtle px-4 py-2 text-xs"
                >
                  취소
                </button>
              </div>
            </div>
          ) : null}
          {approval.lastAttempt ? (
            <p className="text-xs text-caution">
              이전 승인 시도가 실패해 대기 상태로 남아 있습니다: {approval.lastAttempt.reason ?? approval.lastAttempt.status}
              {approval.lastAttempt.detail ? ` · ${approval.lastAttempt.detail}` : ""}
            </p>
          ) : null}
        </div>
      ) : null}

      {approval.status === "APPROVED" ? <EscrowSummary escrow={escrow} /> : null}
      {approval.status === "REJECTED" ? (
        <div className="sketch-alt mt-4 border border-dashed border-negative bg-background px-3 py-2 text-sm">
          <p className="font-semibold text-negative">거절됨 · 자금은 잠기지 않았습니다</p>
          <p className="mt-1 text-muted">{rejectReason ?? "사유 없음"}</p>
        </div>
      ) : null}

      {error ? <p className="mt-3 text-sm text-negative">{error}</p> : null}
    </article>
  );
}

function EscrowSummary({ escrow }: { escrow: ApprovalEscrowSummary | null }) {
  if (!escrow) {
    return (
      <div className="sketch-alt mt-4 border border-dashed border-border-subtle bg-background px-3 py-2 text-sm">
        <p className="font-semibold">승인됨</p>
        <p className="mt-1 text-muted">에스크로 요약이 없습니다.</p>
      </div>
    );
  }
  const locked = escrow.status === "LOCKED";
  const tone = locked ? "text-positive" : escrow.status === "FAILED" ? "text-negative" : "text-caution";
  return (
    <div className="sketch-alt mt-4 border border-dashed border-border-subtle bg-background px-3 py-2 text-sm">
      <p className={`font-semibold ${tone}`}>
        {locked ? "승인됨 · 에스크로 예치 완료" : `승인됨 · 에스크로 ${escrow.status}`}
      </p>
      {locked ? (
        <div className="mt-1 break-all font-mono text-[10px] text-muted">
          {escrow.escrowId ? <p>escrow {escrow.escrowId}</p> : null}
          {escrow.lockedAmountBaseUnits ? (
            <p>
              {baseUnitsToUsdc(escrow.lockedAmountBaseUnits)} USDC
              {escrow.network ? ` · ${escrow.network}` : ""}
            </p>
          ) : null}
          {escrow.signature ? <p>서명 {escrow.signature}</p> : null}
          {escrow.explorerUrl ? (
            <a href={escrow.explorerUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              Explorer
            </a>
          ) : null}
        </div>
      ) : (
        <p className="mt-1 text-muted">
          {escrowReasonLabel(escrow.reason) || "사유 없음"}
          {escrow.detail ? ` · ${escrow.detail}` : ""}
        </p>
      )}
    </div>
  );
}

function baseUnitsToUsdc(value: string) {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return value;
  return (raw / 1_000_000).toLocaleString();
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ko-KR", { hour12: false });
}

function readableError(caught: unknown) {
  if (caught instanceof ProductApiError) return caught.message;
  if (caught instanceof Error) return caught.message;
  return String(caught);
}
