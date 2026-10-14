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
