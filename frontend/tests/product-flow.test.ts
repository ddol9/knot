import assert from "node:assert/strict";
import test from "node:test";
import { firebaseAuthErrorMessage } from "../src/auth/firebaseClient";
import { getDashboardPath, headerMenuForAuth, postLoginPath, safeRedirectPath } from "../src/auth/authState";
import { accountRoutes, appRoutes, brandWorkspaceRoutes, creatorWorkspaceRoutes, roleHome, roleNegotiation, roleResult } from "../src/product/flow";
import { createKnotDataSource, resolveDataMode } from "../src/product/dataSource";
import { ProductApiClient, ProductApiError, type ApiPromotion } from "../src/product/apiClient";
import {
  calculateBrandEscrow,
  calculateCreatorSettlement,
  mapTaskStateToCreatorStatus,
  promotionProgress,
} from "../src/product/mvp";

test("product route surface exposes separated MVP role pages", () => {
  assert.deepEqual(appRoutes, [
    "/",
    "/login",
    "/signup",
    "/signup/brand",
    "/signup/creator",
    "/brand",
    "/brand/onboarding",
    "/brand/promotions",
    "/brand/promotions/new",
    "/brand/promotions/[promotionId]",
    "/brand/negotiations/[negotiationId]",
    "/brand/agreements/[agreementId]",
    "/brand/products/new",
    "/brand/negotiate",
    "/brand/result",
    "/brand/settlement",
    "/brand/me",
    "/brand/settings",
    "/creator",
    "/creator/onboarding",
    "/creator/offers",
    "/creator/offers/[negotiationId]",
    "/creator/criteria",
    "/creator/result",
    "/creator/agreements",
    "/creator/agreements/[agreementId]",
    "/creator/settlements",
    "/creator/me",
    "/creator/settings",
    "/dev/admin",
  ]);
});

test("workspace nav is menu-like and role-specific", () => {
  assert.deepEqual(brandWorkspaceRoutes.map((route) => route.href), [
    "/brand",
    "/brand/promotions",
    "/brand/promotions",
    "/brand/promotions",
  ]);
  assert.deepEqual(creatorWorkspaceRoutes.map((route) => route.href), [
    "/creator",
    "/creator/criteria",
    "/creator/offers",
    "/creator/agreements",
    "/creator/settlements",
  ]);
});

test("auth header menu follows loading unauthenticated and authenticated states", () => {
  assert.deepEqual(headerMenuForAuth("loading", null), ["loading"]);
  assert.deepEqual(headerMenuForAuth("unauthenticated", null), ["login", "signup"]);
  assert.deepEqual(headerMenuForAuth("authenticated", "BRAND"), ["dashboard", "mypage", "logout"]);
  assert.deepEqual(headerMenuForAuth("authenticated", "CREATOR"), ["dashboard", "mypage", "logout"]);
});

test("auth helpers preserve safe redirects and role dashboard paths", () => {
  assert.equal(getDashboardPath("BRAND"), "/brand");
  assert.equal(getDashboardPath("CREATOR"), "/creator");
  assert.equal(getDashboardPath(null), null);
  assert.equal(safeRedirectPath("/brand/promotions/promotion-1"), "/brand/promotions/promotion-1");
  assert.equal(safeRedirectPath("//evil.example"), null);
  assert.equal(safeRedirectPath("/api/v1/me"), null);
});

test("post-login redirect sends completed brands to dashboard instead of creation flow", () => {
  const brandAccount = {
    uid: "uid",
    userId: "uid",
    email: "brand@example.com",
    displayName: "Brand",
    photoUrl: null,
    role: "BRAND" as const,
    onboardingStatus: "COMPLETED" as const,
    status: "ACTIVE" as const,
    brandId: "brand-1",
    creatorId: null,
    agentId: "agent-brand-1",
    schemaVersion: 2,
  };

  assert.equal(postLoginPath(brandAccount, "/brand", "/brand/promotions/new"), "/brand");
  assert.equal(postLoginPath(brandAccount, "/brand", "/brand/products/new"), "/brand");
  assert.equal(postLoginPath(brandAccount, "/brand", "/brand/promotions/promotion-1"), "/brand/promotions/promotion-1");
  assert.equal(postLoginPath(brandAccount, "/brand", "/creator"), "/brand");
});

