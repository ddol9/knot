import type {
  ApprovalDoc,
  ApprovalListResponse,
  ApprovalResponse,
  ApprovalStatus,
  ApproveApprovalResponse,
} from "@/product/approvalTypes";
import type { CampaignRequest, CancelCampaignResponse, RunCampaignResponse } from "@/product/campaignTypes";

export type { CampaignRequest, CancelCampaignResponse, RunCampaignResponse } from "@/product/campaignTypes";
export type { ApprovalDoc, ApprovalStatus } from "@/product/approvalTypes";

type ApiEnvelope<T> = {
  data: T;
  meta?: {
    requestId?: string;
    timestamp?: string;
    schemaVersion?: string;
  };
};

export type ApiPromotion = {
  promotionId: string;
  brandId: string;
  brandAgentId: string;
  title: string;
  objective: string;
  category: string;
  targetAudience: string[];
  budget: {
    totalUsdc: number;
    maxPerCreatorUsdc: number;
  };
  deliverables: Array<{
    format: string;
    count: number;
  }>;
  postingWindow: {
    start: string;
    end: string;
  };
  usageRights: string;
  constraints?: {
    requiredDisclosures?: string[];
    prohibitedClaims?: string[];
    requiredCategories?: string[];
    prohibitedCategories?: string[];
  };
  autonomy?: {
    maxNegotiationRounds?: number;
    autoEscrow?: boolean;
    autoRelease?: boolean;
  };
  status: string;
  productName?: string;
  deliverableSummary?: string;
  workItems?: Array<Record<string, unknown>>;
};

export type ApiUser = {
  userId: string;
  email: string;
  displayName: string;
  roles: string[];
  activeRole: "brand" | "creator";
  brandId?: string;
  brandAgentId?: string;
  creatorId?: string;
  creatorAgentId?: string;
};

export type CurrentAccount = {
  uid: string;
  userId: string;
  email: string | null;
  displayName: string | null;
  photoUrl: string | null;
  role: "BRAND" | "CREATOR" | null;
  onboardingStatus: "ROLE_REQUIRED" | "PROFILE_REQUIRED" | "COMPLETED";
  status: "ACTIVE" | "DISABLED" | "DELETION_PENDING" | "DELETED";
  brandId?: string | null;
  creatorId?: string | null;
  agentId?: string | null;
  walletAddress?: string | null;
  walletNetwork?: string | null;
  walletUpdatedAt?: string | null;
  schemaVersion: number;
};

export type CurrentUserContext = {
  account: CurrentAccount;
  profileSummary: Record<string, unknown> | null;
  dashboardTarget: string;
};

export type ApiRoleSession = {
  role: "brand" | "creator";
  userLabel: string;
  organizationLabel: string;
  agentId: string;
  agentLabel: string;
  profileSummary: string;
  walletAddress: string;
};

export type BootstrapUserInput = {
  email: string;
  displayName: string;
  role: "brand" | "creator";
};

export type BrandOnboardingInput = {
  userId?: string;
  brandName: string;
  websiteUrl: string;
  category: string;
  targetAudience: string[];
  restrictedClaims: string[];
};

export type CreatorOnboardingInput = {
  userId?: string;
  creatorName: string;
  snsUrl: string;
  primaryCategory: string;
};

export type CurrentBrandProfileInput = {
  brandName: string;
  websiteUrl: string;
  categories: string[];
  customCategory?: string;
  targetAudience: string;
  description?: string;
  restrictedClaims: string[];
};

export type CurrentCreatorProfileInput = {
  creatorName: string;
  snsUrl: string;
  categories: string[];
  customCategory?: string;
  minimumUsdc: number;
  blockedDomains: string[];
  preferredContent: string[];
  walletAddress?: string;
};

export type CreatorCriteriaInput = {
  minimumUsdc: number;
  blockedDomains: string[];
  preferredContent: string[];
  usageRights: string;
  notes: string;
};

export type PromotionCreateInput = Omit<ApiPromotion, "promotionId" | "status"> & {
  promotionId?: string;
  status?: string;
};

export type BrandPromotionCreateInput = {
  promotionId?: string;
  productName: string;
  title: string;
  objective: string;
  categories: string[];
  targetAudience: string;
  totalBudget: number;
  initialOffer: number;
  maximumPerCreator: number;
  autoAcceptCeiling: number;
  maximumRounds: number;
  deliverables: Array<{ format: string; count: number }>;
  usageRights: string;
  deadline: string;
  prohibitedClaims: string[];
};

export type BrandSourceAnalysisInput = {
  websiteUrl?: string;
  productUrl?: string;
  pdfFileRef?: string;
};

export type BrandSourceField<T> = {
  value: T;
  source: "WEBSITE" | "PRODUCT_URL" | "PDF" | "USER_INPUT" | "AI_INFERENCE" | "DEMO_FIXTURE";
  confidence: number;
};

export type BrandSourceAnalysisDraft = {
  mode: "api" | "demo";
  brand: {
    name: BrandSourceField<string>;
  };
  product: {
    name: BrandSourceField<string>;
    category: BrandSourceField<string>;
    summary: BrandSourceField<string>;
    price?: BrandSourceField<string>;
    features: Array<BrandSourceField<string>>;
    targetAudience: Array<BrandSourceField<string>>;
    keywords: Array<BrandSourceField<string>>;
  };
  recommendations: {
    objectives: string[];
    channels: string[];
    deliverables: string[];
  };
};

