# Phase 15 - Single Negotiation Path Tracing (match.run / negotiation.run in the product API)

## Goal
프로덕트 API의 단일 협상 경로(`POST /promotions/{id}/matches:run` → `POST /match-runs/{id}:start-negotiation`)가 캠페인 경로와 **같은 모양의 스팬 트리**를 남기게 한다.
`scripts/trace_tail.py` 한 번으로 캠페인 트리와 단일 협상 트리를 같은 방식으로 읽을 수 있어야 하고, 트리 모양은 테스트로 고정한다.

## Current Behavior
- 12단계에서 `campaign.run → campaign.discovery / negotiation.run → a2a.send → creator.decide → llm.call` 트리가 캠페인 경로(`CampaignRunner`/`BrandNegotiator`)에 붙었다.
- 프로덕트 API의 `routes.start_negotiation`은 협상 전체(제안 → 크리에이터 결정 → 브리지 카운터/수락)를 인프로세스로 직접 돌리지만 스팬을 하나도 열지 않는다. 응답 헤더 `X-Trace-Id`만 나가고 `trace_tail.py`에는 아무것도 안 보인다.
- `run_matches`(탐색 + 순위 + 선택적 pay.sh 검증)도 같다. `negotiations/{id}`, `matchRuns/{id}`(이 경로에서 쓴 것)에 `traceId`가 없다.
- 로컬 모드(`InMemoryA2ATaskStore`)의 `creator.decide`는 이미 찍히지만 부모 없이 루트로 떠 있다.

## In Scope
- `start_negotiation`: `negotiation.run` 스팬(캠페인과 같은 attrs: `brandAgentId, creatorAgentId, promotionId, contextId, maxRounds → outcome, rounds, finalAmountUsdc, agreementId, taskId, taskState, turns`, 추가로 `negotiationId, matchRunId`), 메시지마다 `turn` 이벤트(`round, role, type, amountUsdc, messageProvider, allowed`). 브랜드 턴은 보내기 전에, 크리에이터 턴은 응답을 파싱한 직후에 기록한다(실패한 전송도 무엇을 제안했는지 남게).
- `_send_creator_a2a_task`: `a2a.send` 스팬(`creatorAgentId, type, round, messageId, taskId → taskId, taskState, replyType`). HTTP 모드는 trace 헤더가 따라가고, 로컬 모드는 `creator.decide`가 그 아래 인프로세스로 열린다.
- `_discover_creator_agent_card`: `a2a.agent_card` 스팬(`mode, baseUrl → discovered, name, version, skillCount`). 로컬 모드도 `discovered=False`로 찍어 두 모드의 트리 모양이 같게.
- `run_matches`: `match.run` 스팬(`promotionId, brandAgentId, matchRunId → queried, ranked, eligible, selected, selectedCreatorAgentId, verificationMode, verificationStatus`), pay.sh가 켜져 있으면 자식 `match.verify`(`provider, protocol, mode → status, continuation, idempotencyReused, amountUsdc`).
- traceId 부착: `negotiations/{id}.traceId`, `matchRuns/{id}.traceId`(이 경로), 두 응답의 `meta.traceId`(= 응답 헤더 `X-Trace-Id`).
- `scripts/trace_tail.py` 요약 키에 `match.run`, `match.verify`, `a2a.agent_card`.
- 테스트·문서.

## Out of Scope
- `frontend/`, `libs/policies/`, `routes.py`의 캠페인 라우트(`_campaign_runner`, `run_campaign`, `stream_campaign`, `cancel_campaign`)와 승인 라우트(다른 작업자가 인증 추가 중).
- 요청 단위 `http.request` 스팬, 샘플링, `brand_discovery.py` 프로브 스팬.
- 기존 협상이 있어 그대로 돌려주는 조기 반환 경로(협상이 돌지 않으므로 스팬 없음).

## Files and Symbols
- `backend/apps/api/routes.py` — `run_matches`(`match.run`), `_traced_paid_verification`(`match.verify`, `_run_paid_verification` 래퍼), `start_negotiation`(`negotiation.run` + `turn`), `_trace_negotiation_turn`, `_send_creator_a2a_task`(`a2a.send`) / `_send_creator_a2a_task_untraced`(기존 전송 본체), `_discover_creator_agent_card`(`a2a.agent_card`), `_PAYSH_DISABLED_MODES`
- `backend/scripts/trace_tail.py` — `SUMMARY_KEYS` 3개 추가
- `backend/tests/test_tracing_product_path.py` (신규), `backend/tests/test_api_a2a_http_integration.py`(HTTP 경계 중첩 단언 추가)

## Data Migration
없음. `negotiations/{id}.traceId`, `matchRuns/{id}.traceId`는 새 문서에만 붙는다.

## API Changes
- 응답에 필드 추가만: `POST /promotions/{id}/matches:run` → `meta.traceId`, `data.matchRun.traceId`; `POST /match-runs/{id}:start-negotiation`(및 `/start-negotiation` 별칭) → `meta.traceId`, `data.negotiation.traceId`.