test("Firebase auth errors map to user-facing messages", () => {
  assert.equal(
    // 443aaf6 에서 내부 기술 용어(Firebase 허용 목록)를 유저 문구로 바꿨다.
    firebaseAuthErrorMessage({ code: "auth/unauthorized-domain" }),
    "현재 접속한 주소에서는 로그인을 사용할 수 없습니다.",
  );
  assert.equal(
    firebaseAuthErrorMessage({ code: "auth/popup-blocked" }),
    "브라우저가 로그인 팝업을 차단했습니다. 팝업을 허용해주세요.",
  );
  assert.equal(
    firebaseAuthErrorMessage({ code: "auth/weak-password" }),
    "비밀번호는 최소 6자 이상이어야 합니다.",
  );
  assert.equal(
    firebaseAuthErrorMessage({ code: "auth/operation-not-allowed" }),
    "현재 사용할 수 없는 로그인 방식입니다. 다른 방식으로 시도해주세요.",
  );
});

test("A2A task state maps to creator display status", () => {
  assert.equal(mapTaskStateToCreatorStatus("TASK_STATE_SUBMITTED", "OFFERED"), "제안 도착");
  assert.equal(mapTaskStateToCreatorStatus("TASK_STATE_WORKING", "WORKING"), "Agent 분석 중");
  assert.equal(mapTaskStateToCreatorStatus("TASK_STATE_AUTH_REQUIRED", "ESCALATED"), "내 승인 필요");
  assert.equal(mapTaskStateToCreatorStatus("TASK_STATE_COMPLETED", "AGREED"), "협상 성공");
  assert.equal(mapTaskStateToCreatorStatus("TASK_STATE_FAILED", "FAILED"), "협상 실패");
});

test("settlement and promotion selectors keep MVP concepts separated", () => {
  assert.deepEqual(
    calculateCreatorSettlement([
      { status: "RELEASED", amountUsdc: 300 },
      { status: "VERIFIED", amountUsdc: 200 },
      { status: "SUBMITTED", amountUsdc: 100 },
    ]),
    { paidAmount: 300, availableToClaimAmount: 200, pendingAmount: 100 },
  );
  assert.deepEqual(
    calculateBrandEscrow(
      {
        escrowId: "escrow-1",
        agreementId: "agreement-1",
        promotionId: "promotion-1",
        lockedAmountBaseUnits: "1000000000",
        releasedAmountBaseUnits: "300000000",
        status: "LOCKED",
        lockSignature: null,
        lockReceiptId: "receipt-1",
      },
      [{ settlementId: "settlement-1", escrowId: "escrow-1", agreementId: "agreement-1", milestoneId: "content", amountBaseUnits: "300000000", status: "CONFIRMED", signature: "sig" }],
    ),
    { lockedAmount: 700, releasableAmount: 0, releasedAmount: 300 },
  );
  assert.equal(
    promotionProgress({
      promotionId: "promotion-1",
      brandId: "brand-1",
      brandAgentId: "agent-1",
      title: "Promo",
      objective: "awareness",
      category: "beauty",
      targetAudience: ["20s"],
      budget: { totalUsdc: 1000, maxPerCreatorUsdc: 500 },
      deliverables: [],
      postingWindow: { start: "2026-08-01", end: "2026-08-10" },
      usageRights: "organicOnly",
      status: "NEGOTIATING",
    }),
    38,
  );
});

test("account routes are kept out of role workspace menus", () => {
  assert.deepEqual(accountRoutes.map((route) => route.href), [
    "/brand/me",
    "/brand/settings",
    "/creator/me",
    "/creator/settings",
  ]);
});

test("data source defaults to API mode unless mock mode is explicitly requested", () => {
  const previous = process.env.NEXT_PUBLIC_KNOT_DATA_MODE;
  delete process.env.NEXT_PUBLIC_KNOT_DATA_MODE;
  delete process.env.KNOT_DATA_MODE;
  try {
    assert.equal(resolveDataMode(), "api");
    process.env.NEXT_PUBLIC_KNOT_DATA_MODE = "mock";
    assert.equal(resolveDataMode(), "mock");
  } finally {
    if (previous === undefined) {
      delete process.env.NEXT_PUBLIC_KNOT_DATA_MODE;
    } else {
      process.env.NEXT_PUBLIC_KNOT_DATA_MODE = previous;
    }
  }
});

