# API Contracts and Backward Compatibility

## 1. First rule: audit, do not assume

Before implementing endpoints, Codex must inventory:

- current OpenAPI routes and schemas;
- frontend API clients/proxies;
- current Firestore collection/field names;
- authentication and ownership checks;
- A2A routes;
- Agreement/escrow/evidence/settlement routes;
- streaming or polling behavior;
- Cloud Run ingress/service authentication;
- deployed frontend/backend URLs and revisions.

Record compatibility changes in `docs/IMPLEMENTATION_STATUS.md` when an API surface changes.

## 2. Compatibility policy

- Do not delete or rename a working public endpoint in the first refactor.
- Prefer adding an operation or versioned response field.
- Add route aliases/redirects for old frontend paths.
- New frontend code consumes a typed adapter, not raw legacy response assumptions.
- Existing consumers continue to work until migration is verified.
- Any field behavior change receives a schema version and contract test.

## 3. Authentication

All user APIs:

```text
Firebase ID token or existing verified auth mechanism
→ backend verifies identity
→ backend resolves role and owner resources
→ no trusted frontend-supplied userId
```

Internal worker/A2A/Web3 calls use existing service authentication. Do not expose private worker endpoints publicly to simplify development.

Agent-runtime routes on the product API (`POST /agreements/{id}/escrow:lock`, milestone release, campaign routes `POST /promotions/{id}/campaigns` / `GET …/campaigns/stream` / `POST …/campaigns/{cid}:cancel`, and the approval queue `GET /approvals`, `GET /approvals/{id}`, `:approve`, `:reject`) share one rule (2026-10-14, ExecPlan 14):

```text
Authorization present → token must verify (401) and be the onboarded Brand that owns
                        the promotion by brandId (403 FORBIDDEN; same check as /brand/*)
Authorization absent  → anonymous agent-runtime path (local demo), unless
                        KNOT_CAMPAIGN_AUTH_REQUIRED=1 closes it (401 UNAUTHENTICATED)
```

`GET /approvals` with a token returns only the caller's Brand's approvals. Approval decisions carry `decidedBy` (uid, or `null` on the anonymous path) on the document and on the `APPROVAL_GRANTED` / `APPROVAL_REJECTED` timeline events. The Next proxy forwards `Authorization`; the browser `EventSource` used for the campaign stream cannot send it, so the switch stays off until the stream client carries the token.

## 4. Suggested additive Product API

Exact paths may map to existing routes. The behavior is canonical.

### Current user

```text
GET /api/v1/me
```

Returns role, onboarding state, role profile summary, agent summary, and allowed navigation.

### Analysis jobs

```text
POST /api/v1/analyses/product
POST /api/v1/analyses/creator-profile
GET  /api/v1/analyses/{analysisId}
POST /api/v1/analyses/{analysisId}:confirm
```

Start should be idempotent for unchanged source URL and analysis version.

### Onboarding

```text
GET   /api/v1/onboarding
PATCH /api/v1/onboarding
POST  /api/v1/onboarding:complete
```

If existing role-specific onboarding endpoints work, adapters may keep them and expose a unified frontend service.

### Creator Agent

```text
GET  /api/v1/creator/agent
POST /api/v1/creator/agent:publish
POST /api/v1/creator/agent:pause
POST /api/v1/creator/agent:resume
```

### Promotion

```text
POST /api/v1/promotions
GET  /api/v1/promotions/{promotionId}
PATCH /api/v1/promotions/{promotionId}
GET  /api/v1/promotions
```

### Match Run

```text
POST /api/v1/promotions/{promotionId}/match-runs
GET  /api/v1/match-runs/{matchRunId}
POST /api/v1/match-runs/{matchRunId}:cancel
GET  /api/v1/match-runs/{matchRunId}/timeline
GET  /api/v1/match-runs/{matchRunId}/events
```

Start response:

```json
{
  "matchRunId": "run-001",
  "status": "QUEUED",
  "promotionId": "promotion-001",
  "links": {
    "self": "/api/v1/match-runs/run-001",
    "events": "/api/v1/match-runs/run-001/events"
  }
}
```

