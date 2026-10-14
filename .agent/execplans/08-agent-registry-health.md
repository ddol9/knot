# Phase 8 - Agent Registry Health and Negotiation Track Record

## Goal
에이전트 레지스트리(`agentRegistry/{agentId}`)가 "살아 있는가"와 "협상에서 어떻게 행동해 왔는가"를 들고 있게 하고, 브랜드 탐색 순위가 그 신호를 쓰게 한다.
크리에이터 에이전트는 자기 호스트/생존을 스스로 알리고(heartbeat), 브랜드는 프로브·협상 결과를 기록한다.

## Current Behavior
- 레지스트리 엔트리에 `baseUrl`, `publicationStatus`, `skillIds`만 있다. 생존 상태·마지막 응답 시각·협상 이력이 없다.
- 탐색 4단계 프로브 결과는 캠페인 결과에만 남고 레지스트리로 돌아가지 않는다. 죽은 에이전트가 다음 캠페인에서도 1순위로 프로브된다.
- 순위는 `matching.py` 점수 + 완료 딜 수뿐이라, 거절·에스컬레이션만 반복하는 에이전트가 계속 위에 온다.
- 크리에이터 에이전트 프로세스는 자기가 어떤 테넌트를 어디서 호스팅하는지 레지스트리에 쓰지 않는다(시드/설정으로만 결정).

## In Scope
- `libs/a2a/registry.py`: `record_agent_heartbeat`, `record_agent_probe`, `record_negotiation_outcome`, `registry_health`, `track_record`(라플라스 보정 합의율).
- 크리에이터 에이전트: 기동 시 호스팅 테넌트 heartbeat(`lastSeenAt`, `baseUrl`, `hostedBy`), 선택적 주기 heartbeat(`KNOT_CREATOR_AGENT_HEARTBEAT_SECONDS`).
- 탐색: 후보에 `healthStatus`/`lastSeenAt`/`trackRecord`/`rankScore` 추가, `rankScore`로 정렬(DOWN 감점, 합의율 가감), 프로브 결과를 레지스트리에 기록.
- 캠페인: 협상 결과마다 레지스트리 이력 기록. A2A 전송 실패는 프로브 DOWN으로 기록.
- 관전 페이지·CLI 표시, 테스트, 문서.

## Out of Scope
- 평판 PDA(온체인), 프론트, Agent Ops 라우터(Firestore 전용) 변경, 레지스트리 쿼리 인덱스.

## Files and Symbols
- `backend/libs/a2a/registry.py` — 위 함수들, `TrackRecord`
- `backend/libs/agents/brand_discovery.py` — `CandidateAgent.health_status/last_seen_at/track_record/rank_score`, `record_probes=`
- `backend/libs/agents/brand_campaign.py` — 결과·오류 기록
- `backend/apps/creator_agent/main.py` — `create_app(repository=)`, heartbeat
- `backend/libs/settings/config.py` — `creator_agent_heartbeat_seconds`
- `backend/apps/brand_agent/static/campaign.html`, `backend/scripts/a2a_campaign.py`
- `backend/tests/test_agent_registry_health.py` (신규)

## Data Migration
없음. 새 필드는 없으면 UNKNOWN/빈 이력으로 해석(하위 호환).

## API Changes
없음(문서 필드 추가만). 탐색 리포트 `candidates[].healthStatus|lastSeenAt|trackRecord|rankScore`.

## Security Considerations
- 레지스트리에는 공개·운영 신호만 쓴다(정책·금액 없음). `lastAmountUsdc`는 쓰지 않는다.
- heartbeat는 크리에이터 에이전트 프로세스가 자기 테넌트에만 쓴다(`allowed_tenants`와 같은 집합).

## Milestones
1. [x] 레지스트리 함수 + 테스트
2. [x] 크리에이터 heartbeat
3. [x] 탐색 순위·프로브 기록
4. [x] 캠페인 이력 기록
5. [x] 표시·문서

## Tests
- 레지스트리: 프로브 UP/DOWN 기록, heartbeat 필드, 결과 누적(CANCELED는 attempts 제외), 합의율 보정값
- 탐색: DOWN+나쁜 이력 에이전트가 점수는 높아도 순위가 내려감, 프로브 후 레지스트리 갱신
- 캠페인: 인프로세스 실행 후 합의 에이전트 attempts=1/agreements=1, 미시작 에이전트는 변화 없음
- 크리에이터 에이전트: 기동 시 호스팅 테넌트 엔트리에 lastSeenAt/hostedBy

## Rollback
새 필드 무시. 정렬은 `rankScore` 대신 `score`로 되돌리면 이전과 동일.

## Progress
- [x] 2026-10-14 전 마일스톤 완료. `tests/test_agent_registry_health.py` 9개.

## Decisions
- 순위 점수(`score`)는 그대로 두고 `rankScore`를 따로 둔다. 매칭 점수의 의미를 바꾸지 않고 운영 신호만 얹는다.
- DOWN은 하드 제외가 아니라 감점. 프로브가 진실이고, 오래된 DOWN 기록으로 살아난 에이전트를 영구 배제하지 않는다.
- 합의율은 라플라스 보정 `(agreements+1)/(attempts+2)`. 이력 없는 에이전트 = 0.5(중립).

## Risks
- 레지스트리 read-modify-write 경합: 캠페인 스레드는 에이전트별로 다른 문서를 쓰므로 충돌 없음. 같은 에이전트에 heartbeat와 프로브가 겹칠 수 있으나 필드가 다르고 마지막 쓰기가 이김.
