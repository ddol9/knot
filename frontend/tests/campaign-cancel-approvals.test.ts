import assert from "node:assert/strict";
import test from "node:test";
import {
  campaignStreamReducer,
  createSseParser,
  initialCampaignStreamState,
  parseCampaignStreamEvent,
  type CampaignStreamState,
} from "../src/app/brand/campaign/useCampaignStream";
import { ProductApiClient, ProductApiError, runningCampaignIdFromProblem, toApiError } from "../src/product/apiClient";
import { governanceReasonLabel } from "../src/product/approvalTypes";
import type { CampaignStreamEvent } from "../src/product/campaignTypes";

const LEDGER = '"ledger":{"totalUsdc":2000,"reservedUsdc":0,"committedUsdc":600,"availableUsdc":1400}';

/** 2026-10-14 로컬 백엔드(KNOT_GOV_MAX_AUTO_AGREEMENT_USDC=500, ceiling 700, target 2)에서 받은 순서를 축약. */
const APPROVAL_REPLAY: Array<[string, string]> = [
  ["status", '{"campaignId":"campaign-7","promotionId":"promotion-001","a2aMode":"local"}'],
  [
    "negotiation_started",
    `{"creatorAgentId":"creator-agent-005","baseUrl":"http://localhost:8081/a2a/v1","reservedUsdc":700,${LEDGER}}`,
  ],
  [
    "negotiation_result",
    `{"creatorAgentId":"creator-agent-005","result":{"outcome":"AGREED","finalAmountUsdc":600,"rounds":2,"agreementId":"agreement-5","termsHash":"sha256:5","turns":[]},${LEDGER}}`,
  ],
  [
    "agreement_created",
    '{"creatorAgentId":"creator-agent-005","agreementId":"agreement-5","negotiationId":"negotiation-5","termsHash":"sha256:5","amountUsdc":600,"deliverableSummary":"릴스 1개","status":"FUNDING_REQUIRED"}',
  ],
  [
    "approval_required",
    '{"creatorAgentId":"creator-agent-005","agreementId":"agreement-5","approvalId":"approval-abc","amountUsdc":600,"campaignCommittedUsdc":600,"reasons":["GOV_SINGLE_AGREEMENT_OVER_AUTO_LIMIT"],"ruleVersion":"governance-v1"}',
  ],
];

function replay(events: Array<[string, string]>, from?: CampaignStreamState): CampaignStreamState {
  let state = from ?? campaignStreamReducer(initialCampaignStreamState, { type: "connecting" });
  for (const [name, raw] of events) {
    const event = parseCampaignStreamEvent(name, raw);
    assert.ok(event, `unparsed event ${name}`);
    state = campaignStreamReducer(state, { type: "event", event: event as CampaignStreamEvent });
  }
  return state;
}

test("approval_required renders as a human-approval note with Korean reasons and no escrow note", () => {
  const state = replay(APPROVAL_REPLAY);
  const column = state.columns["creator-agent-005"];
  assert.equal(state.phase, "running");
  assert.equal(column.statusText, "사람 승인 대기");
  assert.equal(column.agreementId, "agreement-5");
  assert.deepEqual(
    column.notes.map((note) => note.kind),
    ["agreement", "approval_required"],
  );
  const note = column.notes[1];
  assert.equal(note.title, "🙋 사람 승인 대기");
  assert.equal(note.approvalId, "approval-abc");
  assert.equal(note.agreementId, "agreement-5");
  assert.equal(note.lines[0], "600 USDC · 캠페인 누적 600 USDC");
  assert.equal(note.lines[1], "단건 합의 금액이 자동 승인 한도를 넘음");
  assert.match(note.lines[2], /governance-v1 · approval-abc/);
  // 같은 approvalId가 두 번 와도 노트는 하나.
  const again = replay([APPROVAL_REPLAY[4]], state);
  assert.equal(again.columns["creator-agent-005"].notes.length, 2);
});

test("governance reason codes map to Korean copy and unknown codes fall through", () => {
  assert.equal(governanceReasonLabel("GOV_CAMPAIGN_TOTAL_OVER_AUTO_LIMIT"), "캠페인 누적 확정 금액이 자동 승인 한도를 넘음");
  assert.equal(governanceReasonLabel("GOV_SOMETHING_NEW"), "GOV_SOMETHING_NEW");
});

