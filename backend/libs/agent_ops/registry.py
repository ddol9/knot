"""Agent Registry - Agent 등록 및 생명주기 관리"""

from datetime import datetime
from enum import Enum
from typing import Optional

from google.cloud import firestore
from pydantic import BaseModel, Field


class AgentStatus(str, Enum):
    """Agent 상태"""

    DRAFT = "draft"  # 개발 중
    TESTING = "testing"  # 테스트 중
    DEPLOYED = "deployed"  # 배포됨
    DEPRECATED = "deprecated"  # 사용 중단


class AgentSpec(BaseModel):
    """
    Agent 명세 - Spec Driven Development

    모든 Agent는 코드보다 스펙이 먼저 정의됩니다.
    """

    # 기본 정보
    agent_id: str = Field(..., description="Agent 고유 ID (예: brand-negotiator)")
    name: str = Field(..., description="Agent 이름 (예: Brand Negotiation Agent)")
    version: str = Field(..., description="시맨틱 버저닝 (예: 2.1.0)")
    description: str = Field(..., description="Agent 설명")

    # 역할 정의
    role: str = Field(
        ..., description="Agent 역할 (discovery, brand_negotiator, creator_negotiator 등)"
    )

    # LLM 설정
    model_provider: str = Field(..., description="LLM provider (gemini, openai, anthropic)")
    model_name: str = Field(..., description="구체적 모델명 (gemini-2.0-flash, gpt-4o 등)")
    temperature: float = Field(0.7, ge=0.0, le=2.0, description="Temperature (0.0-2.0)")
    max_tokens: int = Field(2048, gt=0, description="최대 토큰 수")

    # 도구 목록
    tools: list[str] = Field(default=[], description="Agent가 사용할 도구 목록 (MCP 도구 이름)")

    # 정책 제약
    policy_constraints: dict = Field(
        default={}, description="Agent 행동 제약 (예: max_budget, allowed_categories)"
    )

    # 모니터링 설정
    trace_enabled: bool = Field(True, description="LangSmith 추적 활성화")
    metrics_enabled: bool = Field(True, description="메트릭 수집 활성화")

    # 거버넌스
    approval_required: bool = Field(
        False, description="사람 승인 필요 여부 (고액 거래 등)"
    )
    audit_log_enabled: bool = Field(True, description="감사 로그 활성화")

    # 상태
    status: AgentStatus = Field(default=AgentStatus.DRAFT, description="Agent 상태")

    # 메타데이터
    created_at: Optional[datetime] = Field(None, description="생성 시각")
    updated_at: Optional[datetime] = Field(None, description="수정 시각")
    created_by: Optional[str] = Field(None, description="생성자")

    class Config:
        use_enum_values = True


class AgentRegistry:
    """
    Agent 등록 및 생명주기 관리

    - Agent 등록 및 조회
    - 버전 관리
    - 배포 (Blue-Green)
    - 롤백
    """

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

        Raises:
            ValueError: 중복된 Agent ID + version
        """
        # 중복 체크
        existing = await self.get_agent(spec.agent_id, spec.version)
        if existing:
            raise ValueError(f"Agent {spec.agent_id} v{spec.version} already exists")

        # 타임스탬프 추가
        now = datetime.utcnow()
        spec.created_at = now
        spec.updated_at = now

        # Firestore에 저장
        doc_id = f"{spec.agent_id}_{spec.version}"
        self.db.collection(self.collection).document(doc_id).set(
            spec.model_dump(exclude_none=True, mode="json")
        )

        return spec

    async def get_agent(
        self, agent_id: str, version: Optional[str] = None
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
            # 특정 버전 조회
            doc_id = f"{agent_id}_{version}"
            doc = self.db.collection(self.collection).document(doc_id).get()
            if doc.exists:
                return AgentSpec(**doc.to_dict())
            return None

        # 최신 배포된 버전 찾기
        docs = (
            self.db.collection(self.collection)
            .where("agent_id", "==", agent_id)
            .where("status", "==", AgentStatus.DEPLOYED.value)
            .order_by("created_at", direction=firestore.Query.DESCENDING)
            .limit(1)
            .stream()
        )

        for doc in docs:
            return AgentSpec(**doc.to_dict())

        return None

    async def list_agents(
        self, status: Optional[AgentStatus] = None, role: Optional[str] = None
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
            query = query.where("status", "==", status.value)

        if role:
            query = query.where("role", "==", role)

        docs = query.stream()
        return [AgentSpec(**doc.to_dict()) for doc in docs]

    async def update_status(
        self, agent_id: str, version: str, new_status: AgentStatus
    ) -> None:
        """
        Agent 상태 변경

        Args:
            agent_id: Agent ID
            version: 버전
            new_status: 새 상태
        """
        doc_id = f"{agent_id}_{version}"
        self.db.collection(self.collection).document(doc_id).update(
            {"status": new_status.value, "updated_at": datetime.utcnow()}
        )

    async def deploy_agent(self, agent_id: str, version: str) -> None:
        """
        Agent 배포 (Blue-Green)

        1. 새 버전 상태를 DEPLOYED로 변경
        2. 기존 배포된 버전을 DEPRECATED로 변경
        3. Health check (TODO)
        4. 실패 시 롤백

        Args:
            agent_id: Agent ID
            version: 배포할 버전

        Raises:
            RuntimeError: Health check 실패
        """
        # 1. 새 버전 배포
        await self.update_status(agent_id, version, AgentStatus.DEPLOYED)

        # 2. 기존 버전 deprecated
        old_agents = await self.list_agents(status=None, role=None)
        for old_agent in old_agents:
            if (
                old_agent.agent_id == agent_id
                and old_agent.version != version
                and old_agent.status == AgentStatus.DEPLOYED
            ):
                await self.update_status(
                    old_agent.agent_id, old_agent.version, AgentStatus.DEPRECATED
                )

        # 3. Health check (TODO: 실제 Agent 실행 테스트)
        # health_ok = await self._health_check(agent_id, version)
        # if not health_ok:
        #     await self.rollback(agent_id, version)
        #     raise RuntimeError("Health check failed")

    async def rollback(self, agent_id: str, failed_version: str) -> None:
        """
        배포 실패 시 롤백

        1. 실패한 버전을 DRAFT로 변경
        2. 이전 DEPRECATED 버전을 다시 DEPLOYED로 변경

        Args:
            agent_id: Agent ID
            failed_version: 실패한 버전
        """
        # 실패한 버전 DRAFT로
        await self.update_status(agent_id, failed_version, AgentStatus.DRAFT)

        # 최근 deprecated 버전 찾기
        docs = (
            self.db.collection(self.collection)
            .where("agent_id", "==", agent_id)
            .where("status", "==", AgentStatus.DEPRECATED.value)
            .order_by("updated_at", direction=firestore.Query.DESCENDING)
            .limit(1)
            .stream()
        )

        for doc in docs:
            old_spec = AgentSpec(**doc.to_dict())
            await self.update_status(
                old_spec.agent_id, old_spec.version, AgentStatus.DEPLOYED
            )
