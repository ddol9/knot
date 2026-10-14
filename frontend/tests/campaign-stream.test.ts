import assert from "node:assert/strict";
import test from "node:test";
import {
  campaignStreamReducer,
  initialCampaignStreamState,
  parseCampaignStreamEvent,
  type CampaignStreamState,
} from "../src/app/brand/campaign/useCampaignStream";
import { toCampaignRequest, validateCampaignForm } from "../src/app/brand/campaign/components/CampaignForm";
import { ProductApiClient } from "../src/product/apiClient";
import type { CampaignStreamEvent } from "../src/product/campaignTypes";

/** 2026-10-14 로컬 백엔드(KNOT_CREATOR_A2A_MODE=local)에서 받은 실제 이벤트 순서를 축약한 것. */
const REPLAY: Array<[string, string]> = [
  ["status", '{"campaignId":"campaign-1","promotionId":"promotion-001","a2aMode":"local"}'],
  [
    "discovery",
    JSON.stringify({
      creatorAgentId: null,
      report: {
        promotionId: "promotion-001",
        queried: 3,
        ranked: 3,
        probed: 0,
        candidates: [
          candidate("agent-creator-1", "씬님", true, 1),
          candidate("creator-agent-005", "라이프 크리에이터", true, 2),
          { ...candidate("creator-agent-004", "고가 크리에이터", false, null), eligible: false, hardFilterReasons: ["RATE_EXCEEDS_MAX_PER_CREATOR"] },
        ],
      },
    }),
  ],
  [
    "negotiation_started",
    '{"creatorAgentId":"agent-creator-1","baseUrl":"http://localhost:8081/a2a/v1","reservedUsdc":800,"ledger":{"totalUsdc":2000,"reservedUsdc":800,"committedUsdc":0,"availableUsdc":1200}}',
  ],
  [
    "turn",
    '{"creatorAgentId":"agent-creator-1","round":1,"role":"brand","type":"OFFER","amountUsdc":800,"message":"800 USDC로 시작합니다.","messageId":"m1"}',
  ],
  [
    "turn",
    '{"creatorAgentId":"agent-creator-1","round":1,"role":"creator","type":"ACCEPT","amountUsdc":800,"message":"수락합니다.","messageId":"m2"}',
  ],
  [
    "negotiation_result",
    '{"creatorAgentId":"agent-creator-1","result":{"outcome":"AGREED","finalAmountUsdc":800,"rounds":1,"agreementId":"agreement-1","termsHash":"sha256:abc","turns":[]},"ledger":{"totalUsdc":2000,"reservedUsdc":0,"committedUsdc":800,"availableUsdc":1200}}',
  ],
  [
    "agreement_created",
    '{"creatorAgentId":"agent-creator-1","agreementId":"agreement-1","negotiationId":"negotiation-1","termsHash":"sha256:abc","amountUsdc":800,"deliverableSummary":"릴스 1개","status":"FUNDING_REQUIRED"}',
  ],
  ["escrow_skipped", '{"creatorAgentId":"agent-creator-1","agreementId":"agreement-1","status":"SKIPPED","reason":"WEB3_GATEWAY_REQUIRED"}'],
  [
    "negotiation_skipped",
    '{"creatorAgentId":"creator-agent-005","reason":"TARGET_REACHED","ledger":{"totalUsdc":2000,"reservedUsdc":0,"committedUsdc":800,"availableUsdc":1200}}',
  ],
  [
    "campaign_result",
    '{"creatorAgentId":null,"result":{"campaignId":"campaign-1","matchRunId":"match-run-1","outcome":"TARGET_REACHED","targetCreatorCount":1,"agreedCount":1,"totalBudgetUsdc":2000,"committedUsdc":800,"agreementIds":["agreement-1"],"negotiations":[]}}',
  ],
];

function candidate(id: string, displayName: string, selected: boolean, rank: number | null) {
  return {
    creatorAgentId: id,
    creatorId: id.replace("agent-", ""),
    displayName,
    baseUrl: "http://localhost:8081/a2a/v1",
    rank,
    eligible: true,
    score: 0.8,
    rankScore: 0.8,
    hardFilterReasons: [],
    categories: ["beauty"],
    cardStatus: "SKIPPED",
    selected,
    healthStatus: "UNKNOWN",
    trackRecord: { attempts: 0, agreements: 0, agreementRate: 0.5 },
  };
}

function replay(events: Array<[string, string]>): CampaignStreamState {
  let state = campaignStreamReducer(initialCampaignStreamState, { type: "connecting" });
  for (const [name, raw] of events) {
    const event = parseCampaignStreamEvent(name, raw);
    assert.ok(event, `unparsed event ${name}`);
    state = campaignStreamReducer(state, { type: "event", event: event as CampaignStreamEvent });
  }
  return state;
}

