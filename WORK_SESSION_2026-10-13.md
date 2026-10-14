# 작업 세션 기록 - 2026-10-13

## 완료된 작업

### 1. Vertex AI 기반 실시간 협상 데모 구현

#### 백엔드 (FastAPI)
- **파일**: `backend/apps/api/demo_routes.py`
- **엔드포인트**: `POST /api/v1/demo/negotiate`
- **기능**:
  - Brand 제안을 받아서 Creator Agent가 평가
  - Vertex AI Gemini 2.5 Flash로 자연스러운 한국어 응답 생성
  - CoT (Chain-of-Thought) 프롬프트 적용
  - 정책 기반 deterministic 판단 (ACCEPT/COUNTER/REJECT)

#### 프론트엔드 (Next.js)
- **파일**: `frontend/src/app/live-demo/page.tsx`
- **URL**: http://localhost:3000/live-demo
- **기능**:
  - 실시간 티키타카 협상 시뮬레이터
  - Brand ↔ Creator 양방향 자동 응답
  - 페르소나 설정 (이름, 어투, 최소 금액, 응답 지연)
  - 협상 메시지 히스토리 표시
  - 신뢰도 점수 표시
  - 빠른 시나리오 버튼

### 2. 환경 설정
- **Vertex AI 설정**: `backend/.env`
  ```
  KNOT_GEMINI_MODE=vertex
  GOOGLE_CLOUD_PROJECT=knot-dev-503505
  VERTEX_AI_LOCATION=us-central1
  GEMINI_MODEL=gemini-2.5-flash
  ```
- **GCP 크레딧**: ₩372,351 사용 가능

### 3. 개발 서버 실행
모든 서비스 정상 작동 중:
- API 백엔드: http://localhost:18080
- Creator Agent: http://localhost:8081
- Web3 Gateway: http://localhost:8082
- Frontend: http://localhost:3000
- Firebase Auth Emulator: http://localhost:9099

### 4. 버그 수정
- **React 클로저 버그**: `sendOffer` 함수에서 `useCallback` 적용
  - 문제: Brand 자동 응답이 한 번만 작동
  - 해결: `useCallback`으로 `brandPersona`, `creatorPersona` 의존성 추가
- **응답 지연 최적화**:
  - Creator: 3000ms → 1500ms
  - Brand: 2000ms → 1000ms
  - 고속 모드: 500ms → 300ms

## 테스트 결과

### API 테스트 (500 USDC 제안)
```json
{
  "creatorResponse": {
    "decision": "COUNTER",
    "rationale": "제안된 기본 보상 금액이 정책 기준에 조금 미치지 못하여...",
    "counterAmount": 650
  },
  "llmInfo": {
    "provider": "vertex-gemini",
    "model": "gemini-2.5-flash",
    "confidence": 0.85,
    "mode": "vertex"
  }
}
```

### 티키타카 흐름
1. Brand: 500 USDC 제안
2. Creator: COUNTER, 650 USDC 제안 (AI 생성 응답)
3. Brand: 650 USDC 재제안
4. Creator: ACCEPT (정책 기준 충족)

## 기술 스택

### 백엔드
- FastAPI
- Vertex AI (Google Cloud)
- Gemini 2.5 Flash
- Pydantic

### 프론트엔드
- Next.js 15 (App Router)
- React 19
- TypeScript
- Tailwind CSS

## 다음 작업 (TODO)

### 1. RAG 기반 페르소나 학습
- [ ] 협상 히스토리를 Firestore/Vector DB에 저장
- [ ] 과거 협상 패턴 분석 (평균 수락 금액, COUNTER 빈도)
- [ ] 유사 협상 검색 후 LLM 프롬프트에 컨텍스트 추가

### 2. 신뢰도 개선
- [ ] LLM에서 실제 confidence score 반환하도록 수정
- [ ] 현재는 하드코딩된 0.85 값 사용 중 (demo_routes.py:128)

### 3. 어투 커스터마이징
- [ ] 페르소나 tone 설정을 LLM 프롬프트에 반영
- [ ] professional/friendly/aggressive 어조 차별화

### 4. 멀티 윈도우 동기화
- [ ] WebSocket 또는 Server-Sent Events 구현
- [ ] 두 개 브라우저 창에서 동시에 협상 진행 확인

## 파일 변경 내역

### 신규 생성
- `frontend/src/app/live-demo/page.tsx` - 실시간 티키타카 UI
- `backend/apps/api/demo_routes.py` - 데모 API 엔드포인트
- `backend/.env` - Vertex AI 환경 설정
- `frontend/.env.local` - 프론트엔드 환경 설정
- `.env.local` (루트) - 전역 환경 설정

### 수정
- `backend/apps/api/main.py` - CORS 설정, demo router 추가
- `backend/libs/ai/gemini.py` - CoT 프롬프트 강화 (이전 세션)
- `frontend/src/app/live-demo/page.tsx` - useCallback 버그 수정

## 주요 이슈 및 해결

### Issue 1: Agent Ops Router 오류
- **문제**: `AttributeError: 'KnotRepository' object has no attribute 'db'`
- **원인**: Memory repository는 Firestore client가 없음
- **해결**: Agent Ops router 비활성화 (main.py:51)

### Issue 2: 티키타카가 한 번만 작동
- **문제**: Brand가 COUNTER 후 재제안하지 않음
- **원인**: React 클로저가 오래된 `brandPersona` 참조
- **해결**: `useCallback`으로 의존성 업데이트

### Issue 3: 응답이 너무 느림
- **문제**: 한 라운드당 5초 대기
- **원인**: 기본 응답 지연이 2-3초로 설정됨
- **해결**: Creator 1.5초, Brand 1초로 단축

## 검증 사항

✅ **실제 AI 사용 확인**:
- 같은 요청을 3번 반복했을 때 매번 다른 한국어 응답 생성
- Provider: `vertex-gemini`
- Model: `gemini-2.5-flash`
- GCP 크레딧 소모 중

