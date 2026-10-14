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
