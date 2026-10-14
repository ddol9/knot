# LangSmith 통합 - Agent 실행 추적

> 모든 Agent 행동을 기록하고 분석

---

## 실제 구현 (2026-10-14) — `libs/observability/tracing.py`

아래 설계안(`@traceable`, LangGraph)과 달리, 실제 코드는 **외부 의존성 없는 작은 트레이서**를 쓰고 LangSmith는 선택 싱크다.
ExecPlan: `.agent/execplans/12-agent-tracing.md`.

**무엇이 찍히나** — 스팬이 끝날 때마다 로거 `knot.trace`에 JSON 한 줄:
`{"traceId","spanId","parentSpanId","name","durationMs","status":"ok|error","error"?,"attrs","events"?,"redacted"?,"startedAt","service"}`

| 스팬 | 어디서 | attrs(요약) |
|---|---|---|
| `campaign.run` | `CampaignRunner.run` | campaignId, matchRunId, promotionId, targetCreatorCount, budgetUsdc → outcome, agreedCount, committedUsdc, agreementIds |
| `campaign.discovery` | 탐색 | queried, ranked, probed, selected, selectedAgentIds |
| `negotiation.run` | `BrandNegotiator.run` (워커 스레드도 캠페인 trace 상속) | creatorAgentId, contextId → outcome, rounds, finalAmountUsdc, agreementId, taskState; `turn` 이벤트(round/role/type/amountUsdc/allowed) |
| `a2a.send` / `a2a.cancel` | 브랜드 → 크리에이터 메시지 | type, round, messageId → taskId, taskState, replyType |
| `creator.decide` | `InMemoryA2ATaskStore.send_message` (크리에이터 프로세스) | tenant, messageType, round → decisionType, action, violationCodes, rationaleProvider |
| `llm.call` | `libs/ai/gemini._generate_json` | purpose, provider, model, mode → fallbackReason (프롬프트·응답 본문은 기록하지 않음) |

`ceiling*`, `min*`, `policy*` 속성은 트레이서가 드롭하고 `redacted`에 키만 남긴다(비공개 협상 상태 보호).

**상관 id** — 미들웨어가 요청마다 trace를 바인딩(`X-Trace-Id`/`X-Request-Id` 재사용, 응답 `X-Trace-Id`), A2A 클라이언트가 `X-Trace-Id`/`X-Parent-Span-Id`를 보내므로 크리에이터 프로세스의 `creator.decide`가 브랜드의 `a2a.send` 아래에 붙는다.
`traceId`는 SSE `status`/`campaign_result`, `CampaignResult.traceId`, `BrandNegotiationResult.traceId`, `matchRuns/{id}.traceId`, API `meta.traceId`에 들어간다.

**보기**
```bash
# 로컬 데모 후 (scripts/local/a2a_multi_agent.sh 는 /tmp/knot-local/*.log 에 남긴다)
cd backend
python scripts/trace_tail.py /tmp/knot-local/brand-agent.log                       # 브랜드 쪽 트리
python scripts/trace_tail.py /tmp/knot-local/brand-agent.log /tmp/knot-local/creator-a.log   # 크리에이터 스팬까지 합친 트리
python scripts/trace_tail.py -f /tmp/knot-local/brand-agent.log                    # 따라가기
```
Cloud Run에서는 stderr의 JSON 라인이 Cloud Logging에 구조화되어 들어가므로 `jsonPayload.traceId="..."`로 필터하면 된다.

**설정**
| 환경 변수 | 기본 | 의미 |
|---|---|---|
| `KNOT_TRACING` | on | `0/false`면 스팬을 내보내지 않음(id 부착은 유지) |
| `KNOT_TRACING_SINK` | `log` (LangSmith 키가 있으면 `langsmith`) | `log` \| `langsmith` |
| `LANGSMITH_API_KEY` 또는 `LANGCHAIN_API_KEY` | — | 있으면 LangSmith 싱크 시도 |
| `LANGSMITH_PROJECT` 또는 `LANGCHAIN_PROJECT` | `knot-agent-ops` | LangSmith 프로젝트 |

