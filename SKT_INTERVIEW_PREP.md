# SKT AI/DX 면접 대비 Q&A

> KNOT Agent Ops Platform 프로젝트 기반

---

## 🎯 핵심 메시지

**"AI Agent를 서비스가 아닌 관리 대상으로, Multi LLM과 MCP로 안전하고 효율적인 Agent 플랫폼을 구축했습니다."**

---

## 📋 프로젝트 30초 소개

**"KNOT는 브랜드와 크리에이터의 협찬 협상을 AI Agent가 자율적으로 수행하는 서비스입니다.
처음에는 단순 협상 Agent였지만, SKT 면접을 준비하며 **Agent Ops 플랫폼**으로 확장했습니다.

현재 **5개의 전문 Agent**(Discovery, Brand, Creator, Verification, Payment)가
**LangGraph로 조율**되고, **Multi LLM**(Gemini/GPT-4/Claude)을 역할별로 선택하며,
**MCP 프로토콜**로 Firestore·Instagram API와 안전하게 통신합니다.

모든 Agent 실행은 **LangSmith로 추적**되고, **AI Governance Engine**이 예산 초과·개인정보 노출을 방지합니다."**

---

## 💬 예상 질문 & 답변

### 1. 기술 선택 관련

#### Q1: "왜 LangGraph를 선택했나요? AutoGen, CrewAI와 비교하면?"

**A**:
협상 워크플로우는 **복잡한 조건부 분기**가 많습니다. "예산 초과면 에스컬레이션", "3라운드 넘으면 자동 종료" 같은 deterministic한 비즈니스 로직이 필요합니다.

- **AutoGen**: 자율적 대화에 강하지만, 명시적 상태 관리가 어렵습니다. Agent끼리 대화만 하고 결과가 불확실할 수 있습니다.
- **CrewAI**: 순차적 작업 흐름(Task 1 → Task 2 → Task 3)에 최적화되어 있습니다. 하지만 협상은 조건에 따라 다른 경로로 분기되므로 맞지 않습니다.
- **LangGraph**: StateGraph로 상태 전이를 명시적으로 정의할 수 있고, LLM 출력과 정책 검증을 분리할 수 있습니다. 또한 LangSmith와 네이티브 통합되어 프로덕션 모니터링이 쉽습니다.

**Trade-off**: LangGraph는 학습 곡선이 있지만, 금융 거래 같은 민감한 작업에서는 명시적 제어가 필수적입니다.

---

#### Q2: "MCP는 무엇이고, 왜 사용했나요?"

**A**:
MCP(Model Context Protocol)는 **Anthropic이 제안한 Agent-Data 통신 표준**입니다.

**문제**: Agent가 Firestore, Instagram API, Payment API에 직접 접근하면:
- 권한 관리가 분산됨 (각 Agent 코드에서 개별 처리)
- 감사 추적이 어려움
- 새 데이터 소스 추가 시 모든 Agent 수정 필요

**MCP 해결책**:
- **표준화**: Tool 인터페이스로 통일 (Agent는 어떤 DB인지 몰라도 됨)
- **권한 관리**: MCP Server 레벨에서 Agent별 접근 제어
- **감사 로그**: 모든 데이터 접근이 자동으로 기록됨
- **확장성**: 새 데이터 소스는 MCP Server만 추가하면 모든 Agent가 즉시 사용 가능

SKT의 **통신 데이터와 AI Agent를 연결**할 때, MCP로 보안과 확장성을 동시에 확보할 수 있습니다.

---

#### Q3: "Multi LLM을 사용하는 이유는? 하나의 모델로 통일하지 않은 이유?"

**A**:
역할별로 최적 모델이 다르기 때문입니다.

**Agent별 모델 선택**:
- **Discovery Agent (GPT-4)**: 복잡한 검색 쿼리와 추론이 필요 → GPT-4의 강력한 reasoning 능력 활용
- **Brand Agent (Gemini 2.0)**: 빠른 응답과 비용 효율이 중요 → Gemini의 속도와 낮은 비용
- **Creator Agent (Claude 3.5)**: 미묘한 협상 뉘앙스 이해 필요 → Claude의 정확한 문맥 파악
- **Verification Agent (Gemini Vision)**: 이미지/비디오 분석 필요 → Gemini의 멀티모달 능력