test("campaign stream reducer replays a real local-mode campaign into columns and a result", () => {
  const state = replay(REPLAY);
  assert.equal(state.phase, "done");
  assert.equal(state.campaignId, "campaign-1");
  assert.equal(state.a2aMode, "local");
  // 선정된 후보만 열이 된다 (탈락 후보 004는 열이 없다).
  assert.deepEqual(state.columnOrder, ["agent-creator-1", "creator-agent-005"]);
  assert.equal(state.discovery?.candidates.length, 3);

  const first = state.columns["agent-creator-1"];
  assert.equal(first.displayName, "씬님");
  assert.equal(first.turns.length, 2);
  assert.equal(first.turns[0].role, "brand");
  assert.equal(first.final?.kind, "AGREED");
  assert.equal(first.final?.label, "합의 800 USDC");
  assert.equal(first.typing, false);
  assert.equal(first.agreementId, "agreement-1");
  assert.deepEqual(
    first.notes.map((note) => note.kind),
    ["agreement", "escrow_skipped"],
  );

  const second = state.columns["creator-agent-005"];
  assert.equal(second.final?.kind, "SKIPPED");
  assert.equal(second.turns.length, 0);

  assert.deepEqual(state.ledger, { totalUsdc: 2000, reservedUsdc: 0, committedUsdc: 800, availableUsdc: 1200 });
  assert.equal(state.result?.outcome, "TARGET_REACHED");
  assert.deepEqual(state.result?.agreementIds, ["agreement-1"]);
});

test("campaign stream reducer shows typing while waiting on the other side", () => {
  const state = replay(REPLAY.slice(0, 4));
  const column = state.columns["agent-creator-1"];
  assert.equal(state.phase, "running");
  assert.equal(column.typing, true);
  assert.match(column.statusText, /크리에이터 평가 중/);
});

test("server error event and connection loss end the campaign view, but not after done", () => {
  const running = replay(REPLAY.slice(0, 3));
  const errored = campaignStreamReducer(running, {
    type: "event",
    event: { name: "error", data: { detail: "boom" } },
  });
  assert.equal(errored.phase, "error");
  assert.equal(errored.error, "boom");

  const lost = campaignStreamReducer(running, { type: "connection_lost", detail: "끊김" });
  assert.equal(lost.phase, "error");
  assert.equal(lost.error, "끊김");

  const done = replay(REPLAY);
  const after = campaignStreamReducer(done, { type: "connection_lost", detail: "끊김" });
  assert.equal(after.phase, "done");
  assert.equal(after.error, null);
});

test("unknown or malformed stream events are ignored", () => {
  assert.equal(parseCampaignStreamEvent("heartbeat", "{}"), null);
  assert.equal(parseCampaignStreamEvent("turn", "not json"), null);
  assert.equal(parseCampaignStreamEvent("turn", "null"), null);
});

test("campaignStreamUrl keeps only numeric params and encodes the promotion id", () => {
  const client = new ProductApiClient("http://127.0.0.1:8180/");
  const url = client.campaignStreamUrl("promotion 001", {
    targetCreatorCount: 2,
    ceilingUsdc: 700,
    openingAmountUsdc: undefined,
    concessionPct: Number.NaN,
  });
  assert.equal(
    url,
    "http://127.0.0.1:8180/api/v1/promotions/promotion%20001/campaigns/stream?targetCreatorCount=2&ceilingUsdc=700",
  );
  assert.equal(
    new ProductApiClient("http://127.0.0.1:8180").campaignStreamUrl("promotion-001"),
    "http://127.0.0.1:8180/api/v1/promotions/promotion-001/campaigns/stream",
  );
});

test("campaign form converts blanks to server defaults and validates ranges", () => {
  const values = {
    targetCreatorCount: "2",
    maxCandidates: "5",
    parallelism: "3",
    openingAmountUsdc: "",
    ceilingUsdc: "700",
    concessionPct: "50",
    maxRounds: "",
  };
  assert.deepEqual(toCampaignRequest(values), {
    targetCreatorCount: 2,
    maxCandidates: 5,
    parallelism: 3,
    openingAmountUsdc: undefined,
    ceilingUsdc: 700,
    concessionPct: 50,
    maxRounds: undefined,
  });
  assert.equal(validateCampaignForm(values), null);
  assert.match(validateCampaignForm({ ...values, maxCandidates: "1" }) ?? "", /최대 후보/);
  assert.match(validateCampaignForm({ ...values, openingAmountUsdc: "900" }) ?? "", /첫 제안 금액/);
  assert.match(validateCampaignForm({ ...values, concessionPct: "0" }) ?? "", /양보율/);
});