**LangSmith 켜기**
```bash
pip install langsmith                 # 선택 의존성. 없으면 경고 1회 후 로그 싱크로 폴백
export LANGSMITH_API_KEY=ls_...
export LANGSMITH_PROJECT=knot-agent-ops
# (KNOT_TRACING_SINK 를 따로 줄 필요 없음 — 키가 있으면 langsmith 가 기본)
```
스팬은 `RunTree`로 미러링된다(`llm.*`→`llm`, `a2a.*`→`tool`, 나머지 `chain`). JSON 로그 라인은 그대로 함께 남는다. 프로세스 경계를 넘은 스팬(헤더로만 부모를 아는 경우)은 LangSmith에서 별도 trace로 보인다.

**코드에서 쓰기**
```python
from libs.observability.tracing import span, propagate_to_thread

with span("my.step", agreementId=agreement_id) as s:
    ...
    s.event("checkpoint", n=3)
    s.set(outcome="ok")

pool.map(propagate_to_thread(work), items)   # 워커 스레드가 현재 trace를 상속
```

---

## 개요 (원안)

LangSmith는 LangChain이 만든 **Agent Observability 플랫폼**입니다.

**주요 기능:**
- Agent 실행 추적 (입력/출력/토큰/비용)
- 에러 디버깅 (스택 트레이스)
- 성능 분석 (병목 구간 식별)
- 프롬프트 비교 (A/B 테스트)

---

## 설치 및 설정

### 1. LangSmith 계정 생성

1. https://smith.langchain.com/ 접속
2. 회원가입 (GitHub 계정 연동 가능)
3. API 키 생성: Settings → API Keys

### 2. 환경 변수 설정

```bash
# .env
LANGCHAIN_TRACING_V2=true
LANGCHAIN_ENDPOINT=https://api.smith.langchain.com
LANGCHAIN_API_KEY=ls_...  # 발급받은 API 키
LANGCHAIN_PROJECT=knot-agent-ops  # 프로젝트 이름
```

### 3. Python 패키지 설치

```bash
pip install langsmith langchain-core
```

---

## 기본 사용법

### @traceable 데코레이터

```python
# backend/libs/agent_ops/observability.py
from langsmith import traceable

@traceable(
    run_type="llm",  # "llm", "chain", "tool", "agent"
    name="BrandNegotiationAgent"
)
async def run_brand_agent(promotion: dict, creator: dict) -> dict:
    """
    LangSmith가 자동으로:
    1. 함수 시작/종료 시간 기록
    2. 입력 (promotion, creator) 저장
    3. 출력 (dict) 저장
    4. 에러 발생 시 스택 트레이스 기록
    """
    # Agent 로직
    result = await brand_agent.negotiate(promotion, creator)
    return result
```

### 수동 Trace 생성

```python
from langsmith import Client

client = Client()

# Trace 시작
with client.trace("negotiation_workflow") as trace:
    # Discovery Phase
    with trace.span("discovery", inputs={"budget": 1000000}):
        candidates = await discovery_agent.find_creators(budget=1000000)
        trace.log(outputs={"candidates": candidates})

    # Negotiation Phase
    with trace.span("negotiation", inputs={"creator": candidates[0]}):
        result = await brand_agent.negotiate(candidates[0])
        trace.log(outputs={"result": result})
```

---

## LangGraph 통합

LangGraph는 **자동으로 LangSmith와 통합**됩니다.

```python
# backend/libs/agents/orchestrator.py
from langgraph.graph import StateGraph
from langsmith import traceable

class NegotiationOrchestrator:
    def __init__(self):
        # StateGraph 정의
        workflow = StateGraph(NegotiationState)
        workflow.add_node("discovery", self.discovery_node)
        workflow.add_node("negotiate", self.negotiate_node)
        workflow.add_node("verify", self.verify_node)

        # 조건부 엣지
        workflow.add_conditional_edges(
            "negotiate",
            self.should_continue,
            {"continue": "negotiate", "accept": "verify", "reject": END}
        )

        self.graph = workflow.compile()

    @traceable(name="DiscoveryNode")
    async def discovery_node(self, state: NegotiationState):
        """Discovery Agent 실행 - LangSmith가 자동 추적"""
        candidates = await discovery_agent.run(state["promotion"])
        return {"candidates": candidates}

    @traceable(name="NegotiateNode")
    async def negotiate_node(self, state: NegotiationState):
        """Brand Agent 협상 - LangSmith가 자동 추적"""
        result = await brand_agent.run(state)
        return {"negotiation_result": result}

# 실행
orchestrator = NegotiationOrchestrator()
result = await orchestrator.graph.invoke({
    "promotion": {...},
    "candidates": []
})

# LangSmith 대시보드에서 전체 Graph 흐름 시각화됨!
```

