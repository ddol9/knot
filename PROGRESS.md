# 리팩토링 진행 상황

> 실시간 업데이트 - 마지막 수정: 2026-10-12

---

## 📊 전체 진행률: 5%

```
[██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 5%

Phase 1: Agent Ops     [░░░░░░░░░░] 0%
Phase 2: MCP           [░░░░░░░░░░] 0%
Phase 3: Multi LLM     [░░░░░░░░░░] 0%
Phase 4: RAG Pipeline  [░░░░░░░░░░] 0%
Phase 5: Spec Driven   [░░░░░░░░░░] 0%
```

---

## ✅ 완료된 작업

### 2026-10-12
- [x] SKT JD 분석 및 핵심 키워드 추출
- [x] Agent Ops 플랫폼 아키텍처 설계
- [x] MCP 기반 Data Engine 연동 설계
- [x] Multi LLM 지원 아키텍처 설계
- [x] 리팩토링 계획 문서화 (REFACTORING_PLAN.md)
- [x] Git 레포지토리 세팅 (origin → ddol9/knot)
- [x] 진행상황 추적 문서 생성 (PROGRESS.md)

---

## 🚧 진행 중

### Phase 1: Agent Ops 플랫폼 기반 (0%)

**목표**: Agent 생명주기 관리 + LangSmith + Governance

#### 1.1 Agent Registry
- [ ] `backend/libs/agent_ops/registry.py` 생성
- [ ] `AgentSpec` Pydantic 모델 정의
- [ ] Agent 등록/조회/배포 API 구현
- [ ] Firestore에 Agent 메타데이터 저장

#### 1.2 LangSmith 통합
- [ ] LangSmith API 키 설정
- [ ] `@traceable` 데코레이터 적용
- [ ] Agent 실행 추적 테스트
- [ ] 대시보드 설정 문서 작성

#### 1.3 AI Governance Engine
- [ ] `backend/libs/agent_ops/governance.py` 생성
- [ ] 예산 초과 검증 로직
- [ ] PII 노출 감지 (Gemini)
- [ ] 감사 로그 Firestore 저장

**예상 완료일**: 2026-10-19

---

## 📋 대기 중

### Phase 2: MCP 기반 Data Engine 연동 (0%)
**예상 시작일**: 2026-10-19

- [ ] MCP Firestore Server 구현
- [ ] MCP Instagram API Server 구현
- [ ] Semantic Layer 메트릭 정의
- [ ] Agent와 MCP 통합 테스트

### Phase 3: Multi LLM 지원 (0%)
**예상 시작일**: 2026-10-26

- [ ] LiteLLM 설치 및 설정
- [ ] Multi LLM Gateway 구현
- [ ] Agent별 최적 모델 매핑
- [ ] Fallback 로직 구현
- [ ] 비용/성능 벤치마크

### Phase 4: RAG + Vector DB (0%)
**예상 시작일**: 2026-11-02

- [ ] Pinecone 계정 생성 및 인덱스 설정
- [ ] Hybrid Search 구현
- [ ] Reranking 로직 구현
- [ ] Redis 캐싱 통합
- [ ] Negotiation Memory 구현

### Phase 5: Spec Driven Development (병행)
**예상 시작일**: 각 Phase와 병행

- [ ] Pydantic 모델 정의 (Phase별)
- [ ] FastAPI OpenAPI 스펙 생성
- [ ] Swagger UI 설정

---

## 🐛 이슈 & 블로커

### 현재 이슈
*현재 이슈 없음*

### 해결된 이슈
*해결된 이슈 없음*

---

## 💡 학습 노트

### 2026-10-12: LangGraph vs AutoGen
**학습 내용:**
- LangGraph는 StateGraph로 명시적 상태 관리
- AutoGen은 자율 대화에 강하지만 deterministic 로직 통합 어려움
- 협상 워크플로우는 조건부 분기 많음 → LangGraph 적합

**참고 자료:**
- [LangGraph Conceptual Guide](https://langchain-ai.github.io/langgraph/concepts/)
- [AutoGen vs LangGraph 비교](https://blog.langchain.dev/langgraph-vs-autogen/)

### 2026-10-12: MCP 프로토콜 이해
**학습 내용:**
- MCP = Model Context Protocol (Anthropic 제안)
- Agent가 외부 데이터 소스에 안전하게 접근하는 표준
- Tool 형태로 정의하면 LangChain과 바로 통합 가능

**참고 자료:**
- [MCP 공식 스펙](https://modelcontextprotocol.io/introduction)
- [MCP Python SDK](https://github.com/modelcontextprotocol/python-sdk)

---

## 📈 다음 주 계획 (2026-10-13 ~ 2026-10-19)

### Phase 1: Agent Ops 집중 구현

**월요일 (10/13)**
- [ ] Agent Registry 모듈 생성
- [ ] AgentSpec 모델 정의
- [ ] Firestore 스키마 설계

**화요일 (10/14)**
- [ ] Agent 등록 API 구현
- [ ] Agent 조회 API 구현
- [ ] 단위 테스트 작성

**수요일 (10/15)**
- [ ] LangSmith 계정 생성
- [ ] API 키 설정
- [ ] 기존 Agent에 @traceable 적용

**목요일 (10/16)**
- [ ] AI Governance Engine 뼈대 구현
- [ ] 예산 초과 검증 로직
- [ ] 테스트 케이스 작성

**금요일 (10/17)**
- [ ] PII 감지 로직 (Gemini 사용)
- [ ] 감사 로그 저장
- [ ] 통합 테스트

**주말 (10/18-19)**
- [ ] Phase 1 문서 작성
- [ ] 코드 리뷰 및 리팩토링
- [ ] Phase 2 준비

---

## 🎯 마일스톤

- [ ] **M1**: Agent Ops 기반 완성 (2026-10-19)
- [ ] **M2**: MCP 연동 완료 (2026-10-26)
- [ ] **M3**: Multi LLM 전환 (2026-11-02)
- [ ] **M4**: RAG 파이프라인 가동 (2026-11-09)
- [ ] **M5**: SKT 데모 준비 완료 (2026-11-16)

---

## 📝 메모

### 기술 스택 최종 확정
- **Backend**: FastAPI, Python 3.12
- **LLM**: Gemini 2.0, GPT-4o, Claude 3.5 (LiteLLM으로 통합)
- **Agent Framework**: LangGraph, LangChain
- **Observability**: LangSmith
- **Vector DB**: Firestore Vector Search (1차), Pinecone (2차)
- **MCP**: Anthropic MCP Python SDK
- **Database**: Firestore
- **Cache**: Redis

### SKT 면접 대비 포인트
1. **Agent Ops**: "Agent를 서비스가 아닌 관리 대상으로"
2. **Multi LLM**: "역할별 최적 모델 선택으로 비용 50% 절감"
3. **MCP**: "Anthropic 표준으로 Agent-Data 안전한 연동"
4. **Spec Driven**: "Pydantic으로 코드보다 스펙이 먼저"
5. **Governance**: "자율 Agent이지만 모든 결정은 정책 검증 통과"

---

*이 문서는 매일 업데이트됩니다.*