✅ **정책 엔진 작동**:
- 500 USDC < 650 USDC → COUNTER
- 650 USDC >= 650 USDC → ACCEPT

⚠️ **Mock 데이터**:
- 신뢰도 점수 85%는 하드코딩됨 (개선 필요)

## 실행 방법

### 1. 전체 스택 시작
```bash
cd /Users/yewonchoi/Desktop/git/knot
./scripts/local/dev_stack.sh
```

### 2. 브라우저 접속
- 데모 페이지: http://localhost:3000/live-demo

### 3. 티키타카 테스트
1. "🚀 시작" 버튼 클릭 (Brand/Creator 자동 응답 기본 활성화)
2. 자동으로 협상 진행됨
3. 또는 "🔄 티키타카 설정 (500→650)" 버튼으로 시나리오 설정

## GCP 리소스

- **Project ID**: knot-dev-503505
- **Region**: us-central1
- **Model**: gemini-2.5-flash
- **잔여 크레딧**: ₩372,351

## 프로젝트 용량

- 총 용량: 1.4GB
- frontend/node_modules: 687MB
- backend/.venv: 334MB
- frontend/.next: 219MB (빌드 캐시)
- web3/gateway/node_modules: 127MB

**정상적인 개발 환경 용량입니다.**

## 참고 문서

- Backend API: http://localhost:18080/docs (FastAPI Swagger)
- LLM 구현: `backend/libs/ai/gemini.py`
- 협상 로직: `backend/libs/agents/negotiation.py`
- CoT 프롬프트: gemini.py의 `thinkingSteps` 섹션

## 브랜치 상태

현재 브랜치: main
마지막 커밋: 978cfe2 (Agent Registry 구현)

**작업 중인 변경사항 (미커밋)**:
- live-demo 페이지
- demo API 엔드포인트
- 환경 설정 파일들

---

작성일: 2026-10-13
작업자: 예원 + Claude Code

---

## 세션 2 (같은 날, 브랜치 `yewon/a2a-negotiation`) — 진짜 Agent ↔ Agent 통신

목표: 프론트가 브랜드 응답을 흉내 내던 구조를 버리고, **브랜드 에이전트 프로세스 ↔ 크리에이터 에이전트 프로세스**가 HTTP A2A로 직접 협상.

### 추가/변경
- `backend/libs/agents/brand_negotiator.py` — 브랜드 협상 루프 (OFFER → COUNTER 처리 → ACCEPT / COUNTER / cancel). 전송은 `A2ATransport` 프로토콜로 추상화(HTTP `CreatorA2AClient`, 테스트용 `InProcessTransport`).
- `backend/apps/brand_agent/main.py` — 브랜드 에이전트 서비스 (:8083). `POST /brand/v1/negotiations`, agent-card.
- `backend/scripts/a2a_negotiate.py` — 터미널 관전 CLI (`--direct` 모드는 브랜드 서버 없이 동작).
- `backend/tests/test_brand_agent_a2a.py` — 5개 (in-process 4 + uvicorn 실 HTTP 1). 전체 A2A 관련 26개 통과.
- `libs/a2a/client.py` `cancel_task` 추가, `libs/a2a/agent_card.py` 브랜드 카드, `Settings.brand_agent_base_url`, `build_initial_terms(creator=None)` 허용.
- `scripts/local/dev_stack.sh`에 brand-agent 추가, `.env.example`에 `BRAND_AGENT_BASE_URL`.
- 문서: `docs/09_A2A_NEGOTIATION_PROTOCOL.md` 부록.

### 실측 (Vertex Gemini on, 두 프로세스 실제 HTTP)
| 시나리오 | 결과 |
|---|---|
| open 500 / ceiling 700 | AGREED 650, 2 rounds, term-sheet artifact + termsHash |
| open 400 / ceiling 600 | 400→525→588→600 vs 650 고정 → WALKED_AWAY, 크리에이터 쪽 task CANCELED |
| category gambling | REJECT round 1 |
| --direct, creator-min 800 | AGREED 800 |

### 실시간 한 화면 관전 (추가)
- 브랜드 에이전트에 SSE `GET /brand/v1/negotiations/stream` + 관전 페이지 `GET /brand/v1/watch` (`apps/brand_agent/static/watch.html`).
- 브라우저: http://127.0.0.1:8083/brand/v1/watch — 턴마다 말풍선 실시간 추가, 상대 "평가 중 ●" 표시, 결과 배너.
- curl 실측: 이벤트가 각 에이전트 Gemini 호출 완료 시점(3~13초 간격)에 도착 → 진짜 스트리밍.
- CLI HTTP 모드도 스트림을 읽어 턴 단위 출력.

### 메모
- 로컬 Docker가 `*:8081`(IPv6)을 점유 중 → 테스트 때 크리에이터를 8091로 띄움. `localhost` 대신 `127.0.0.1` 쓰면 됨.
- 미커밋 상태. 커밋/PR은 확인 후.

### 다음 후보
- [ ] live-demo 페이지가 브랜드 응답을 로컬에서 흉내 내는 대신 `POST /brand/v1/negotiations` 결과(turns)를 그대로 렌더
- [x] 브랜드 에이전트에 SSE 스트리밍 추가 (턴 단위로 푸시) + 관전 페이지
- [ ] 크리에이터 에이전트 응답에 실제 confidence 노출 (현재 `creator_rationale` 내부에서만 사용)


---

## 세션 3 (2026-10-14, 브랜치 `yewon/a2a-negotiation`) — 에이전트 월드 1단계: 탐색 → 다중 협상

목표: 에이전트가 여러 개(여러 프로세스)일 때 브랜드가 탐색해서 조건 맞는 에이전트들에게 동시에 협상.