test("cancel flow: request is marked, stream stays open, skipped/canceled labels, CANCELED result closes", () => {
  const running = replay([
    ["status", '{"campaignId":"campaign-9","promotionId":"promotion-001","a2aMode":"local"}'],
    [
      "negotiation_started",
      `{"creatorAgentId":"agent-creator-1","baseUrl":"http://localhost:8081/a2a/v1","reservedUsdc":700,${LEDGER}}`,
    ],
  ]);
  // 연결 전에는 취소 표시를 하지 않는다.
  const tooEarly = campaignStreamReducer(initialCampaignStreamState, { type: "cancel_requested" });
  assert.equal(tooEarly.cancelRequested, false);

  const requested = campaignStreamReducer(running, { type: "cancel_requested" });
  assert.equal(requested.phase, "running");
  assert.equal(requested.cancelRequested, true);
  assert.equal(requested.cancelError, null);

  const failed = campaignStreamReducer(requested, { type: "cancel_failed", detail: "404" });
  assert.equal(failed.cancelRequested, false);
  assert.equal(failed.cancelError, "404");
  assert.equal(failed.phase, "running");

  const after = replay(
    [
      [
        "negotiation_result",
        `{"creatorAgentId":"agent-creator-1","result":{"outcome":"CANCELED","finalAmountUsdc":null,"rounds":1,"turns":[]},${LEDGER}}`,
      ],
      ["negotiation_skipped", `{"creatorAgentId":"creator-agent-005","reason":"CANCELED",${LEDGER}}`],
      [
        "campaign_result",
        '{"creatorAgentId":null,"result":{"campaignId":"campaign-9","matchRunId":"match-run-9","outcome":"CANCELED","targetCreatorCount":2,"agreedCount":0,"totalBudgetUsdc":2000,"committedUsdc":0,"agreementIds":[],"negotiations":[]}}',
      ],
    ],
    requested,
  );
  assert.equal(after.phase, "done");
  assert.equal(after.cancelRequested, true);
  assert.equal(after.result?.outcome, "CANCELED");
  assert.deepEqual(after.columns["agent-creator-1"].final, { kind: "CANCELED", label: "브랜드 취소로 중단" });
  assert.equal(after.columns["agent-creator-1"].statusText, "취소됨");
  assert.deepEqual(after.columns["creator-agent-005"].final, { kind: "SKIPPED", label: "캠페인 취소로 시작하지 않음" });

  // 사람이 취소하지 않았는데 CANCELED면 목표 도달 쪽 문구.
  const targetReached = replay(
    [
      [
        "negotiation_result",
        `{"creatorAgentId":"agent-creator-1","result":{"outcome":"CANCELED","finalAmountUsdc":null,"rounds":1,"turns":[]},${LEDGER}}`,
      ],
    ],
    running,
  );
  assert.equal(targetReached.columns["agent-creator-1"].final?.label, "목표 도달로 취소");
});

test("409 CAMPAIGN_ALREADY_RUNNING on start becomes an error with the running campaign id", () => {
  const body = {
    detail: {
      type: "https://knot.example/errors/campaign-already-running",
      title: "Campaign Already Running",
      status: 409,
      detail: "Campaign campaign-0f3c2b1a-aaaa-bbbb-cccc-123456789abc is already running for this Promotion.",
      code: "CAMPAIGN_ALREADY_RUNNING",
    },
  };
  assert.equal(runningCampaignIdFromProblem(body), "campaign-0f3c2b1a-aaaa-bbbb-cccc-123456789abc");
  // detail 문장에만 느슨한 id를 허용하고, type URL의 "campaign-already-running"은 id로 보지 않는다.
  assert.equal(
    runningCampaignIdFromProblem({
      detail: { ...body.detail, detail: "Campaign campaign-1 is already running for this Promotion." },
    }),
    "campaign-1",
  );
  assert.equal(runningCampaignIdFromProblem({ detail: { ...body.detail, detail: "already running" } }), null);
  assert.equal(runningCampaignIdFromProblem({ detail: { detail: "already running", code: "X" } }), null);
  assert.equal(runningCampaignIdFromProblem("plain text"), null);
  assert.equal(runningCampaignIdFromProblem(null), null);

  const error = toApiError(409, body);
  assert.ok(error instanceof ProductApiError);
  assert.equal(error.code, "CAMPAIGN_ALREADY_RUNNING");
  assert.match(error.message, /이미 실행 중인 캠페인/);

  const state = campaignStreamReducer(campaignStreamReducer(initialCampaignStreamState, { type: "connecting" }), {
    type: "start_failed",
    detail: error.message,
    code: error.code,
    runningCampaignId: runningCampaignIdFromProblem(body),
  });
  assert.equal(state.phase, "error");
  assert.deepEqual(state.conflict, {
    code: "CAMPAIGN_ALREADY_RUNNING",
    campaignId: "campaign-0f3c2b1a-aaaa-bbbb-cccc-123456789abc",
  });

  const other = campaignStreamReducer(state, { type: "start_failed", detail: "x", code: "NOT_FOUND", runningCampaignId: null });
  assert.equal(other.conflict, null);
});

