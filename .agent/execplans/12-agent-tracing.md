# Phase 12 - Agent Tracing (campaign → negotiation → A2A → LLM)

## Goal
캠페인·협상·A2A 메시지·LLM 호출 하나하나가 **같은 traceId로 묶인 스팬 트리**로 남게 한다.
외부 서비스 없이 표준 라이브러리만으로 구조화 JSON 로그(`knot.trace`)를 기본으로 쓰고, LangSmith는 선택(키가 있고 `langsmith`가 import되면)으로 미러링한다.
브랜드 프로세스와 크리에이터 프로세스 로그를 합치면 한 트리가 되어야 한다.

## Current Behavior
- `libs/observability/middleware.py`는 응답에 `X-KNOT-Service` 헤더만 붙인다. 요청 id·상관 id가 없다.
- 캠페인/협상은 SSE 이벤트와 결과 객체로만 관측된다. 어느 협상이 어느 캠페인이고, 크리에이터 쪽 결정이 어느 브랜드 메시지에 대한 것인지 로그로 이을 방법이 없다.
- Gemini 호출(`libs/ai/gemini.py`)은 fallback 사유를 결과 객체에만 남기고, 지연 시간은 어디에도 없다.
- uvicorn 아래에서 앱 로거의 INFO는 루트 로거 last-resort 핸들러(WARNING 이상)에 걸려 출력되지 않는다.
- `docs/agent_ops/02_langsmith_integration.md`는 `@traceable`/LangGraph 기반 설계안이지만 코드가 없다.

## In Scope
- `libs/observability/tracing.py`: `new_trace_id()`, `span(name, **attrs)`(`Span.set/event`), contextvars 전파(`propagate()/bind()/propagate_to_thread()/start_trace()`), 프로세스 간 헤더(`X-Trace-Id`/`X-Parent-Span-Id`, `trace_headers()`), 싱크(`LogSink` 기본, `LangSmithSink` 선택), 리댁션(`ceiling*`/`min*`/`policy*` 속성 드롭 + `redacted: [...]`), `install_logging()`.
- `Settings.tracing_enabled`(`KNOT_TRACING`, 기본 on) / `tracing_sink`(`KNOT_TRACING_SINK`=`log|langsmith`, 키가 있으면 기본 langsmith) / `langsmith_project`(`LANGSMITH_PROJECT`|`LANGCHAIN_PROJECT`).
- 미들웨어: 요청마다 trace 컨텍스트 바인딩(들어온 `X-Trace-Id`/`X-Request-Id` 재사용), 응답 `X-Trace-Id`. A2A 클라이언트가 같은 헤더를 보낸다.
- 계측: `campaign.run` → `campaign.discovery`, `negotiation.run`(스레드 전파) → `a2a.send`/`a2a.cancel` + `turn` 이벤트; 크리에이터 `creator.decide` → `llm.call`.
- traceId 부착: SSE `status`/`campaign_result`, `CampaignResult.traceId`, `BrandNegotiationResult.traceId`, `matchRuns/{id}.traceId`, API 응답 `meta.traceId`, 타임라인 `CAMPAIGN_STARTED/COMPLETED`.
- `scripts/trace_tail.py`: 로그 파일(들)/stdin → traceId별 들여쓰기 트리(+지속 시간, 이벤트, `-f`).
- 테스트·문서.

## Out of Scope
- 프론트, `scripts/local/`, `libs/policies/`, `libs/repositories/`, `repository_factory.py`, `brand_discovery.py`(다른 작업자 소유).
- `brand_campaign.py`의 정산/승인 경로(`_settle`, `negotiation_result` 이후 블록) — 다른 작업자가 편집 중. 여기서는 `run()` 시작/끝, `_result`/`_persist_match_run` 페이로드, `pool.map` 한 줄(스레드 전파)만 만진다.
- 요청 단위 `http.request` 스팬(헬스체크·폴링 노이즈), 샘플링, 메트릭 집계.

## Files and Symbols
- `backend/libs/observability/tracing.py` (신규) — `Span`, `span`, `TraceContext`, `bind`, `propagate`, `propagate_to_thread`, `start_trace`, `trace_headers`, `redact`, `LogSink`, `LangSmithSink`, `configure`, `install_logging`
- `backend/libs/observability/middleware.py` — trace 바인딩 + `X-Trace-Id`
- `backend/libs/a2a/client.py` — `_headers()`에 `trace_headers()`
- `backend/libs/agents/brand_negotiator.py` — `run()`→`negotiation.run` 스팬, `_send`→`a2a.send`, `_cancel`→`a2a.cancel`, `_trace_turn`, `BrandNegotiationResult.trace_id`
- `backend/libs/agents/brand_campaign.py` — `CampaignRunner.trace_id`, `run()`→`campaign.run`/`campaign.discovery`, `CampaignResult.trace_id`, matchRuns `traceId`
- `backend/libs/agents/campaign_stream.py` — `status.traceId`, 워커 스레드 컨텍스트 전파
- `backend/libs/a2a/store.py` — `send_message`→`creator.decide`(`_decide`)
- `backend/libs/ai/gemini.py` — `_generate_json(purpose=)`→`llm.call`, 실제 호출은 `_call_vertex`
- `backend/libs/settings/config.py` — tracing 설정 3개
- `backend/apps/{api,brand_agent,creator_agent}/main.py` — `install_logging(settings)`
- `backend/apps/api/routes.py` — `run_campaign`/`stream_campaign`에서 `start_trace`, `meta.traceId`
- `backend/apps/brand_agent/main.py` — `_stream_negotiation` status `traceId`, 워커 전파
- `backend/scripts/trace_tail.py` (신규)
- `backend/tests/test_tracing.py` (신규), `tests/test_brand_campaign.py`, `tests/test_api_campaigns.py`, `tests/test_api_promotions.py`