**결과**:
- **비용 50% 절감**: 단순 작업은 저렴한 모델, 복잡한 작업만 고급 모델 사용
- **Resilience**: 한 provider가 다운되어도 Fallback으로 서비스 지속
- **Vendor Lock-in 방지**: LiteLLM Gateway로 provider 변경이 설정 파일 수정만으로 가능

**SKT 통신 데이터**의 다양한 use case(고객 상담, 네트워크 분석, 마케팅)에도 동일한 전략을 적용할 수 있습니다.

---

#### Q4: "RAG를 사용하는데, Fine-tuning과 비교하면?"

**A**:
협상 데이터가 **매일 쌓이는 환경**이므로 RAG가 적합합니다.

**Fine-tuning의 한계**:
- 새 데이터 반영하려면 재학습 필요 (시간 + 비용)
- 배포 주기가 김 (주 1회 정도)
- 특정 도메인에 과적합될 위험

**RAG의 장점**:
- **실시간 반영**: 오늘 완료된 협상이 내일부터 검색 가능
- **투명성**: Agent가 "이 결정은 과거 협상 ID-123을 참고했다"고 명시 가능
- **유연성**: 검색 쿼리만 바꾸면 다른 컨텍스트 활용 가능

**Hybrid 전략**:
- 자주 사용하는 일반 패턴 → Base LLM이 이미 학습
- 특수 케이스 → RAG로 검색
- 나중에 충분한 데이터 쌓이면 일부 패턴 LoRA Fine-tuning 고려

**SKT 통신 데이터**는 규모가 크고 실시간성이 중요하므로, RAG가 초기 단계에 적합합니다.

---

### 2. Agent Ops 관련

#### Q5: "Agent Ops가 정확히 무엇인가요?"

**A**:
Agent를 **서비스가 아닌 관리 대상**으로 보는 것입니다.

**기존 방식** (Agent as Service):
- Agent 코드 작성 → 배포 → 모니터링 없음
- 문제 발생 시 로그 뒤지기
- 버전 관리 없음

**Agent Ops 방식** (Agent as Managed Entity):
1. **생명주기 관리**: 개발 → 테스트 → 배포 → 모니터링 → 롤백
2. **실시간 추적**: LangSmith로 모든 실행 기록 (입력/출력/토큰/비용)
3. **성능 분석**: 어떤 Agent가 느린지, 어디서 에러나는지 대시보드로 확인
4. **거버넌스**: 예산 초과, 개인정보 노출, 비정상 패턴 자동 감지
5. **버전 관리**: Blue-Green 배포, 롤백 가능

**SKT의 대규모 Agent 서비스**에서는 수십 개의 Agent가 동시에 실행될 텐데, Agent Ops 없이는 운영이 불가능합니다.

---

#### Q6: "AI Governance는 어떻게 구현했나요?"

**A**:
**"Agent가 자율적이지만, 모든 결정은 정책 검증을 통과한다"**는 원칙입니다.

**구현 방법**:
1. **예산 초과 방지**:
   ```python
   if decision["amount"] > context["max_budget"]:
       violations.append("BUDGET_EXCEEDED")
       # 사람에게 에스컬레이션
   ```

2. **개인정보(PII) 노출 감지**:
   ```python
   if gemini.detect_pii(decision["message"]):
       violations.append("PII_EXPOSURE")
       # 응답 차단
   ```

3. **비정상 패턴 탐지**:
   - Agent가 갑자기 예산을 2배로 올리면 경고
   - 동일 크리에이터에게 반복 제안하면 봇 의심

4. **감사 로그**:
   - 모든 위반 사항을 Firestore에 저장
   - 나중에 Agent 행동 분석 가능

**SKT 통신 데이터**는 개인정보가 많으므로, 이런 Governance가 필수적입니다.

---

### 3. 구현 디테일

#### Q7: "LangSmith로 무엇을 추적하나요?"

**A**:
**모든 Agent 실행의 생명주기**를 추적합니다.

**추적 항목**:
1. **실행 시간**: 각 Agent/단계별 소요 시간 → 병목 구간 식별
2. **입력/출력**: Agent에게 무엇을 보냈고 무엇을 받았는지
3. **LLM 호출**: 어떤 프롬프트로 몇 토큰 사용했는지 → 비용 분석
4. **에러**: 어디서 실패했는지 스택 트레이스
5. **상태 전이**: LangGraph의 어떤 경로로 흘러갔는지