test("sse parser splits chunks into event/data messages across boundaries", () => {
  const parser = createSseParser();
  assert.deepEqual(parser.push("event: status\ndata: {\"a\":1}\n"), []);
  assert.deepEqual(parser.push("\nevent: tu"), [{ event: "status", data: '{"a":1}' }]);
  assert.deepEqual(parser.push("rn\r\ndata: line1\r\ndata: line2\r\n\r\n: comment\n\n"), [
    { event: "turn", data: "line1\nline2" },
  ]);
  assert.deepEqual(parser.push("data: no-event\n\n"), [{ event: "message", data: "no-event" }]);
});

test("approvals and cancel API client hit the documented routes with the right shapes", async () => {
  const previousFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body: string | null; idempotency: string | null }> = [];
  ProductApiClient.setAuthTokenProvider(async () => null);
  const approval = {
    approvalId: "approval-1",
    type: "ESCROW_LOCK",
    status: "PENDING",
    promotionId: "promotion-001",
    campaignId: "campaign-1",
    agreementId: "agreement-1",
    creatorAgentId: "creator-agent-005",
    creatorId: "creator-005",
    amountUsdc: 600,
    campaignCommittedUsdc: 600,
    reasons: ["GOV_SINGLE_AGREEMENT_OVER_AUTO_LIMIT"],
    ruleVersion: "governance-v1",
    createdAt: "2026-10-14T00:00:00Z",
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : null,
      idempotency: new Headers(init?.headers).get("Idempotency-Key"),
    });
    if (url.endsWith("/api/v1/approvals?status=PENDING")) return Response.json({ data: { approvals: [approval] } });
    if (url.endsWith("/api/v1/approvals")) return Response.json({ data: { approvals: [] } });
    if (url.endsWith("/api/v1/approvals/approval-1")) return Response.json({ data: { approval } });
    if (url.endsWith("/api/v1/approvals/approval-1:approve")) {
      return Response.json({
        data: { approval: { ...approval, status: "APPROVED" }, escrow: { status: "SKIPPED", reason: "WEB3_GATEWAY_REQUIRED" } },
      });
    }
    if (url.endsWith("/api/v1/approvals/approval-1:reject")) {
      return Response.json({ data: { approval: { ...approval, status: "REJECTED", reason: "too much" } } });
    }
    if (url.endsWith("/api/v1/promotions/promotion-001/campaigns/campaign-1:cancel")) {
      return Response.json({ data: { campaignId: "campaign-1", status: "CANCELING" } });
    }
    if (url.endsWith("/api/v1/promotions/promotion-001/campaigns/campaign-gone:cancel")) {
      return Response.json(
        { detail: { title: "Not Found", code: "NOT_FOUND", detail: "campaign campaign-gone not found", status: 404 } },
        { status: 404 },
      );
    }
    return Response.json({ detail: { title: "Unexpected request", code: "TEST_ERROR" } }, { status: 500 });
  }) as typeof fetch;

  try {
    const api = new ProductApiClient("");
    assert.equal((await api.listApprovals("PENDING")).length, 1);
    assert.equal((await api.listApprovals()).length, 0);
    assert.equal((await api.getApproval("approval-1")).approvalId, "approval-1");
    const approved = await api.approveApproval("approval-1", "approval-1-retry");
    assert.equal(approved.approval.status, "APPROVED");
    assert.equal(approved.escrow.reason, "WEB3_GATEWAY_REQUIRED");
    const rejected = await api.rejectApproval("approval-1", "too much");
    assert.equal(rejected.status, "REJECTED");
    const canceled = await api.cancelCampaign("promotion-001", "campaign-1");
    assert.equal(canceled.status, "CANCELING");
    await assert.rejects(api.cancelCampaign("promotion-001", "campaign-gone"), (caught: unknown) => {
      return caught instanceof ProductApiError && caught.status === 404 && caught.code === "NOT_FOUND";
    });

    assert.deepEqual(
      calls.map((call) => [call.url, call.method]),
      [
        ["/api/v1/approvals?status=PENDING", "GET"],
        ["/api/v1/approvals", "GET"],
        ["/api/v1/approvals/approval-1", "GET"],
        ["/api/v1/approvals/approval-1:approve", "POST"],
        ["/api/v1/approvals/approval-1:reject", "POST"],
        ["/api/v1/promotions/promotion-001/campaigns/campaign-1:cancel", "POST"],
        ["/api/v1/promotions/promotion-001/campaigns/campaign-gone:cancel", "POST"],
      ],
    );
    assert.equal(calls[3].idempotency, "approval-1-retry");
    assert.equal(calls[3].body, null);
    assert.equal(calls[4].body, JSON.stringify({ reason: "too much" }));
    assert.equal(calls[5].body, null);
  } finally {
    globalThis.fetch = previousFetch;
    ProductApiClient.setAuthTokenProvider(null);
  }
});