---

## LangSmith 대시보드 활용

### 1. Trace 보기

**URL**: https://smith.langchain.com/projects/knot-agent-ops

**확인 가능한 정보**:
- 전체 실행 시간 (예: 3.2초)
- 각 단계별 소요 시간
  - Discovery: 0.8초
  - Negotiate Round 1: 1.2초
  - Negotiate Round 2: 1.0초
  - Verify: 0.2초
- LLM 호출 횟수 및 토큰 사용량
  - GPT-4: 2 calls, 1500 tokens, $0.045
  - Gemini: 3 calls, 2000 tokens, $0.006
- 입력/출력 데이터 전체

### 2. 에러 디버깅

**시나리오**: Brand Agent가 500 에러 발생

**LangSmith에서**:
1. 실패한 Trace 필터
2. 에러 메시지 확인: `ValueError: Budget exceeded`
3. 스택 트레이스 보기
4. 입력 데이터 확인: `{"budget": 5000000, "max_budget": 3000000}`
5. **원인 파악**: 예산 초과 검증 누락

### 3. 성능 분석

**질문**: "왜 협상이 5초나 걸리지?"

**LangSmith 분석**:
```
Total: 5.2초
├─ Discovery: 0.5초
├─ RAG Search: 3.8초 ← 병목!
├─ Negotiate: 0.7초
└─ Verify: 0.2초
```

**해결책**: RAG 캐싱 추가 → 3.8초 → 0.3초

### 4. A/B 테스트

**시나리오**: Gemini vs GPT-4 성능 비교

```python
# A 그룹: Gemini
@traceable(tags=["model:gemini", "experiment:ab-test"])
async def negotiate_gemini(state):
    return await gemini_agent.run(state)

# B 그룹: GPT-4
@traceable(tags=["model:gpt-4", "experiment:ab-test"])
async def negotiate_gpt4(state):
    return await gpt4_agent.run(state)
```

**LangSmith에서**:
- 태그 필터: `model:gemini`
- 메트릭 비교:
  - Gemini: 평균 1.2초, 성공률 85%, 비용 $0.01
  - GPT-4: 평균 2.5초, 성공률 92%, 비용 $0.08
- **결론**: 단순 협상은 Gemini, 복잡한 협상만 GPT-4

---

## Agent Ops 대시보드 구축

LangSmith API로 커스텀 대시보드를 만들 수 있습니다.

