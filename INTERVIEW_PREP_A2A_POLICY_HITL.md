# 면접 대비 — A2A 구조 · 정책 엔진 · 휴먼 인 더 루프

> 이 파일의 모든 답은 **레포에 실제로 있는 코드**를 근거로 한다. 면접관이 "보여주세요" 하면 바로 열 수 있는 것만 적었다.
> `SKT_INTERVIEW_PREP.md`의 LangGraph / Multi-LLM / LangSmith 부분은 레포에 구현이 없다. 그 얘기를 하려면 "설계 구상"이라고 선을 긋고, 구현된 건 아래 내용으로 답할 것.

---

## 0. 한 문장 핵심 메시지

**"판단은 결정적 정책 코드가 하고, LLM은 문장만 쓴다. 에이전트끼리는 A2A 표준 JSON으로 대화하고, 사람은 한도(정책)를 정하고 ESCALATE된 건만 본다."**

이 한 문장을 아래 세 축으로 풀어서 설명할 수 있어야 한다.

| 축 | 근거 코드 |
|---|---|
| A2A 통신 | `backend/libs/a2a/models.py`, `apps/creator_agent/main.py`, `libs/a2a/store.py`, `libs/agents/brand_negotiator.py` |
| 정책 엔진 | `libs/policies/creator.py`, `libs/policies/brand.py`, `libs/agents/negotiation.py` |
| 사람 개입 | `libs/agents/negotiation.py`의 ESCALATE, `A2ATaskState.INPUT_REQUIRED`, `PromotionAutonomy`, `libs/ai/gemini.py`의 confidence 가드 |

---

## A. A2A 구조

### A1. A2A가 뭔가요? 그냥 REST API 호출과 뭐가 다른가요?
- A2A(Agent-to-Agent)는 Google이 제안한 **에이전트 간 상호운용 프로토콜**. 핵심 개념은 AgentCard(발견), Message/Part(대화 단위), Task(상태 있는 작업), Artifact(결과물).
- REST와 다른 점: (1) `/.well-known/agent-card.json`으로 **상대 능력을 먼저 발견**한다. (2) 요청-응답이 아니라 **Task라는 상태 머신**을 공유한다 (SUBMITTED → WORKING → INPUT_REQUIRED → COMPLETED …). (3) 메시지가 여러 라운드 이어져도 `contextId`/`taskId`로 한 대화로 묶인다.
- 우리 구현: 크리에이터 에이전트가 A2A 서버(`apps/creator_agent/main.py`), 브랜드 에이전트가 A2A 클라이언트(`libs/a2a/client.py` + `brand_negotiator.py`). 둘은 별도 프로세스, HTTP로만 대화.
- **꼬리질문 대비**: "MCP랑 뭐가 달라요?" → MCP는 에이전트↔도구/데이터, A2A는 에이전트↔에이전트. 우리 레포에서 MCP는 pay.sh(결제 도구) 쪽, A2A는 협상 쪽.

### A2. 메시지 하나의 구조를 설명해보세요.
```
A2ASendRequest
 ├ tenant            : 상대 에이전트 id (creator-agent-001)
 ├ message
 │   ├ messageId     : 멱등성 키
 │   ├ contextId     : 대화 묶음
 │   ├ taskId        : 2번째 메시지부터 채움
 │   ├ role          : ROLE_USER(보내는 쪽) / ROLE_AGENT(응답)
 │   └ parts[0].data : knot.negotiation.v1 payload
 ├ configuration.acceptedOutputModes
 └ metadata          : (데모용) creatorNegotiationContext
```
- `A2APart`는 text / raw / url / data 중 **정확히 하나**만 허용 (`models.py`의 `validate_one_content_kind`). 우리는 구조화 협상이므로 항상 `data`.
- 헤더: `A2A-Version: 1.0`, `Content-Type: application/a2a+json`, `Authorization: Bearer`. 셋 다 서버가 검증 (`_validate_a2a_headers`, `_validate_service_auth`).

