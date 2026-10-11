# KNOT → Agent Ops Platform 리팩토링 계획

> SKT AI/DX 직군 인터뷰 대비 - Agent 중심 플랫폼으로 전환

## 📋 목표

**현재 상태**: AI Agent가 브랜드-크리에이터 협상을 수행하는 서비스
**목표 상태**: **Agent Ops 플랫폼** - Agent 생명주기 관리, Multi LLM, MCP 기반 Data Engine 연동

### SKT JD 핵심 요구사항 매칭

| SKT 키워드 | 구현 계획 |
|-----------|----------|
| **Multi LLM·RAG·AI Governance·Agent Ops 기반 A.X Platform** | Agent Registry, LangSmith 모니터링, Governance Engine |
| **MCP 기반 AI Agent–Data Engine 연동** | MCP Server (Firestore, Instagram API, Payment) |
| **Multi LLM 기반 역할·Domain 특화 Agent Service** | LiteLLM Gateway로 Agent별 최적 모델 선택 |
| **LLM Workflow 개발** | LangGraph StateGraph 기반 협상 워크플로우 |
| **Spec Driven Development** | Pydantic 모델 + OpenAPI 자동 생성 |
| **Vector DB, RAG 파이프라인** | Firestore Vector Search + Pinecone Hybrid |

---

## 🏗️ 새로운 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                  Agent Ops Dashboard                         │
│         (배포, 모니터링, 버전 관리, 성능 분석, 거버넌스)       │
└────────────────────────┬────────────────────────────────────┘
                         │
        ┌────────────────┴────────────────┐
        ▼                                 ▼
┌──────────────────┐            ┌──────────────────┐
│  LangSmith       │            │  AI Governance   │
│  (Trace/Debug)   │            │  (정책 준수 감사) │
└──────────────────┘            └──────────────────┘
        │                                 │
        └────────────────┬────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              LangGraph Multi-Agent Orchestrator             │
└──────────────────────────┬──────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│ Discovery     │  │ Brand         │  │ Creator       │
│ Agent         │  │ Negotiator    │  │ Negotiator    │
│ (GPT-4)       │  │ (Gemini)      │  │ (Claude)      │
└───────┬───────┘  └───────┬───────┘  └───────┬───────┘
        │                  │                  │
        └──────────────────┼──────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    LiteLLM Gateway                          │
│           (Multi LLM 통합: Gemini, GPT-4, Claude)           │
└────────────────────────┬────────────────────────────────────┘
                         │
        ┌────────────────┴────────────────┐
        ▼                                 ▼
┌──────────────────┐            ┌──────────────────┐
│  MCP Servers     │            │  RAG Pipeline    │
│                  │            │                  │
│ • Firestore      │            │ • Hybrid Search  │
│ • Instagram API  │            │ • Reranking      │
│ • Payment API    │            │ • Caching        │
└──────────────────┘            └──────────────────┘
```

---

## 📅 Phase별 구현 계획 (총 4주)

### **Phase 1: Agent Ops 플랫폼 기반** ⭐⭐⭐ (1주)

**SKT 키워드**: Agent Ops, AI Governance, LangSmith

**구현 내용:**
1. **Agent Registry & Spec Management**
   ```python
   # backend/libs/agent_ops/registry.py
   class AgentSpec:
       agent_id: str
       version: str
       model_provider: str  # "gemini", "openai", "anthropic"
       tools: list[str]
       policy_constraints: dict
   ```

2. **LangSmith 통합 - 실시간 모니터링**
   - 모든 Agent 실행 추적 (입력/출력/토큰/비용)
   - 에러 패턴 분석
   - 병목 구간 식별

3. **AI Governance Engine**
   - 예산 초과 방지
   - 개인정보(PII) 노출 감지
   - 비정상 패턴 탐지
   - 고액 거래 사람 승인 필요

**결과물:**
- `backend/libs/agent_ops/` 모듈
- LangSmith 대시보드 설정
- Agent 배포 워크플로우 문서

---

### **Phase 2: MCP 기반 Data Engine 연동** ⭐⭐⭐ (1주)

**SKT 키워드**: MCP, Semantic Layer, Data Engine 연동

**구현 내용:**
1. **MCP Server 구현**
   ```python
   # backend/libs/mcp/firestore_server.py
   @Tool(name="query_creators")
   async def query_creators(category: str, min_followers: int):
       # Agent가 Firestore에 안전하게 접근
   ```

2. **Semantic Layer**
   - 복잡한 쿼리를 비즈니스 메트릭으로 추상화
   - Agent가 "creator_engagement_rate" 같은 메트릭 직접 요청 가능

3. **통합 Data Sources**
   - Firestore (협상 히스토리, 크리에이터 DB)
   - Instagram Graph API (실시간 팔로워, 콘텐츠)
   - Payment API (정산 상태)

**결과물:**
- `backend/libs/mcp/` 모듈
- MCP Server 3개 (Firestore, Instagram, Payment)
- Semantic Layer 메트릭 정의

---

### **Phase 3: Multi LLM 지원** ⭐⭐⭐ (1주)

**SKT 키워드**: Multi LLM, Domain 특화 Agent

**구현 내용:**
1. **LiteLLM Gateway**
   ```python
   model_mapping = {
       "discovery": "gpt-4o",           # 복잡한 검색
       "brand": "gemini-2.0-flash",     # 빠른 협상
       "creator": "claude-3-5-sonnet",  # 정확한 평가
       "verification": "gemini-vision"  # 멀티모달
   }
   ```

2. **Fallback & Load Balancing**
   - 1차 모델 실패 시 자동 백업 모델 사용
   - Rate limit 회피

3. **Cost Optimization**
   - Agent별 최적 모델 선택으로 비용 50% 절감

**결과물:**
- `backend/libs/llm/gateway.py`
- 모델별 성능/비용 분석 문서

---

### **Phase 4: RAG + Vector DB** ⭐⭐ (1주)

**SKT 키워드**: RAG, Vector DB, 대용량 데이터 처리

**구현 내용:**
1. **Hybrid Vector Search**
   - Firestore: 메타데이터 필터 (날짜, 카테고리)
   - Pinecone: 벡터 검색 (의미적 유사성)

2. **Reranking + Caching**
   - Gemini로 검색 결과 재평가
   - Redis 캐싱으로 응답 속도 10배 개선

3. **Negotiation Memory**
   - 과거 협상 임베딩 → 유사 케이스 자동 검색
   - Agent가 과거 패턴 학습

**결과물:**
- `backend/libs/rag/` 모듈
- Pinecone 인덱스 설정
- RAG 성능 벤치마크

---

### **Phase 5: Spec Driven Development** (병행)

**SKT 키워드**: Spec Driven Development, OpenAPI

**구현 내용:**
1. **Pydantic 모델 정의**
   ```python
   class NegotiationInput(BaseModel):
       promotion_id: str
       creator_id: str
       initial_offer: int
   ```

2. **FastAPI 자동 검증 & 문서화**
   - OpenAPI 3.0 스펙 자동 생성
   - Swagger UI 자동 생성

**결과물:**
- `backend/libs/specs/` 모듈
- OpenAPI 스펙 파일

---

## 🎯 SKT 면접 데모 시나리오

### "완전 자율 Multi-Agent 협상 플랫폼"

```
1. Agent Ops Dashboard
   → "Brand Negotiation Agent v2.1" 배포
   → LangSmith 실시간 추적 시작

