/**
 * 거버넌스 승인 큐(`approvals/{approvalId}`) API 타입.
 *
 * - `GET  /api/v1/approvals?status=PENDING|APPROVED|REJECTED`
 * - `GET  /api/v1/approvals/{approvalId}`
 * - `POST /api/v1/approvals/{approvalId}:approve` / `:reject`
 *
 * 백엔드 `libs/agents/brand_campaign.py::_queue_approval` 와 `apps/api/routes.py::_decide_approval` 의 문서와 1:1.
 * 규칙 설명은 docs/09 부록 5.
 */

import type { CampaignEscrowSummary } from "./campaignTypes";

export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED";

export const APPROVAL_STATUSES: readonly ApprovalStatus[] = ["PENDING", "APPROVED", "REJECTED"];

/** `libs/policies/governance.py` 규칙 id. */
export type GovernanceReasonCode =
  | "GOV_SINGLE_AGREEMENT_OVER_AUTO_LIMIT"
  | "GOV_CAMPAIGN_TOTAL_OVER_AUTO_LIMIT"
  | "GOV_PROMOTION_AUTO_ESCROW_DISABLED";

/** 승인 뒤 에스크로 요약. LOCKED(서명·explorer) / SKIPPED(reason) / FAILED(reason·detail). */
export type ApprovalEscrowSummary = CampaignEscrowSummary;

export type ApprovalDoc = {
  approvalId: string;
  type: "ESCROW_LOCK" | string;
  status: ApprovalStatus;
  promotionId: string;
  campaignId: string;
  matchRunId?: string | null;
  agreementId: string;
  creatorAgentId: string;
  creatorId: string;
  amountUsdc: number;
  campaignCommittedUsdc: number;
  reasons: string[];
  ruleVersion: string;
  createdAt: string;
  updatedAt?: string;
  decidedAt?: string | null;
  escrow?: ApprovalEscrowSummary | null;
  /** 거절 사유 (`:reject` body의 reason). 백엔드는 `reason`으로 저장한다. */
  reason?: string | null;
  rejectReason?: string | null;
  /** 승인 시도가 락 실패로 끝났을 때 마지막 시도 (PENDING 유지). */
  lastAttempt?: (ApprovalEscrowSummary & { at?: string }) | null;
};

export type ApprovalListResponse = { approvals: ApprovalDoc[] };
export type ApprovalResponse = { approval: ApprovalDoc };
export type ApproveApprovalResponse = { approval: ApprovalDoc; escrow: ApprovalEscrowSummary };

export const APPROVAL_STATUS_LABEL: Record<ApprovalStatus, string> = {
  PENDING: "승인 대기",
  APPROVED: "승인됨",
  REJECTED: "거절됨",
};

const GOVERNANCE_REASON_LABEL: Record<GovernanceReasonCode, string> = {
  GOV_SINGLE_AGREEMENT_OVER_AUTO_LIMIT: "단건 합의 금액이 자동 승인 한도를 넘음",
  GOV_CAMPAIGN_TOTAL_OVER_AUTO_LIMIT: "캠페인 누적 확정 금액이 자동 승인 한도를 넘음",
  GOV_PROMOTION_AUTO_ESCROW_DISABLED: "프로모션이 자동 에스크로를 끔",
};

export function governanceReasonLabel(code: string) {
  return (GOVERNANCE_REASON_LABEL as Record<string, string>)[code] ?? code;
}

/** 에스크로 요약 status/reason 코드를 사람이 읽는 말로. */
const ESCROW_REASON_LABEL: Record<string, string> = {
  WEB3_GATEWAY_REQUIRED: "web3 게이트웨이 모드가 아니라 온체인 예치를 건너뜀",
  AUTO_ESCROW_DISABLED: "프로모션이 자동 에스크로를 꺼서 건너뜀",
};

export function escrowReasonLabel(reason: string | null | undefined) {
  if (!reason) return "";
  return ESCROW_REASON_LABEL[reason] ?? reason;
}

/** 거절 사유는 백엔드가 `reason`으로 저장한다. 다른 덤프의 `rejectReason`도 받아 준다. */
export function approvalRejectReason(approval: Pick<ApprovalDoc, "reason" | "rejectReason">) {
  return approval.reason ?? approval.rejectReason ?? null;
}
