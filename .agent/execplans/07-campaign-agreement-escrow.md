# Phase 7 - Campaign Agreement and Escrow Hand-off

## Goal
캠페인(탐색 → 팬아웃 협상)에서 나온 합의를 제품이 이해하는 `negotiations/`, `agreements/`(+milestones) 문서로 만들고,
프로모션 정책이 허용하면 기존 에스크로 락 경로로 넘겨 "에이전트끼리 합의 → 자금 잠금"까지 한 번에 끝낸다.
에이전트 도메인(합의 문서 생성)과 결제 도메인(에스크로)은 호출 경계로만 만나고, 결제 로직은 건드리지 않는다.

## Current Behavior
- `CampaignRunner`는 `matchRuns/{id}`와 후보 문서만 쓴다. 합의 결과(`agreementId`, `termsHash`, `terms`)는 결과 객체에만 있고 저장되지 않는다.
- 제품 API의 단일 협상 경로(`routes.start_negotiation`)만 `negotiations/`, `agreements/`, milestones를 만들고, `POST /agreements/{id}/escrow:lock`이 에스크로를 잠근다.
- 합의 문서 투영 헬퍼(`_terms_work_items`, `_public_*_snapshot` 등)는 `routes.py` 안에 갇혀 있다.
- `matchRuns` 상태 어휘가 캠페인(TARGET_REACHED 등)과 제품(doc 07: NEGOTIATING/AGREED/EXHAUSTED…)에서 다르다.

## In Scope
- `libs/agents/agreements.py`: 투영 헬퍼 이동 + `build_negotiation_document`, `build_agreement_document`(termsHash 재계산·불일치 시 하드 실패), `write_agreement_milestones`.
- `libs/agents/creator_context.py`: 저장소 기반 크리에이터 컨텍스트 해석기(크리에이터 에이전트와 API 로컬 모드가 공유).
- `CampaignRunner`: 합의 시 문서 영속화, `agreement_created` 이벤트, 선택적 `settlement_hook`(에스크로) 호출과 `escrow_locked`/`escrow_skipped` 이벤트, doc 07 어휘의 `matchRuns.status` + `campaignOutcome`.
- 제품 API: `POST /api/v1/promotions/{id}/campaigns`, `GET /api/v1/promotions/{id}/campaigns/stream`(SSE). 로컬 A2A 모드는 인프로세스 스토어, http 모드는 레지스트리 엔드포인트. 합의마다 `autonomy.autoEscrow`면 기존 `lock_escrow`를 그대로 호출.
- 브랜드 에이전트 앱/관전 페이지/CLI: 합의·에스크로 이벤트 표시.
- 테스트·문서.

## Out of Scope
- 에스크로 락 로직 리팩터링(`routes.py` 결제 부분은 호출만 한다), 마일스톤 릴리즈, 프론트(Next) 연동, `a2aTasks/` 문서 복제.

## Files and Symbols
- `backend/libs/agents/agreements.py` (신규)
- `backend/libs/agents/creator_context.py` (신규)
- `backend/libs/agents/brand_campaign.py` — `CampaignRunner(brand=, promotion_document=, settlement_hook=)`, `CandidateNegotiation.negotiationId/agreementId/termsHash/escrow`
- `backend/libs/agents/campaign_stream.py` (신규) — 러너 이벤트를 SSE 튜플로
- `backend/apps/api/routes.py` — 헬퍼 import로 교체, 캠페인 라우트 2개
- `backend/apps/creator_agent/main.py` — 해석기 import
- `backend/apps/brand_agent/main.py`, `static/campaign.html`, `backend/scripts/a2a_campaign.py`
- `backend/tests/test_agreements.py`, `test_brand_campaign.py`, `test_api_campaigns.py` (신규)

## Data Migration
없음. `matchRuns.status`는 doc 07 어휘(`NEGOTIATING`→`AGREED`/`EXHAUSTED`)로 쓰고 `campaignOutcome`을 함께 저장한다.

## API Changes
- 신규 `POST /api/v1/promotions/{promotionId}/campaigns` → `{campaign, agreements}`
- 신규 `GET /api/v1/promotions/{promotionId}/campaigns/stream` → SSE (`discovery`, `negotiation_started`, `turn`, `negotiation_result`, `agreement_created`, `escrow_locked`, `escrow_skipped`, `campaign_result`, `error`)
- 기존 라우트 동작 불변.

## Security Considerations
- termsHash는 크리에이터 아티팩트 값을 믿지 않고 재계산해 비교한다. 불일치면 합의로 세지 않고 예산을 돌려준다.
- 에스크로는 프로모션 `autonomy.autoEscrow`가 true이고 web3 모드가 gateway일 때만, 기존 엔드포인트의 멱등키/영수증 경로로만 잠근다. 멱등키 = `campaign-{campaignId}-{agreementId}`.
- 크리에이터 정책 스냅샷은 `{"redacted": true}` 그대로.

## Milestones
1. [x] 투영 헬퍼·합의 문서 빌더를 libs로 이동, routes는 import
2. [x] CampaignRunner 영속화 + settlement hook + 이벤트
3. [x] 제품 API 캠페인 라우트(동기 + SSE), 로컬/HTTP 전송
4. [x] 브랜드 에이전트/페이지/CLI 표시
5. [x] 테스트·문서

## Tests
- 합의 빌더: 정상 생성, termsHash 불일치 예외, 마일스톤 금액 합계 = 락 금액
- 캠페인(인프로세스): 합의마다 `negotiations/`·`agreements/`·milestones 존재, 후보 문서에 negotiationId/agreementId 링크, hook 호출·이벤트 순서
- API: 시드 저장소 로컬 모드 → 201 + agreements; gateway 모의 → 각 합의 escrow LOCKED, 타임라인 `ESCROW_LOCKED`; autoEscrow off → `escrow_skipped`
- 기존 스위트 회귀 없음

## Rollback
신규 파일 삭제, routes.py의 import를 원래 함수 정의로 되돌림.

## Progress
- [x] 2026-10-14 전 마일스톤 완료. `tests/test_api_campaigns.py` 6개 + `tests/test_agreements.py` 2개 추가, 전체 214 passed.
- [x] 실행 검증: `scripts/local/a2a_multi_agent.sh` + CLI 캠페인에서 `agreement_created` → `escrow_skipped(SETTLEMENT_VIA_PRODUCT_API)` 확인. API 경로는 gateway 모의 테스트로 `ESCROW_LOCKED` 2건 확인.

## Decisions
- API가 브랜드 에이전트 런타임 역할도 한다(기존 단일 협상 경로와 같은 저장소·결제 경로). 별도 프로세스 브랜드 에이전트는 합의 문서까지만 만들고 에스크로는 `SETTLEMENT_VIA_PRODUCT_API`로 건너뛴다.
- 에스크로 락은 `lock_escrow` 라우트 함수를 같은 스코프에서 직접 호출한다(FastAPI 데코레이터는 함수를 그대로 돌려준다). 결제 코드를 복제하거나 리팩터링하지 않는다.

## Risks
- `routes.py` 헬퍼 이동 시 호출부 누락 → ruff F821로 잡힌다.
- 캠페인 SSE는 요청 스레드 밖에서 저장소를 쓴다. 메모리 저장소는 락이 있으므로 안전, Firestore는 클라이언트가 스레드 안전.
