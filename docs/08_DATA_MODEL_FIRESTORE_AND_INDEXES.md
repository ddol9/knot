# Data Model, Firestore and Indexes

## 1. Principles

- Firestore stores canonical application state and audit events.
- Searchable projections are separate from full profiles and private policies.
- Frontend does not assemble canonical state from arbitrary collections; Product API returns authorized ViewModels.
- New schema is additive and versioned.
- Existing collection/field names are audited before migration.

## 2. Collection overview

```text
users
brands
creatorProfiles
productProfiles
socialSnapshots
agents
agentPolicies
agentAuthorities
agentRegistry
creatorDiscoveryProfiles
promotions
matchRuns
  candidates
  events
reservations
negotiations
  messages
  decisions
a2aTasks
  events
  artifacts
agreements
escrows
  operations
evidence
verificationResults
settlements
agentActivities
paymentReceipts
onboardingSessions
```

Existing repository collections must be mapped before introducing duplicates.

## 3. User

```json
{
  "userId": "firebase-uid",
  "role": "BRAND",
  "status": "ACTIVE",
  "onboardingStatus": "COMPLETED",
  "profileRef": "brands/brand-001",
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

Role and ownership are server-authoritative.

## 4. Agent

```json
{
  "agentId": "creator-agent-001",
  "ownerId": "creator-001",
  "agentType": "CREATOR",
  "status": "ACTIVE",
  "publicationStatus": "PUBLISHED",
  "acceptingOffers": true,
  "availability": "AVAILABLE",
  "activeNegotiations": 0,
  "maxConcurrentNegotiations": 1,
  "activeCollaborations": 0,
  "maxActiveCollaborations": 1,
  "profileRef": "creatorProfiles/creator-001",
  "policyRef": "agentPolicies/creator-agent-001",
  "authorityRef": "agentAuthorities/creator-agent-001",
  "agentVersion": "1.0.0",
  "promptVersion": "creator-negotiator-v1",
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

If existing code has `status`, `availability`, and `acceptingOffers`, preserve them and add only missing dimensions.

## 5. Creator Profile

```json
{
  "creatorId": "creator-001",
  "ownerUserId": "uid-creator",
  "sourceUrl": "https://instagram.com/example",
  "displayName": "Example",
  "handle": "@example",
  "categoryKeys": ["beauty", "lifestyle"],
  "formatKeys": ["REEL", "FEED"],
  "moodIds": ["clean_minimal", "authentic_review"],
  "audienceTags": ["skincare", "20s_30s"],
  "languageKeys": ["ko"],
  "countryCode": "KR",
  "summary": "...",
  "confirmedFields": ["displayName", "categoryKeys", "formatKeys", "moodIds"],
  "unknownFields": ["averageViews"],
  "analysisRef": "socialSnapshots/snapshot-001",
  "taxonomyVersion": 1,
  "profileVersion": 3,
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

Do not store fabricated social metrics.

## 6. Product Profile

```json
{
  "productProfileId": "product-profile-001",
  "brandId": "brand-001",
  "sourceUrl": "https://example.com/product",
  "productName": "Daily SPF Moisturizer",
  "categoryKeys": ["beauty", "skincare"],
  "desiredMoodIds": ["clean_minimal", "natural_wellness"],
  "audienceTags": ["daily_skincare", "20s_30s"],
  "summary": "...",
  "confirmedFields": ["productName", "categoryKeys", "desiredMoodIds"],
  "analysisRef": "...",
  "taxonomyVersion": 1,
  "profileVersion": 2,
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

## 7. Private Agent Policy

```json
{
  "agentId": "creator-agent-001",
  "policyType": "CREATOR_NEGOTIATION",
  "version": 4,
  "currency": "USDC",
  "targetBaseUsdc": 300,
  "minimumBaseUsdc": 250,
  "minimumLeadDays": 7,
  "allowedFormats": ["REEL", "FEED"],
  "allowedUsageRights": ["ORGANIC_ONLY"],
  "blockedCategories": ["gambling", "adult"],
  "maximumRevisions": 1,
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

Brand policy:

```json
{
  "agentId": "brand-agent-001",
  "policyType": "BRAND_PROMOTION",
  "version": 3,
  "promotionId": "promotion-001",
  "targetAmountUsdc": 250,
  "maxAmountUsdc": 350,
  "maxNegotiationRounds": 3,
  "verificationSpendCapUsdc": 0.5,
  "allowedUsageRights": ["ORGANIC_ONLY"],
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

These documents are never returned to the counterparty.

## 8. Agent Authority

```json
{
  "agentId": "brand-agent-001",
  "mode": "LIMITED_AUTONOMY",
  "version": 2,
  "capabilities": {
    "startMatchRun": true,
    "sendOffer": true,
    "sendCounter": true,
    "acceptAgreement": true,
    "purchaseVerificationApi": true,
    "lockEscrow": true,
    "releaseSettlement": true
  },
  "spendLimits": {
    "perMatchRunEscrowUsdc": 350,
    "perMatchRunVerificationUsdc": 0.5,
    "dailyTotalUsdc": 500
  },
  "walletRef": "wallets/brand-agent-wallet-001",
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

The implementation must reflect actual wallet architecture. Never claim autonomous signing when the system still needs an interactive wallet prompt.

## 9. Creator Discovery Profile

```json
{
  "creatorId": "creator-001",
  "creatorAgentId": "creator-agent-001",
  "agentStatus": "PUBLISHED",
  "acceptingOffers": true,
  "availability": "AVAILABLE",
  "capacityAvailable": true,
  "categoryKeys": ["beauty", "lifestyle"],
  "primaryCategoryKey": "beauty",
  "formatKeys": ["REEL", "FEED"],
  "primaryFormatKey": "REEL",
  "moodIds": ["clean_minimal", "authentic_review"],
  "audienceTags": ["skincare", "20s_30s"],
  "languageKeys": ["ko"],
  "countryCode": "KR",
  "publicRateBand": "250_400",
  "nextAvailableAt": "timestamp",
  "verifiedDealsCount": 8,
  "completionRate": 0.96,
  "onTimeRate": 0.92,
  "cancellationRate": 0.02,
  "profileEmbedding": "vector",
  "profileVersion": 3,
  "taxonomyVersion": 1,
  "embeddingVersion": 2,
  "indexVersion": 4,
  "updatedAt": "timestamp"
}
```

It is a denormalized projection. Update it on confirmed profile/publish/availability/reputation events.

## 10. Promotion

```json
{
  "promotionId": "promotion-001",
  "brandId": "brand-001",
  "brandAgentId": "brand-agent-001",
  "productProfileId": "product-profile-001",
  "status": "READY",
  "requiredFormat": "REEL",
  "targetAmountUsdc": 250,
  "maxAmountUsdc": 350,
  "deadline": "timestamp",
  "usageRights": "ORGANIC_ONLY",
  "verificationSpendCapUsdc": 0.5,
  "targetAgreementCount": 1,
  "maxCandidatesPerRun": 3,
  "maxRoundsPerNegotiation": 3,
  "version": 2,
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

Private financial fields are returned only to the Brand owner and internal services.

## 11. Match Run

```json
{
  "matchRunId": "run-001",
  "promotionId": "promotion-001",
  "brandId": "brand-001",
  "brandAgentId": "brand-agent-001",
  "status": "NEGOTIATING",
  "targetAgreementCount": 1,
  "maxCandidates": 3,
  "currentCandidateRank": 1,
  "currentNegotiationId": "negotiation-001",
  "agreementId": null,
  "querySnapshot": {},
  "policySnapshotRef": "...",
  "idempotencyKey": "...",
  "workerLease": {
    "owner": "worker-id",
    "generation": 2,
    "expiresAt": "timestamp"
  },
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

### Candidate subcollection

```json
{
  "creatorId": "creator-001",
  "creatorAgentId": "creator-agent-001",
  "rank": 1,
  "rawVectorDistance": 0.12,
  "score": 91.4,
  "scoreComponents": {
    "semanticMoodFit": 0.95,
    "categoryAudienceFit": 0.9,
    "formatFit": 1,
    "scheduleFit": 0.8,
    "coarseBudgetFit": 0.7,
    "reliabilityFit": 0.92
  },
  "profileVersion": 3,
  "indexVersion": 4,
  "verificationStatus": "NOT_REQUIRED",
  "reservationId": "reservation-001",
  "negotiationId": "negotiation-001",
  "outcome": "NEGOTIATING",
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

## 12. Negotiation and A2A

Keep product and protocol records separate but linked.

```json
{
  "negotiationId": "negotiation-001",
  "matchRunId": "run-001",
  "promotionId": "promotion-001",
  "brandAgentId": "brand-agent-001",
  "creatorAgentId": "creator-agent-001",
  "contextId": "ctx-001",
  "taskId": "task-001",
  "status": "COUNTERED",
  "currentRound": 2,
  "maxRounds": 3,
  "currentPublicTerms": {},
  "brandPolicySnapshotRef": "...",
  "creatorPolicySnapshotRef": "...",
  "reservationId": "reservation-001",
  "lastMessageId": "msg-002",
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

Messages store A2A envelope fields and safe indexed fields. Raw payload access is internal and sanitized.

## 13. Agreement

```json
{
  "agreementId": "agreement-001",
  "negotiationId": "negotiation-001",
  "matchRunId": "run-001",
  "promotionId": "promotion-001",
  "brandId": "brand-001",
  "creatorId": "creator-001",
  "artifactId": "artifact-001",
  "terms": {
    "baseAmountUsdc": 300,
    "deliverables": [{"format": "REEL", "count": 1}],
    "usageRights": "ORGANIC_ONLY",
    "deadline": "timestamp"
  },
  "termsHash": "sha256:...",
  "status": "ESCROW_PENDING",
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

Unique logical constraint: one Agreement per terminal agreed negotiation.

## 14. Escrow and operations

```json
{
  "escrowId": "escrow-001",
  "agreementId": "agreement-001",
  "network": "SOLANA_DEVNET",
  "asset": "USDC",
  "lockedAmountUsdc": 300,
  "releasedAmountUsdc": 0,
  "status": "CONFIRMED",
  "lockOperationId": "op-lock-001",
  "releaseOperationId": null,
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

Operation:

```json
{
  "operationId": "op-lock-001",
  "operationType": "ESCROW_LOCK",
  "idempotencyKey": "agreement-001:ESCROW_LOCK",
  "status": "CONFIRMED",
  "signature": "...",
  "explorerUrl": "...",
  "submittedAt": "timestamp",
  "confirmedAt": "timestamp",
  "errorCode": null
}
```

## 15. Evidence and settlement

```json
{
  "evidenceId": "evidence-001",
  "agreementId": "agreement-001",
  "creatorId": "creator-001",
  "sourceType": "CONTENT_URL",
  "normalizedUrl": "https://instagram.com/reel/...",
  "status": "VERIFYING",
  "submittedAt": "timestamp"
}
```

```json
{
  "settlementId": "settlement-001",
  "escrowId": "escrow-001",
  "agreementId": "agreement-001",
  "amountUsdc": 300,
  "status": "CONFIRMED",
  "operationId": "op-release-001",
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

## 16. Index update pipeline

Trigger conditions:

- creator confirms onboarding/profile;
- mood/formats/categories change;
- Agent publish/pause status changes;
- availability/capacity changes;
- verified collaboration completes;
- scheduled social refresh changes confirmed attributes.

Update steps:

```text
canonical Profile/Agent event
→ validate projection
→ generate embedding only when semantic fields changed
→ write discovery document with new versions
→ emit INDEX_UPDATED event
```

Availability-only updates do not regenerate embeddings.

## 17. Firestore indexes

Exact syntax depends on actual SDK/config, but the repository must include index configuration for supported queries.

Required query families:

1. Published and accepting by format/country/availability.
2. Active Match Run by Promotion and non-terminal status.
3. Negotiations by Brand/Creator owner and updated time.
4. Agreements by owner/status.
5. Events by aggregate ID and sequence.
6. Escrow/settlement by Agreement and status.
7. Vector index on `creatorDiscoveryProfiles.profileEmbedding`, with supported prefilter fields used by the chosen query.

Avoid large arrays that require incompatible compound filters. If Firestore query limits prevent a single query, use a bounded candidate pool strategy or separate index partitions—not a collection scan.

## 18. Migration

Codex must produce a mapping table:

| Existing collection/field | Canonical target | Action | Backward compatibility |
|---|---|---|---|

Rules:

- do not delete old fields during initial migration;
- add canonical fields and adapters;
- dual-read old/new where necessary;
- backfill with idempotent script;
- switch writes after verification;
- remove legacy only after route/API/test references are proven absent.

## 19. Discovery query composite index and the local emulator (2026-10-14 추가)

브랜드 탐색 1단계(`libs/agents/discovery.py::_public_filters`)는 `creatorDiscoveryProfiles` 에 다음 한 쿼리만 보낸다.

```text
agentStatus == PUBLISHED, acceptingOffers == true, availability == AVAILABLE,
capacityAvailable == true, countryCode == KR,
categoryKeys array_contains <primary required category>,
nextAvailableAt <= <postingWindow.start ISO date>        (limit ≤ 100)
```

포맷(`formatKeys`)은 Firestore 가 쿼리당 `array_contains` 를 하나만 허용하므로 메모리에서 후처리한다.
이 모양에 정확히 맞는 복합 인덱스가 `firestore.indexes.json` 첫 항목이다 (등식 5개 ASC → `categoryKeys` CONTAINS → 범위 필드 `nextAvailableAt` ASC 가 마지막).
`backend/tests/test_firestore_emulator_agents.py::test_discovery_query_has_a_matching_composite_index` 가 쿼리와 인덱스 파일의 드리프트를 잡는다.
인덱스가 없는 실 Firestore 에서는 `FAILED_PRECONDITION` → `_filter_without_composite_index` 폴백(경고 로그, 결과 동일, 비용만 큼). 배포: `firebase deploy --only firestore:indexes --config scripts/local/firebase.json`.

로컬 실측은 Firestore 에뮬레이터(`scripts/local/firebase.json`, :8780)로 한다. **에뮬레이터는 복합 인덱스를 강제하지 않는다** — 쿼리 결과의 정확성(메모리 저장소와 동일)만 검증하고, 인덱스 존재는 위 테스트가 본다.

```bash
scripts/local/a2a_multi_agent_firestore.sh          # 에뮬레이터 + 시드 + 크리에이터 A/B + 브랜드 (하나의 Firestore)
FIRESTORE_EMULATOR_HOST=127.0.0.1:8780 GOOGLE_CLOUD_PROJECT=demo-knot \
  python backend/scripts/seed_firestore.py --creator-agent-base-url http://127.0.0.1:8091/a2a/v1   # 멱등 시드
cd backend && FIRESTORE_EMULATOR_HOST=127.0.0.1:8780 pytest tests/test_firestore_emulator_agents.py   # 어댑터·레지스트리 통합
```

`agentRegistry/{agentId}` 는 쿼리하지 않고 문서 id 로만 읽으므로 인덱스가 필요 없다. 시드 재실행은 레지스트리의 운영 필드(`healthStatus`, `lastSeenAt`, `hostedBy`, `negotiationStats`, 프로브 필드)를 보존한다.