### A3. 협상 payload(`knot.negotiation.v1`)에 뭐가 들어가나요? 왜 그렇게 설계했나요?
- `type`(OFFER/COUNTER/ACCEPT/REJECT/ESCALATE), `round`, `promotion`(공개 조건), `terms`(금액·산출물·사용권·마일스톤·제약), `changedFields`, `rationale`, `display`.
- 설계 의도 세 가지:
  1. **기계 판독 필드와 사람용 필드 분리**: 상대 에이전트는 `type`/`terms`/`changedFields`만 읽는다. `display.message`는 UI용이고 LLM이 채운다.
  2. **비공개 정보는 와이어에 없음**: 브랜드 상한, 크리에이터 최소 금액은 payload 어디에도 없다. 상대는 결과(650 역제안)만 본다.
  3. **`changedFields`로 diff 명시**: 무엇을 바꿨는지 상대가 재계산하지 않아도 된다.
- 실제 원문 예시는 세션 기록 참조 (OFFER 500 → COUNTER 650 → ACCEPT → ACCEPT → term-sheet artifact).

### A4. Task 상태 전이를 설명해보세요.
- `libs/a2a/store.py`의 `send_message`:
  - 크리에이터 COUNTER / ESCALATE → `INPUT_REQUIRED` (상대 입력 대기)
  - ACCEPT → `COMPLETED` + `knot.term-sheet.v1` artifact (agreementId, termsHash)
  - REJECT → `COMPLETED` + artifact(result=REJECTED)
  - 브랜드가 물러나면 `tasks/{id}:cancel` → `CANCELED`
- 종료된 task에 메시지를 보내면 409 (`terminal tasks do not accept new messages`).
- **왜 상태 머신인가**: 협상은 여러 라운드고 중간에 사람이 끼어들 수 있다. 요청-응답으로는 "지금 누구 차례인지"를 표현할 수 없다.

### A5. 같은 메시지가 두 번 오면 어떻게 되나요? (멱등성)
- `store.send_message` 첫 줄: `messageId`가 이미 처리됐으면 **저장된 task를 그대로 반환**. 재시도해도 라운드가 두 번 돌지 않는다.
- `contextId`/`taskId` 불일치는 409로 거부 (`_validate_message_task_context`).
- 꼬리: "분산 환경이면?" → 지금은 인메모리. Firestore로 옮기면 messageId를 문서 키로 쓰고 트랜잭션으로 묶으면 된다(설계 답변).

### A6. AgentCard는 왜 필요한가요?
- 브랜드 에이전트는 협상 전에 `GET /.well-known/agent-card.json`으로 상대가 `promotion-negotiation` 스킬을 지원하는지, 입출력 모드가 `application/json`인지 확인한다 (`brand_agent/main.py`의 `_prepare`, `routes.py`의 `_validate_creator_agent_card`).
- 이게 있어야 **다른 회사가 만든 크리에이터 에이전트**와도 붙을 수 있다. 우리 서버가 아니어도 카드만 맞으면 협상 가능.

### A7. 브랜드 에이전트의 협상 전략은 어떻게 동작하나요?
- `BrandNegotiationStrategy`: `openingAmountUsdc`, **`ceilingUsdc`(비공개 상한)**, `concessionPct`, `maxRounds`.
- 루프 (`BrandNegotiator.run`):
  1. OFFER 전송.
  2. COUNTER가 오면 → 금액 ≤ 상한 **그리고** 브랜드 정책 통과 → ACCEPT.
  3. 아니면 갭의 `concessionPct`%만큼 올려 COUNTER. 상한에서 캡.
  4. 더 못 올리면 cancel → `WALKED_AWAY`. 라운드 초과 → `ROUND_LIMIT`.
- 실측: 400/600 시나리오에서 400 → 525 → 588 → 600 → 철수. 크리에이터는 650 고수.
- 꼬리: "LLM이 전략을 정하면 안 되나요?" → 돈이 걸린 결정은 재현 가능해야 한다. 같은 입력엔 같은 출력. LLM 전략은 테스트 불가능하고 프롬프트 인젝션에 취약.