### 추가/변경
- `libs/agents/brand_discovery.py` — 4단계 깔때기 (공개 프로젝션 쿼리 → 순위 → 정밀 필터 → agent card 프로브).
- `libs/agents/brand_campaign.py` — `BudgetLedger`(예약/확정/대기 FIFO), `CampaignRunner`(병렬 협상, 목표 도달 시 취소, matchRuns 기록).
- `apps/brand_agent/main.py` — `POST /brand/v1/campaigns`, `GET /brand/v1/campaigns/stream`(SSE), `GET /brand/v1/campaign`(페이지 `static/campaign.html`), 저장소 주입.
- `apps/creator_agent/main.py` — 저장소 기반 테넌트 해석을 메모리 시드에서도 사용(12명), `KNOT_CREATOR_AGENT_TENANTS`로 프로세스별 호스팅 제한.
- `libs/a2a/registry.py` — `baseUrl`, `registry_base_url()`; `libs/a2a/store.py` — `allowed_tenants`.
- `libs/agents/brand_negotiator.py` — `should_stop`, `committed_usdc_provider`, `CANCELED`.
- `Settings.creator_agent_tenants`, `Settings.creator_agent_endpoints`.
- `scripts/local/a2a_multi_agent.sh`, `backend/scripts/a2a_campaign.py`, `tests/test_brand_campaign.py`(9개).
- ExecPlan `.agent/execplans/06-brand-discovery-fanout.md`, 문서 `docs/09` 부록 2.

### 실측 (Vertex on, 크리에이터 8091/8092 + 브랜드 8083)
- 탐색 queried 6 / probed 4 → 선정 4 (agent-creator-1, 005, 003, 001). 탈락: 004 금액 초과, 006 사용권.
- 결과 TARGET_REACHED 2/2, 확정 1050/1300. agent-creator-1 400 즉시 수락, creator-agent-001 400→650.
- 005/003은 005가 8092 프로세스에 있음을 agent card로 확인했고, 목표 도달로 미시작.

### 남은 것 / 다음
- [ ] 캠페인 결과(agreementId, termsHash)를 에스크로 락으로 연결 (Payment 에이전트)
- [ ] 레지스트리 healthStatus/lastSeenAt 갱신 + 최근 협상 성공률을 순위에 반영
- [ ] Firestore 백엔드에서 복합 인덱스 실측
- [ ] 미커밋. 커밋/PR은 확인 후.

## 세션 4 (2026-10-14, 브랜치 `yewon/a2a-negotiation`) — 합의 → Agreement → 에스크로

중간 PR #2 (https://github.com/ddol9/knot/pull/2) 올리고 main과 동기화(충돌 없음). 이어서 "에이전트끼리 합의 → 자금 잠금" 루프를 닫았다.

### 추가/변경
- `libs/agents/agreements.py` — `routes.py`에 갇혀 있던 합의 투영 헬퍼 이동 + `build_negotiation_document`/`build_agreement_document`(termsHash 재계산, 불일치 `AgreementTermsMismatch`)/`write_agreement_milestones`.
- `libs/agents/creator_context.py` — 크리에이터 컨텍스트 해석기(크리에이터 에이전트·API 로컬 모드 공용).
- `libs/agents/brand_campaign.py` — 합의 시 `negotiations/`·`agreements/`(+milestones) 영속화, 후보 문서 링크, `settlement_hook`, 이벤트 `agreement_created`/`escrow_locked|skipped|failed`. 해시 불일치는 합의로 세지 않고 예산 반환.
- `apps/api/routes.py` — `POST /api/v1/promotions/{id}/campaigns`, `GET …/campaigns/stream`. 합의마다 `autonomy.autoEscrow`면 기존 `lock_escrow`를 같은 스코프에서 직접 호출(결제 코드 무수정). 타임라인 `CAMPAIGN_STARTED`/`AGREEMENT_CREATED`/`ESCROW_LOCKED`/`CAMPAIGN_COMPLETED`.
- `apps/api/schemas.py` — `PromotionCampaignRequest`(금액 생략 시 프로모션 `initialOffer`/`maxPerCreatorUsdc`).
- `apps/brand_agent` — 공용 스트림 사용, 에스크로 `SETTLEMENT_VIA_PRODUCT_API`; 관전 페이지·CLI에 합의서/에스크로 표시.
- 테스트: `tests/test_agreements.py`(2), `tests/test_api_campaigns.py`(6: gateway 모의 락 2건, autoEscrow off, gateway 없음, 기본 금액, SSE, 404). 전체 214 passed / 5 skipped.
- ExecPlan `.agent/execplans/07-campaign-agreement-escrow.md`, 문서 `docs/09` 부록 3.

### 메모
- 기존 락 경로는 `agreements/{id}`를 `FUNDED`로 바꾸지 않는다(자금 확인은 별도 단계). 캠페인도 그 의미를 그대로 따른다.
- `matchRuns.status`를 캠페인 어휘에서 docs/07 어휘(`AGREED`/`EXHAUSTED`)로 바꾸고 `campaignOutcome`을 함께 저장.
- `a2a_multi_agent.sh` 재실행 시 8083에 이전 브랜드 프로세스가 남아 있으면 새 코드가 안 뜬다. 먼저 종료할 것.

### 남은 것 / 다음
- [ ] 프론트 브랜드 대시보드에서 캠페인 실행·관전(`/campaigns/stream`) 연결
- [ ] 레지스트리 healthStatus/lastSeenAt + 협상 성공률 순위 반영
- [ ] Firestore 복합 인덱스 실측

## 세션 5 (2026-10-14, 브랜치 `yewon/agent-registry-health`) — 레지스트리 생존 신호 + 협상 이력

PR #2 병합(main `0bf46ec`). 새 브랜치에서 레지스트리가 운영 신호를 들고, 탐색 순위가 그걸 쓰게 했다.

