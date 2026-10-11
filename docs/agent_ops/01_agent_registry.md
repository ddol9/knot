# Agent Registry - Agent 생명주기 관리

> Agent를 서비스가 아닌 **관리 대상**으로

---

## 개요

Agent Registry는 KNOT 플랫폼의 모든 Agent를 중앙에서 관리하는 시스템입니다.

**주요 기능:**
- Agent 등록 및 스펙 정의
- 버전 관리 및 배포
- 상태 모니터링
- 롤백 및 복구

---

## Agent Spec 정의

모든 Agent는 **Spec Driven**으로 정의됩니다.

```python
# backend/libs/agent_ops/registry.py
from pydantic import BaseModel, Field
from enum import Enum

class AgentStatus(str, Enum):
    DRAFT = "draft"              # 개발 중
    TESTING = "testing"          # 테스트 중
    DEPLOYED = "deployed"        # 배포됨
    DEPRECATED = "deprecated"    # 사용 중단

class AgentSpec(BaseModel):
    """Agent 명세 - 코드보다 스펙이 먼저"""

    # 기본 정보
    agent_id: str = Field(..., description="Agent 고유 ID")
    name: str = Field(..., description="Agent 이름")
    version: str = Field(..., description="시맨틱 버저닝 (e.g., 2.1.0)")
    description: str = Field(..., description="Agent 설명")

    # 역할 정의
    role: str = Field(..., description="Agent 역할 (discovery, brand, creator 등)")

    # LLM 설정
    model_provider: str = Field(..., description="LLM provider (gemini, openai, anthropic)")
    model_name: str = Field(..., description="구체적 모델명 (gemini-2.0-flash, gpt-4o 등)")
    temperature: float = Field(0.7, ge=0.0, le=2.0)
    max_tokens: int = Field(2048, gt=0)

    # 도구 목록
    tools: list[str] = Field(
        default=[],
        description="Agent가 사용할 도구 목록 (MCP 도구 이름)"
    )

    # 정책 제약
    policy_constraints: dict = Field(
        default={},
        description="Agent 행동 제약 (예: max_budget, allowed_categories)"
    )

    # 모니터링 설정
    trace_enabled: bool = Field(True, description="LangSmith 추적 활성화")
    metrics_enabled: bool = Field(True, description="메트릭 수집 활성화")

    # 거버넌스
    approval_required: bool = Field(
        False,
        description="사람 승인 필요 여부 (고액 거래 등)"
    )
    audit_log_enabled: bool = Field(True, description="감사 로그 활성화")

    # 상태
    status: AgentStatus = Field(default=AgentStatus.DRAFT)

    # 메타데이터
    created_at: str | None = None
    updated_at: str | None = None
    created_by: str | None = None

# 예시: Brand Negotiation Agent 스펙
brand_agent_spec = AgentSpec(
    agent_id="brand-negotiator",
    name="Brand Negotiation Agent",
    version="2.1.0",
    description="브랜드를 대신해 크리에이터와 협상을 진행하는 Agent",
    role="brand_negotiator",
    model_provider="gemini",
    model_name="gemini-2.0-flash",
    temperature=0.7,
    max_tokens=2048,
    tools=["query_creators", "get_negotiation_history", "calculate_budget"],
    policy_constraints={
        "max_budget_per_deal": 5000000,  # 500만원
        "max_rounds": 5,
        "allowed_categories": ["beauty", "fashion", "tech"]
    },
    approval_required=True,  # 100만원 이상은 승인 필요
    status=AgentStatus.DEPLOYED
)
```

---

## Agent Registry 클래스

