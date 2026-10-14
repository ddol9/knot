# Phase 11 - Governance Guardrails and Human Approval Queue

## Goal
자율 경로(탐색 → 협상 → 합의 → 에스크로 락)에 **결정적 거버넌스 가드레일**을 얹는다.
고액 합의·누적 지출은 에스크로 직전에 멈춰 사람을 기다리고(승인 큐), 비정상 협상 이력을 가진 에이전트는 탐색에서 표시·강등한다.
"사람 개입 없이 결제"가 핵심이지만, 한도 밖은 사람이 결정한다는 걸 코드로 보여준다(REFACTORING_PLAN Phase 1 "AI Governance Engine", INTERVIEW_PREP HITL).

## Current Behavior
- 캠페인이 합의를 만들면 `autonomy.autoEscrow`와 web3 모드만 보고 바로 `lock_escrow`를 부른다. 금액 상한은 프로모션 예산(`maxPerCreatorUsdc`, `totalUsdc`)뿐이고 "사람이 봐야 하는 금액"이라는 개념이 없다.
- 승인 대기 상태·승인 API가 없다. 사람이 개입하려면 `autoEscrow=false`로 끄고 Phantom으로 직접 펀딩하는 길뿐.
- 레지스트리 이력(`negotiationStats`)은 합의율로 순위를 ±0.025 조정할 뿐, "연속 실패" 같은 이상 패턴을 표시하지 않는다.

## In Scope
- `libs/policies/governance.py`: `GovernanceRules`(settings), `evaluate_settlement` → `GovernanceDecision`, `flag_track_record` → `AnomalyFlag`.
- `Settings.gov_*` + `KNOT_GOV_MAX_AUTO_AGREEMENT_USDC`(800) / `KNOT_GOV_MAX_AUTO_CAMPAIGN_TOTAL_USDC`(2000) / `KNOT_GOV_MAX_CONSECUTIVE_FAILURES`(3).
- `CampaignRunner(governance=)`: 정산 단계에서 승인 필요 시 `approvals/{id}` 생성, `negotiation.escrow = PENDING_APPROVAL`, `approval_required` 이벤트, 정산 훅 미호출.
- 제품 API: `GET /approvals`, `GET /approvals/{id}`, `POST /approvals/{id}:approve`, `POST /approvals/{id}:reject`. 타임라인 `APPROVAL_REQUIRED` / `APPROVAL_GRANTED` / `APPROVAL_REJECTED`.
- 탐색: `trackRecord.flag` + `rankScore` ×0.7 (하드 제외 없음). 레지스트리 `negotiationStats.recentOutcomes`(최근 10개).
- 독립 브랜드 에이전트·CLI·관전 페이지 표시, 테스트, 문서.

## Out of Scope
- 승인 라우트 인증/권한(캠페인 라우트와 같은 수준으로 열어 둠 — 후속), 프론트 승인 UI, 마일스톤 릴리즈 측 거버넌스(기존 `AutomationLevel` 임계값 그대로), 알림.

## Files and Symbols
- `backend/libs/policies/governance.py` (신규) — `GovernanceRules`, `GovernanceDecision`, `AnomalyFlag`, `evaluate_settlement`, `flag_track_record`, 규칙 id 상수
- `backend/libs/settings/config.py` — `gov_max_auto_agreement_usdc`, `gov_max_auto_campaign_total_usdc`, `gov_max_consecutive_failures`
- `backend/libs/repositories/firestore_paths.py` — `COLLECTIONS.approvals`, `FirestorePaths.approval`
- `backend/libs/a2a/registry.py` — `TrackRecord.recent_outcomes`, `RECENT_OUTCOMES_LIMIT`
- `backend/libs/agents/brand_campaign.py` — `CampaignRunner(governance=)`, `_settle(committed_usdc=)`, `_queue_approval`
- `backend/libs/agents/brand_discovery.py` — `discover_creator_agents(governance=)`, `rank_score(flagged=)`, `FLAGGED_RANK_MULTIPLIER`
- `backend/apps/api/routes.py` — `_campaign_runner`(거버넌스 주입, 타임라인 이벤트를 on_event에서), `_lock_agreement_escrow`, 승인 라우트 4개, `_decide_approval`, `_get_approval`
- `backend/apps/api/schemas.py` — `ApprovalRejectRequest`
- `backend/apps/brand_agent/main.py`, `static/campaign.html`, `backend/scripts/a2a_campaign.py`
- `backend/tests/test_governance.py`, `backend/tests/test_api_approvals.py` (신규)

