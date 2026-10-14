/**
 * 브랜드 캠페인(탐색 → 다중 A2A 협상 → 합의서 → 에스크로) API 타입.
 *
 * - `POST /api/v1/promotions/{promotionId}/campaigns` 요청/응답
 * - `GET  /api/v1/promotions/{promotionId}/campaigns/stream` SSE 이벤트 payload
 *
 * 백엔드 `libs/agents/brand_campaign.py` / `brand_discovery.py`의 by_alias 덤프와 1:1.
 */

export type CampaignRequest = {
  targetCreatorCount?: number;
  maxCandidates?: number;
  parallelism?: number;
  openingAmountUsdc?: number;
  /** 브랜드 비공개 상한. 브랜드 자신의 API로만 전달되고 크리에이터에게는 절대 노출되지 않는다. */
  ceilingUsdc?: number;
  concessionPct?: number;
  maxRounds?: number;
};

export type CampaignOutcome =
  | "TARGET_REACHED"
  | "PARTIAL"
  | "NO_AGREEMENT"
  | "NO_CANDIDATES"
  | "CANCELED";

export type NegotiationOutcome =
  | "AGREED"
  | "REJECTED"
  | "ESCALATED"
  | "WALKED_AWAY"
  | "ROUND_LIMIT"
  | "CANCELED";

export type NegotiationSkipReason = "TARGET_REACHED" | "BUDGET_EXHAUSTED" | "CANCELED";

export type CandidateCardStatus = "UP" | "DOWN" | "NO_SKILL" | "SKIPPED";

export type AgentHealthStatus = "UP" | "DOWN" | "UNKNOWN";

export type TurnRole = "brand" | "creator";

export type TurnType = "OFFER" | "COUNTER" | "ACCEPT" | "REJECT" | "ESCALATE";

export type BudgetLedgerSnapshot = {
  totalUsdc: number;
  reservedUsdc: number;
  committedUsdc: number;
  availableUsdc: number;
};

export type AgentTrackRecord = {
  attempts: number;
  agreements: number;
  agreementRate: number;
  lastOutcome?: string | null;
};

export type DiscoveryCandidate = {
  creatorAgentId: string;
  creatorId: string;
  displayName: string;
  baseUrl: string;
  rank: number | null;
  eligible: boolean;
  score: number | null;
  rankScore: number | null;
  scoreComponents?: Record<string, number>;
  hardFilterReasons: string[];
  publicRateBand?: string | null;
  categories: string[];
  completedDealCount?: number;
  cardStatus: CandidateCardStatus;
  cardError?: string | null;
  selected: boolean;
  healthStatus?: AgentHealthStatus;
  lastSeenAt?: string | null;
  trackRecord?: AgentTrackRecord | null;
};

export type DiscoveryReport = {
  promotionId: string;
  queried: number;
  ranked: number;
  probed: number;
  candidates: DiscoveryCandidate[];
};

export type CampaignTurn = {
  creatorAgentId: string;
  role: TurnRole;
  round: number;
  type: TurnType;
  amountUsdc: number;
  message: string;
  rationale?: string;
  messageProvider?: string;
  messageModel?: string | null;
  messageId?: string;
  taskId?: string | null;
};

export type NegotiationResult = {
  outcome: NegotiationOutcome;
  brandAgentId?: string;
  creatorAgentId?: string;
  finalAmountUsdc: number | null;
  rounds: number;
  agreementId?: string | null;
  termsHash?: string | null;
  turns: Array<Omit<CampaignTurn, "creatorAgentId">>;
};

export type CampaignEscrowSummary = {
  status: string;
  escrowId?: string | null;
  signature?: string | null;
  explorerUrl?: string | null;
  lockedAmountBaseUnits?: string | null;
  network?: string | null;
  reason?: string | null;
  detail?: string | null;
};

export type CampaignNegotiationSummary = {
  creatorAgentId: string;
  displayName: string;
  status: "PENDING" | "RUNNING" | "DONE" | "SKIPPED" | string;
  skipReason?: string | null;
  reservedUsdc?: number | null;
  committedUsdc?: number | null;
  agreementId?: string | null;
  termsHash?: string | null;
  escrow?: CampaignEscrowSummary | null;
  result?: NegotiationResult | null;
};

