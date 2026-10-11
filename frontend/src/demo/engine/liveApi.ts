import type { A2AMessage, CampaignSpec, CreatorCard, Deal, MilestoneState } from "./types";
import {
  ProductApiClient,
  ProductApiError,
  type ApiAgreementEscrowBundle,
  type ApiAutoSettlement,
  type ApiEscrow,
  type ApiEvidence,
  type ApiSettlement,
} from "@/product/apiClient";
import {
  connectPhantomWallet,
  sendPreparedSolanaTransaction,
  signPhantomMessage,
} from "@/features/wallet/phantom";

type ApiEnvelope<T> = {
  data?: T;
  detail?: unknown;
};

type ApiMatchRun = {
  matchRunId: string;
  promotionId: string;
  selectedCreatorId?: string | null;
  selectedCreatorAgentId?: string | null;
  status?: string;
};

type ApiCandidate = {
  creatorId: string;
  creatorAgentId?: string;
  creatorDisplayName?: string;
  categories?: string[];
  supportedDeliverableFormats?: string[];
  eligible?: boolean;
  score?: number;
  rank?: number | null;
  explanation?: string;
  hardFilterReasons?: string[];
};

type ApiMessage = {
  messageId: string;
  role?: string;
  sequence?: number;
  payload?: Record<string, unknown>;
  content?: Record<string, unknown>;
};

type ApiNegotiation = {
  negotiationId: string;
  status?: string;
  creatorId?: string;
  creatorAgentId?: string;
  creatorDisplayName?: string;
  currentAmountUsdc?: number;
  currentTerms?: ApiTerms;
  productName?: string;
  promotionTitle?: string;
};

type ApiTerms = {
  compensation?: {
    baseAmountUsdc?: number;
  };
  deliverables?: Array<{
    format?: string;
    count?: number;
    postWindow?: {
      start?: string;
      end?: string;
    };
  }>;
  usageRights?: string;
  milestones?: Array<{
    id?: string;
    trigger?: string;
    releasePct?: number;
  }>;
};

type ApiAgreement = {
  agreementId: string;
  status?: string;
  termsHash?: string;
  terms?: ApiTerms;
  creatorAgentId?: string;
  productName?: string;
  promotionTitle?: string;
};

export type LiveApiResult = {
  promotionId: string;
  matchRun: ApiMatchRun;
  candidates: ApiCandidate[];
  creatorCards: CreatorCard[];
  selectedCreatorId: string;
  negotiation: ApiNegotiation;
  agreement: ApiAgreement | null;
  messages: A2AMessage[];
  deal: Deal | null;
  spec: CampaignSpec;
};

export type LiveFundingResult = {
  escrow: ApiEscrow;
  signature: string | null;
};

export type LiveEvidenceSettlementResult = {
  evidence: ApiEvidence;
  escrowBundle: ApiAgreementEscrowBundle;
  autoSettlement?: ApiAutoSettlement;
  outcome?: string;
  reasonCodes?: string[];
};

const PROMOTION_ID =
  process.env.NEXT_PUBLIC_KNOT_DEMO_PROMOTION_ID ?? "promotion-demo-cheriexx";

const KNOWN_CREATOR_IDS: Record<string, string> = {
  "creator-demo-ssin": "ssin",
  "agent-demo-creator-ssin": "ssin",
  "creator-demo-geekble": "geekble",
  "agent-demo-creator-geekble": "geekble",
  "creator-demo-risabae": "risabae",
  "agent-demo-creator-risabae": "risabae",
};

export function liveApiEnabled() {
  return process.env.NEXT_PUBLIC_KNOT_LIVE_API !== "0";
}