### A8. 전송 계층을 어떻게 추상화했나요?
- `A2ATransport` Protocol(`send_message`, `cancel_task`). 구현 둘: HTTP(`CreatorA2AClient`), 인프로세스(`InProcessTransport` → `InMemoryA2ATaskStore`).
- 효과: 같은 협상 루프를 **단위 테스트는 인프로세스로 0.2초**, 통합 테스트는 uvicorn 실서버로 돌린다 (`tests/test_brand_agent_a2a.py`).
- 제품 API도 `KNOT_CREATOR_A2A_MODE=local|http`로 같은 스위치를 쓴다 (`routes.py`의 `_send_creator_a2a_task`).

### A9. 실시간으로 어떻게 보여주나요?
- 브랜드 에이전트가 SSE(`GET /brand/v1/negotiations/stream`)로 `status → turn… → result` 이벤트를 민다. 협상 루프는 워커 스레드, `on_turn` 콜백이 큐에 넣고 제너레이터가 흘려보낸다.
- 왜 WebSocket이 아니라 SSE: 서버→클라 단방향이면 충분하고, EventSource는 재연결이 내장.

### A10. 이 구조의 한계는?
- 솔직하게 말할 것: (1) 인메모리 task store → 재시작하면 날아감. (2) `metadata.creatorNegotiationContext`로 **상대 정책을 밀어넣는 데모용 경로**가 있는데, 운영이라면 크리에이터 에이전트가 자기 정책을 스스로 들고 있어야 한다(신뢰 경계 위반). (3) 스트리밍 중단해도 서버 쪽 협상은 끝까지 간다.

---

## B. 정책 엔진

### B1. "정책 기반 결정"이 정확히 뭔가요?
- 입력(promotion, terms, 정책, 오늘 날짜)을 받아 **`PolicyDecision{allowed, action, violations[], ruleVersion}`**을 내는 순수 함수. LLM 호출 없음, 부작용 없음.
- 크리에이터 7개 규칙 (`policies/creator.py`): 차단 업종, 최소 금액, 허용 사용권, 월 캐파, 리드타임, 수정 횟수, 독점 기간.
- 브랜드 규칙 (`policies/brand.py`): 카테고리 매칭, 크리에이터당/총 예산, 누적 예산, 성과 비율, 사용권 일치, 산출물 포맷, 게시 기간, 라운드 상한, autoEscrow/autoRelease 플래그.
- `violations[].code`가 **기계 판독용 사유**. 상대 에이전트와 UI는 이 코드를 보고 다음 행동을 정한다.

### B2. 정책 결과를 어떻게 협상 행동(COUNTER/REJECT/ESCALATE)으로 바꾸나요?
- `libs/agents/negotiation.py` `evaluate_creator_message`:
  - 라운드 초과 → REJECT
  - 위반 없음 → ACCEPT (+ agreementId, termsHash 생성)
  - 위반이 **오직 `CREATOR_MIN_BASE_NOT_MET` 하나** → COUNTER (금액만 최소값으로 올림, `changedFields=["compensation.baseAmountUsdc"]`)
  - `CREATOR_BLOCKED_INDUSTRY` 포함 → REJECT
  - 그 외 전부 → **ESCALATE** (사람 검토)
- 왜 COUNTER를 금액 하나에만 허용하나: 자동으로 고칠 수 있는 위반은 금액뿐이다. 사용권이나 일정은 크리에이터의 선호라 에이전트가 임의로 바꾸면 안 된다 → 사람에게.

### B3. 정책 버전은 왜 넣었나요? (`ruleVersion: creator-policy-v1`)
- 결정 기록(`persisted_decisions`)에 버전이 남아서 **나중에 규칙이 바뀌어도 그때 왜 그렇게 판단했는지 재현** 가능. 감사(audit)의 기본.

### B4. 정책을 누가 정하나요? 사람이요, 에이전트요?
- **사람**. 크리에이터는 온보딩에서 `CreatorPolicy`(최소 금액, 차단 업종…)를, 브랜드는 `Promotion.budget` + `autonomy`를 설정. 에이전트는 그 **안에서만** 움직인다.
- 이게 휴먼 인 더 루프의 1단계: 매 건 승인이 아니라 **사전에 한도를 승인**.