```python
# backend/libs/agent_ops/registry.py
from google.cloud import firestore
from typing import Optional

class AgentRegistry:
    """Agent 등록 및 생명주기 관리"""

    def __init__(self, db: firestore.Client):
        self.db = db
        self.collection = "agent_registry"

    async def register_agent(self, spec: AgentSpec) -> AgentSpec:
        """
        새 Agent 등록

        Args:
            spec: Agent 명세

        Returns:
            등록된 Agent 스펙 (created_at 등 추가된 상태)
        """
        # 중복 체크
        existing = await self.get_agent(spec.agent_id, spec.version)
        if existing:
            raise ValueError(f"Agent {spec.agent_id} v{spec.version} already exists")

        # 타임스탬프 추가
        spec.created_at = firestore.SERVER_TIMESTAMP
        spec.updated_at = firestore.SERVER_TIMESTAMP

        # Firestore에 저장
        doc_id = f"{spec.agent_id}_{spec.version}"
        await self.db.collection(self.collection).document(doc_id).set(
            spec.model_dump(exclude_none=True)
        )

        return spec

    async def get_agent(
        self,
        agent_id: str,
        version: Optional[str] = None
    ) -> Optional[AgentSpec]:
        """
        Agent 조회

        Args:
            agent_id: Agent ID
            version: 버전 (None이면 최신 배포된 버전)

        Returns:
            Agent 스펙 또는 None
        """
        if version:
            doc_id = f"{agent_id}_{version}"
            doc = await self.db.collection(self.collection).document(doc_id).get()
            if doc.exists:
                return AgentSpec(**doc.to_dict())
            return None

        # 최신 배포된 버전 찾기
        docs = self.db.collection(self.collection) \
            .where("agent_id", "==", agent_id) \
            .where("status", "==", AgentStatus.DEPLOYED) \
            .order_by("created_at", direction=firestore.Query.DESCENDING) \
            .limit(1) \
            .stream()

        for doc in docs:
            return AgentSpec(**doc.to_dict())

        return None

    async def list_agents(
        self,
        status: Optional[AgentStatus] = None,
        role: Optional[str] = None
    ) -> list[AgentSpec]:
        """
        Agent 목록 조회

        Args:
            status: 상태 필터 (None이면 전체)
            role: 역할 필터 (None이면 전체)

        Returns:
            Agent 스펙 리스트
        """
        query = self.db.collection(self.collection)

        if status:
            query = query.where("status", "==", status)

        if role:
            query = query.where("role", "==", role)

        docs = query.stream()
        return [AgentSpec(**doc.to_dict()) for doc in docs]

    async def update_status(
        self,
        agent_id: str,
        version: str,
        new_status: AgentStatus
    ):
        """Agent 상태 변경"""
        doc_id = f"{agent_id}_{version}"
        await self.db.collection(self.collection).document(doc_id).update({
            "status": new_status,
            "updated_at": firestore.SERVER_TIMESTAMP
        })

    async def deploy_agent(
        self,
        agent_id: str,
        version: str
    ):
        """
        Agent 배포 (Blue-Green)

        1. 새 버전 상태를 DEPLOYED로 변경
        2. 기존 배포된 버전을 DEPRECATED로 변경
        3. Health check (실제 Agent 실행 테스트)
        4. 실패 시 롤백
        """
        # 1. 새 버전 배포
        await self.update_status(agent_id, version, AgentStatus.DEPLOYED)

        # 2. 기존 버전 deprecated
        old_agents = await self.list_agents(
            status=AgentStatus.DEPLOYED,
            role=None  # 모든 역할
        )
        for old_agent in old_agents:
            if old_agent.agent_id == agent_id and old_agent.version != version:
                await self.update_status(
                    old_agent.agent_id,
                    old_agent.version,
                    AgentStatus.DEPRECATED
                )

        # 3. Health check (TODO: 실제 Agent 실행 테스트)
        # health_ok = await self._health_check(agent_id, version)
        # if not health_ok:
        #     await self.rollback(agent_id, version)
        #     raise RuntimeError("Health check failed")

    async def rollback(self, agent_id: str, failed_version: str):
        """
        배포 실패 시 롤백

        1. 실패한 버전을 DRAFT로 변경
        2. 이전 DEPRECATED 버전을 다시 DEPLOYED로 변경
        """
        # 실패한 버전 DRAFT로
        await self.update_status(agent_id, failed_version, AgentStatus.DRAFT)

        # 최근 deprecated 버전 찾기
        docs = self.db.collection(self.collection) \
            .where("agent_id", "==", agent_id) \
            .where("status", "==", AgentStatus.DEPRECATED) \
            .order_by("updated_at", direction=firestore.Query.DESCENDING) \
            .limit(1) \
            .stream()

        for doc in docs:
            old_spec = AgentSpec(**doc.to_dict())
            await self.update_status(
                old_spec.agent_id,
                old_spec.version,
                AgentStatus.DEPLOYED
            )
```