export async function runLiveDemoNegotiation(): Promise<LiveApiResult> {
  const idempotencyKey = `knot-live-product-${Date.now()}-${randomId()}`;
  const matchRun = await apiFetch<{ matchRun: ApiMatchRun }>(
    `/api/v1/promotions/${encodeURIComponent(PROMOTION_ID)}/matches:run`,
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
    },
  ).then((data) => data.matchRun);

  const candidates = await apiFetch<{ candidates: ApiCandidate[] }>(
    `/api/v1/match-runs/${encodeURIComponent(matchRun.matchRunId)}/candidates`,
  ).then((data) => data.candidates ?? []);

  const negotiationBundle = await apiFetch<{
    negotiation: ApiNegotiation;
    agreement: ApiAgreement | null;
  }>(`/api/v1/match-runs/${encodeURIComponent(matchRun.matchRunId)}/start-negotiation`, {
    method: "POST",
    headers: { "Idempotency-Key": `${idempotencyKey}-negotiation` },
  });

  const messages = await apiFetch<{ messages: ApiMessage[] }>(
    `/api/v1/negotiations/${encodeURIComponent(
      negotiationBundle.negotiation.negotiationId,
    )}/messages`,
  ).then((data) => data.messages ?? []);

  const creatorCards = candidates.map(cardFromCandidate);
  const selectedRawId =
    negotiationBundle.negotiation.creatorId ??
    matchRun.selectedCreatorId ??
    candidates.find((c) => c.creatorAgentId === matchRun.selectedCreatorAgentId)?.creatorId ??
    candidates[0]?.creatorId;
  if (!selectedRawId) {
    throw new Error("API 매칭 결과에 선택된 크리에이터가 없습니다.");
  }
  const selectedCreatorId = uiCreatorId(selectedRawId);
  const agreement = negotiationBundle.agreement;
  const agreementDeal = agreement ? dealFromAgreement(selectedCreatorId, agreement) : null;
  return {
    promotionId: PROMOTION_ID,
    matchRun,
    candidates,
    creatorCards,
    selectedCreatorId,
    negotiation: negotiationBundle.negotiation,
    agreement,
    messages: messages.map((message) => messageFromApi(message)).filter(Boolean) as A2AMessage[],
    deal: isAgreementReady(negotiationBundle.negotiation, agreementDeal) ? agreementDeal : null,
    spec: specFromAgreement(agreement, negotiationBundle.negotiation),
  };
}

function isAgreementReady(negotiation: ApiNegotiation, deal: Deal | null) {
  return negotiation.status === "AGREED" && Boolean(deal);
}

export async function fundLiveAgreementEscrow(agreementId: string): Promise<LiveFundingResult> {
  const client = new ProductApiClient();
  const wallet = await connectPhantomWallet();
  await proveAndSaveWallet(client, wallet.address);
  const prepared = await client.prepareEscrowFunding(
    agreementId,
    uniqueRequestKey(`demo-funding-prepare-${agreementId}-${wallet.address}`),
  );
  if (!prepared.funding) {
    return {
      escrow: prepared.escrow,
      signature: prepared.escrow.fundingTransactionSignature ?? prepared.escrow.lockSignature ?? null,
    };
  }
  if (prepared.funding.brandAuthority !== wallet.address) {
    throw new Error(
      `연결된 브랜드 지갑이 이 계약의 예치 지갑과 다릅니다. 연결됨 ${shortAddress(
        wallet.address,
      )}, 필요 ${shortAddress(prepared.funding.brandAuthority)}`,
    );
  }
  const signature = await sendPreparedSolanaTransaction(prepared.funding);
  const confirmed = await client.confirmEscrowFunding(
    agreementId,
    signature,
    uniqueRequestKey(`demo-funding-confirm-${agreementId}-${signature}`),
  );
  return { escrow: confirmed.escrow, signature };
}

export async function submitAndSettleLiveEvidence(input: {
  agreementId: string;
  creatorAgentId: string;
  milestoneId: string;
  url: string;
}): Promise<LiveEvidenceSettlementResult> {
  const client = new ProductApiClient();
  let evidence: ApiEvidence | null = null;
  try {
    evidence = await client.submitEvidence(
      { agreementId: input.agreementId, creatorAgentId: input.creatorAgentId },
      input.milestoneId,
      input.url,
    );
  } catch (caught) {
    if (caught instanceof ProductApiError && caught.code === "EVIDENCE_ALREADY_SUBMITTED") {
      evidence = evidenceFromApiError(caught);
    } else {
      throw caught;
    }
  }
  if (!evidence) {
    throw new Error("정산 증빙을 찾지 못했습니다. 새로고침 후 다시 시도해 주세요.");
  }
  const verified = await client.verifyEvidence(evidence.evidenceId);
  const escrowBundle = await client.getAgreementEscrow(input.agreementId);
  return {
    evidence: verified.evidence,
    escrowBundle,
    autoSettlement: verified.autoSettlement,
    outcome: verified.outcome,
    reasonCodes: verified.reasonCodes,
  };
}

export function settlementSummaryFromBundle(bundle: ApiAgreementEscrowBundle) {
  const escrow = bundle.escrow;
  const settlements = bundle.settlements ?? [];
  const settlement = settlements[settlements.length - 1] ?? null;
  return {
    escrowId: escrow?.escrowId ?? null,
    escrowStatus: escrow?.status ?? null,
    fundingSignature: escrow?.fundingTransactionSignature ?? escrow?.lockSignature ?? null,
    settlementStatus: settlement?.status ?? null,
    settlementSignature: settlement?.signature ?? null,
    releasedAmountUsdc: baseUnitsToUsdc(escrow?.releasedAmountBaseUnits),
    settlements,
  };
}