**실제 사용 예**:
- "Brand Agent가 왜 느리지?" → LangSmith 보니 RAG 검색에 80% 시간 소요 → 캐싱 추가
- "Creator Agent가 왜 거부했지?" → Trace 보니 Policy에서 최소 금액 미달 → 정책 조정
- "이번 달 LLM 비용 왜 증가?" → Agent별 토큰 사용량 확인 → Discovery가 GPT-4 과다 호출 → Gemini로 일부 전환

---

#### Q8: "Semantic Layer가 왜 필요한가요?"

**A**:
Agent가 **복잡한 SQL을 몰라도 비즈니스 메트릭을 쿼리**할 수 있게 하기 위해서입니다.

**문제**: Agent에게 이렇게 시키면 안됩니다:
```sql
SELECT creator_id, SUM(likes + comments) / SUM(views) as engagement_rate
FROM creator_posts
WHERE post_date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY creator_id
```

**해결책 (Semantic Layer)**:
```python
# Agent는 이렇게 요청
agent.call_tool("get_metric", {
    "metric_name": "creator_engagement_rate",
    "filters": {"period": "30d"}
})

# Semantic Layer가 자동으로 SQL 변환 실행
```

**장점**:
- Agent는 비즈니스 용어만 알면 됨
- DB 스키마 변경해도 Agent 코드 수정 불필요
- 메트릭 정의를 한 곳에서 관리

**SKT 통신 데이터**는 스키마가 복잡할 텐데, Semantic Layer 없이는 Agent가 쿼리할 수 없습니다.

---

#### Q9: "Hybrid Vector Search는 어떻게 동작하나요?"

**A**:
**Firestore의 메타데이터 필터링 + Pinecone의 벡터 검색**을 결합합니다.

**문제**:
- 벡터 검색만 하면 → 날짜/카테고리 필터 어려움
- 메타데이터 검색만 하면 → 의미적 유사성 찾기 어려움

**Hybrid 방식**:
```python
# 1단계: Firestore로 메타데이터 필터
candidates = firestore.collection("negotiations") \
    .where("category", "==", "beauty") \
    .where("date", ">=", "2026-09-01") \
    .limit(100)

# 2단계: Pinecone으로 벡터 검색 (Firestore 결과 중에서만)
similar = pinecone.query(
    vector=query_embedding,
    filter={"id": {"$in": candidate_ids}},
    top_k=5
)
```

**결과**: "뷰티 카테고리, 최근 3개월" 중에서 의미적으로 유사한 협상 5건 검색

**SKT 통신 데이터**도 시간/지역/서비스 타입 같은 메타데이터와 의미적 유사성을 동시에 고려해야 하므로 동일한 전략을 쓸 수 있습니다.

---

### 4. 프로덕션 준비

#### Q10: "Agent가 잘못된 결정을 하면 어떻게 되나요?"

**A**:
**4단계 안전장치**가 있습니다.

1. **Policy Engine** (사전 방지):
   - LLM 출력을 deterministic 코드가 재검증
   - 예산·정책 위반 시 자동 차단

2. **Confidence Threshold** (불확실성 처리):
   - Agent가 확신도 < 70%면 사람에게 에스컬레이션
   - "이 협상은 복잡해서 검토 필요합니다"

3. **Human-in-the-loop** (고위험 작업):
   - 100만원 이상 거래는 사람 승인 필수
   - 새로운 유형의 요청은 자동 승인 안 함

4. **LangSmith Trace** (사후 분석):
   - 잘못된 결정의 원인을 trace에서 분석
   - 프롬프트 개선 또는 정책 업데이트

**실제 예**:
- Agent가 200만원 제안 → Policy Engine이 예산 150만원 확인 → 차단
- Agent가 크리에이터 이메일 노출 → Governance가 PII 감지 → 응답 삭제
- 불확실한 콘텐츠 검증 → 확신도 65% → 사람이 직접 확인

---

#### Q11: "Fallback은 어떻게 동작하나요?"

**A**:
1차 모델 실패 시 **자동으로 백업 모델**로 전환합니다.