test("role route helpers point to current MVP entry points", () => {
  assert.equal(roleHome("brand"), "/brand");
  assert.equal(roleNegotiation("brand"), "/brand/negotiate");
  assert.equal(roleResult("brand"), "/brand/result");
  assert.equal(roleHome("creator"), "/creator");
  assert.equal(roleNegotiation("creator"), "/creator/result");
  assert.equal(roleResult("creator"), "/creator/result");
});

test("mock data source exposes sanitized negotiation views for both roles", async () => {
  const mockDataSource = createKnotDataSource("mock");
  const brand = await mockDataSource.getNegotiation("brand");
  const creator = await mockDataSource.getNegotiation("creator");

  assert.equal(brand.taskId, creator.taskId);
  assert.ok(brand.publicSummary.some((line) => line.includes("최소 단가")));
  assert.ok(creator.publicSummary.some((line) => line.includes("hard maximum")));
  assert.equal(brand.termsHash, creator.termsHash);
});

test("mock data source exposes DB-ready creator deal and criteria collections", async () => {
  const mockDataSource = createKnotDataSource("mock");
  const criteria = await mockDataSource.getCreatorCriteria();
  const deals = await mockDataSource.getCreatorDeals();
  const agreedDeal = await mockDataSource.getCreatorDeal("agreement-mock-alpha");

  assert.ok(criteria.blockedDomains.includes("담배"));
  assert.ok(deals.some((deal) => deal.status === "AGREED"));
  assert.equal(agreedDeal?.settlement.escrowStatus, "LOCKED");
});

