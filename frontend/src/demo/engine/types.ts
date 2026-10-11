/**
 * 라이브 데모 엔진 타입 — /b(브랜드 창)과 /c(크리에이터 창)이 공유하는 단일 상태.
 *
 * 브랜드 창이 호스트로 대본을 굴리고, 매 커밋마다 전체 상태를
 * BroadcastChannel + localStorage로 흘려보낸다. 크리에이터 창은 순수 미러.
 * 대사·금액·판정은 전부 대본(script.ts)의 결정론 값이다 — 라이브에서 놀라지 않기.
 */

export type Mood = "idle" | "think" | "talk" | "happy" | "sad" | "alert" | "sleep";

export type BrandProfile = {
  url: string;
  name: string;
  tagline: string;
  /** 사이트에서 추출한 회사 소개 2~3문장 */
  intro: string;
  tone: string[];
  products: { name: string; desc: string }[];
  audience: string;
  /** 사이트 본문에서 수집한 제품/브랜드 이미지 URL (외부 URL) */
  images: string[];
  /** 캐릭터 실 색 — 사이트에서 "추출"한 브랜드 컬러라는 설정 */
  color: string;
  /** 사이트에서 추출한 브랜드 로고 (로컬 에셋) */
  logo: string;
  agentName: string;
};

export type CampaignSpec = {
  goal: string;
  contentType: string;
  budgetUsdc: number;
  maxPerDealUsdc: number;
  deadlineLabel: string;
};

export type CampaignStatus =
  | "scouting"
  | "negotiating"
  | "pending_approval"
  | "knotting"
  | "active"
  | "completed";

export type CreatorCard = {
  id: string;
  handle: string;
  name: string;
  /** 캐릭터 실 색 */
  color: string;
  /** 프로필 사진 (로컬 에셋) */
  photo: string;
  followers: string;
  engagement: string;
  niche: string;
  fit: number;
  fitReason: string;
  /** 프로필 링크 (인스타그램 등) */
  profileUrl: string;
  /** 최근 인사이트 — 스카우팅·승인 카드에서 노출 */
  insights: {
    avgViews: string;
    saves30d: string;
    growth30d: string;
    topFormat: string;
  };
};

export type A2ASpeaker = "brand" | "creator" | "policy";

export type A2AMessage = {
  id: string;
  from: A2ASpeaker;
  text: string;
  /** 어떤 논리로 이 판단을 했는지 — 항상 노출 가능해야 한다(심사 포인트). */
  reasoning?: string;
  amountUsdc?: number | null;
};

export type NegotiationStatus =
  | "queued"
  | "contacting"
  | "talking"
  | "agreed"
  | "blocked";

export type Negotiation = {
  creatorId: string;
  status: NegotiationStatus;
  messages: A2AMessage[];
  agreedUsdc: number | null;
  blockedReason: string | null;
};

export type MilestoneStatus = "locked" | "active" | "review" | "released";

export type MilestoneState = {
  id: string;
  label: string;
  pct: number;
  usdc: number;
  status: MilestoneStatus;
};

export type DealMetrics = {
  views: string;
  saves: string;
  ctr: string;
  cpmDelta: string;
};

export type VerifyCheck = { label: string; ok: boolean };

export type Deal = {
  creatorId: string;
  amountUsdc: number;
  termsHash: string;
  milestones: MilestoneState[];
  /** 실타래 진행률 0~100. 100에서 타래 완성 + 펑. */
  starPct: number;
  bonusUsdc: number | null;
  postUrl: string | null;
  /** 크리에이터 창에서 실제 게시물 URL을 제출해야 다음 스텝으로 넘어간다. */
  awaitingPost: boolean;
  /** 마지막 증빙 검증 결과 (실패 시 재제출 유도) */
  verify: VerifyCheck[] | null;
  metrics: DealMetrics | null;
  txs: { label: string; hash: string }[];
};

export type TaskBrief = {
  criteria: string[];
  tasks: string[];
  references: { title: string; length: string; note: string }[];
};

export type ChatChip = { id: string; label: string };