export type CampaignResult = {
  campaignId: string;
  matchRunId: string | null;
  outcome: CampaignOutcome;
  targetCreatorCount: number;
  agreedCount: number;
  totalBudgetUsdc: number;
  committedUsdc: number;
  agreementIds: string[];
  negotiations: CampaignNegotiationSummary[];
};

export type RunCampaignResponse = {
  campaign: CampaignResult;
  agreements: Array<Record<string, unknown>>;
};

/** `POST /promotions/{id}/campaigns/{campaignId}:cancel` 응답. 실행 중이 아니면 404. */
export type CancelCampaignResponse = {
  campaignId: string;
  status: "CANCELING";
};

/* ---------- SSE event payloads (each `data:` line) ---------- */

export type CampaignStatusEvent = {
  campaignId: string;
  promotionId: string;
  a2aMode: string;
};

export type CampaignDiscoveryEvent = {
  report: DiscoveryReport;
};

export type NegotiationStartedEvent = {
  creatorAgentId: string;
  baseUrl: string;
  reservedUsdc: number;
  ledger: BudgetLedgerSnapshot;
};

export type NegotiationSkippedEvent = {
  creatorAgentId: string;
  reason: NegotiationSkipReason;
  ledger: BudgetLedgerSnapshot;
};

export type NegotiationErrorEvent = {
  creatorAgentId: string;
  detail: string;
};

export type NegotiationResultEvent = {
  creatorAgentId: string;
  result: NegotiationResult;
  ledger: BudgetLedgerSnapshot;
};

export type AgreementCreatedEvent = {
  creatorAgentId: string;
  agreementId: string;
  negotiationId: string;
  termsHash: string;
  amountUsdc: number;
  deliverableSummary: string;
  status: string;
};

export type EscrowLockedEvent = {
  creatorAgentId: string;
  agreementId: string;
  escrowId?: string | null;
  signature?: string | null;
  explorerUrl?: string | null;
  lockedAmountBaseUnits?: string | null;
  network?: string | null;
};

export type EscrowSkippedEvent = {
  creatorAgentId: string;
  agreementId: string;
  status: string;
  reason?: string | null;
};

export type EscrowFailedEvent = {
  creatorAgentId: string;
  agreementId: string;
  reason?: string | null;
  detail?: string | null;
};

/** 거버넌스가 에스크로 락을 사람 뒤로 미뤘을 때 (escrow_* 대신 발생). docs/09 부록 5. */
export type ApprovalRequiredEvent = {
  creatorAgentId: string;
  agreementId: string;
  approvalId: string;
  amountUsdc: number;
  campaignCommittedUsdc: number;
  reasons: string[];
  ruleVersion: string;
};

export type CampaignResultEvent = {
  result: CampaignResult;
};

export type CampaignErrorEvent = {
  detail: string;
};

/** 서버가 보내는 `event:` 이름과 payload의 판별 합집합. */
export type CampaignStreamEvent =
  | { name: "status"; data: CampaignStatusEvent }
  | { name: "discovery"; data: CampaignDiscoveryEvent }
  | { name: "negotiation_started"; data: NegotiationStartedEvent }
  | { name: "negotiation_skipped"; data: NegotiationSkippedEvent }
  | { name: "negotiation_error"; data: NegotiationErrorEvent }
  | { name: "turn"; data: CampaignTurn }
  | { name: "negotiation_result"; data: NegotiationResultEvent }
  | { name: "agreement_created"; data: AgreementCreatedEvent }
  | { name: "escrow_locked"; data: EscrowLockedEvent }
  | { name: "escrow_skipped"; data: EscrowSkippedEvent }
  | { name: "escrow_failed"; data: EscrowFailedEvent }
  | { name: "approval_required"; data: ApprovalRequiredEvent }
  | { name: "campaign_result"; data: CampaignResultEvent }
  | { name: "error"; data: CampaignErrorEvent };

export type CampaignStreamEventName = CampaignStreamEvent["name"];

export const CAMPAIGN_STREAM_EVENT_NAMES: readonly CampaignStreamEventName[] = [
  "status",
  "discovery",
  "negotiation_started",
  "negotiation_skipped",
  "negotiation_error",
  "turn",
  "negotiation_result",
  "agreement_created",
  "escrow_locked",
  "escrow_skipped",
  "escrow_failed",
  "approval_required",
  "campaign_result",
  "error",
];