test("API data source reads a pending negotiation without creating agent resources", async () => {
  const previousFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];
  const promotion: ApiPromotion = {
    promotionId: "promotion-api-pending",
    brandId: "brand-api",
    brandAgentId: "brand-agent-api",
    title: "API pending Promotion",
    objective: "awareness",
    category: "beauty",
    targetAudience: ["20s"],
    budget: { totalUsdc: 1200, maxPerCreatorUsdc: 600 },
    deliverables: [{ format: "reel", count: 1 }],
    postingWindow: { start: "2026-08-01", end: "2026-08-10" },
    usageRights: "paidBoost30d",
    constraints: { requiredDisclosures: ["ad"], prohibitedClaims: [] },
    autonomy: { maxNegotiationRounds: 5, autoEscrow: false, autoRelease: false },
    status: "DRAFT",
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET" });
    if (url.endsWith("/api/v1/promotions/promotion-api-pending")) {
      return Response.json({ data: { promotion } });
    }
    if (url.endsWith("/api/v1/promotions/promotion-api-pending/timeline")) {
      return Response.json({ data: { events: [] } });
    }
    return Response.json({ detail: { title: "Unexpected request", code: "TEST_ERROR" } }, { status: 500 });
  }) as typeof fetch;

  try {
    const apiDataSource = createKnotDataSource("api");
    const view = await apiDataSource.getNegotiation("brand", {
      promotionId: "promotion-api-pending",
    });
    assert.equal(view.agreementId, null);
    assert.equal(view.negotiationId, null);
    assert.deepEqual(calls.map((call) => call.method), ["GET", "GET"]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("API data source projects canonical match run replay and technical proof", async () => {
  const previousFetch = globalThis.fetch;
  const calls: string[] = [];
  const promotion: ApiPromotion = {
    promotionId: "promotion-api-live",
    brandId: "brand-api",
    brandAgentId: "brand-agent-api",
    title: "API live Promotion",
    objective: "awareness",
    category: "beauty",
    targetAudience: ["20s"],
    budget: { totalUsdc: 1200, maxPerCreatorUsdc: 600 },
    deliverables: [{ format: "reel", count: 1 }],
    postingWindow: { start: "2026-08-01", end: "2026-08-10" },
    usageRights: "organicOnly",
    constraints: { requiredDisclosures: ["ad"], prohibitedClaims: [] },
    autonomy: { maxNegotiationRounds: 3, autoEscrow: false, autoRelease: false },
    status: "NEGOTIATING",
  };

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/api/v1/promotions/promotion-api-live")) {
      return Response.json({ data: { promotion } });
    }
    if (url.endsWith("/api/v1/promotions/promotion-api-live/timeline")) {
      return Response.json({
        data: {
          events: [
            {
              eventId: "timeline-match",
              promotionId: "promotion-api-live",
              type: "MATCH_RUN_COMPLETED",
              data: { matchRunId: "match-api-live", selectedCreatorAgentId: "creator-agent-api" },
              createdAt: "2026-07-31T01:00:00Z",
            },
            {
              eventId: "timeline-negotiation",
              promotionId: "promotion-api-live",
              type: "NEGOTIATION_STARTED",
              data: { negotiationId: "negotiation-api-live" },
              createdAt: "2026-07-31T01:01:00Z",
            },
          ],
        },
      });
    }
    if (url.endsWith("/api/v1/negotiations/negotiation-api-live")) {
      return Response.json({
        data: {
          negotiation: {
            negotiationId: "negotiation-api-live",
            matchRunId: "match-api-live",
            matchCandidateId: "candidate-api-live",
            promotionId: "promotion-api-live",
            brandAgentId: "brand-agent-api",
            creatorAgentId: "creator-agent-api",
            contextId: "context-api-live",
            taskId: "task-api-live",
            status: "AGREED",
            currentRound: 2,
            maxRounds: 3,
            currentTerms: {
              compensation: { structure: "flat", baseAmountUsdc: 520 },
              deliverables: [{ format: "reel", count: 1, postWindow: promotion.postingWindow }],
              usageRights: "organicOnly",
              milestones: [{ id: "content", trigger: "contentLiveVerified", releasePct: 100 }],
            },
          },
        },
      });
    }
    if (url.endsWith("/api/v1/negotiations/negotiation-api-live/agreement")) {
      return Response.json({
        data: {
          agreement: {
            agreementId: "agreement-api-live",
            negotiationId: "negotiation-api-live",
            taskId: "task-api-live",
            artifactId: "artifact-api-live",
            promotionId: "promotion-api-live",
            brandAgentId: "brand-agent-api",
            creatorAgentId: "creator-agent-api",
            terms: {
              compensation: { structure: "flat", baseAmountUsdc: 520 },
              deliverables: [{ format: "reel", count: 1, postWindow: promotion.postingWindow }],
              usageRights: "organicOnly",
              milestones: [{ id: "content", trigger: "contentLiveVerified", releasePct: 100 }],
            },
            canonicalTermsJson: "{}",
            termsHash: "sha256:agreement-api-live",
            status: "AGREED",
          },
        },
      });
    }
    if (url.endsWith("/api/v1/match-runs/match-api-live")) {
      return Response.json({
        data: {
          matchRun: {
            matchRunId: "match-api-live",
            promotionId: "promotion-api-live",
            brandAgentId: "brand-agent-api",
            status: "COMPLETED",
            selectedCreatorId: "creator-api",
            selectedCreatorAgentId: "creator-agent-api",
          },
        },
      });
    }
    if (url.endsWith("/api/v1/match-runs/match-api-live/candidates")) {
      return Response.json({
        data: {
          candidates: [
            {
              creatorId: "creator-api",
              creatorAgentId: "creator-agent-api",
              rank: 1,
              eligible: true,
              overallScore: 0.92,
              explanation: "public fit reason",
            },
          ],
        },
      });
    }
    if (url.endsWith("/api/v1/match-runs/match-api-live/events")) {
      return Response.json({
        data: {
          events: [
            {
              eventId: "run-ready",
              promotionId: "promotion-api-live",
              type: "MATCH_RUN_READY",
              data: { matchRunId: "match-api-live" },
              createdAt: "2026-07-31T01:00:00Z",
              sequence: 1,
            },
            {
              eventId: "run-completed",
              promotionId: "promotion-api-live",
              type: "MATCH_RUN_COMPLETED",
              data: { matchRunId: "match-api-live", selectedCreatorAgentId: "creator-agent-api" },
              createdAt: "2026-07-31T01:00:04Z",
              sequence: 5,
            },
          ],
        },
      });
    }
    if (url.endsWith("/api/v1/negotiations/negotiation-api-live/events")) {
      return Response.json({
        data: {
          events: [
            {
              eventId: "decision-accept",
              promotionId: "promotion-api-live",
              type: "NEGOTIATION_ACCEPT",
              data: { decisionId: "decision-accept" },
              createdAt: "2026-07-31T01:01:30Z",
            },
          ],
        },
      });
    }
    return Response.json({ detail: { title: "Unexpected request", code: "TEST_ERROR" } }, { status: 500 });
  }) as typeof fetch;

  try {
    const view = await createKnotDataSource("api").getNegotiation("brand", {
      promotionId: "promotion-api-live",
    });
    assert.deepEqual(view.runEvents.map((event) => event.type), [
      "MATCH_RUN_READY",
      "MATCH_RUN_COMPLETED",
    ]);
    assert.ok(view.technicalProof.some((item) => item.label === "Data source" && item.value === "LIVE"));
    // 라벨이 "A2A Task ID" -> "협상 기록" 으로 바뀌었다(443aaf6, 내부 기술 용어 제거).
    assert.ok(view.technicalProof.some((item) => item.label === "협상 기록" && item.value === "task-api-live"));
    assert.ok(calls.some((url) => url.endsWith("/api/v1/match-runs/match-api-live/events")));
    assert.ok(calls.some((url) => url.endsWith("/api/v1/negotiations/negotiation-api-live/events")));
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("API client does not start negotiation when matching has no eligible creator", async () => {
  const previousFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];
  const promotion: ApiPromotion = {
    promotionId: "promotion-no-candidate",
    brandId: "brand-api",
    brandAgentId: "brand-agent-api",
    title: "No candidate Promotion",
    objective: "awareness",
    category: "gambling",
    targetAudience: ["20s"],
    budget: { totalUsdc: 100, maxPerCreatorUsdc: 100 },
    deliverables: [{ format: "reel", count: 1 }],
    postingWindow: { start: "2026-08-01", end: "2026-08-10" },
    usageRights: "paidBoost30d",
    constraints: { requiredDisclosures: ["ad"], prohibitedClaims: [] },
    autonomy: { maxNegotiationRounds: 5, autoEscrow: false, autoRelease: false },
    status: "DRAFT",
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET" });
    if (url.endsWith("/api/v1/brand/promotions/promotion-no-candidate/agent-run")) {
      return Response.json(
        {
          data: {
            promotion,
            matchRun: {
              matchRunId: "match-no-candidate",
              promotionId: "promotion-no-candidate",
              brandAgentId: "brand-agent-api",
              status: "COMPLETED",
              selectedCreatorId: null,
              selectedCreatorAgentId: null,
            },
            candidates: [
              {
                creatorId: "creator-001",
                creatorAgentId: "creator-agent-001",
                eligible: false,
                hardFilterReasons: ["CATEGORY_MISMATCH", "RATE_EXCEEDS_MAX_PER_CREATOR"],
              },
            ],
            negotiation: null,
            agreement: null,
            timeline: [],
            waitingForCreator: true,
          },
        },
        { status: 201 },
      );
    }
    return Response.json({ detail: { title: "Unexpected request", code: "TEST_ERROR" } }, { status: 500 });
  }) as typeof fetch;

  try {
    const flow = await new ProductApiClient("").runAgentForPromotion("promotion-no-candidate");
    assert.equal(flow.waitingForCreator, true);
    assert.equal(flow.negotiation, null);
    assert.deepEqual(calls.map((call) => call.method), ["POST"]);
    assert.ok(!calls.some((call) => call.url.includes(":start-negotiation")));
    assert.ok(!calls.some((call) => call.url.includes("matches:run")));
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("evidence verification surfaces the four-way outcome", async () => {
  // REVISION_REQUIRED / MANUAL_REVIEW 는 200 으로 오므로 클라이언트가 오류로 만들지 않아야
  // 한다 — 오류로 내면 화면이 "실패" 로 보여서 재제출 경로를 덮는다 (docs/17 P1).
  const previousFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    Response.json({
      data: {
        evidence: { evidenceId: "evidence-1", status: "FAILED" },
        outcome: "REVISION_REQUIRED",
        reasonCodes: ["EVIDENCE_DISCLOSURE_MISSING"],
        revisionsRemaining: 1,
        autoSettlement: { attempted: false, reason: "REVISION_REQUIRED" },
      },
    })) as typeof fetch;

  try {
    const result = await new ProductApiClient("").verifyEvidence("evidence-1");
    assert.equal(result.outcome, "REVISION_REQUIRED");
    assert.deepEqual(result.reasonCodes, ["EVIDENCE_DISCLOSURE_MISSING"]);
    assert.equal(result.revisionsRemaining, 1);
    assert.equal(result.autoSettlement?.released, undefined);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("wallet registration sends the ownership proof signature", async () => {
  // 플랫폼이 유저 키를 보관하지 않으므로(docs/17 D7) 주소만 보내는 등록은 있어서는 안 된다.
  const previousFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: unknown }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.endsWith("/api/v1/me/wallet/challenge")) {
      return Response.json({
        data: {
          challenge: {
            challengeId: "walletchal-1",
            walletAddress: "WalletAddress1",
            message: "knot-wallet-ownership:walletchal-1",
            expiresInSeconds: 600,
          },
        },
      });
    }
    return Response.json({ data: { wallet: { walletAddress: "WalletAddress1", walletNetwork: "devnet" } } });
  }) as typeof fetch;

  try {
    const client = new ProductApiClient("");
    const { challenge } = await client.createWalletChallenge("WalletAddress1");
    await client.saveWalletAddress("WalletAddress1", {
      challengeId: challenge.challengeId,
      signature: "test-signature",
    });

    assert.equal(calls.length, 2);
    assert.ok(calls[0].url.endsWith("/api/v1/me/wallet/challenge"));
    assert.deepEqual(calls[0].body, { walletAddress: "WalletAddress1" });
    assert.ok(calls[1].url.endsWith("/api/v1/me/wallet"));
    assert.deepEqual(calls[1].body, {
      walletAddress: "WalletAddress1",
      network: "devnet",
      challengeId: "walletchal-1",
      signature: "test-signature",
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("API client forwards Firebase bearer token when configured", async () => {
  const previousFetch = globalThis.fetch;
  let observedAuthorization: string | null = null;
  ProductApiClient.setAuthTokenProvider(async () => "firebase-test-token");

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    observedAuthorization = new Headers(init?.headers).get("Authorization");
    return Response.json({
      data: {
        account: {
          uid: "firebase-uid",
          userId: "firebase-uid",
          email: "tester@example.com",
          displayName: "Tester",
          photoUrl: null,
          role: null,
          onboardingStatus: "ROLE_REQUIRED",
          status: "ACTIVE",
          brandId: null,
          creatorId: null,
          agentId: null,
          schemaVersion: 2,
        },
        profileSummary: null,
        dashboardTarget: "/signup",
      },
    });
  }) as typeof fetch;

  try {
    const context = await new ProductApiClient("").getMe();
    assert.equal(context.account.uid, "firebase-uid");
    assert.equal(observedAuthorization, "Bearer firebase-test-token");
  } finally {
    ProductApiClient.setAuthTokenProvider(null);
    globalThis.fetch = previousFetch;
  }
});

test("API client maps one-role account conflicts to demo-friendly Korean copy", async () => {
  const previousFetch = globalThis.fetch;
  ProductApiClient.setAuthTokenProvider(async () => "firebase-test-token");

  globalThis.fetch = (async () =>
    Response.json(
      {
        detail: {
          title: "Conflict",
          code: "ROLE_ALREADY_SELECTED",
          detail: "A KNOT v1 account can only have one role.",
        },
      },
      { status: 409 },
    )) as typeof fetch;

  try {
    await assert.rejects(
      () => new ProductApiClient("").selectMyRole("CREATOR", "role-conflict-test"),
      (caught: unknown) => {
        assert.ok(caught instanceof ProductApiError);
        assert.equal(caught.code, "ROLE_ALREADY_SELECTED");
        assert.match(caught.message, /한 계정에 하나의 역할/);
        assert.match(caught.message, /브랜드 데모는 t1/);
        return true;
      },
    );
  } finally {
    ProductApiClient.setAuthTokenProvider(null);
    globalThis.fetch = previousFetch;
  }
});

test("API client reads authenticated role dashboards without mock fallback", async () => {
  const previousFetch = globalThis.fetch;
  const calls: string[] = [];
  ProductApiClient.setAuthTokenProvider(async () => "firebase-dashboard-token");

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(String(input));
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer firebase-dashboard-token");
    if (String(input).endsWith("/api/v1/brand/dashboard")) {
      return Response.json({
        data: {
          dashboard: {
            brand: { brandId: "brand-owned", displayName: "Brand" },
            summary: {
              activePromotions: 0,
              negotiationsInProgress: 0,
              agreements: 0,
              lockedEscrowBaseUnits: "0",
            },
            activePromotions: [],
            recentAgentActivity: [],
            contractedCreators: [],
          },
        },
      });
    }
    if (String(input).endsWith("/api/v1/creator/dashboard")) {
      return Response.json({
        data: {
          dashboard: {
            creator: { creatorId: "creator-owned", displayName: "Creator" },
            summary: {
              newOffers: 0,
              agentNegotiations: 0,
              activeSponsorships: 0,
              pendingPayoutBaseUnits: "0",
            },
            offers: [],
            activeSponsorships: [],
            recentAgentActivity: [],
          },
        },
      });
    }
    return Response.json({ detail: { title: "Unexpected request", code: "TEST_ERROR" } }, { status: 500 });
  }) as typeof fetch;

  try {
    const api = new ProductApiClient("");
    assert.equal((await api.getBrandDashboard()).brand.brandId, "brand-owned");
    assert.equal((await api.getCreatorDashboard()).creator.creatorId, "creator-owned");
    assert.deepEqual(calls, ["/api/v1/brand/dashboard", "/api/v1/creator/dashboard"]);
  } finally {
    ProductApiClient.setAuthTokenProvider(null);
    globalThis.fetch = previousFetch;
  }
});

test("API client uses resource routes for promotions offers and agreements", async () => {
  const previousFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];
  ProductApiClient.setAuthTokenProvider(async () => "resource-token");

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET" });
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer resource-token");
    if (url.endsWith("/api/v1/brand/promotions") && init?.method === "POST") {
      return Response.json({ data: { promotion: { promotionId: "promotion-resource" } } }, { status: 201 });
    }
    if (url.endsWith("/api/v1/brand/promotions/promotion-resource")) {
      return Response.json({
        data: {
          promotion: { promotionId: "promotion-resource", title: "Resource", status: "DRAFT" },
          agreement: null,
          activity: [],
        },
      });
    }
    if (url.endsWith("/api/v1/creator/offers/negotiation-resource")) {
      return Response.json({
        data: {
          offer: { negotiationId: "negotiation-resource", status: "OFFERED" },
          negotiation: { negotiationId: "negotiation-resource", currentTerms: {} },
        },
      });
    }
    if (url.endsWith("/api/v1/brand/agreements/agreement-resource")) {
      return Response.json({
        data: {
          agreement: { agreementId: "agreement-resource", status: "AGREED" },
          escrow: null,
        },
      });
    }
    return Response.json({ detail: { title: "Unexpected request", code: "TEST_ERROR" } }, { status: 500 });
  }) as typeof fetch;

  try {
    const api = new ProductApiClient("");
    await api.createBrandPromotion(
      {
        productName: "Product",
        title: "Resource",
        objective: "awareness",
        categories: ["beauty"],
        targetAudience: "skincare",
        totalBudget: 1000,
        initialOffer: 500,
        maximumPerCreator: 700,
        autoAcceptCeiling: 650,
        maximumRounds: 3,
        deliverables: [{ format: "reel", count: 1 }],
        usageRights: "organicOnly",
        deadline: "2026-08-10",
        prohibitedClaims: [],
      },
      "frontend-resource-test",
    );
    await api.getBrandPromotionDetail("promotion-resource");
    await api.getCreatorOfferDetail("negotiation-resource");
    await api.getBrandAgreementDetail("agreement-resource");
    assert.deepEqual(calls, [
      { url: "/api/v1/brand/promotions", method: "POST" },
      { url: "/api/v1/brand/promotions/promotion-resource", method: "GET" },
      { url: "/api/v1/creator/offers/negotiation-resource", method: "GET" },
      { url: "/api/v1/brand/agreements/agreement-resource", method: "GET" },
    ]);
  } finally {
    ProductApiClient.setAuthTokenProvider(null);
    globalThis.fetch = previousFetch;
  }
});
