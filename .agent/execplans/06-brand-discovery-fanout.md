# Phase 6 - Brand Agent Discovery and Fan-out Negotiation

## Goal
브랜드 에이전트가 레지스트리/공개 프로필을 탐색해 조건에 맞는 크리에이터 에이전트 여러 명을 고르고, 총예산 안에서 동시에 A2A 협상을 진행해 목표 인원만큼 합의를 만든다. 모든 에이전트는 자기 정책을 스스로 들고 있고, 브랜드는 공개 정보와 엔드포인트만 본다.

## Current Behavior
- `apps/brand_agent`는 요청에서 `creatorAgentId` 하나를 받아 단일 협상만 한다. 엔드포인트는 `CREATOR_AGENT_BASE_URL` 하나로 고정.
- `apps/creator_agent`는 `demo_creator_contexts()` 3명만 알고, Firestore 백엔드일 때만 저장소 정책을 읽는다.
- `libs/agents/discovery.py` + `matching.py`에 탐색·점수 로직이 있으나 제품 API(`routes.py`)만 쓰고, 상위 1명만 고른다.
- 레지스트리 문서(`agents/{id}/registry`)에 `a2aEndpoint`는 경로("/a2a/v1")뿐, 호스트가 없다.

## In Scope
- 크리에이터 에이전트: 저장소 기반 테넌트 해석(메모리 시드 포함), `KNOT_CREATOR_AGENT_TENANTS`로 프로세스별 호스팅 테넌트 제한.
- 레지스트리 엔트리에 `baseUrl` 추가, 설정 `KNOT_CREATOR_AGENT_ENDPOINTS`로 테넌트별 엔드포인트 오버라이드.
- `libs/agents/brand_discovery.py`: 공개 프로필 쿼리 → 순위 → 상세 하드필터 → 상위 K → agent card 생존 확인(병렬).
- `libs/agents/brand_campaign.py`: 예산 예약 장부, 후보별 병렬 `BrandNegotiator`, 목표 인원 도달 시 나머지 취소, `matchRuns` 기록.
- `BrandNegotiator`: 외부 중단 신호, 누적 확정 예산 제공자, `CANCELED` 결과.
- 브랜드 에이전트 API: `POST /brand/v1/campaigns`, `GET /brand/v1/campaigns/stream`(SSE), `GET /brand/v1/campaign`(관전 페이지).
- 스크립트 `backend/scripts/a2a_campaign.py`, `scripts/local/dev_stack.sh` 크리에이터 프로세스 2개.
- 테스트.

## Out of Scope
- Firestore 실연결, 벡터 검색, pay.sh 검증(`verify_candidates`) 호출, 에스크로 락, 프론트(Next) 연동, LangGraph.

## Files and Symbols
- `backend/libs/settings/config.py` — `creator_agent_tenants`, `creator_agent_endpoints`
- `backend/libs/a2a/registry.py` — `creator_agent_registry_entry(base_url=)`, `registry_base_url()`
- `backend/libs/a2a/store.py` — `InMemoryA2ATaskStore(allowed_tenants=)`
- `backend/apps/creator_agent/main.py` — `_build_task_store` 저장소 해석 항상 배선
- `backend/libs/agents/brand_negotiator.py` — `should_stop`, `committed_usdc_provider`, `Outcome` + `CANCELED`
- `backend/libs/agents/brand_discovery.py` (신규)
- `backend/libs/agents/brand_campaign.py` (신규)
- `backend/apps/brand_agent/main.py` — campaigns 엔드포인트, 저장소 주입
- `backend/apps/brand_agent/static/campaign.html` (신규)
- `backend/scripts/a2a_campaign.py` (신규)
- `backend/tests/test_brand_campaign.py` (신규)
- `backend/libs/repositories/seed.py` — 레지스트리 엔트리에 baseUrl 반영