```python
# backend/libs/agent_ops/dashboard.py
from langsmith import Client
from datetime import datetime, timedelta

class AgentOpsDashboard:
    def __init__(self):
        self.client = Client()
        self.project_name = "knot-agent-ops"

    async def get_agent_metrics(
        self,
        agent_id: str,
        days: int = 7
    ) -> dict:
        """
        특정 Agent의 7일간 메트릭

        Returns:
            {
                "total_runs": 150,
                "success_rate": 0.92,
                "avg_latency": 2.3,
                "total_cost": 15.50,
                "error_types": {"ValueError": 5, "Timeout": 3}
            }
        """
        start_time = datetime.now() - timedelta(days=days)

        # LangSmith API로 runs 조회
        runs = self.client.list_runs(
            project_name=self.project_name,
            filter=f"name = '{agent_id}'",
            start_time=start_time
        )

        total = 0
        success = 0
        latencies = []
        costs = []
        errors = {}

        for run in runs:
            total += 1
            if run.status == "success":
                success += 1
            latencies.append(run.latency)
            costs.append(run.total_cost or 0)

            if run.error:
                error_type = type(run.error).__name__
                errors[error_type] = errors.get(error_type, 0) + 1

        return {
            "total_runs": total,
            "success_rate": success / total if total > 0 else 0,
            "avg_latency": sum(latencies) / len(latencies) if latencies else 0,
            "total_cost": sum(costs),
            "error_types": errors
        }

    async def get_bottlenecks(self) -> list[dict]:
        """
        느린 Agent/단계 식별

        Returns:
            [
                {"name": "RAG Search", "avg_latency": 3.8, "p95_latency": 5.2},
                {"name": "Brand Negotiate", "avg_latency": 2.1, "p95_latency": 3.5}
            ]
        """
        # LangSmith에서 모든 span 조회
        runs = self.client.list_runs(
            project_name=self.project_name,
            run_type="chain"
        )

        latencies_by_name = {}
        for run in runs:
            if run.name not in latencies_by_name:
                latencies_by_name[run.name] = []
            latencies_by_name[run.name].append(run.latency)

        # P95 계산
        bottlenecks = []
        for name, latencies in latencies_by_name.items():
            latencies.sort()
            p95_index = int(len(latencies) * 0.95)
            bottlenecks.append({
                "name": name,
                "avg_latency": sum(latencies) / len(latencies),
                "p95_latency": latencies[p95_index]
            })

        # P95 기준 정렬
        bottlenecks.sort(key=lambda x: x["p95_latency"], reverse=True)
        return bottlenecks[:10]  # Top 10

# FastAPI 라우트
@app.get("/api/v1/agent-ops/metrics/{agent_id}")
async def get_agent_metrics(agent_id: str, days: int = 7):
    dashboard = AgentOpsDashboard()
    return await dashboard.get_agent_metrics(agent_id, days)

@app.get("/api/v1/agent-ops/bottlenecks")
async def get_bottlenecks():
    dashboard = AgentOpsDashboard()
    return await dashboard.get_bottlenecks()
```

---

## 프로덕션 Best Practices

### 1. Sampling (샘플링)

**문제**: 모든 요청을 추적하면 비용 증가

**해결책**: 10% 샘플링

```python
import random

@traceable(
    run_type="agent",
    sample_rate=0.1  # 10%만 추적
)
async def run_agent(state):
    # 또는 수동으로
    if random.random() < 0.1:
        with client.trace("agent_run"):
            return await agent.run(state)
    else:
        return await agent.run(state)
```

### 2. 민감 정보 마스킹

```python
@traceable
async def run_agent(user_data: dict):
    # 민감 정보 마스킹
    safe_data = {
        **user_data,
        "email": "***@***",
        "phone": "***-****-****"
    }
    # LangSmith에는 safe_data만 기록됨
    return await agent.run(safe_data)
```

### 3. 환경별 프로젝트 분리

```bash
# 개발 환경
LANGCHAIN_PROJECT=knot-dev

# 스테이징 환경
LANGCHAIN_PROJECT=knot-staging

# 프로덕션 환경
LANGCHAIN_PROJECT=knot-production
```

---

## SKT 적용 시나리오

### 고객 상담 Agent 모니터링

```python
@traceable(tags=["service:customer-support", "channel:chat"])
async def handle_customer_inquiry(inquiry: str):
    # 1. 분류
    category = await classifier_agent.run(inquiry)

    # 2. 답변 생성
    answer = await answer_agent.run(inquiry, category)

    # 3. 만족도 예측
    satisfaction = await satisfaction_predictor.run(answer)

    return {"answer": answer, "satisfaction": satisfaction}

# LangSmith에서 확인 가능:
# - 평균 응답 시간
# - 카테고리별 성공률
# - 만족도 점수 분포
```

**대시보드 메트릭**:
- 평균 응답 시간: 1.5초
- 자동 해결률: 78%
- 상담원 에스컬레이션: 22%
- LLM 비용: 하루 $50

---

## 다음 단계

- [ ] LangSmith 계정 생성
- [ ] API 키 발급 및 환경 변수 설정
- [ ] 기존 Agent에 @traceable 적용
- [ ] 대시보드 메트릭 확인
- [ ] AI Governance 통합 (다음 문서)