export function applySettlementsToDeal(deal: Deal, settlements: ApiSettlement[]) {
  const released = new Set(
    settlements
      .filter((settlement) => settlement.status === "CONFIRMED" || Boolean(settlement.signature))
      .map((settlement) => settlement.milestoneId),
  );
  for (const milestone of deal.milestones) {
    milestone.status = released.has(milestone.id) ? "released" : "active";
  }
  const releasedPct = deal.milestones
    .filter((milestone) => milestone.status === "released")
    .reduce((sum, milestone) => sum + milestone.pct, 0);
  deal.starPct = Math.min(100, releasedPct || deal.starPct);
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    headers,
    signal: AbortSignal.timeout(70_000),
  });
  const body = (await response.json().catch(() => ({}))) as ApiEnvelope<T>;
  if (!response.ok || !body.data) {
    throw new Error(errorMessage(body.detail) ?? `API 요청 실패 (${response.status})`);
  }
  return body.data;
}

async function proveAndSaveWallet(client: ProductApiClient, address: string) {
  const { challenge } = await client.createWalletChallenge(address);
  const signature = await signPhantomMessage(challenge.message);
  await client.saveWalletAddress(address, {
    challengeId: challenge.challengeId,
    signature,
  });
}

function evidenceFromApiError(error: ProductApiError): ApiEvidence | null {
  const detail = error.detail;
  if (!detail || typeof detail !== "object" || !("evidence" in detail)) return null;
  const evidence = (detail as { evidence?: unknown }).evidence;
  if (!evidence || typeof evidence !== "object" || !("evidenceId" in evidence)) return null;
  return evidence as ApiEvidence;
}

function cardFromCandidate(candidate: ApiCandidate): CreatorCard {
  const id = uiCreatorId(candidate.creatorId);
  const categories = candidate.categories ?? [];
  const primaryCategory = categories[0] ?? "creator";
  const fit = scoreToPct(candidate.score);
  return {
    id,
    handle: handleFor(candidate),
    name: candidate.creatorDisplayName || handleFor(candidate).replace(/^@/, ""),
    color: colorFor(primaryCategory),
    photo: photoFor(primaryCategory),
    followers: "API 확인",
    engagement: "정책 검증",
    niche: labelForCategories(categories),
    fit,
    fitReason:
      candidate.explanation ||
      `${labelForCategories(categories)} · 후보 검증 ${candidate.eligible ? "통과" : "확인 필요"}`,
    profileUrl: candidate.creatorId,
    insights: {
      avgViews: "API 확인",
      saves30d: candidate.rank ? `${candidate.rank}위 후보` : "후보",
      growth30d: candidate.eligible ? "검증 통과" : "제외",
      topFormat: formatLabel(candidate.supportedDeliverableFormats?.[0]),
    },
  };
}

function messageFromApi(message: ApiMessage): A2AMessage | null {
  const payload = message.payload ?? message.content ?? {};
  const display = valueAsRecord(payload.display);
  const type = stringValue(payload.type ?? payload.messageType ?? display.headline);
  const amount = numberValue(valueAsRecord(payload.terms)?.compensation, "baseAmountUsdc");
  const text =
    stringValue(display.message) ||
    stringValue(display.headline) ||
    stringValue(payload.rationale) ||
    type ||
    "A2A 메시지";
  const reasoning =
    stringValue(display.rationale) ||
    stringValue(payload.rationale) ||
    stringValue(valueAsRecord(payload.policyDecision)?.reason);
  const role = String(message.role ?? "").toUpperCase();
  return {
    id: message.messageId,
    from: role === "ROLE_SYSTEM" ? "policy" : role === "ROLE_AGENT" ? "creator" : "brand",
    text,
    reasoning,
    amountUsdc: amount,
  };
}

function dealFromAgreement(creatorId: string, agreement: ApiAgreement): Deal {
  const terms = agreement.terms ?? {};
  const baseAmount = Number(terms.compensation?.baseAmountUsdc ?? 0);
  return {
    creatorId,
    amountUsdc: baseAmount,
    termsHash: agreement.termsHash ?? agreement.agreementId,
    milestones: (terms.milestones ?? []).map((milestone, index) =>
      milestoneFromApi(milestone, index, baseAmount),
    ),
    starPct: 0,
    bonusUsdc: null,
    postUrl: null,
    awaitingPost: false,
    verify: null,
    metrics: null,
    txs: [],
  };
}