```python
async def generate_with_fallback(agent_role, messages):
    primary = model_mapping[agent_role]  # "gpt-4o"
    fallback = "gemini-2.0-flash"

    try:
        return await llm.call(primary, messages)
    except (Timeout, RateLimitError) as e:
        logger.warning(f"{primary} failed: {e}")
        return await llm.call(fallback, messages)
```

**발생 가능한 상황**:
- GPT-4 API가 다운 → Gemini로 자동 전환
- Rate limit 도달 → 다른 provider로 우회
- 특정 지역에서 차단 → 백업 모델 사용

**결과**: Agent 서비스가 **99.9% 가용성** 유지

---

### 5. SKT 적용 가능성

#### Q12: "이 플랫폼을 SKT에 어떻게 적용할 수 있나요?"

**A**:
**3가지 방향**으로 확장 가능합니다.

**1. 고객 상담 Agent Ops**:
- 현재: 브랜드-크리에이터 협상
- SKT 적용: 고객-상담원 대화 자동화
- Agent: 문의 분류 Agent, 답변 생성 Agent, 에스컬레이션 Agent
- MCP: 고객 DB, 상품 카탈로그, 주문 이력 연동
- Multi LLM: 단순 문의는 Gemini, 복잡한 불만은 GPT-4

**2. 네트워크 운영 Agent**:
- Agent: 이상 탐지 Agent, 원인 분석 Agent, 조치 제안 Agent
- MCP: 네트워크 로그, 장비 상태 DB 연동
- Semantic Layer: "기지국 성능", "트래픽 패턴" 같은 메트릭

**3. 마케팅 캠페인 Agent**:
- Agent: 타겟 선정 Agent, 메시지 생성 Agent, 성과 분석 Agent
- MCP: 고객 세그먼트 DB, 캠페인 이력 연동
- RAG: 과거 성공 캠페인 패턴 학습

**공통 인프라**:
- Agent Ops Platform으로 모든 Agent 통합 관리
- LangSmith로 실시간 모니터링
- AI Governance로 컴플라이언스 준수

---

#### Q13: "SKT의 통신 데이터 규모에서도 작동할까요?"

**A**:
**확장성을 고려해 설계**했습니다.

**현재 아키텍처**:
- Firestore: 자동 스케일링 (Google 관리)
- Pinecone: 1억 벡터까지 밀리초 응답
- LiteLLM: 여러 provider 로드 밸런싱
- Redis 캐싱: 자주 조회되는 데이터 캐싱

**SKT 규모 대응 전략**:
1. **샤딩**: 지역별/서비스별로 Agent 분리
2. **배치 처리**: 실시간이 아닌 작업은 비동기 큐 (Cloud Tasks)
3. **캐싱 강화**: Redis Cluster로 처리량 증가
4. **비용 최적화**: 저렴한 모델 우선 사용, 필요시만 고급 모델

**벤치마크 목표**:
- Agent 응답 시간: < 2초 (95th percentile)
- 동시 처리: 1000 requests/sec
- 가용성: 99.9%

---

## 🎤 1분 피칭 (엘리베이터 피치)

**"KNOT Agent Ops Platform은 브랜드-크리에이터 협상을 5개의 전문 AI Agent가 자율적으로 수행하는 플랫폼입니다.

LangGraph로 협상 워크플로우를 조율하고, Multi LLM으로 역할별 최적 모델을 선택하며, MCP 프로토콜로 데이터 소스와 안전하게 통신합니다.

모든 Agent는 LangSmith로 실시간 추적되고, AI Governance Engine이 예산 초과와 개인정보 노출을 방지합니다.

이 플랫폼을 SKT의 고객 상담, 네트워크 운영, 마케팅에 적용하면 통신 데이터를 활용한 자율 Agent 서비스를 빠르게 구축할 수 있습니다."**

---

## 📝 면접 전 체크리스트

- [ ] REFACTORING_PLAN.md 숙지
- [ ] PROGRESS.md 최신 상태 확인
- [ ] 데모 준비 (LangSmith 대시보드, Agent 실행 영상)
- [ ] 코드 주요 부분 설명 준비 (AgentSpec, MCP Server, LiteLLM Gateway)
- [ ] SKT 적용 사례 3가지 암기
- [ ] 기술 선택 근거 설명 연습
- [ ] 1분 피칭 연습

---

*파이팅!*