## Data Migration
없음. 레지스트리 문서에 `baseUrl` 필드 추가(없으면 기본값으로 해석, 하위 호환).

## API Changes
- 신규 `POST /brand/v1/campaigns` → `CampaignResult`
- 신규 `GET /brand/v1/campaigns/stream` → SSE `discovery`, `negotiation_started`, `turn`, `negotiation_result`, `campaign_result`, `error`
- 기존 `/brand/v1/negotiations*` 유지.

## UI Changes
브랜드 에이전트 정적 페이지 `campaign.html`: 탐색 결과 표 + 후보별 협상 컬럼 + 예산/결과 배너.

## Security Considerations
- 캠페인 경로는 `creatorNegotiationContext` 메타데이터를 보내지 않는다. 크리에이터 정책은 크리에이터 에이전트 저장소에서만 읽는다.
- 비공개 상한·최소 금액은 와이어/탐색 결과에 노출하지 않는다(공개 프로필은 `publicRateBand` 구간만).
- 예산 초과는 장부 예약 + `validate_brand_terms(cumulative_committed_usdc)` 이중 차단.

## Milestones
1. [x] 크리에이터 에이전트 다중 테넌트 + 테넌트 제한
2. [x] 레지스트리 baseUrl + 엔드포인트 해석
3. [x] 탐색 깔때기
4. [x] 예산 장부 + 팬아웃 (FIFO 공정성 포함)
5. [x] 브랜드 API/SSE/페이지
6. [x] 테스트·실행 검증·문서

## Tests
- 탐색: beauty 프로모션 시드에서 후보 순위, 탈락 사유(`RATE_EXCEEDS_MAX_PER_CREATOR` 등), 카드 프로브 실패 시 제외
- 장부: 예약 합이 총예산을 넘지 않음, 합의 시 차액 반환
- 캠페인(인프로세스): 목표 2명 도달 시 나머지 CANCELED
- 캠페인(실 HTTP): 크리에이터 uvicorn 2개(테넌트 분할) + 브랜드 TestClient 스트림

## Rollback
신규 파일 삭제 + 설정 필드 제거. 기존 단일 협상 경로는 변경하지 않는다.

## Progress
- [x] 2026-10-14 전 마일스톤 완료. `tests/test_brand_campaign.py` 9개 + 기존 A2A 27개 통과.
- [x] 실행 검증: `scripts/local/a2a_multi_agent.sh`로 크리에이터 2 프로세스(8091/8092) + 브랜드(8083), Vertex on, beauty/1300/목표2 → TARGET_REACHED, 확정 1050.

## Decisions
- 순차가 아니라 병렬 팬아웃 + 예약. 이유: 데모 체감과 실제 플랫폼 동작 모두 병렬이 맞고, 초과 지출은 예약으로 막을 수 있다.
- 탐색 1~2단계는 기존 `discovery.py`/`matching.py` 재사용. 새 점수 체계를 만들지 않는다.
- LangGraph 미도입. 결정적 루프가 테스트·감사에 유리.

## Risks
- 메모리 저장소 `query_documents`가 `array_contains`/`<=`를 지원하는지에 의존 → 테스트로 확인.
- 병렬 Gemini 호출로 라운드 지연 증가 → 라운드당 수초, 후보 5명이면 1분 내.

## Completion Evidence
- 탐색: queried 6 · ranked 6 · probed 4. 탈락 사유 `RATE_EXCEEDS_MAX_PER_CREATOR`(004), `USAGE_RIGHTS_UNSUPPORTED`(006).
- 협상: agent-creator-1 400 즉시 ACCEPT, creator-agent-001 400→650 COUNTER→ACCEPT. 나머지 TARGET_REACHED로 미시작.
- 장부: 예약 700 → 확정 400 → 가용 900 → 예약 700 → 확정 1050 / 1300.
- 관전 페이지 `http://127.0.0.1:8083/brand/v1/campaign` 스크린샷은 세션 기록 참조.