### B5. 정책이 서로 충돌하면? (브랜드 상한 < 크리에이터 최소)
- 수렴 불가 → 브랜드가 상한까지 양보하고 물러남(`WALKED_AWAY`), 또는 라운드 초과. 둘 다 **명시적 종료 상태**로 남고 task는 CANCELED. 영원히 핑퐁하지 않는다.
- 꼬리: "무한 루프 방지는?" → `maxNegotiationRounds`(≤5, 모델 레벨 `le=5`)가 양쪽에 있다. 크리에이터도 `payload.round > max_rounds`면 REJECT.

### B6. 합의 결과는 어떻게 고정하나요?
- ACCEPT 시 `terms_hash(terms)` = sha256. term-sheet artifact에 `termsHash`로 들어가고, 이 해시가 Anchor 에스크로의 합의 지문이 된다. 나중에 조건을 바꿔치기하면 해시가 안 맞는다.

### B7. 정책 엔진 테스트는 어떻게 하나요?
- `tests/test_policy_rules.py`(규칙 단위), `tests/test_a2a_negotiation.py`(결정 매핑), `tests/test_brand_agent_a2a.py`(루프 전체 + 실HTTP). 결정적이라 플래키 없음, LLM 호출 없음.

---

## C. 휴먼 인 더 루프 (HITL) / 자율성 한도

### C1. "사람 승인 없이 결제"가 핵심인데, 그럼 사람은 언제 개입하나요?
세 층으로 답한다.
1. **사전 한도 (Before)**: `CreatorPolicy`, `Promotion.budget.maxPerCreatorUsdc`, `PromotionAutonomy{maxNegotiationRounds, autoEscrow, autoRelease}`. 프론트는 실지갑 잔액을 예산 한도로 쓴다(커밋 `eb300af`).
2. **예외 시 호출 (During)**: 정책으로 자동 처리 못 하는 위반 → `ESCALATE` → A2A task `INPUT_REQUIRED`. Gemini confidence < 0.7이면 문장 앞에 `[검토 필요]` 붙임 (`gemini.py` `creator_rationale`).
3. **사후 감사 (After)**: 모든 메시지·결정이 `persisted_messages`/`persisted_decisions`로 저장(ruleVersion, policyDecision 포함). termsHash로 합의 내용 불변.

### C2. ESCALATE가 나면 구체적으로 무슨 일이 생기나요?
- 크리에이터 에이전트가 `type: ESCALATE` 응답 → task `INPUT_REQUIRED`로 멈춤. 브랜드 에이전트는 `outcome: ESCALATED`로 루프 종료(자동으로 더 밀어붙이지 않음).
- 사람이 조건을 고치거나 정책을 바꾼 뒤 **같은 task에 새 메시지**로 재개할 수 있다 (`taskId` 유지).
- 어떤 경우: 사용권 불일치, 캐파 초과, 리드타임 부족, 수정 횟수/독점 기간 초과. 즉 "금액 말고 다른 게 안 맞을 때".

### C3. 자율성 플래그(`autoEscrow`, `autoRelease`)는 어디서 쓰나요?
- `validate_brand_terms(action="ESCROW_LOCK")`: `autoEscrow=false`면 `POLICY_AUTO_ESCROW_DISABLED` 위반 → 에이전트가 돈을 잠그지 못하고 사람 승인으로 넘어감. `MILESTONE_RELEASE`도 동일.
- 즉 브랜드가 "협상은 자동, 돈 나가는 건 내가"를 선택할 수 있다.

### C4. 돈이 실제로 나가는 지점에서의 안전장치는?
- 에스크로 마일스톤: 계약금 20%(`creatorAccepted`) + 잔금 80%(`contentLiveVerified`). 계약금도 **수락 즉시 전송이 아니라 귀속만** 확정 → "수락 → 계약금 수령 → 잠수" 어뷰징 차단 (`brand.py` 주석, docs/17).
- 정산 자동화는 환경 플래그 `KNOT_AUTO_SETTLEMENT_ON_EVIDENCE`로 끌 수 있고, 실패하면 수동 Phantom 릴리즈 fallback.
- pay.sh API 결제: `PAYSH_MAX_CALL_AMOUNT_USDC`, `PAYSH_RUN_SPEND_CAP_USDC`, `PAYSH_DAILY_SPEND_CAP_USDC` 3단 한도 (`backend/.env.example`).