function milestoneFromApi(
  milestone: NonNullable<ApiTerms["milestones"]>[number],
  index: number,
  baseAmount: number,
): MilestoneState {
  const pct = Number(milestone.releasePct ?? 0);
  return {
    id: milestone.id || `m${index + 1}`,
    label: triggerLabel(milestone.trigger),
    pct,
    usdc: Number(((baseAmount * pct) / 100).toFixed(2)),
    status: "locked",
  };
}

function specFromAgreement(agreement: ApiAgreement | null, negotiation: ApiNegotiation): CampaignSpec {
  const terms = agreement?.terms ?? negotiation.currentTerms ?? {};
  const deliverable = terms.deliverables?.[0];
  const product = agreement?.productName ?? negotiation.productName ?? "체리 글로우 키트";
  return {
    goal: `${product} 협찬`,
    contentType: `${formatLabel(deliverable?.format)} ${deliverable?.count ?? 1}개`,
    budgetUsdc: 10,
    maxPerDealUsdc: 4,
    deadlineLabel: deliverable?.postWindow?.end ? `${deliverable.postWindow.end}까지` : "2주 안에",
  };
}

function uiCreatorId(id: string) {
  return KNOWN_CREATOR_IDS[id] ?? `live-${id}`;
}

function scoreToPct(score: unknown) {
  const n = Number(score);
  if (!Number.isFinite(n)) return 80;
  return Math.max(0, Math.min(100, Math.round(n <= 1 ? n * 100 : n)));
}

function handleFor(candidate: ApiCandidate) {
  const name = candidate.creatorDisplayName || candidate.creatorId.replace(/^creator-demo-/, "");
  const ascii = name
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/gi, "")
    .slice(0, 18);
  return `@${ascii || candidate.creatorId}`;
}

function colorFor(category: string) {
  if (/beauty|fashion/i.test(category)) return "#e8896b";
  if (/tech|crypto/i.test(category)) return "#7ba05b";
  if (/gaming|entertainment/i.test(category)) return "#6b7fd7";
  if (/wellness|fitness|health/i.test(category)) return "#34a188";
  return "#b58cd9";
}

function photoFor(category: string) {
  if (/beauty|fashion/i.test(category)) return "/demo/ssin.jpg";
  if (/tech|crypto/i.test(category)) return "/demo/geekble.jpg";
  if (/gaming|entertainment/i.test(category)) return "/demo/jocoding.jpg";
  if (/wellness|fitness|health/i.test(category)) return "/demo/haru.jpg";
  return "/demo/nari.jpg";
}

function labelForCategories(categories: string[]) {
  if (!categories.length) return "크리에이터";
  return categories.map((category) => categoryLabel(category)).join(" · ");
}

function categoryLabel(category: string) {
  const labels: Record<string, string> = {
    beauty: "뷰티",
    fashion: "패션",
    tech: "테크",
    wellness: "웰니스",
    fitness: "피트니스",
    health: "헬스",
    crypto: "크립토",
    gaming: "게임",
    entertainment: "엔터테인먼트",
    lifestyle: "라이프스타일",
  };
  return labels[category.toLowerCase()] ?? category;
}

function formatLabel(format: unknown) {
  const key = String(format ?? "short").toLowerCase();
  const labels: Record<string, string> = {
    short: "숏폼",
    reel: "릴스",
    post: "피드",
    video: "유튜브 영상",
    youtube_shorts: "유튜브 쇼츠",
    youtube_longform: "유튜브 롱폼",
    instagram_reel: "인스타 릴스",
  };
  return labels[key] ?? String(format ?? "숏폼");
}

function triggerLabel(trigger: unknown) {
  const key = String(trigger ?? "");
  if (key === "creatorAccepted") return "크리에이터 수락";
  if (key === "contentLiveVerified") return "콘텐츠 게시 확인";
  return key || "마일스톤";
}

function valueAsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(parent: unknown, key: string): number | null {
  const value = valueAsRecord(parent)[key];
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function errorMessage(detail: unknown) {
  if (typeof detail === "string") return detail;
  const record = valueAsRecord(detail);
  return stringValue(record.detail) ?? stringValue(record.message) ?? stringValue(record.title);
}

function randomId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(16).slice(2);
}

function uniqueRequestKey(prefix: string) {
  return `${prefix}-${randomId()}`;
}

function shortAddress(value: string) {
  if (value.length <= 12) return value;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function baseUnitsToUsdc(value: string | undefined) {
  if (!value) return "0";
  const raw = Number(value);
  if (!Number.isFinite(raw)) return "0";
  return (raw / 1_000_000).toLocaleString();
}
