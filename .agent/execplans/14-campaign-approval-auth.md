# Phase 14 - Campaign and Approval Route Authentication

## Goal
캠페인 라우트(`POST /promotions/{id}/campaigns`, `GET …/campaigns/stream`, `POST …/campaigns/{cid}:cancel`)와 승인 라우트(`GET /approvals`, `GET /approvals/{id}`, `:approve`, `:reject`)가 **프로모션을 소유한 브랜드 사용자**만 받게 한다.
로컬 데모(헤더 없이 시드 `promotion-001` 캠페인)는 지금 문서대로 그대로 돌아야 하고, 운영에서는 스위치 하나로 익명 경로를 닫을 수 있어야 한다.
승인/거절은 **누가 결정했는지**(`decidedBy`)를 문서·타임라인·감사에 남긴다.

## Current Behavior
- 캠페인·승인 라우트에 인증이 전혀 없다(ExecPlan 11 "Out of Scope", 세션 6c 메모). 누구나 어떤 프로모션으로든 캠페인을 띄우고, 어떤 승인이든 결정할 수 있다.
- `/brand/*` 라우트는 항상 `_require_auth_user` → `_require_completed_role(BRAND)` → `_require_brand_promotion_document`(404/403). `KNOT_AUTH_MODE`는 `firebase`(Admin SDK 검증) / `emulator`(서명 없는 JWT) 둘뿐이고 **어느 모드에도 익명 허용은 없다**.
- 같은 `/promotions`·`/agreements`·`/escrows` 네임스페이스의 에이전트 런타임 라우트(`POST /agreements/{id}/escrow:lock`, `…/milestones/{id}:release`, `POST /disputes/{id}:resolve`)는 **헤더가 있으면 검증·소유권 강제, 없으면 익명 진행**이다. 캠페인 정산은 이 `lock_escrow`를 그대로 호출한다.
- 승인 결정에는 결정자 기록이 없다(`decidedAt`만).
- 프론트 `apiClient.request`는 토큰이 있으면 `Authorization`을 붙이고, Next 프록시 `frontend/src/app/api/v1/[...path]/route.ts`는 `Authorization`·`Idempotency-Key`를 그대로 전달한다. 캠페인 관전은 네이티브 `EventSource(url)`라 **헤더를 못 보낸다**.

## In Scope
- `routes.py` 모듈 헬퍼 `_optional_brand_user`, `_optional_promotion_owner`, `_approvals_for_brand` (다른 `_require_*` 옆).
- 캠페인 라우트 3개·승인 라우트 4개에 `Authorization` 헤더 파라미터 + 위 헬퍼.
- `Settings.campaign_auth_required` / `KNOT_CAMPAIGN_AUTH_REQUIRED`(기본 off): 익명 경로를 401로 닫는 스위치.
- `_decide_approval(decided_by=)` → `approvals/{id}.decidedBy`, 타임라인 `APPROVAL_GRANTED|APPROVAL_REJECTED.data.decidedBy`, 감사 `actorUid`.
- 테스트 `tests/test_api_auth_campaigns.py`, 문서.

## Out of Scope
- 독립 브랜드 에이전트(`apps/brand_agent`) — 서비스 토큰 체계가 따로 있다.
- 프론트 변경(EventSource에 토큰을 싣는 방식), 단일 협상 경로(`matches:run`, `start-negotiation`)의 인증, 승인 큐 화면, 알림.
- `matches:run`·`start-negotiation`은 다른 에이전트가 트레이싱 span을 넣는 중이라 건드리지 않는다.

## Files and Symbols
- `backend/apps/api/routes.py` — `_optional_brand_user`, `_optional_promotion_owner`, `_approvals_for_brand`; `run_campaign`, `stream_campaign`, `cancel_campaign`, `list_approvals`, `get_approval`, `_owned_approval`, `approve_approval`, `reject_approval`, `_decide_approval(decided_by=)`
- `backend/libs/settings/config.py` — `campaign_auth_required`
- `backend/.env.example` — `KNOT_CAMPAIGN_AUTH_REQUIRED`
- `backend/tests/test_api_auth_campaigns.py` (신규)
- `docs/09_A2A_NEGOTIATION_PROTOCOL.md` 부록 5 "인증", `docs/10_API_CONTRACTS_AND_BACKWARD_COMPATIBILITY.md` §3

## Data Migration
없음. `approvals/{id}.decidedBy`(uid 또는 `null`)는 새 결정부터 기록, 기존 문서는 필드 없음.