### 추가/변경
- `libs/a2a/registry.py` — `record_agent_heartbeat`/`record_agent_probe`/`record_negotiation_outcome`, `registry_health`, `track_record`(라플라스 합의율). 모르는 에이전트는 `publicationStatus: UNKNOWN` 스텁.
- `apps/creator_agent/main.py` — `create_app(repository=)`, 기동 시 호스팅 테넌트 heartbeat(`lastSeenAt`, `baseUrl`, `hostedBy`), `KNOT_CREATOR_AGENT_HEARTBEAT_SECONDS`(0=기동 시 1회).
- `libs/agents/brand_discovery.py` — 후보에 `healthStatus/lastSeenAt/trackRecord/rankScore`, `rankScore` 정렬(DOWN ×0.85, 합의율 ±0.025), 프로브 결과를 레지스트리에 기록(`record_probes=`).
- `libs/agents/brand_campaign.py` — 협상 결과마다 이력 기록, A2A 전송 실패는 프로브 DOWN.
- 관전 페이지 "생존 · 이력" 컬럼, CLI 🟢/🔴 + n/m.
- 테스트 `tests/test_agent_registry_health.py` 9개. ExecPlan 08, docs/09 부록 4.

### 메모
- 메모리 저장소에서는 heartbeat가 크리에이터 프로세스 자기 메모리에만 남는다(브랜드는 못 본다). Firestore에서 의미가 생긴다. 브랜드 프로세스의 프로브·이력은 같은 프로세스 안에서 두 번째 캠페인부터 보인다.

### 남은 것 / 다음
- [ ] Firestore에서 heartbeat → 브랜드 탐색 반영 실측 (복합 인덱스 포함)
- [ ] 프론트 브랜드 대시보드에서 캠페인 실행·관전

## 세션 6a (2026-10-14) — Firestore 공유 레지스트리

세션 5의 메모("메모리 저장소에서는 heartbeat 가 자기 프로세스에만 남는다")를 닫았다. 로컬 멀티 에이전트 스택이 **하나의 Firestore 에뮬레이터**를 보게 해서 heartbeat → 브랜드 탐색 → 캠페인 이력이 프로세스를 넘어 흐르는 것을 실측했다.

### 추가/변경
- `scripts/local/firebase.json` — Firestore 에뮬레이터 `:8780`(8080 은 Docker) + `firestore.indexes.json` 참조.
- `scripts/local/a2a_multi_agent_firestore.sh` (신규) — 에뮬레이터(이미 떠 있으면 재사용) → `FIRESTORE_EMULATOR_HOST`/`GOOGLE_CLOUD_PROJECT=demo-knot`/`KNOT_REPOSITORY_BACKEND=firestore` → 시드 1회 → 크리에이터 A(:8091)/B(:8092)/브랜드(:8083). 브랜드에 `KNOT_CREATOR_AGENT_ENDPOINTS` 를 **주지 않는다** — B 테넌트(003/005)의 baseUrl 은 B 의 heartbeat 가 레지스트리에 쓴다. 메모리 스크립트는 그대로.
- `backend/scripts/seed_firestore.py` (신규) — `seed_demo_repository` 를 Firestore 에, 멱등, 컬렉션별 개수 출력, `FIRESTORE_EMULATOR_HOST` 없으면 거부(`--allow-remote` 필요), 재시드 시 레지스트리 운영 신호 보존.
- `libs/repositories/firestore_adapter.py` — `where(filter=FieldFilter(...))` (SDK 2.x 의 positional 폐기 경고가 탐색 쿼리마다 7개 나던 것 제거). 그 외 어댑터는 에뮬레이터에서 메모리 저장소와 결과 동일(원문 CRUD, `==`/`array_contains`/`<=`, limit, 서브컬렉션, 중첩/None/빈 컨테이너, create-only, 멱등키).
- `firestore.indexes.json` — 탐색 쿼리(`_public_filters`)와 정확히 맞는 복합 인덱스 추가(등식 5 + `categoryKeys` CONTAINS + `nextAvailableAt` 범위). `docs/08` §19.
- 테스트 `tests/test_firestore_emulator_agents.py` — 에뮬레이터 있을 때 3개(어댑터 왕복, 탐색 쿼리 = 메모리, heartbeat → 다른 클라이언트의 탐색 → 캠페인 → `negotiationStats`/`agreements`+milestones/`matchRuns`), 항상 1개(인덱스 드리프트). ExecPlan `.agent/execplans/09-firestore-shared-registry.md`.

### 실행
```bash
# 필요: java 11+, node/npx, venv 에 google-cloud-firestore
scripts/local/a2a_multi_agent_firestore.sh                       # 에뮬레이터 + 시드 + A/B/브랜드
cd backend && python scripts/a2a_campaign.py --category beauty --total 1300 --target 2   # 2번 실행
# Firestore UI: http://127.0.0.1:4000/firestore   관전: http://127.0.0.1:8083/brand/v1/campaign

# 테스트 (에뮬레이터 떠 있을 때; 없으면 3개 skip)
cd backend && FIRESTORE_EMULATOR_HOST=127.0.0.1:8780 pytest tests/test_firestore_emulator_agents.py
# 시드만
FIRESTORE_EMULATOR_HOST=127.0.0.1:8780 GOOGLE_CLOUD_PROJECT=demo-knot \
  python backend/scripts/seed_firestore.py --creator-agent-base-url http://127.0.0.1:8091/a2a/v1
```

### 실측 (LLM off, 포트 8191/8192/8183 으로 실행)
- 1회차 탐색: 후보 6명 전부 🟢(크리에이터 heartbeat 를 브랜드가 Firestore 에서 읽음). 005/003 의 baseUrl 이 `127.0.0.1:8192`(B) — 엔드포인트 env 없이 레지스트리만으로 라우팅. 결과 TARGET_REACHED 2/2, 확정 1000/1300 (agent-creator-1 400, creator-agent-005 400→600).
- 2회차 탐색: agent-creator-1 / creator-agent-005 가 `🟢1/1` (브랜드가 1회차에 쓴 `negotiationStats` 를 다시 읽음), 나머지 `-/-`.
- 에뮬레이터 `agentRegistry/creator-agent-005`: `baseUrl=http://127.0.0.1:8192/a2a/v1`(B), `healthStatus=UP`, `lastProbeStatus=UP`, `negotiationStats.agreements=2/attempts=2`(2회차 후). `agreements` 4건, `matchRuns` 2건.

