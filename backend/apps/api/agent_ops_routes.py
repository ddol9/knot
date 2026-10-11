"""Agent Ops API Routes - Agent 생명주기 관리 엔드포인트"""

from fastapi import APIRouter, HTTPException, status

from libs.agent_ops.registry import AgentRegistry, AgentSpec, AgentStatus
from libs.repositories.store import KnotRepository

router = APIRouter(prefix="/api/v1/agents", tags=["Agent Ops"])


def build_agent_ops_router(repository: KnotRepository) -> APIRouter:
    """Agent Ops 라우터 생성"""

    registry = AgentRegistry(repository.db)

    @router.post("/", response_model=AgentSpec, status_code=status.HTTP_201_CREATED)
    async def register_agent(spec: AgentSpec):
        """
        Agent 등록

        새로운 Agent 스펙을 등록합니다.

        - **agent_id**: 고유 ID (예: brand-negotiator)
        - **version**: 시맨틱 버저닝 (예: 2.1.0)
        - **role**: Agent 역할 (discovery, brand_negotiator 등)
        - **model_provider**: LLM provider (gemini, openai, anthropic)

        Returns:
            등록된 Agent 스펙
        """
        try:
            return await registry.register_agent(spec)
        except ValueError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    @router.get("/{agent_id}", response_model=AgentSpec)
    async def get_agent(agent_id: str, version: str | None = None):
        """
        Agent 조회

        Args:
            agent_id: Agent ID
            version: 버전 (생략 시 최신 배포된 버전)

        Returns:
            Agent 스펙
        """
        agent = await registry.get_agent(agent_id, version)
        if not agent:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Agent {agent_id} v{version or 'latest'} not found",
            )
        return agent

    @router.get("/", response_model=list[AgentSpec])
    async def list_agents(
        status_filter: AgentStatus | None = None, role: str | None = None
    ):
        """
        Agent 목록 조회

        Args:
            status_filter: 상태 필터 (draft, testing, deployed, deprecated)
            role: 역할 필터 (discovery, brand_negotiator 등)

        Returns:
            Agent 스펙 리스트
        """
        return await registry.list_agents(status=status_filter, role=role)

    @router.post("/{agent_id}/{version}/deploy", status_code=status.HTTP_200_OK)
    async def deploy_agent(agent_id: str, version: str):
        """
        Agent 배포 (Blue-Green)

        1. 새 버전을 DEPLOYED로 변경
        2. 기존 배포 버전을 DEPRECATED로 변경

        Args:
            agent_id: Agent ID
            version: 배포할 버전

        Returns:
            배포 결과
        """
        try:
            await registry.deploy_agent(agent_id, version)
            return {
                "status": "deployed",
                "agent_id": agent_id,
                "version": version,
                "message": f"Agent {agent_id} v{version} successfully deployed",
            }
        except RuntimeError as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e)
            )

    @router.post("/{agent_id}/{version}/rollback", status_code=status.HTTP_200_OK)
    async def rollback_agent(agent_id: str, failed_version: str):
        """
        Agent 롤백

        실패한 버전을 DRAFT로 변경하고,
        이전 DEPRECATED 버전을 다시 DEPLOYED로 복구합니다.

        Args:
            agent_id: Agent ID
            failed_version: 실패한 버전

        Returns:
            롤백 결과
        """
        try:
            await registry.rollback(agent_id, failed_version)
            return {
                "status": "rolled_back",
                "agent_id": agent_id,
                "failed_version": failed_version,
                "message": f"Agent {agent_id} rolled back from v{failed_version}",
            }
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e)
            )

    @router.patch("/{agent_id}/{version}/status", response_model=dict)
    async def update_agent_status(
        agent_id: str, version: str, new_status: AgentStatus
    ):
        """
        Agent 상태 수동 변경

        Args:
            agent_id: Agent ID
            version: 버전
            new_status: 새 상태

        Returns:
            업데이트 결과
        """
        try:
            await registry.update_status(agent_id, version, new_status)
            return {
                "status": "updated",
                "agent_id": agent_id,
                "version": version,
                "new_status": new_status.value,
            }
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e)
            )

    return router