export type AnalysisJob = {
  analysisId: string;
  ownerUid: string;
  role: "BRAND" | "CREATOR";
  analysisType: "PRODUCT" | "CREATOR_PROFILE";
  status: "READY_FOR_CONFIRMATION" | "CONFIRMED" | string;
  sourceUrl: string;
  sourceDigest: string;
  provider: string;
  model: string | null;
  fallbackReason: string | null;
  draft: Record<string, unknown>;
  confirmedFields: string[];
};

export type OnboardingSession = {
  ownerUid: string;
  role: "BRAND" | "CREATOR" | null;
  status: "IN_PROGRESS" | "COMPLETED" | string;
  currentCard: string;
  completedCards: string[];
  analysisJobId: string | null;
  draft: Record<string, unknown>;
  draftVersion: number;
};

export type CreatorAgentControl = {
  agentId: string;
  creatorId: string;
  publicationStatus: "DRAFT" | "PUBLISHED" | "PAUSED" | "SUSPENDED" | string;
  acceptingOffers: boolean;
  availability: "AVAILABLE" | "RESERVED" | "NEGOTIATING" | "AT_CAPACITY" | "UNAVAILABLE" | string;
  activeNegotiations: number;
  maxConcurrentNegotiations: number;
  activeCollaborations: number;
  maxActiveCollaborations: number;
  capacityAvailable: boolean;
  updatedAt?: string;
};

export type ApiMatchRun = {
  matchRunId: string;
  promotionId: string;
  brandAgentId: string;
  status: string;
  selectedCreatorId: string | null;
  selectedCreatorAgentId: string | null;
};

export type ApiCandidate = {
  creatorId: string;
  creatorAgentId: string;
  creatorDisplayName?: string;
  categories?: string[];
  supportedDeliverableFormats?: string[];
  rank?: number;
  eligible: boolean;
  overallScore?: number;
  hardFilterReasons?: string[];
  explanation?: string;
  negotiationId?: string | null;
  negotiationStatus?: string | null;
};

export type ApiAgreementTerms = {
  compensation: {
    structure: string;
    baseAmountUsdc: number;
    performancePct?: number;
  };
  deliverables: Array<{
    format: string;
    count: number;
    postWindow: {
      start: string;
      end: string;
    };
    revisionRounds?: number;
  }>;
  usageRights: string;
  milestones: Array<{
    id: string;
    trigger: string;
    releasePct: number;
  }>;
  constraints?: {
    requiredDisclosures?: string[];
    prohibitedClaims?: string[];
    exclusivityDays?: number;
  };
};

export type ApiNegotiation = {
  negotiationId: string;
  matchRunId: string;
  matchCandidateId: string;
  promotionId: string;
  promotionTitle?: string;
  productName?: string;
  brandDisplayName?: string;
  brandId?: string;
  brandAgentId: string;
  creatorId?: string;
  creatorAgentId: string;
  creatorDisplayName?: string;
  contextId: string;
  taskId: string;
  status:
    | "CREATED"
    | "OFFERED"
    | "AGREED"
    | "REJECTED"
    | "COUNTERED"
    | "ESCALATED"
    | "CANCELED"
    | "FAILED";
  currentRound: number;
  maxRounds: number;
  currentTerms: ApiAgreementTerms;
  initialAmountUsdc?: number;
  currentAmountUsdc?: number;
  deliverableSummary?: string;
  workItems?: Array<Record<string, unknown>>;
  brandSnapshot?: Record<string, unknown> | null;
  promotionSnapshot?: Record<string, unknown> | null;
  creatorSnapshot?: Record<string, unknown> | null;
};

export type ApiAgreement = {
  agreementId: string;
  negotiationId: string;
  taskId: string;
  artifactId: string;
  promotionId: string;
  promotionTitle?: string;
  productName?: string;
  brandDisplayName?: string;
  brandId?: string;
  brandAgentId: string;
  creatorId?: string;
  creatorAgentId: string;
  creatorDisplayName?: string;
  terms: ApiAgreementTerms;
  deliverableSummary?: string;
  workItems?: Array<Record<string, unknown>>;
  brandSnapshot?: Record<string, unknown> | null;
  promotionSnapshot?: Record<string, unknown> | null;
  creatorSnapshot?: Record<string, unknown> | null;
  canonicalTermsJson: string;
  termsHash: string;
  status: "AGREED" | "FUNDING_REQUIRED" | "FUNDED" | "REJECTED";
};

export type ApiTimelineEvent = {
  eventId: string;
  promotionId: string;
  type: string;
  data: Record<string, unknown>;
  createdAt: string;
  sequence?: number;
};

export type ApiNegotiationMessage = {
  messageId: string;
  negotiationId?: string;
  contextId: string;
  taskId: string;
  role?: string;
  sequence?: number;
  payload?: Record<string, unknown>;
  content?: Record<string, unknown>;
  a2aMessage?: Record<string, unknown>;
  createdAt: string;
};

export type ApiEvidence = {
  evidenceId: string;
  agreementId: string;
  milestoneId: string;
  creatorAgentId: string;
  status: "SUBMITTED" | "PASSED" | "FAILED";
};