### 메모
- 에뮬레이터는 복합 인덱스를 강제하지 않는다. 인덱스 정합성은 테스트로, 실 Firestore 는 `firebase deploy --only firestore:indexes --config scripts/local/firebase.json`.
- `dev_stack.sh`(Auth 에뮬레이터)와 동시에 띄우면 UI/허브 포트(4000/4400)가 겹친다.

### 남은 것 / 다음
- [ ] 제품 API(`apps/api`)도 같은 Firestore 로 붙여 에스크로 락까지 한 스택에서
- [ ] 실 Firestore(knot-dev) 인덱스 배포 + 폴백 경고가 사라지는지 확인
- [ ] 프론트 브랜드 대시보드에서 캠페인 실행·관전
## 세션 6c (2026-10-14) — 거버넌스 가드레일 + 승인 큐

PR #3 병합(main `726dbb9`). 자율 경로에 "한도 밖은 사람이 결정한다"를 코드로 넣었다.

### 추가/변경
- `libs/policies/governance.py` — `GovernanceRules`(settings), `evaluate_settlement`(단건 한도·캠페인 누적 한도·autoEscrow off), `flag_track_record`(연속 실패·저합의율). 결정적, LLM 없음, `governance-v1`.
- `Settings.gov_*` — `KNOT_GOV_MAX_AUTO_AGREEMENT_USDC`(800), `KNOT_GOV_MAX_AUTO_CAMPAIGN_TOTAL_USDC`(2000), `KNOT_GOV_MAX_CONSECUTIVE_FAILURES`(3).
- `libs/agents/brand_campaign.py` — `CampaignRunner(governance=)`. 정산 단계에서 승인 필요면 `approvals/{id}` PENDING 생성, `negotiation.escrow = PENDING_APPROVAL`, `approval_required` 이벤트, 정산 훅 미호출. 합의·예산 확정은 그대로.
- `apps/api/routes.py` — `GET /approvals`, `GET /approvals/{id}`, `POST /approvals/{id}:approve`(멱등키 없으면 `approval-{id}`, 같은 `lock_escrow` 경로), `POST /approvals/{id}:reject`. 타임라인 `APPROVAL_REQUIRED`/`APPROVAL_GRANTED`/`APPROVAL_REJECTED`. `AGREEMENT_CREATED`는 정산 훅이 아니라 러너 이벤트에서 기록(승인 대기 합의도 남도록). `_lock_agreement_escrow` 헬퍼로 캠페인/승인 경로 공유.
- `libs/agents/brand_discovery.py` — `trackRecord.flag`, `rank_score(flagged=)` ×0.7. `libs/a2a/registry.py` — `negotiationStats.recentOutcomes`(최근 10, CANCELED 제외).
- `libs/repositories/firestore_paths.py` — `approvals`. `apps/api/schemas.py` — `ApprovalRejectRequest`.
- 독립 브랜드 에이전트도 settings에서 거버넌스 주입. CLI·관전 페이지 "🙋 사람 승인 대기".
- 테스트 `tests/test_governance.py`(10), `tests/test_api_approvals.py`(7). 전체 240 passed / 5 skipped. ExecPlan 11, docs/09 부록 5.

### 메모
- 시드 데모(promotion-001, open 400 / ceiling 700)는 기본 한도(800/2000)에서 둘 다 자동 락. 한도를 500으로 내리면 creator-agent-005의 600이 승인 큐로 간다 — 데모 때 `KNOT_GOV_MAX_AUTO_AGREEMENT_USDC=500`으로 보여줄 수 있다.
- 캠페인 팬아웃은 병렬이라 어느 에이전트가 먼저 합의하는지 비결정적. 새 테스트는 `parallelism=1`. 기존 `test_campaign_skips_escrow_when_auto_escrow_is_off`가 전체 스위트 부하에서 드물게 agreedCount 2로 흔들림(목표 1인데 두 스레드가 동시에 합의) — 거버넌스와 무관, `brand_negotiator`의 should_stop 타이밍.
- 승인 라우트는 캠페인 라우트처럼 인증 없음(데모). 운영 전 브랜드 소유자 인증 필요.

### 남은 것 / 다음
- [ ] 승인 라우트 인증(브랜드 소유자) + 프론트 승인 큐 화면
- [ ] 마일스톤 릴리즈 측도 같은 규칙 모듈로 통합(현재 `AutomationLevel` 임계값 별도)
- [ ] 승인 대기 알림(notifications/)
- [x] 프론트 브랜드 대시보드에서 캠페인 실행·관전 → 세션 6b

## 세션 6b (2026-10-14) — 브랜드 대시보드 캠페인 페이지

브랜드 사용자가 제품 대시보드에서 캠페인(탐색 → 다중 A2A 협상 → 합의서 → 에스크로)을 실행하고 SSE로 관전하는 페이지. `frontend/`만 변경(백엔드 무수정).