## API Changes
| 라우트 | 헤더 없음 (기본) | 헤더 없음 (`KNOT_CAMPAIGN_AUTH_REQUIRED=1`) | 헤더 있음 |
|---|---|---|---|
| `POST /promotions/{id}/campaigns`, `GET …/campaigns/stream`, `POST …/campaigns/{cid}:cancel` | 익명 진행(기존과 동일) | 401 `UNAUTHENTICATED` | 토큰 무효 401 · 브랜드 아님 403 `FORBIDDEN` · 온보딩 미완 409 `ONBOARDING_REQUIRED` · 프로모션 없음 404 · 다른 브랜드 403 `FORBIDDEN` → 통과 |
| `GET /approvals` | 전체 큐 | 401 | 내 브랜드 프로모션의 승인만 |
| `GET /approvals/{id}`, `:approve`, `:reject` | 익명 진행, `decidedBy: null` | 401 | 소유 브랜드만(403), `decidedBy: <uid>` |
- 소유권 판단은 `promotion.brandId == user.brandId`(`/brand/promotions/{id}`와 동일). 프로모션 문서의 `ownerUid`는 보지 않는다 — 시드 `promotion-001`(brand-001)은 `user-brand-1`(brand-1) 토큰으로 403.
- 소유권 검사는 상태 검사보다 먼저라, 다른 브랜드는 403 뒤로 아무것도 알 수 없다(APPROVED/REJECTED 여부 포함).
- 타임라인 `APPROVAL_GRANTED` / `APPROVAL_REJECTED` `data.decidedBy`, 감사 이벤트 `data.actorUid` 추가. 기존 필드 불변.

## Security Considerations
- "`/brand/*`보다 느슨하지도, 나머지 제품보다 엄격하지도 않게": 캠페인·승인 라우트는 같은 네임스페이스의 `escrow:lock`·`milestones:release`와 같은 규칙(헤더가 있으면 반드시 맞아야 한다)을 따르고, 운영에서는 스위치로 `/brand/*` 수준(항상 토큰)으로 올린다.
- 기본값을 "항상 필요"로 두지 않은 이유: (1) 프론트 캠페인 관전이 `EventSource`라 토큰을 못 싣는다 — Cloud Run(`KNOT_AUTH_MODE=firebase`) 데모가 즉시 깨진다. (2) 기존 캠페인·승인 테스트와 로컬 스크립트는 헤더 없이 `Settings()` 기본값으로 돈다. 스위치를 켜기 전에 프론트가 스트림에 토큰을 싣도록(fetch 기반 SSE 등) 바꿔야 한다.
- 토큰 검증은 기존 `FirebaseTokenVerifier`(`firebase`/`emulator`) 그대로. 쿼리 파라미터 토큰은 추가하지 않았다(URL·로그 유출).
- 401/403 응답은 스트림이 열리기 전에 돌아간다(SSE `error` 이벤트가 아니라 일반 응답).

## Milestones
1. [x] 헬퍼 + 설정
2. [x] 캠페인 라우트 3개
3. [x] 승인 라우트 4개 + `decidedBy`
4. [x] 테스트
5. [x] 문서

## Tests
- 소유 브랜드 토큰: 캠페인 201 / 스트림 200 / cancel 404(미존재 캠페인), 승인·거절 200 + `decidedBy`
- 다른 브랜드 토큰: 캠페인 3개·승인 3개 모두 403 `FORBIDDEN`, 타임라인·승인 문서 불변
- `ownerUid`가 아니라 `brandId`로 판단(promotion-001 + user-brand-1 → 403)
- 크리에이터/미등록 uid 403, 깨진 토큰 401, 소유자 토큰 + 없는 프로모션 404
- 헤더 없음: 기본 모드 201(데모 유지), `campaign_auth_required=True`면 7개 라우트 모두 401이고 소유자는 영향 없음
- `GET /approvals` 브랜드별 필터(익명은 전체), 익명 결정은 `decidedBy: null`
- 기존 `test_api_campaigns.py`·`test_api_approvals.py` 무변경 통과

## Rollback
라우트에서 `_optional_promotion_owner`/`_optional_brand_user` 호출 제거 → 이전과 동일. `decidedBy`는 추가 필드라 남겨도 무해.

## Progress
- [x] 2026-10-14 전 마일스톤 완료. `tests/test_api_auth_campaigns.py` 11개.

## Decisions
- 가장 가까운 기존 라우트는 `/brand/promotions/{id}`가 아니라 `POST /agreements/{id}/escrow:lock`이다. 캠페인 라우트는 `/promotions/...` 에이전트 런타임 네임스페이스에 있고, 정산을 바로 그 함수로 하며, 시드 데모 프로모션에 소유 사용자가 없다. 그래서 "헤더가 있으면 강제, 없으면 익명" + 스위치.
- 스위치는 `KNOT_AUTH_MODE`에 얹지 않고 별도 불리언으로 뒀다. 인증 모드는 "토큰을 어떻게 검증하나"이지 "누가 익명으로 와도 되나"가 아니고, 두 모드 모두 `/brand/*`는 항상 토큰을 요구한다.
- 익명 결정의 `decidedBy`는 가짜 문자열 대신 `null`. 감사 필드명은 dev-admin과 같은 `actorUid`.
- 다른 브랜드의 승인은 404가 아니라 403(`_require_brand_promotion_document`와 동일 코드).

## Risks
- 스위치를 켜면 현재 프론트 캠페인 관전(EventSource)이 401로 끊긴다 — 프론트 후속 필요.
- 프로모션이 삭제(`deletedAt`)된 승인은 소유자 토큰으로도 404(`_require_brand_promotion_document` 규칙). 익명 경로는 영향 없음.