HTTP 202 is appropriate for durable asynchronous work.

### Negotiation

```text
GET /api/v1/negotiations/{negotiationId}
GET /api/v1/negotiations/{negotiationId}/timeline
GET /api/v1/negotiations?status=...
```

User-facing response is sanitized. Raw A2A debug output is a separate admin-only endpoint.

### Agreement and escrow

```text
GET  /api/v1/agreements/{agreementId}
GET  /api/v1/agreements
GET  /api/v1/escrows/{escrowId}
POST /api/v1/agreements/{agreementId}/escrow:fund
```

If the Agent funds automatically, the frontend does not call `fund`; it observes the operation. Retain an admin/retry operation only where safe.

### Evidence and settlement

```text
POST /api/v1/agreements/{agreementId}/evidence
GET  /api/v1/evidence/{evidenceId}
GET  /api/v1/settlements/{settlementId}
GET  /api/v1/settlements
```

## 5. Idempotency

Mutating operations accept:

```http
Idempotency-Key: <client-generated-key>
```

Server stores operation key, request digest, owner, state, and result reference. Same key + same digest returns the existing result. Same key + different digest returns 409.

## 6. ViewModels

### Brand Dashboard

```ts
type BrandDashboardView = {
  agent: BrandAgentControlView;
  activeRun: MatchRunSummaryView | null;
  actionItems: ActionItemView[];
  activeCollaborations: CollaborationSummaryView[];
  money: BrandMoneySummaryView;
  recentActivities: AgentActivityView[];
  recentRuns: MatchRunSummaryView[];
};
```

### Creator Dashboard

```ts
type CreatorDashboardView = {
  agent: CreatorAgentControlView;
  activeNegotiation: NegotiationSummaryView | null;
  actionItems: ActionItemView[];
  activeCollaborations: CollaborationSummaryView[];
  money: CreatorMoneySummaryView;
  recentActivities: AgentActivityView[];
  recentNegotiations: NegotiationSummaryView[];
};
```

### Match Run detail

```ts
type MatchRunDetailView = {
  matchRunId: string;
  status: string;
  promotion: PromotionSummaryView;
  currentPhase: string;
  candidateSummary: CandidateSelectionView | null;
  currentNegotiation: NegotiationPublicView | null;
  timeline: AgentActivityView[];
  agreement: AgreementView | null;
  escrow: EscrowView | null;
  technicalProof?: TechnicalProofView;
};
```

The API builds these views; the client does not read private canonical documents directly.

## 7. Event streaming

Use the repository’s verified mechanism. Candidate options:

- SSE from Product API;
- task subscription/stream projection;
- authenticated real-time projection;
- bounded polling fallback.

The contract must include:

```text
lastEventId / sequence
heartbeat
reconnect
terminal signal
permission recheck
```

## 8. Errors

| HTTP | Meaning |
|---:|---|
| 200/201 | completed synchronous success |
| 202 | durable operation accepted |
| 400 | malformed/validation error |
| 401 | unauthenticated |
| 403 | wrong owner/role/authority |
| 404 | resource not found or intentionally hidden |
| 409 | invalid state, duplicate conflict, active-run conflict |
| 422 | business/policy condition cannot be satisfied |
| 429 | rate/spend/tool quota |
| 502 | downstream A2A/Web3/tool failure |
| 503 | temporary service unavailable |

Error body:

```json
{
  "error": {
    "code": "ACTIVE_MATCH_RUN_EXISTS",
    "message": "이미 실행 중인 매칭이 있어요.",
    "retryable": false,
    "correlationId": "corr-001",
    "details": {}
  }
}
```

Do not leak private policy through error details.

## 9. Legacy frontend adapter pattern

```text
Existing visual component
→ feature ViewModel hook
→ new/legacy compatibility adapter
→ typed API client
```

No UI component should depend on raw Firestore fields or branch-specific mock types.

## 10. Contract tests

Required:

- auth/ownership per role;
- idempotency;
- old endpoint response remains valid;
- new fields optional for old client;
- private policy absent;
- run start returns same run for duplicate key;
- timeline event order;
- A2A payload schema;
- Agreement/escrow relation;
- error codes.