### 추가/변경
- `frontend/src/product/campaignTypes.ts` — 캠페인 요청/응답과 SSE 이벤트 payload 타입(`CampaignStreamEvent` 판별 합집합).
- `frontend/src/product/apiClient.ts` — `runCampaign(promotionId, body)`(POST), `campaignStreamUrl(promotionId, params)`(EventSource용 절대 URL, 같은 base URL 규칙).
- `frontend/src/app/api/v1/[...path]/route.ts` — `text/event-stream` 응답은 버퍼링 없이 패스스루 + 클라이언트가 끊으면 업스트림 abort. (기존에는 `arrayBuffer()`로 모아서 캠페인이 끝날 때까지 아무 이벤트도 안 왔다. 백엔드 CORS가 3000만 허용해 직접 EventSource는 불가.)
- `frontend/src/app/brand/campaign/` — `page.tsx`(`?promotionId=`), `useCampaignStream.ts`(리듀서/훅, 한국어 라벨), `components/`(조건 폼, 탐색 표(순위·점수·생존·이력·상태), 예산 장부 타일, 크리에이터별 대화 열(말풍선·입력 중), 결과 배너(합의서 링크)).
- `frontend/src/features/dashboard/PromotionDetail.tsx` — "여러 크리에이터와 동시 협상" 링크.
- `frontend/src/product/flow.ts` 라우트 목록 + 테스트, `frontend/tests/campaign-stream.test.ts`(실제 로컬 캠페인 이벤트 리플레이 등 6개).
- ExecPlan `.agent/execplans/10-brand-campaign-page.md`.

### 여는 법
```bash
# 백엔드 (메모리 저장소 + 데모 시드, 로컬 A2A)
cd backend && KNOT_CREATOR_A2A_MODE=local KNOT_MEMORY_SEED_DEMO=1 .venv/bin/uvicorn apps.api.main:app --port 8180
# 프론트 (.env.local에 KNOT_API_BASE_URL=http://127.0.0.1:8180 + Firebase 설정)
cd frontend && PORT=3100 npm run dev
# 브랜드 계정으로 로그인 → 프로모션 상세 → "여러 크리에이터와 동시 협상"
#   또는 http://localhost:3100/brand/campaign?promotionId=promotion-001
```

### 실측
- 백엔드 직접 `curl -N …/promotions/promotion-001/campaigns/stream?targetCreatorCount=2`: 탐색 6명 → agent-creator-1·creator-agent-005 각 800 즉시 수락 → 합의서 2건, 에스크로 `SKIPPED/WEB3_GATEWAY_REQUIRED`(로컬 모드) → 003/004 `TARGET_REACHED` 미시작 → `TARGET_REACHED` 2/2, 확정 1600/2000.
- 프록시 경유(3100)도 같은 순서, `content-type: text/event-stream`. 1초 간격 모의 SSE를 프록시로 통과시켜 이벤트가 지연 없이 도착함을 확인.
- `npm run typecheck`·eslint 클린, `npm test` 28 passed.
- 페이지 자체는 Firebase 로그인 설정이 없는 환경이라 AuthGate("로그인이 필요합니다")까지만 브라우저로 확인. 로그인 이후 화면은 리듀서 리플레이 테스트로 대신 검증.

### 메모
- `campaign_result`/`error`/연결 오류를 받으면 EventSource를 즉시 닫는다. 열어 두면 자동 재접속으로 같은 프로모션 캠페인이 다시 시작된다.
- "관전 중단"은 프록시의 업스트림 fetch를 abort하지만 백엔드 캠페인 스레드는 끝까지 돈다.
- Turbopack은 워크트리의 `node_modules` 심링크를 거부해서 로컬 확인은 `next dev --webpack`으로 했다.

### 남은 것 / 다음
- [ ] 캠페인 결과 영속 조회(새로고침 후에도 보이게) — matchRuns/agreements에서 재구성
- [ ] 백엔드 CORS에 프론트 포트 추가 또는 프록시 없는 배포 경로 검토
- [ ] Firebase 로그인 환경에서 페이지 전체 플로우 눈으로 확인
## 세션 6d (2026-10-14) — 에이전트 트레이싱

캠페인 → 협상 → A2A 메시지 → LLM 호출이 **한 traceId의 스팬 트리**로 남게 했다. 외부 서비스 없이 표준 라이브러리로 `knot.trace` 로거에 JSON 한 줄/스팬. LangSmith는 키가 있고 `langsmith`가 import되면 선택 미러링.

### 추가/변경
- `libs/observability/tracing.py`(신규) — `span()`/`Span.set/event`, contextvars 전파(`propagate/bind/propagate_to_thread/start_trace`), 프로세스 간 헤더 `X-Trace-Id`/`X-Parent-Span-Id`, `LogSink`(기본)/`LangSmithSink`(선택, 실패 시 경고 1회 후 폴백), 리댁션(`ceiling*`/`min*`/`policy*` 드롭 + `redacted`), `install_logging()`(uvicorn 아래에서 INFO JSON 라인이 stderr로 나가게).
- `libs/observability/middleware.py` — 요청마다 trace 바인딩(들어온 `X-Trace-Id`/`X-Request-Id` 재사용), 응답 `X-Trace-Id`. `libs/a2a/client.py` — 같은 헤더 전송 → 크리에이터 프로세스의 스팬이 브랜드 `a2a.send` 아래에 붙는다.
- 계측: `campaign.run` → `campaign.discovery` / `negotiation.run`(워커 스레드 상속) → `a2a.send`·`a2a.cancel` + `turn` 이벤트; 크리에이터 `creator.decide` → `llm.call`(provider/model/fallbackReason/latency만, 프롬프트 없음).
- traceId 부착: SSE `status`/`campaign_result`, `CampaignResult.traceId`, `BrandNegotiationResult.traceId`, `matchRuns/{id}.traceId`, API `meta.traceId`, 타임라인 `CAMPAIGN_STARTED/COMPLETED`.
- `Settings.tracing_enabled`(`KNOT_TRACING`) / `tracing_sink`(`KNOT_TRACING_SINK`) / `langsmith_project`.
- `scripts/trace_tail.py`(신규) — 로그 파일(들)/stdin → traceId별 트리(지속 시간·이벤트·`-f`). 브랜드+크리에이터 로그를 같이 주면 한 트리.
- 테스트: `tests/test_tracing.py` 10개 + `tests/test_brand_campaign.py` 트리 검증 1개 + `tests/test_api_campaigns.py` traceId 단언. 전체 234 passed / 5 skipped / 6 deselected.
- ExecPlan `.agent/execplans/12-agent-tracing.md`, `docs/agent_ops/02_langsmith_integration.md` 상단 "실제 구현".