## Data Migration
없음. `approvals/` 신규 컬렉션. `agreements/{id}.approvalId|approvalStatus`, `negotiationStats.recentOutcomes`는 없으면 무시.

## API Changes
- 신규 `GET /api/v1/approvals?status=PENDING` → `{approvals: [...]}`
- 신규 `GET /api/v1/approvals/{approvalId}` → `{approval}`
- 신규 `POST /api/v1/approvals/{approvalId}:approve` (Idempotency-Key 선택, 없으면 `approval-{id}`) → `{approval: APPROVED, escrow}`; 재호출 멱등. 락 실패 시 409 + PENDING 유지.
- 신규 `POST /api/v1/approvals/{approvalId}:reject` `{reason}` → `{approval: REJECTED}`; 재호출 멱등.
- 캠페인 응답/SSE: `negotiations[].escrow.status`에 `PENDING_APPROVAL` 추가, 이벤트 `approval_required`.
- 기존 라우트 동작 불변(기본 한도 800/2000은 시드 프로모션 캠페인을 바꾸지 않는다).

## Security Considerations
- 규칙은 LLM 없이 결정적이며 결정마다 `ruleVersion`과 규칙 id를 남긴다.
- 승인은 기존 `lock_escrow` 경로(멱등키·영수증·감사)를 그대로 쓴다. 승인 문서는 APPROVED 전까지 돈을 움직이지 않고, 락이 실패하면 PENDING으로 남는다.
- 승인 라우트는 현재 캠페인 라우트와 같이 인증 없음(데모). 운영 전 브랜드 소유자 인증 필요.

## Milestones
1. [x] 규칙 모듈 + 설정 + 테스트
2. [x] 캠페인 승인 큐 + 이벤트
3. [x] 승인 API + 타임라인
4. [x] 탐색 이상 표시
5. [x] 표시(에이전트/CLI/페이지)·문서

## Tests
- 규칙: 한도 이하 자동, 단건 초과, 누적 초과, 경계 포함, autoEscrow off는 큐에 안 넣음, 연속 실패/저합의율 플래그, 레지스트리 recentOutcomes(CANCELED 제외)
- API(gateway 모의, 한도 500): 400 자동 락 + 600 PENDING_APPROVAL, 승인 → LOCKED + `APPROVAL_GRANTED`/`ESCROW_LOCKED`, 재승인 멱등(에스크로 1개), 거절 → `FUNDING_REQUIRED` 유지 + `APPROVAL_REJECTED`, 404, SSE `approval_required`, 기본 한도 회귀
- 탐색: 연속 실패 3회 → `trackRecord.flag`, 1위에서 내려가지만 선정은 됨

## Rollback
`_campaign_runner`에서 `governance=` 제거(또는 한도를 매우 크게) → 이전과 동일. 승인 라우트는 독립이라 남겨도 무해.

## Progress
- [x] 2026-10-14 전 마일스톤 완료. `tests/test_governance.py` 10개 + `tests/test_api_approvals.py` 7개. 전체 240 passed / 5 skipped.

## Decisions
- 승인 큐는 "합의"를 되돌리지 않는다. 합의·예산 확정은 그대로이고 자금 잠금만 사람 뒤로 미룬다(크리에이터 입장에서 합의는 유효).
- `autonomy.autoEscrow=false`면 승인 큐에 넣지 않는다. 그 경우 수동 Phantom 펀딩 경로가 이미 사람의 결정이므로 큐가 중복된다.
- 거절은 합의 문서를 지우지 않고 `approvalStatus: REJECTED`만 남긴다(상태 `FUNDING_REQUIRED` 유지). 취소/환불 의미는 docs/17 영역.
- 이상 플래그는 강등(×0.7)이지 제외가 아니다. 프로브·협상이 진실이고, 합의 1건이면 연속 실패 스트릭이 끊긴다.
- 타임라인 `AGREEMENT_CREATED`를 정산 훅이 아니라 러너 이벤트(`on_event`)에서 쓴다. 승인 대기 합의도 타임라인에 남아야 하기 때문.

## Risks
- 캠페인 팬아웃은 병렬이라 "어느 에이전트가 먼저 합의하느냐"가 비결정적. 테스트는 `parallelism=1`로 고정. (기존 `test_campaign_skips_escrow_when_auto_escrow_is_off`가 전체 스위트 부하에서 가끔 agreedCount 2로 흔들리는 건 이 경합이지 거버넌스와 무관.)
- 승인 라우트에 인증이 없다. 데모 범위 밖에서는 반드시 보호할 것.