export type ApiEscrow = {
  escrowId: string;
  agreementId: string;
  promotionId: string;
  network?: string;
  lockedAmountBaseUnits: string;
  fundedAmountBaseUnits?: string;
  fundedAmountUsdc?: string;
  totalAmountUsdc?: string;
  releasedAmountBaseUnits: string;
  releasedAmountUsdc?: string;
  refundedAmountUsdc?: string;
  milestoneAmounts?: Record<string, string>;
  status: "CREATED" | "FUNDED" | "PARTIALLY_RELEASED" | "RELEASED" | "LOCKED" | "COMPLETED" | string;
  brandAuthority?: string;
  creatorDestination?: string;
  escrowPda?: string;
  vaultTokenAccount?: string;
  brandTokenAccount?: string;
  fundingTransactionSignature?: string | null;
  lockSignature: string | null;
  lockReceiptId?: string;
};

export type ApiSettlement = {
  settlementId: string;
  escrowId: string;
  agreementId: string;
  milestoneId: string;
  amountBaseUnits: string;
  status: "SIMULATED" | "SUBMITTED" | "CONFIRMED" | string;
  signature: string | null;
};

export type ApiAutoSettlement = {
  attempted: boolean;
  released?: boolean;
  reason?: string;
  fallback?: string;
  signedBy?: string;
  settlement?: ApiSettlement | null;
};

export type ApiReceipt = {
  receiptId: string;
  paymentOperationId: string;
  network: string;
  signature: string | null;
  explorerUrl: string | null;
  status: "SIMULATED" | "SUBMITTED" | "CONFIRMED" | string;
  detail?: string;
};

export type BrandDashboard = {
  brand: Record<string, unknown>;
  summary: {
    activePromotions: number;
    negotiationsInProgress: number;
    agreements: number;
    lockedEscrowBaseUnits: string;
  };
  activePromotions: ApiPromotion[];
  recentAgentActivity: ApiTimelineEvent[];
  contractedCreators: Array<Record<string, unknown>>;
};

export type CreatorDashboard = {
  creator: Record<string, unknown>;
  summary: {
    newOffers: number;
    agentNegotiations: number;
    activeSponsorships: number;
    pendingPayoutBaseUnits: string;
  };
  offers: Array<Record<string, unknown>>;
  activeSponsorships: Array<Record<string, unknown>>;
  recentAgentActivity: Array<Record<string, unknown>>;
};

export type ApiNegotiationBundle = {
  promotion: ApiPromotion;
  matchRun: ApiMatchRun;
  candidates: ApiCandidate[];
  negotiation: ApiNegotiation;
  agreement: ApiAgreement | null;
  timeline: ApiTimelineEvent[];
};

export type ApiAgreementEscrowBundle = {
  escrow: ApiEscrow | null;
  settlements: ApiSettlement[];
};

export type EscrowFundingPrepare = {
  status: "PREPARED";
  agreementId: string;
  escrowId: string;
  network: string;
  mint: string;
  programId: string;
  brandAuthority: string;
  creatorDestination: string;
  settlementAuthority: string;
  totalAmountBaseUnits: string;
  brandTokenAccount: string;
  escrowPda: string;
  vaultTokenAccount: string;
  brandUsdcBalanceBaseUnits: string;
  estimatedNetworkFeeLamports: string;
  transactionBase64: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
  rpcUrl?: string;
};

export type EscrowReleasePrepare = {
  status: "PREPARED";
  agreementId: string;
  escrowId: string;
  milestoneId: string;
  network: string;
  mint: string;
  programId: string;
  creatorDestination: string;
  settlementAuthority: string;
  expectedAmountBaseUnits: string;
  escrowPda: string;
  vaultTokenAccount: string;
  creatorTokenAccount: string;
  estimatedNetworkFeeLamports: string;
  transactionBase64: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
  rpcUrl?: string;
};

export type ApiDevAdminOverview = {
  enabled: boolean;
  actorUid: string;
  counts: Record<string, number>;
  latestFailures: Array<Record<string, unknown>>;
};

export type ApiDemoPersonaLogin = {
  uid: string;
  email: string;
  passwordHint: string;
  canLogin: boolean;
  status: string;
};

export type ApiDemoBrandPersona = {
  kind: "BRAND";
  profileId: string;
  displayName: string;
  logoUrl?: string | null;
  categories: string[];
  description?: string | null;
  websiteUrl?: string | null;
  platforms: string[];
  socialProfiles: Record<string, unknown>;
  demoPermission: boolean;
  login: ApiDemoPersonaLogin;
};

export type ApiDemoCreatorPersona = {
  kind: "CREATOR";
  profileId: string;
  displayName: string;
  profileImageUrl?: string | null;
  categories: string[];
  primaryPlatform?: string | null;
  platforms: string[];
  subscriberOrFollowerCount?: number | null;
  averageRecentViews?: number | null;
  medianRecentViews?: number | null;
  contentKeywords: string[];
  formats: string[];
  login: ApiDemoPersonaLogin;
};

export type ApiDevDemoPersonas = {
  brandCount: number;
  creatorCount: number;
  loginPasswordHint: string;
  brands: ApiDemoBrandPersona[];
  creators: ApiDemoCreatorPersona[];
};