### 실측 (워크트리 코드로 브랜드 :8183 + 크리에이터 :8191, `scripts/a2a_campaign.py --brand-url http://127.0.0.1:8183/brand/v1`)
```text
trace dc36e20ed58c46babce99a824c738cf3  13 spans  124 ms  [knot-brand-agent, knot-creator-agent]
campaign.run 124.2 ms ok @knot-brand-agent  outcome=TARGET_REACHED agreedCount=2 committedUsdc=1000 budgetUsdc=1300
  campaign.discovery 79.2 ms ok  queried=6 ranked=6 probed=4 selected=4
  negotiation.run 13.4 ms ok  creatorAgentId=agent-creator-1 outcome=AGREED rounds=1 finalAmountUsdc=400 agreementId=agreement-d7a1…
    · turn +0.11 ms  round=1 role=brand type=OFFER amountUsdc=400
    · turn +13.33 ms  round=1 role=creator type=ACCEPT amountUsdc=400 allowed=True
    a2a.send 13.1 ms ok  type=OFFER round=1 replyType=ACCEPT taskState=TASK_STATE_COMPLETED
      creator.decide 0.5 ms ok @knot-creator-agent  tenant=agent-creator-1 messageType=OFFER decisionType=ACCEPT violationCodes=[]
        llm.call 0.0 ms ok @knot-creator-agent  purpose=creator_rationale provider=deterministic fallbackReason=gemini_mode_off
  negotiation.run 30.1 ms ok  creatorAgentId=creator-agent-005 outcome=AGREED rounds=2 finalAmountUsdc=600 agreementId=agreement-169f…
    · turn +0.06 ms  r1 brand OFFER 400 · +12.62 ms r1 creator COUNTER 600 · +15.6 ms r2 brand ACCEPT 600 · +30.01 ms r2 creator ACCEPT 600
    a2a.send 12.5 ms ok  type=OFFER round=1 replyType=COUNTER taskState=TASK_STATE_INPUT_REQUIRED
      creator.decide 0.4 ms ok @knot-creator-agent  messageType=OFFER decisionType=COUNTER violationCodes=["CREATOR_MIN_BASE_NOT_MET"]
        llm.call 0.0 ms ok  purpose=creator_rationale provider=deterministic fallbackReason=gemini_mode_off
    a2a.send 14.3 ms ok  type=ACCEPT round=2 replyType=ACCEPT taskState=TASK_STATE_COMPLETED
      creator.decide 0.5 ms ok @knot-creator-agent  messageType=ACCEPT decisionType=ACCEPT violationCodes=[]
        llm.call 0.0 ms ok  purpose=creator_rationale provider=deterministic fallbackReason=gemini_mode_off
```

### 메모
- 로그 I/O가 GIL을 놓으면서 캠페인 팬아웃의 "목표 도달 후 동시 합의" 경합이 테스트에서 재현됐다(main에서는 5ms GIL 스위치 간격 덕에 안 보였을 뿐). 예산은 장부가 지키고 초과 합의는 설계상 허용. 정확한 합의 수를 단언하는 API 테스트만 `parallelism: 1`로 고정.
- Starlette는 동기 제너레이터를 스텝마다 다른 컨텍스트 복사본에서 돌린다. 스트림 라우트는 첫 스텝(러너 생성)에만 trace를 바인딩하고, `campaign_event_stream`은 첫 yield 전에 컨텍스트를 캡처해 워커 스레드에 넘긴다.
- `tests/test_api_promotions.py`의 A2A 헤더 정확 일치 단언 2곳은 trace 헤더를 빼고 비교하도록 바꿨다.

### 남은 것 / 다음
- [ ] 실제 LangSmith 키로 미러링 확인(가짜 `RunTree`로만 검증)
- [ ] Cloud Run에서 `jsonPayload.traceId` 필터 실측
- [ ] 단일 협상 API 경로(`routes.start_negotiation`)도 `negotiation.run` 스팬으로 감싸기(지금은 traceId 헤더만 나간다)

## 세션 6 통합 (2026-10-14, 브랜치 `yewon/agent-world-phase6`)

6a~6d 네 갈래를 서브에이전트 worktree에서 병렬로 만들고 통합했다. 충돌은 세션 기록(양쪽 덧붙임), `brand_agent/main.py` import, `brand_campaign.py` 탐색 호출(트레이싱 span + governance 인자) 셋뿐.

### 통합 후 추가
- **목표 슬롯**: 두 에이전트가 각자 발견한 경쟁(병렬 협상이 stop 플래그를 보기 전에 동시에 합의 → 목표 초과)을 세마포어 슬롯으로 막았다. 테스트 `test_parallel_fan_out_never_agrees_past_the_target`.
- **취소 + 중복 방지**: `POST /promotions/{id}/campaigns/{campaignId}:cancel`, 프로모션당 실행 중 캠페인 1개(409 `CAMPAIGN_ALREADY_RUNNING`). 프론트 "관전 중단"이 이 엔드포인트를 부르면 서버 스레드도 멈춘다(프론트 연결은 다음).
- 결과: 백엔드 254 passed / 8 skipped, 프론트 typecheck·eslint·28 tests.

### 남은 것
- [ ] 프론트 "관전 중단" → cancel 엔드포인트 호출, 승인 큐 화면
- [ ] 승인·캠페인 라우트 인증
- [ ] 단일 협상 경로(`start_negotiation`)에도 `negotiation.run` span

## 세션 7c (2026-10-14) — 단일 협상 경로 트레이싱