### C5. 완전 자동화 vs 사람 승인, 어떤 기준으로 나눴나요?
- 기준: **되돌릴 수 있는가 + 정책으로 판정 가능한가**.
  - 되돌릴 수 있고 판정 가능 → 자동 (협상 메시지, 금액 역제안)
  - 되돌리기 어렵지만 판정 가능 → 자동 + 한도 (에스크로 락, 마일스톤 릴리즈)
  - 판정 불가 → 사람 (ESCALATE, 분쟁)
- 꼬리: "한도 안이면 다 자동이면 위험하지 않나?" → 한도는 사람이 지갑 잔액 기준으로 정하고, 라운드 상한과 ruleVersion 감사가 있다. 그리고 대화 전체가 A2A history로 남아 사후 검토가 가능하다.

### C6. 사람이 개입한 결과는 에이전트 학습에 쓰이나요?
- 지금은 아니다(솔직히). TODO에 "협상 히스토리를 벡터 DB에 넣고 유사 협상을 프롬프트 컨텍스트로" 있음. 단, 그래도 **결정은 여전히 정책 코드**가 하고 RAG는 문장 품질/톤에만 쓸 계획. 결정에 LLM을 넣는 순간 재현성이 깨진다.

### C7. 에이전트가 잘못된 결정을 했을 때 책임 추적은?
- 누가(agentLabel), 언제(createdAt), 어떤 규칙 버전(ruleVersion)으로, 어떤 위반(violations)을 보고, 어떤 행동(type)을 했는지가 메시지 단위로 남는다. LLM 문장은 `messageProvider/model`로 출처 표시, fallback이면 `fallbackReason`까지.

---

## D. LLM의 역할과 안전

### D1. LLM은 정확히 뭘 하나요?
- 두 함수뿐: `creator_rationale`(크리에이터 말풍선), `brand_message_display`(브랜드 말풍선). 둘 다 프롬프트에 **"The action, amount … are fixed by deterministic code. Do not change…"** 명시.
- 출력은 JSON 한 줄(`{"message": …}` 또는 `{"thinking", "confidence", "rationale"}`), 파싱 실패/빈 값이면 **결정적 문장으로 fallback** (`fallbackReason` 기록).
- Gemini를 끄면(`KNOT_GEMINI_MODE=off`) 협상 결과가 **1바이트도 안 바뀐다**. 테스트가 그 증거.

### D2. 프롬프트 인젝션은?
- 상대가 보낸 `display.message`나 `rationale`은 우리 쪽 **결정 코드가 읽지 않는다**. 읽는 건 `type`/`terms`/`policyDecision`뿐. LLM이 생성하는 건 우리 쪽 문장이고, 입력으로 들어가는 건 구조화된 terms와 policyDecision.
- 비공개 임계값(최소 금액)은 프롬프트에 "Do not reveal private thresholds"로 막고, 애초에 LLM에게 금액 결정권이 없다.

### D3. CoT(thinkingSteps)는 왜 넣었나요?
- 문장 품질용. `step1 분석 → step2 위반 식별 → step3 톤 → step4 작성`. `thinking`은 출력 JSON에 있지만 UI엔 안 보여주고 `rationale`만 쓴다.
- confidence는 LLM 자기평가. 0.7 미만이면 `[검토 필요]` 접두 → 사람 눈에 띄게. 현재 데모 라우트의 0.85는 하드코딩이라 고칠 TODO(솔직히 말할 것).

---

## E. 운영/실패 시나리오

### E1. 크리에이터 에이전트가 죽어 있으면?
- 브랜드 쪽 `CreatorA2AClientError` → 502 `A2A_CREATOR_AGENT_UNAVAILABLE`. SSE에서는 `error` 이벤트. 재시도는 messageId 멱등성 덕에 안전.