export type ChatMsg = {
  id: string;
  role: "user" | "agent";
  text: string;
  chips?: ChatChip[];
  at: number;
};

export type FeedTone = "info" | "ok" | "warn" | "money";

export type FeedItem = {
  id: string;
  icon: string;
  text: string;
  tone: FeedTone;
  at: number;
};

export type CampaignState = {
  spec: CampaignSpec;
  status: CampaignStatus;
  /** 탐험에서 지금까지 발견된 크리에이터 id 순서 */
  discovered: string[];
  negotiations: Record<string, Negotiation>;
  deals: Deal[];
  brief: TaskBrief | null;
  reportReady: boolean;
};

export type AutopilotRun = {
  label: string;
  items: { id: string; text: string; tone: FeedTone }[];
  spentUsdc: number;
  dealCount: number;
  done: boolean;
};

export type OnboardScan = {
  url: string;
  /** 추출 카드가 하나씩 켜진다: 0=none … 5=완료 */
  step: number;
  done: boolean;
};

export type InboundOfferStatus = "new" | "negotiating" | "declined" | "agreed";

/** 크리에이터 창 오퍼함 항목 — 브랜드들이 크리에이터 에이전트에게 보낸 제안 */
export type InboundOffer = {
  id: string;
  brandName: string;
  /** 이모지 또는 로컬 로고 에셋 경로("/"로 시작) */
  brandLogo: string;
  amountUsdc: number;
  format: string;
  status: InboundOfferStatus;
  /** 한 줄 상태 설명 (검토 상황·거절 사유 등) */
  note?: string;
  at: number;
};

/**
 * 실시간 devnet 증빙 — 대본(feed/txs)과 별개로 실제 백엔드(knot-api → knot-web3)를
 * 호출해 진짜 프로모션·협상·에스크로·정산을 만든다. 실패해도 대본 연출은 안 끊긴다.
 */
export type RealChainStatus =
  | "idle"
  | "creating"
  | "waiting_creator"
  | "agreed"
  | "funding"
  | "funded"
  | "submitting_evidence"
  | "released"
  | "error";

export type RealChainState = {
  status: RealChainStatus;
  promotionId: string | null;
  agreementId: string | null;
  creatorAgentId: string | null;
  escrowId: string | null;
  amountUsdc: number | null;
  network: string;
  brandWallet: string | null;
  creatorWallet: string | null;
  fundingSignature: string | null;
  releaseSignature: string | null;
  milestoneId: string | null;
  error: string | null;
};

export type DemoStage = "intro" | "scanning" | "hatch" | "workspace";

export type DemoState = {
  v: number;
  stage: DemoStage;
  scan: OnboardScan | null;
  brand: BrandProfile | null;
  chat: ChatMsg[];
  agentTyping: boolean;
  /** 캠페인 생성 대화가 어디까지 왔나 */
  composeStep: "idle" | "goal" | "budget" | "content" | "confirm" | "done";
  /** budget 단계에서 고른(칩 또는 직접입력) 값 — confirm/탐험 시점에 소비된다 */
  pendingBudget: { budgetUsdc: number; maxPerDealUsdc: number } | null;
  campaign: CampaignState | null;
  feed: FeedItem[];
  autopilot: boolean;
  autopilotRun: AutopilotRun | null;
  /** 크리에이터 창 오퍼함 — 들어오는 브랜드 딜들 (최신이 앞) */
  inboundOffers: InboundOffer[];
  /** 크리에이터 창 지갑 잔액(USDC) — 릴리즈마다 차오른다 */
  creatorWalletUsdc: number;
  /** 크리에이터 창에서 별 펑 연출 트리거 (증가하는 카운터) */
  burstSeq: number;
  /** 실시간 devnet 증빙 상태 — null이면 아직 시작 안 함 */
  real: RealChainState | null;
};

export type DemoAction = (draft: DemoState) => void;

export type SequenceStep = {
  /** 이전 스텝으로부터의 지연(ms) */
  d: number;
  run: DemoAction;
};