프로덕트 API의 단일 협상 경로(`POST /promotions/{id}/matches:run` → `POST /match-runs/{id}:start-negotiation`)가 캠페인 경로와 **같은 모양의 스팬 트리**를 남기게 했다. 6d의 "남은 것" 마지막 항목. ExecPlan `.agent/execplans/15-single-negotiation-tracing.md`.

### 추가/변경 (`backend/apps/api/routes.py`, 캠페인·승인 라우트는 손대지 않음)
- `start_negotiation` → `negotiation.run` 스팬(캠페인과 같은 attrs + `negotiationId`, `matchRunId`), 메시지마다 `turn` 이벤트(round/role/type/amountUsdc/messageProvider/allowed). 브랜드 턴은 **보내기 전**, 크리에이터 턴은 **응답 파싱 직후**에 기록(`_trace_negotiation_turn`) — 전송이 실패해도 무엇을 제안했는지 남는다.
- `_send_creator_a2a_task` → `a2a.send` 스팬(type/round/messageId → taskId/taskState/replyType). 기존 전송 본체는 `_send_creator_a2a_task_untraced`. 로컬 모드의 `creator.decide`(→ `llm.call`)가 그 아래에 붙고, HTTP 모드는 헤더로 크리에이터 프로세스 스팬이 붙는다.
- `_discover_creator_agent_card` → `a2a.agent_card` 스팬(mode/baseUrl → discovered/name/version/skillCount). 로컬 모드도 `discovered=False`로 찍는다.
- `run_matches` → `match.run` 스팬(promotionId/matchRunId → queried/ranked/eligible/selected/selectedCreatorAgentId/verificationMode/verificationStatus), pay.sh가 켜져 있으면 자식 `match.verify`(`_traced_paid_verification`: provider/mode → status/continuation/idempotencyReused/amountUsdc, 영수증·지갑 없음).
- traceId 부착: `negotiations/{id}.traceId`, `matchRuns/{id}.traceId`(이 경로), 두 응답 `meta.traceId`(= `X-Trace-Id`). `brandPolicySnapshot`/`creatorPolicySnapshot`/크리에이터 정책은 스팬에 넘기지 않는다.
- `scripts/trace_tail.py` 요약 키에 `match.run`, `match.verify`, `a2a.agent_card`.
- 테스트: `tests/test_tracing_product_path.py` 3개(로컬 합의 트리·응답/문서 traceId 일치, 카운터 흐름 `turn` 6개 순서·금액·offset 단조, 전송 실패 시 `negotiation.run`/`a2a.send` error + OFFER 턴만) + `tests/test_api_a2a_http_integration.py`에 HTTP 경계 중첩 단언(`creator.decide` 3개가 `a2a.send` 3개 아래). 전체 257 passed / 8 skipped / 6 deselected.
- `docs/agent_ops/02_langsmith_integration.md` 스팬 표에 3개 추가.

### 실측 (워크트리 코드로 API :8181, `KNOT_CREATOR_A2A_MODE=local KNOT_MEMORY_SEED_DEMO=1`, `python scripts/trace_tail.py /tmp/knot-local/api-trace.log`)
```text
trace 8c953e68455740efa48038a16c0b52c5  2 spans  1 ms  [knot-api]
match.run 1.0 ms ok @knot-api  promotionId=promotion-001 queried=6 ranked=6 selected=1 verificationStatus=SKIPPED
  match.verify 0.1 ms ok @knot-api  provider=pay.sh mode=sandbox status=SKIPPED continuation=FREE_SIGNALS_ONLY amountUsdc=0.02

trace e2af6368d4dd499a80bd0234b7f52751  5 spans  1 ms  [knot-api]
negotiation.run 1.3 ms ok @knot-api  creatorAgentId=agent-creator-1 outcome=AGREED rounds=1 finalAmountUsdc=300 agreementId=agreement-978277f1-…
  · turn +0.29 ms  round=1 role=brand type=OFFER amountUsdc=300 messageProvider=deterministic
  · turn +0.61 ms  round=1 role=creator type=ACCEPT amountUsdc=300 messageProvider=deterministic allowed=True
  a2a.agent_card 0.0 ms ok @knot-api  mode=local discovered=False
  a2a.send 0.3 ms ok @knot-api  type=OFFER round=1 replyType=ACCEPT taskState=TASK_STATE_COMPLETED
    creator.decide 0.2 ms ok @knot-api  tenant=agent-creator-1 messageType=OFFER decisionType=ACCEPT violationCodes=[] taskState=TASK_STATE_COMPLETED
      llm.call 0.0 ms ok @knot-api  purpose=creator_rationale provider=deterministic fallbackReason=gemini_mode_off
```
응답 헤더 `X-Trace-Id` = `meta.traceId` = `matchRun.traceId` / `negotiation.traceId` 확인.

### 메모
- `start_negotiation` 본문 전체를 `with start_trace(...), span("negotiation.run", ...)` 아래로 한 단계 들여써서 diff가 크다. 의미 변경은 `turn`/traceId/`meta.traceId` 추가뿐. 같은 함수를 건드리는 브랜치와는 머지 충돌이 날 수 있다.
- 처음엔 영속 메시지를 append할 때 `turn`을 찍었는데, 전송 실패 테스트에서 브랜드 OFFER 턴이 사라지는 걸 보고 전송 전/파싱 후로 옮겼다(`BrandNegotiator._trace_turn`과 같은 시점).
- 기존 협상이 있어 그대로 돌려주는 조기 반환은 스팬을 열지 않는다(협상이 돌지 않음).

### 남은 것 / 다음
- [ ] 프론트 "관전 중단" → cancel 엔드포인트 호출, 승인 큐 화면
- [ ] 승인·캠페인 라우트 인증(다른 브랜치 진행 중)
- [ ] 실제 LangSmith 키로 미러링 확인, Cloud Run `jsonPayload.traceId` 필터 실측