## Security Considerations
- `brandPolicySnapshot`/`creatorPolicySnapshot`/`CreatorNegotiationContext.policy`는 스팬에 넘기지 않는다. `turn` 이벤트는 `policyDecision.allowed`만 읽고, 트레이서의 `ceiling*/min*/policy*` 리댁션은 마지막 방어선일 뿐이다. 테스트가 로그 전체에서 `ceiling`, `"policy`, `"minBaseUsdc"` 부재를 단언한다.
- `match.verify`는 결과 요약(status/continuation/amount)만 기록한다. 영수증 본문·지갑·pay.sh 원응답은 넣지 않는다.
- 실패한 요청은 스팬 `status: error`에 `HTTPException: 502: {...}` 형태로 남는데, `_problem`의 detail은 공개 에러 메시지뿐이다.

## Milestones
1. [x] `negotiation.run` + `turn` + `a2a.send` + `a2a.agent_card`, traceId 부착
2. [x] `match.run` + `match.verify`, traceId 부착
3. [x] 테스트(로컬 합의 / 로컬 카운터 / 전송 실패 / HTTP 경계)
4. [x] 실측(:8181, `KNOT_CREATOR_A2A_MODE=local`)
5. [x] 문서

## Tests
- `tests/test_tracing_product_path.py`(3): (a) `matches:run` + `start-negotiation`이 각각 `match.run(+match.verify)`, `negotiation.run` 루트를 남기고 응답 `X-Trace-Id` = `meta.traceId` = 문서 `traceId`; `turn` 2개(brand OFFER / creator ACCEPT), `a2a.agent_card`·`a2a.send`가 협상 아래, `creator.decide`가 send 아래, 두 trace 외 스팬 없음, 로그에 비공개 키 없음. (b) 카운터 흐름(최소가 650, 첫 제안 300): `turn` 6개가 메시지 순서·금액·라운드대로, offset 단조 증가, `a2a.send` 3개가 같은 taskId, `creator.decide`가 각 send 아래. (c) 전송 실패: `negotiation.run`/`a2a.send` 모두 `status: error`, 브랜드 OFFER 턴만 기록, 502.
- `tests/test_api_a2a_http_integration.py`: 실제 HTTP 크리에이터 에이전트(스레드)에서 `creator.decide` 3개가 브랜드 `a2a.send` 3개 아래에 헤더로 붙는다, `a2a.agent_card discovered=True`.
- 전체: 257 passed / 8 skipped / 6 deselected (`-k "not paysh_sandbox"`).

## Rollback
`KNOT_TRACING=0`이면 스팬을 내보내지 않는다(id 부착은 유지). 코드 롤백 시 `traceId` 필드만 사라진다.

## Progress
- [x] 2026-10-14 전 마일스톤 완료. 실측 트리는 `WORK_SESSION_2026-10-13.md` 세션 7c.

## Decisions
- 라우트 본문을 함수로 쪼개지 않고 `with start_trace(...), span("negotiation.run", ...)` 아래로 들여썼다. 캠페인 라우트와 같은 패턴이고, 다른 작업자가 같은 파일의 다른 라우트를 편집 중이라 구조 변경을 최소화했다.
- `a2a.send`는 기존 전송 함수를 `_send_creator_a2a_task_untraced`로 두고 그 위에 감쌌다. 테스트가 전송만 깨뜨릴 수 있고(`monkeypatch`), 로컬 store 캐시(`_LOCAL_CREATOR_A2A_STORES`) 로직은 손대지 않았다.
- 브랜드 턴은 전송 전, 크리에이터 턴은 파싱 직후에 기록한다(`BrandNegotiator._trace_turn`과 같은 시점). 영속 메시지 목록을 뒤에서 한 번에 돌면 offset이 전부 끝 시각이 돼 쓸모가 없고, 실패한 전송의 제안이 사라진다.
- `a2a.agent_card`는 로컬 모드에서도 찍는다(`discovered=False`). 트리에서 "카드 탐색을 건너뛰었다"를 바로 읽기 위해서다.
- `match.verify`는 pay.sh 모드가 꺼져 있으면(`off/disabled/local/none`) 열지 않는다. 기본값(`sandbox`, 리소스 미설정)은 검증 단계가 돌고 안에서 SKIPPED 되므로 스팬이 남는다.
- `negotiation.run`에 `negotiationId`, `matchRunId`를 더 넣었다. 캠페인 경로엔 없는 상관 키지만 프로덕트 경로에선 문서 경로를 바로 찾는 데 필요하다.

## Risks
- `start_negotiation` 본문 전체가 한 단계 더 들여써져 diff가 크다(의미 변경은 `turn`/traceId/`meta.traceId` 추가뿐). 다른 작업자가 같은 함수를 건드리면 머지 충돌이 난다. 캠페인·승인 라우트는 건드리지 않았다.
- HTTP 모드에서 크리에이터 프로세스가 trace 헤더를 무시하면 `creator.decide`가 별도 루트로 보인다(12단계와 같은 제약).