2. Discovery Agent (GPT-4)
   → MCP Firestore로 크리에이터 검색
   → Instagram API 호출 (팔로워 확인)
   → Pinecone 유사 프로필 검색
   → 상위 3명 추천

3. Brand Agent (Gemini)
   → RAG로 과거 협상 검색
   → 첫 제안 생성
   → AI Governance 검증 통과

4. Creator Agent (Claude)
   → Policy 체크
   → Counter offer 생성
   → LangGraph 상태 전이

5. Verification Agent (Gemini Vision)
   → Instagram MCP로 콘텐츠 가져오기
   → 멀티모달 분석
   → 자동 승인

6. Payment 자동 정산
   → 전 과정 LangSmith에 기록
```

---

## 💡 기술 의사결정 근거

### LangGraph vs AutoGen vs CrewAI
- **선택**: LangGraph
- **이유**: 협상은 복잡한 조건부 분기 → 명시적 상태 관리 필요
- **Trade-off**: 학습 곡선 있지만 LangSmith 통합, deterministic 로직 분리 가능

### MCP 사용 이유
- **표준화**: Anthropic 표준, Agent-Data 통신 표준화
- **보안**: MCP 레벨 권한 관리 + 감사 로그
- **확장성**: 새 데이터 소스 추가 시 MCP Server만 구현

### Multi LLM 전략
- **Discovery**: GPT-4 (추론 능력)
- **Brand**: Gemini (빠른 응답, 비용 효율)
- **Creator**: Claude (미묘한 뉘앙스 이해)
- **Verification**: Gemini Vision (멀티모달)

### RAG vs Fine-tuning
- **선택**: RAG
- **이유**: 협상 데이터가 매일 쌓임 → 실시간 반영 필요
- **Trade-off**: 추론 시 검색 비용 vs Fine-tuning 재학습 비용

---

## 📊 성공 지표

| 메트릭 | 현재 | 목표 |
|--------|------|------|
| Agent 배포 시간 | 수동 (1시간) | 자동 (5분) |
| 협상 성공률 | 알 수 없음 | LangSmith로 추적 |
| LLM 비용 | 100% | 50% (최적 모델 선택) |
| 응답 속도 | 5초 | 2초 (RAG 캐싱) |
| 에러율 | 알 수 없음 | <1% (Governance) |

---

## 📚 참고 자료

- [LangGraph 공식 문서](https://langchain-ai.github.io/langgraph/)
- [MCP 프로토콜 스펙](https://modelcontextprotocol.io/)
- [LangSmith Tracing](https://docs.smith.langchain.com/)
- [LiteLLM Proxy](https://docs.litellm.ai/)
- [Firestore Vector Search](https://cloud.google.com/firestore/docs/vector-search)

---

## 🚀 다음 단계

1. ✅ 레포지토리 세팅 (origin → ddol9/knot)
2. ⏳ Phase 1: Agent Ops 기반 구축
3. ⏳ Phase 2: MCP 연동
4. ⏳ Phase 3: Multi LLM
5. ⏳ Phase 4: RAG Pipeline

**시작일**: 2026-10-12
**목표 완료일**: 2026-11-09 (4주)