### E2. 타임아웃은?
- `CREATOR_A2A_TIMEOUT_SECONDS`(기본 30). Gemini 호출이 라운드당 3~13초라 여유 둠. 실측 타이밍은 세션 기록에 있음.

### E3. 두 에이전트가 동시에 같은 task에 쓰면?
- 지금은 단일 프로세스 인메모리라 GIL + 순차 처리. 분산이면 task 문서에 낙관적 락(버전 필드) 필요 — docs/14에 동시성 설계.

### E4. 테스트 전략은?
- 피라미드: 정책 단위(순수 함수) → 결정 매핑 → 협상 루프(인프로세스) → 실HTTP 통합(uvicorn 스레드) → 데모 스크립트(Vertex on). LLM은 통합까지 **off**, 데모에서만 on.

---

## F. 압박/꼬리 질문 모음 (한 줄 답)

- **"그냥 함수 호출로 하면 되지 왜 A2A?"** → 다른 조직의 에이전트와 붙으려면 표준이 필요. 카드 발견 + task 상태 + artifact가 그 최소 계약.
- **"LLM 없이도 되는 거면 AI가 아니잖아요?"** → 판단의 재현성이 돈 거래의 전제. LLM은 설명·톤·향후 RAG 기반 전략 추천에 쓰고, 최종 결정권은 정책에 둔다. 그게 "안전한 자율성".
- **"사람이 매번 보면 자동화 의미가 없지 않나?"** → 매 건이 아니라 한도를 한 번 승인. 예외만 본다. 실측에서 4건 중 사람 개입 0건.
- **"상대 에이전트가 거짓말하면?"** → 와이어에는 조건만 있고 약속은 termsHash + 에스크로가 강제. 말(문장)은 신뢰 안 함.
- **"이 구조 어디까지 직접 했나?"** → 브랜드 에이전트 프로세스 분리, 협상 루프, SSE, 관전 페이지, 테스트 5종은 직접. A2A 서버/정책 엔진은 팀 공동(스키마 공동 설계).

---

## G. 공부 순서 (4일)

**1일차 — 와이어를 외운다**
- 두 에이전트 띄우고 `curl …/a2a/v1/tasks`로 원문 JSON을 3번 읽는다. OFFER→COUNTER→ACCEPT→ACCEPT→artifact를 **종이에 손으로** 그려본다.
- `models.py`를 위에서 아래로 읽고, 각 필드가 왜 있는지 한 줄씩 적는다.

**2일차 — 정책을 외운다**
- `policies/creator.py` 7개 코드와 `policies/brand.py` 코드 이름을 외운다. 각 위반이 COUNTER/REJECT/ESCALATE 중 어디로 가는지 `negotiation.py` 보고 표로 만든다.
- 시나리오 5개를 직접 돌린다: 합의 / 철수 / 거절 / `--creator-min` 바꿔서 / `maxRounds=2`.

**3일차 — HITL을 말로 한다**
- C1의 3층(사전 한도 / 예외 호출 / 사후 감사)을 **30초**에 말하는 연습. 녹음해서 들어본다.
- "자동 vs 사람" 기준(C5)을 예시 3개와 함께.

**4일차 — 모의 면접**
- 이 파일 질문을 랜덤으로 뽑아 답 → 바로 코드 열어서 근거 가리키기. 근거를 못 가리키면 그 답은 버린다.
- 관전 페이지(`/brand/v1/watch`) 시연 2분 리허설: 조건 입력 → 말풍선 → 결과 배너 → curl로 원문 보여주기.

**암기 카드 (정의 한 줄)**
- A2A: 에이전트 간 발견·대화·작업 상태 공유 표준 (AgentCard / Message / Task / Artifact)
- MCP: 에이전트↔도구 표준. 우리 레포에선 pay.sh
- x402: HTTP 402 기반 API 호출당 결제. 토큰 USDC-SPL
- pay.sh: Solana 재단+Google Cloud의 x402 게이트웨이 + Pay MCP
- termsHash: 합의 조건 sha256. 에스크로 지문
- INPUT_REQUIRED: A2A task에서 "상대/사람 입력 대기" 상태
- ruleVersion: 정책 버전. 사후 재현용