## Data Migration
없음. `matchRuns/{id}.traceId`는 새 문서에만 붙는다(없으면 null로 읽음).

## API Changes
- 응답에 필드 추가만: `POST /promotions/{id}/campaigns` → `meta.traceId`, `data.campaign.traceId`, `negotiations[].result.traceId`.
- SSE `status`/`campaign_result`에 `traceId`. 브랜드 에이전트 `/negotiations/stream` `status.traceId`.
- 모든 응답 헤더 `X-Trace-Id`; A2A 요청 헤더 `X-Trace-Id`/`X-Parent-Span-Id`(크리에이터는 무시해도 동작).

## Security Considerations
- 비공개 협상 상태(브랜드 상한 `ceiling*`, 크리에이터 최소 `min*`, 정책 스냅샷 `policy*`)는 트레이서가 키 이름으로 강제 드롭한다(중첩 dict 포함). 테스트로 고정.
- `llm.call`은 provider/model/fallbackReason/latency만 남긴다. 프롬프트·응답 본문은 절대 기록하지 않는다.
- LangSmith 미러링은 키가 있을 때만, 실패해도 협상을 깨지 않는다(경고 1회 후 로그 싱크로 폴백).
- 들어오는 `X-Trace-Id`는 `[A-Za-z0-9_-]{8,64}`만 받고 아니면 새로 만든다(로그 인젝션 방지).

## Milestones
1. [x] 트레이서 + 설정 + 로깅 설치
2. [x] 미들웨어/A2A 헤더로 프로세스 간 상관
3. [x] 캠페인·협상·크리에이터·LLM 계측, traceId 부착
4. [x] `trace_tail.py` + 실측(브랜드 8183 / 크리에이터 8191)
5. [x] 테스트·문서

## Tests
- `tests/test_tracing.py`(10): 중첩/부모 id, 스레드 전파(전파 안 하면 다른 trace), 리댁션(중첩·이벤트 포함), 예외→`status: error`, 비활성 시 id만, LangSmith 폴백 경고 1회, 가짜 `langsmith.RunTree`로 중첩 run 미러링, `start_trace`/헤더, 미들웨어 바인딩·에코, `bind` 복원.
- `tests/test_brand_campaign.py::test_campaign_emits_one_trace_tree_across_negotiation_threads`: 인프로세스 캠페인이 `campaign.run` 1개 + 시작된 협상 수만큼 `negotiation.run`(같은 traceId, 부모=캠페인 스팬), `a2a.send`→`creator.decide` 중첩, 로그에 ceiling/policy 없음, matchRuns `traceId`.
- `tests/test_api_campaigns.py`: `meta.traceId == campaign.traceId == X-Trace-Id`, SSE `status`/`campaign_result` traceId, matchRun traceId.
- 전체: 234 passed / 5 skipped / 6 deselected (`-k "not paysh_sandbox"`).

## Rollback
`KNOT_TRACING=0`이면 스팬을 내보내지 않는다(id 부착은 유지). 코드 롤백 시 응답의 `traceId` 필드만 사라진다.

## Progress
- [x] 2026-10-14 전 마일스톤 완료. 실측 트리는 `WORK_SESSION_2026-10-13.md` 세션 6d.

## Decisions
- OpenTelemetry/LangSmith SDK를 필수 의존성으로 넣지 않는다. 해커톤 데모 환경(로컬·Cloud Run)에서 로그 한 줄이 가장 확실하고, Cloud Logging은 JSON 라인을 그대로 구조화한다.
- 스팬은 종료 시 1줄만 쓴다(시작 로그 없음). 트리는 `parentSpanId`로 복원하고, 자식이 부모보다 먼저 찍히는 것을 리더가 감안한다.
- 요청 단위 스팬은 만들지 않는다. 미들웨어는 id만 바인딩하고, 의미 있는 단위(캠페인/협상/메시지/LLM)가 스팬을 연다.
- `CampaignRunner`는 생성 시점에 traceId를 고정한다. SSE `status`가 `run()` 전에 나가야 하기 때문.
- Starlette가 동기 제너레이터를 스텝마다 다른 컨텍스트 복사본에서 돌리므로, 스트림 라우트는 첫 스텝(러너 생성·워커 스레드 컨텍스트 캡처)에만 trace를 바인딩한다. `bind()`는 다른 컨텍스트에서 만들어진 토큰 리셋도 견딘다.
- `llm.call`은 Gemini 모드가 off여도 찍는다(`provider=deterministic, fallbackReason=gemini_mode_off`). 데모에서 "LLM이 실제로 쓰였는가"를 트리에서 바로 읽기 위해서다.

## Risks
- 로그 I/O가 GIL을 놓으면서 캠페인 팬아웃의 목표 도달 경합(두 협상이 stop 플래그 전에 동시에 합의)이 더 자주 드러난다. 설계상 허용된 초과이며 예산은 장부가 지킨다. 정확한 합의 수를 단언하는 API 테스트는 `parallelism: 1`로 고정했다.
- LangSmith 싱크는 실제 키로 검증하지 않았다(가짜 `RunTree`로 호출 순서만 고정). 프로세스 간 부모(헤더로만 아는 스팬)는 LangSmith에서 별도 trace로 보인다.