---

## FastAPI 라우트

```python
# backend/apps/api/routes.py
from fastapi import APIRouter, HTTPException
from libs.agent_ops.registry import AgentRegistry, AgentSpec

router = APIRouter(prefix="/api/v1/agents", tags=["Agent Ops"])

@router.post("/", response_model=AgentSpec)
async def register_agent(spec: AgentSpec):
    """Agent 등록"""
    registry = AgentRegistry(firestore_client)
    try:
        return await registry.register_agent(spec)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/{agent_id}", response_model=AgentSpec)
async def get_agent(agent_id: str, version: str | None = None):
    """Agent 조회"""
    registry = AgentRegistry(firestore_client)
    agent = await registry.get_agent(agent_id, version)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    return agent

@router.get("/", response_model=list[AgentSpec])
async def list_agents(
    status: AgentStatus | None = None,
    role: str | None = None
):
    """Agent 목록"""
    registry = AgentRegistry(firestore_client)
    return await registry.list_agents(status, role)

@router.post("/{agent_id}/{version}/deploy")
async def deploy_agent(agent_id: str, version: str):
    """Agent 배포"""
    registry = AgentRegistry(firestore_client)
    try:
        await registry.deploy_agent(agent_id, version)
        return {"status": "deployed", "agent_id": agent_id, "version": version}
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
```

---

## 사용 예시

```python
# 1. Agent 스펙 정의
spec = AgentSpec(
    agent_id="discovery-agent",
    name="Creator Discovery Agent",
    version="1.0.0",
    role="discovery",
    model_provider="openai",
    model_name="gpt-4o",
    tools=["search_instagram", "query_firestore"],
    policy_constraints={"max_search_results": 50}
)

# 2. 등록
registry = AgentRegistry(firestore_client)
await registry.register_agent(spec)

# 3. 배포
await registry.deploy_agent("discovery-agent", "1.0.0")

# 4. 조회 (최신 배포된 버전)
active_agent = await registry.get_agent("discovery-agent")
print(f"Active version: {active_agent.version}")

# 5. 모든 활성 Agent 조회
active_agents = await registry.list_agents(status=AgentStatus.DEPLOYED)
for agent in active_agents:
    print(f"{agent.name} v{agent.version} ({agent.model_name})")
```

---

## SKT 적용 시나리오

### 1. 고객 상담 Agent 관리

```python
# 문의 분류 Agent
classifier_spec = AgentSpec(
    agent_id="customer-inquiry-classifier",
    role="classifier",
    model_provider="gemini",
    model_name="gemini-2.0-flash",
    tools=["query_faq_db", "search_knowledge_base"]
)

# 답변 생성 Agent
answer_spec = AgentSpec(
    agent_id="customer-answer-generator",
    role="answer_generator",
    model_provider="openai",
    model_name="gpt-4o",
    tools=["get_customer_history", "query_product_catalog"],
    approval_required=True  # 복잡한 답변은 상담원 검토
)

# 등록 및 배포
await registry.register_agent(classifier_spec)
await registry.register_agent(answer_spec)
await registry.deploy_agent("customer-inquiry-classifier", "1.0.0")
await registry.deploy_agent("customer-answer-generator", "1.0.0")
```

### 2. A/B 테스트

```python
# 버전 A: Gemini 사용
await registry.deploy_agent("brand-negotiator", "2.0.0")  # Gemini

# 버전 B: Claude 사용
await registry.deploy_agent("brand-negotiator", "2.1.0")  # Claude

# 트래픽 50:50 분배
# LangSmith로 성능 비교 후 최종 버전 선택
```

---

## 다음 단계

- [ ] Agent Registry 구현
- [ ] FastAPI 라우트 추가
- [ ] Firestore 인덱스 설정
- [ ] LangSmith 통합 (다음 문서)