export type ApiSettlementBundle = ApiNegotiationBundle & {
  agreement: ApiAgreement;
  evidence: ApiEvidence;
  escrow: ApiEscrow;
  settlement: ApiSettlement;
  receipt: ApiReceipt;
};

export type BrandPromotionDetail = {
  promotion: ApiPromotion & Record<string, unknown>;
  agreement: (ApiAgreement & Record<string, unknown>) | null;
  agreements?: Array<ApiAgreement & Record<string, unknown>>;
  activity: ApiTimelineEvent[];
};

export type AgreementDetail = {
  agreement: ApiAgreement & Record<string, unknown>;
  escrow: ApiEscrow | null;
};

export type CreatorOfferDetail = {
  offer: Record<string, unknown>;
  negotiation: ApiNegotiation & Record<string, unknown>;
};

export type AgentPromotionRunResult = {
  promotion: ApiPromotion & Record<string, unknown>;
  matchRun: ApiMatchRun;
  candidates: ApiCandidate[];
  negotiation: ApiNegotiation | null;
  agreement: ApiAgreement | null;
  timeline: ApiTimelineEvent[];
  waitingForCreator: boolean;
};

export class ProductApiError extends Error {
  status: number;
  code: string;
  detail: unknown;

  constructor(message: string, status: number, code: string, detail: unknown) {
    super(message);
    this.name = "ProductApiError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export class ProductApiClient {
  private static authTokenProvider: (() => Promise<string | null>) | null = null;
  private baseUrl: string;

  constructor(baseUrl = apiBaseUrl()) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  static setAuthTokenProvider(provider: (() => Promise<string | null>) | null) {
    ProductApiClient.authTokenProvider = provider;
  }

  async health() {
    return this.raw<{ status: string; service: string }>("/readyz");
  }

  async getMe() {
    return this.request<CurrentUserContext>("/api/v1/me");
  }

  async selectMyRole(role: "BRAND" | "CREATOR", idempotencyKey: string) {
    return this.request<CurrentUserContext>("/api/v1/me/role", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ role }),
    });
  }

  async createMyBrandProfile(input: CurrentBrandProfileInput, idempotencyKey: string) {
    return this.request<{
      brand: Record<string, unknown>;
      agent: Record<string, unknown>;
    } & CurrentUserContext>("/api/v1/me/brand-profile", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(input),
    });
  }

  async createMyCreatorProfile(input: CurrentCreatorProfileInput, idempotencyKey: string) {
    return this.request<{
      creator: { creatorId: string; creatorAgentId: string };
      agent: Record<string, unknown>;
      policy: Record<string, unknown>;
    } & CurrentUserContext>("/api/v1/me/creator-profile", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(input),
    });
  }

  async listPromotions() {
    const response = await this.request<{ promotions: ApiPromotion[] }>("/api/v1/promotions");
    return response.promotions;
  }

  async getBrandDashboard() {
    const response = await this.request<{ dashboard: BrandDashboard }>("/api/v1/brand/dashboard");
    return response.dashboard;
  }

  async listBrandPromotions() {
    const response = await this.request<{ promotions: Array<ApiPromotion & Record<string, unknown>> }>(
      "/api/v1/brand/promotions",
    );
    return response.promotions;
  }

  async createBrandPromotion(input: BrandPromotionCreateInput, idempotencyKey: string) {
    const response = await this.request<{ promotion: ApiPromotion & Record<string, unknown> }>(
      "/api/v1/brand/promotions",
      {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify(input),
      },
    );
    return response.promotion;
  }

  async analyzeBrandSource(input: BrandSourceAnalysisInput) {
    return this.request<BrandSourceAnalysisDraft>("/api/v1/onboarding/brand/analyze-source", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async getOnboarding() {
    const response = await this.request<{ onboarding: OnboardingSession }>("/api/v1/onboarding");
    return response.onboarding;
  }

  async patchOnboarding(input: Partial<OnboardingSession> & { role: "BRAND" | "CREATOR" }) {
    const response = await this.request<{ onboarding: OnboardingSession }>("/api/v1/onboarding", {
      method: "PATCH",
      body: JSON.stringify(input),
    });
    return response.onboarding;
  }

  async analyzeProduct(sourceUrl: string, idempotencyKey?: string) {
    const headers = idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined;
    const response = await this.request<{ analysis: AnalysisJob }>("/api/v1/analyses/product", {
      method: "POST",
      headers,
      body: JSON.stringify({ sourceUrl }),
    });
    return response.analysis;
  }

  async analyzeCreatorProfile(sourceUrl: string, idempotencyKey?: string) {
    const headers = idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined;
    const response = await this.request<{ analysis: AnalysisJob }>(
      "/api/v1/analyses/creator-profile",
      {
        method: "POST",
        headers,
        body: JSON.stringify({ sourceUrl }),
      },
    );
    return response.analysis;
  }

  async getAnalysis(analysisId: string) {
    const response = await this.request<{ analysis: AnalysisJob }>(
      `/api/v1/analyses/${analysisId}`,
    );
    return response.analysis;
  }

  async confirmAnalysis(
    analysisId: string,
    input: { confirmedFields: string[]; edits?: Record<string, unknown> },
    idempotencyKey: string,
  ) {
    const response = await this.request<{ analysis: AnalysisJob }>(
      `/api/v1/analyses/${analysisId}:confirm`,
      {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ ...input, edits: input.edits ?? {} }),
      },
    );
    return response.analysis;
  }

  async getBrandPromotionDetail(promotionId: string) {
    return this.request<BrandPromotionDetail>(`/api/v1/brand/promotions/${promotionId}`);
  }

  async deleteBrandPromotion(promotionId: string, idempotencyKey: string) {
    return this.request<{ promotion: ApiPromotion & Record<string, unknown>; deleted: boolean }>(
      `/api/v1/brand/promotions/${promotionId}`,
      {
        method: "DELETE",
        headers: { "Idempotency-Key": idempotencyKey },
      },
    );
  }

  async listBrandAgreements() {
    const response = await this.request<{ agreements: Array<ApiAgreement & Record<string, unknown>> }>(
      "/api/v1/brand/agreements",
    );
    return response.agreements;
  }

  async getBrandAgreementDetail(agreementId: string) {
    return this.request<AgreementDetail>(`/api/v1/brand/agreements/${agreementId}`);
  }

  async listCreatorOffers() {
    const response = await this.request<{ offers: Array<Record<string, unknown>> }>(
      "/api/v1/creator/offers",
    );
    return response.offers;
  }

  async getCreatorOfferDetail(negotiationId: string) {
    return this.request<CreatorOfferDetail>(`/api/v1/creator/offers/${negotiationId}`);
  }

  async listCreatorAgreements() {
    const response = await this.request<{ agreements: Array<ApiAgreement & Record<string, unknown>> }>(
      "/api/v1/creator/agreements",
    );
    return response.agreements;
  }

  async getCreatorAgreementDetail(agreementId: string) {
    return this.request<AgreementDetail>(`/api/v1/creator/agreements/${agreementId}`);
  }

  async getCreatorDashboard() {
    const response = await this.request<{ dashboard: CreatorDashboard }>(
      "/api/v1/creator/dashboard",
    );
    return response.dashboard;
  }

  async getCreatorAgent() {
    return this.request<{
      agent: CreatorAgentControl;
      discoveryProfile: Record<string, unknown> | null;
    }>("/api/v1/creator/agent");
  }

  async publishCreatorAgent() {
    return this.request<{
      agent: CreatorAgentControl;
      discoveryProfile: Record<string, unknown>;
    }>("/api/v1/creator/agent:publish", { method: "POST" });
  }

  async pauseCreatorAgent() {
    return this.request<{
      agent: CreatorAgentControl;
      discoveryProfile: Record<string, unknown>;
    }>("/api/v1/creator/agent:pause", { method: "POST" });
  }

  async resumeCreatorAgent() {
    return this.request<{
      agent: CreatorAgentControl;
      discoveryProfile: Record<string, unknown>;
    }>("/api/v1/creator/agent:resume", { method: "POST" });
  }

  async bootstrapUser(input: BootstrapUserInput) {
    const response = await this.request<{ user: ApiUser }>("/api/v1/users:bootstrap", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return response.user;
  }

  async onboardBrand(input: BrandOnboardingInput) {
    return this.request<{ brand: Record<string, unknown>; agent: Record<string, unknown>; session: ApiRoleSession }>(
      "/api/v1/brands:onboard",
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }

  async onboardCreator(input: CreatorOnboardingInput) {
    return this.request<{
      creator: { creatorId: string; creatorAgentId: string };
      agent: Record<string, unknown>;
      policy: Record<string, unknown>;
      session: ApiRoleSession;
    }>("/api/v1/creators:onboard", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async updateCreatorCriteria(creatorId: string, input: CreatorCriteriaInput) {
    return this.request<{ creator: Record<string, unknown>; policy: Record<string, unknown> }>(
      `/api/v1/creators/${creatorId}/criteria`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }

  async createPromotion(input: PromotionCreateInput) {
    const response = await this.request<{ promotion: ApiPromotion }>("/api/v1/promotions", {
      method: "POST",
      body: JSON.stringify(withoutStatus(input)),
    });
    return response.promotion;
  }

  async runMatches(promotionId: string, idempotencyKey = `frontend-match-${promotionId}-${Date.now()}`) {
    const response = await this.request<{ matchRun: ApiMatchRun }>(
      `/api/v1/promotions/${promotionId}/matches:run`,
      {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
      },
    );
    return response.matchRun;
  }

  async listCandidates(matchRunId: string) {
    const response = await this.request<{ candidates: ApiCandidate[] }>(
      `/api/v1/match-runs/${matchRunId}/candidates`,
    );
    return response.candidates;
  }

  async getMatchRun(matchRunId: string) {
    const response = await this.request<{ matchRun: ApiMatchRun }>(
      `/api/v1/match-runs/${matchRunId}`,
    );
    return response.matchRun;
  }

  async listMatchRunEvents(matchRunId: string) {
    const response = await this.request<{ events: ApiTimelineEvent[] }>(
      `/api/v1/match-runs/${matchRunId}/events`,
    );
    return response.events;
  }

  /**
   * 캠페인 동기 실행: 탐색 → 병렬 A2A 협상 → 합의서 → 에스크로 락.
   * 스트림 없이 최종 결과만 필요할 때 쓴다. 금액을 생략하면 프로모션의
   * initialOffer / budget.maxPerCreatorUsdc를 서버가 기본값으로 쓴다.
   */
  async runCampaign(promotionId: string, body: CampaignRequest = {}) {
    return this.request<RunCampaignResponse>(
      `/api/v1/promotions/${encodeURIComponent(promotionId)}/campaigns`,
      {
        method: "POST",
        body: JSON.stringify(compactCampaignRequest(body)),
      },
    );
  }

  /**
   * EventSource용 절대 URL. 브라우저에서는 ProductApiClient와 같은 base URL
   * (basePath 포함 same-origin → `/api/v1/[...path]` 프록시)을 거치고, 서버에서는
   * KNOT_API_BASE_URL을 그대로 쓴다. ceilingUsdc(비공개 상한)는 브랜드 자신의
   * API로만 간다.
   */
  campaignStreamUrl(promotionId: string, params: CampaignRequest = {}) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(compactCampaignRequest(params))) {
      query.set(key, String(value));
    }
    const search = query.toString();
    const path = `${this.baseUrl}/api/v1/promotions/${encodeURIComponent(promotionId)}/campaigns/stream${
      search ? `?${search}` : ""
    }`;
    if (typeof window !== "undefined") {
      return new URL(path, window.location.origin).toString();
    }
    return path;
  }

  /**
   * 실행 중인 캠페인 취소. 대기 후보는 `CANCELED`로 미시작, 진행 중 협상은 다음 전송 전에
   * A2A cancel. 이미 만든 합의는 남는다. 실행 중이 아니면 404(`NOT_FOUND`).
   */
  async cancelCampaign(promotionId: string, campaignId: string) {
    return this.request<CancelCampaignResponse>(
      `/api/v1/promotions/${encodeURIComponent(promotionId)}/campaigns/${encodeURIComponent(campaignId)}:cancel`,
      { method: "POST" },
    );
  }

  /* ---------- 거버넌스 승인 큐 (docs/09 부록 5) ---------- */

  async listApprovals(status?: ApprovalStatus) {
    const search = status ? `?status=${encodeURIComponent(status)}` : "";
    const response = await this.request<ApprovalListResponse>(`/api/v1/approvals${search}`);
    return response.approvals;
  }

  async getApproval(approvalId: string) {
    const response = await this.request<ApprovalResponse>(`/api/v1/approvals/${encodeURIComponent(approvalId)}`);
    return response.approval;
  }

  /**
   * 승인 → 같은 `lock_escrow` 경로로 예치. 멱등키를 생략하면 서버가 `approval-{id}`를 쓴다.
   * 락 실패 시 409(승인은 PENDING 유지)로 던져진다.
   */
  async approveApproval(approvalId: string, idempotencyKey?: string) {
    const headers = idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined;
    return this.request<ApproveApprovalResponse>(`/api/v1/approvals/${encodeURIComponent(approvalId)}:approve`, {
      method: "POST",
      headers,
    });
  }

  async rejectApproval(approvalId: string, reason: string): Promise<ApprovalDoc> {
    const response = await this.request<ApprovalResponse>(`/api/v1/approvals/${encodeURIComponent(approvalId)}:reject`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
    return response.approval;
  }

  async getNegotiation(negotiationId: string) {
    const response = await this.request<{ negotiation: ApiNegotiation }>(
      `/api/v1/negotiations/${negotiationId}`,
    );
    return response.negotiation;
  }

  async listNegotiationMessages(negotiationId: string) {
    const response = await this.request<{ messages: ApiNegotiationMessage[] }>(
      `/api/v1/negotiations/${negotiationId}/messages`,
    );
    return response.messages;
  }

  async listNegotiationEvents(negotiationId: string) {
    const response = await this.request<{ events: ApiTimelineEvent[] }>(
      `/api/v1/negotiations/${negotiationId}/events`,
    );
    return response.events;
  }

  async startNegotiation(matchRunId: string) {
    return this.request<{ negotiation: ApiNegotiation; agreement: ApiAgreement | null }>(
      `/api/v1/match-runs/${matchRunId}/start-negotiation`,
      { method: "POST" },
    );
  }

  async getNegotiationAgreement(negotiationId: string) {
    const response = await this.request<{ agreement: ApiAgreement }>(
      `/api/v1/negotiations/${negotiationId}/agreement`,
    );
    return response.agreement;
  }

  async getAgreement(agreementId: string) {
    const response = await this.request<{ agreement: ApiAgreement }>(
      `/api/v1/agreements/${agreementId}`,
    );
    return response.agreement;
  }

  async getAgreementEscrow(agreementId: string) {
    return this.request<ApiAgreementEscrowBundle>(`/api/v1/agreements/${agreementId}/escrow`);
  }

  async createWalletChallenge(walletAddress: string) {
    return this.request<{
      challenge: { challengeId: string; walletAddress: string; message: string; expiresInSeconds: number };
    }>("/api/v1/me/wallet/challenge", {
      method: "POST",
      body: JSON.stringify({ walletAddress }),
    });
  }

  /**
   * 지갑 주소 등록. 소유 증명 서명이 필수다 — 플랫폼이 유저 키를 보관하지 않으므로
   * 이 서명만이 "이 주소가 이 유저 것" 을 보장한다(docs/17 D7).
   */
  async saveWalletAddress(
    walletAddress: string,
    proof: { challengeId: string; signature: string },
    network = "devnet",
  ) {
    return this.request<{ wallet: { walletAddress: string; walletNetwork: string } } & CurrentUserContext>(
      "/api/v1/me/wallet",
      {
        method: "POST",
        body: JSON.stringify({ walletAddress, network, ...proof }),
      },
    );
  }

  async prepareEscrowFunding(agreementId: string, idempotencyKey: string) {
    return this.request<{ escrow: ApiEscrow; funding: EscrowFundingPrepare | null }>(
      `/api/v1/agreements/${agreementId}/escrow/prepare`,
      {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
      },
    );
  }

  async confirmEscrowFunding(
    agreementId: string,
    transactionSignature: string,
    idempotencyKey: string,
  ) {
    return this.request<{ escrow: ApiEscrow; receipt: ApiReceipt }>(
      `/api/v1/agreements/${agreementId}/escrow/confirm`,
      {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ transactionSignature }),
      },
    );
  }

  async runAgentForPromotion(
    promotionId: string,
    idempotencyKey = `frontend-agent-run-${promotionId}-${Date.now()}`,
  ): Promise<AgentPromotionRunResult> {
    return this.request<AgentPromotionRunResult>(
      `/api/v1/brand/promotions/${promotionId}/agent-run`,
      {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
      },
    );
  }

  async getPromotion(promotionId: string) {
    const response = await this.request<{ promotion: ApiPromotion }>(
      `/api/v1/promotions/${promotionId}`,
    );
    return response.promotion;
  }

  async getTimeline(promotionId: string) {
    const response = await this.request<{ events: ApiTimelineEvent[] }>(
      `/api/v1/promotions/${promotionId}/timeline`,
    );
    return response.events;
  }

  async submitEvidence(
    agreement:
      | ApiAgreement
      | { agreementId: string; creatorAgentId: string },
    milestoneId: string,
    url = "https://social.example/post/with-brand-and-ad",
  ) {
    const response = await this.request<{ evidence: ApiEvidence }>(
      `/api/v1/agreements/${agreement.agreementId}/evidence`,
      {
        method: "POST",
        body: JSON.stringify({
          url,
          submittedByAgentId: agreement.creatorAgentId,
          milestoneId,
        }),
      },
    );
    return response.evidence;
  }

  /**
   * 증빙 검증. 판정은 4단이다 (docs/17 P1).
   *
   * VERIFIED 만 정산으로 이어진다. REVISION_REQUIRED / MANUAL_REVIEW 는 오류가 아니라
   * 계약이 살아 있는 상태이므로 200 으로 온다 — "실패" 로 표시하면 재제출 경로를 덮는다.
   * REJECTED 만 409 로 온다.
   */
  async verifyEvidence(evidenceId: string) {
    return this.request<{
      evidence: ApiEvidence;
      outcome?: "VERIFIED" | "REVISION_REQUIRED" | "MANUAL_REVIEW" | "REJECTED";
      reasonCodes?: string[];
      revisionsRemaining?: number;
      autoSettlement?: ApiAutoSettlement;
    }>(`/api/v1/evidence/${evidenceId}:verify`, { method: "POST" });
  }

  async lockEscrow(agreementId: string) {
    return this.request<{ escrow: ApiEscrow; receipt: ApiReceipt }>(
      `/api/v1/agreements/${agreementId}/escrow:lock`,
      {
        method: "POST",
        headers: { "Idempotency-Key": `frontend-lock-${agreementId}` },
      },
    );
  }

  async releaseMilestone(escrowId: string, milestoneId: string) {
    return this.request<{ settlement: ApiSettlement; escrow: ApiEscrow; receipt: ApiReceipt }>(
      `/api/v1/escrows/${escrowId}/milestones/${milestoneId}:release`,
      {
        method: "POST",
        headers: { "Idempotency-Key": `frontend-release-${escrowId}-${milestoneId}` },
      },
    );
  }

  async prepareMilestoneRelease(escrowId: string, milestoneId: string, idempotencyKey: string) {
    return this.request<{ escrow: ApiEscrow; release: EscrowReleasePrepare }>(
      `/api/v1/escrows/${escrowId}/milestones/${milestoneId}/release/prepare`,
      {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
      },
    );
  }

  async confirmMilestoneRelease(
    escrowId: string,
    milestoneId: string,
    transactionSignature: string,
    creatorTokenAccount: string,
    idempotencyKey: string,
  ) {
    return this.request<{ settlement: ApiSettlement; escrow: ApiEscrow; receipt: ApiReceipt }>(
      `/api/v1/escrows/${escrowId}/milestones/${milestoneId}/release/confirm`,
      {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ transactionSignature, creatorTokenAccount }),
      },
    );
  }

  async getDevAdminOverview() {
    const response = await this.request<{ overview: ApiDevAdminOverview }>(
      "/api/v1/dev-admin/overview",
    );
    return response.overview;
  }

  async getDevAdminDemoPersonas() {
    const response = await this.request<{ personas: ApiDevDemoPersonas }>(
      "/api/v1/dev-admin/demo-personas",
    );
    return response.personas;
  }

  private async raw<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = await this.headers(init);
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      cache: "no-store",
      headers,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw toApiError(response.status, body);
    }
    return body as T;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const envelope = await this.raw<ApiEnvelope<T>>(path, init);
    return envelope.data;
  }

  private async headers(init?: RequestInit) {
    const headers = new Headers(init?.headers);
    if (init?.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    const token = await ProductApiClient.authTokenProvider?.();
    if (token && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    return headers;
  }
}

/** 실패 응답(status + JSON body)을 ProductApiError로. 스트림(fetch SSE) 경로도 같은 규칙을 쓴다. */
export function toApiError(status: number, body: unknown) {
  if (isProblemEnvelope(body)) {
    const message =
      userFacingProblemMessage(body.detail.code) ??
      (typeof body.detail.detail === "string" ? body.detail.detail : body.detail.title);
    return new ProductApiError(message, status, body.detail.code, body.detail);
  }
  if (isFastApiValidationEnvelope(body)) {
    return new ProductApiError(
      validationMessage(body.detail),
      status,
      "VALIDATION_ERROR",
      body.detail,
    );
  }
  return new ProductApiError(`요청이 실패했습니다. 상태 코드: ${status}`, status, "API_ERROR", body);
}

/**
 * 409 `CAMPAIGN_ALREADY_RUNNING`의 detail 문장("Campaign campaign-… is already running …")에서
 * 캠페인 id를 뽑는다. 문구가 바뀌어도 죽지 않도록 못 찾으면 null.
 */
export function runningCampaignIdFromProblem(problem: unknown): string | null {
  // 백엔드 id는 `campaign-{uuid4}`. 문제 문서의 `type` URL(…/campaign-already-running)에 속지 않도록
  // uuid 꼴을 먼저 찾고, detail 문장에서만 느슨한 꼴을 허용한다.
  const UUID_ID = /\bcampaign-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/i;
  const LOOSE_ID = /\bcampaign-(?!already\b)[0-9A-Za-z]+(?:-[0-9A-Za-z]+)*\b/;
  const texts: string[] = [];
  const visit = (value: unknown) => {
    if (typeof value === "string") texts.push(value);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  visit(problem);
  for (const text of texts) {
    const match = UUID_ID.exec(text);
    if (match) return match[0];
  }
  const detail = isProblemEnvelope(problem) ? problem.detail.detail : null;
  const loose = typeof detail === "string" ? LOOSE_ID.exec(detail) : null;
  return loose ? loose[0] : null;
}

function userFacingProblemMessage(code: string) {
  if (code === "CAMPAIGN_ALREADY_RUNNING") {
    return "이 프로모션에는 이미 실행 중인 캠페인이 있습니다. 먼저 취소하거나 끝날 때까지 기다려 주세요.";
  }
  if (code === "ROLE_ALREADY_SELECTED") {
    return "KNOT v1에서는 한 계정에 하나의 역할만 사용할 수 있습니다. 브랜드 데모는 t1, 크리에이터 데모는 c1 계정으로 각각 입장해 주세요.";
  }
  if (code === "FORBIDDEN") {
    return "현재 계정 권한으로는 이 작업을 할 수 없습니다. 로그인한 역할과 화면을 확인해 주세요.";
  }
  return null;
}

function isProblemEnvelope(value: unknown): value is {
  detail: { title: string; code: string; detail?: string };
} {
  if (!value || typeof value !== "object" || !("detail" in value)) return false;
  const detail = (value as { detail: unknown }).detail;
  return Boolean(
    detail &&
      typeof detail === "object" &&
      "code" in detail &&
      "title" in detail,
  );
}

function isFastApiValidationEnvelope(value: unknown): value is {
  detail: Array<{ loc?: unknown[]; msg?: string }>;
} {
  if (!value || typeof value !== "object" || !("detail" in value)) return false;
  return Array.isArray((value as { detail: unknown }).detail);
}

function validationMessage(errors: Array<{ loc?: unknown[]; msg?: string }>) {
  const first = errors[0];
  if (!first) return "입력값을 확인해주세요.";
  const field = Array.isArray(first.loc) ? first.loc.filter((part) => part !== "body").join(".") : "";
  return field ? `${field}: ${first.msg ?? "입력값을 확인해주세요."}` : first.msg ?? "입력값을 확인해주세요.";
}

/** undefined / NaN 필드를 제거해 서버 기본값이 적용되게 한다. */
function compactCampaignRequest(input: CampaignRequest) {
  const payload: Record<string, number> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      payload[key] = value;
    }
  }
  return payload;
}

function withoutStatus(input: PromotionCreateInput) {
  const payload: Partial<PromotionCreateInput> = { ...input };
  delete payload.status;
  return payload;
}

export function apiBaseUrl() {
  if (typeof window !== "undefined") {
    // Same-origin relative fetch, but prefixed with the app's basePath when the
    // deployment is served under a path prefix (e.g. thezonebio.com/knot) —
    // Next's basePath rewriting doesn't cover raw fetch() calls.
    return process.env.NEXT_PUBLIC_KNOT_BASE_PATH ?? "";
  }
  return (
    process.env.KNOT_API_BASE_URL ??
    process.env.NEXT_PUBLIC_KNOT_API_BASE_URL ??
    "http://127.0.0.1:8080"
  );
}
