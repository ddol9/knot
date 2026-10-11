"""Agent Registry 테스트"""

import pytest
from datetime import datetime
from unittest.mock import MagicMock, AsyncMock
from google.cloud import firestore

from libs.agent_ops.registry import AgentRegistry, AgentSpec, AgentStatus


@pytest.fixture
def mock_firestore():
    """Firestore 클라이언트 mock"""
    return MagicMock(spec=firestore.Client)


@pytest.fixture
def agent_registry(mock_firestore):
    """AgentRegistry 인스턴스"""
    return AgentRegistry(mock_firestore)


@pytest.fixture
def sample_agent_spec():
    """테스트용 Agent 스펙"""
    return AgentSpec(
        agent_id="test-agent",
        name="Test Agent",
        version="1.0.0",
        description="Test agent for unit testing",
        role="tester",
        model_provider="gemini",
        model_name="gemini-2.0-flash",
        temperature=0.7,
        max_tokens=2048,
        tools=["tool1", "tool2"],
        policy_constraints={"max_budget": 1000000},
        status=AgentStatus.DRAFT,
    )


class TestAgentSpec:
    """AgentSpec Pydantic 모델 테스트"""

    def test_agent_spec_creation(self, sample_agent_spec):
        """Agent 스펙 생성 테스트"""
        assert sample_agent_spec.agent_id == "test-agent"
        assert sample_agent_spec.version == "1.0.0"
        assert sample_agent_spec.status == AgentStatus.DRAFT
        assert sample_agent_spec.temperature == 0.7

    def test_agent_spec_defaults(self):
        """기본값 테스트"""
        minimal_spec = AgentSpec(
            agent_id="minimal",
            name="Minimal Agent",
            version="1.0.0",
            description="Minimal spec",
            role="test",
            model_provider="gemini",
            model_name="gemini-2.0-flash",
        )
        assert minimal_spec.tools == []
        assert minimal_spec.policy_constraints == {}
        assert minimal_spec.trace_enabled is True
        assert minimal_spec.status == AgentStatus.DRAFT

    def test_agent_spec_validation(self):
        """유효성 검증 테스트"""
        # Temperature 범위 벗어남
        with pytest.raises(ValueError):
            AgentSpec(
                agent_id="invalid",
                name="Invalid",
                version="1.0.0",
                description="Invalid temp",
                role="test",
                model_provider="gemini",
                model_name="gemini-2.0-flash",
                temperature=3.0,  # 2.0 초과
            )

        # max_tokens 음수
        with pytest.raises(ValueError):
            AgentSpec(
                agent_id="invalid",
                name="Invalid",
                version="1.0.0",
                description="Invalid tokens",
                role="test",
                model_provider="gemini",
                model_name="gemini-2.0-flash",
                max_tokens=-100,
            )


class TestAgentRegistry:
    """AgentRegistry 클래스 테스트"""

    @pytest.mark.asyncio
    async def test_register_agent(self, agent_registry, sample_agent_spec, mock_firestore):
        """Agent 등록 테스트"""
        # Mock Firestore 응답
        mock_doc = MagicMock()
        mock_doc.exists = False
        mock_firestore.collection.return_value.document.return_value.get.return_value = (
            mock_doc
        )

        # Agent 등록
        registered = await agent_registry.register_agent(sample_agent_spec)

        # 검증
        assert registered.agent_id == "test-agent"
        assert registered.created_at is not None
        assert registered.updated_at is not None

        # Firestore set 호출 확인
        mock_firestore.collection.return_value.document.return_value.set.assert_called_once()

    @pytest.mark.asyncio
    async def test_register_duplicate_agent(
        self, agent_registry, sample_agent_spec, mock_firestore
    ):
        """중복 Agent 등록 실패 테스트"""
        # Mock: 이미 존재하는 Agent
        mock_doc = MagicMock()
        mock_doc.exists = True
        mock_doc.to_dict.return_value = sample_agent_spec.model_dump(mode="json")
        mock_firestore.collection.return_value.document.return_value.get.return_value = (
            mock_doc
        )

        # 중복 등록 시도
        with pytest.raises(ValueError, match="already exists"):
            await agent_registry.register_agent(sample_agent_spec)

    @pytest.mark.asyncio
    async def test_get_agent_by_version(self, agent_registry, sample_agent_spec, mock_firestore):
        """특정 버전 Agent 조회 테스트"""
        # Mock Firestore 응답
        mock_doc = MagicMock()
        mock_doc.exists = True
        mock_doc.to_dict.return_value = sample_agent_spec.model_dump(mode="json")
        mock_firestore.collection.return_value.document.return_value.get.return_value = (
            mock_doc
        )

        # Agent 조회
        agent = await agent_registry.get_agent("test-agent", "1.0.0")

        # 검증
        assert agent is not None
        assert agent.agent_id == "test-agent"
        assert agent.version == "1.0.0"

    @pytest.mark.asyncio
    async def test_get_agent_not_found(self, agent_registry, mock_firestore):
        """존재하지 않는 Agent 조회 테스트"""
        # Mock: Agent 없음
        mock_doc = MagicMock()
        mock_doc.exists = False
        mock_firestore.collection.return_value.document.return_value.get.return_value = (
            mock_doc
        )

        # Agent 조회
        agent = await agent_registry.get_agent("nonexistent", "1.0.0")

        # 검증
        assert agent is None

    @pytest.mark.asyncio
    async def test_list_agents(self, agent_registry, mock_firestore):
        """Agent 목록 조회 테스트"""
        # Mock Firestore 응답
        mock_docs = [
            MagicMock(
                to_dict=lambda: {
                    "agent_id": "agent1",
                    "name": "Agent 1",
                    "version": "1.0.0",
                    "description": "Agent 1",
                    "role": "test",
                    "model_provider": "gemini",
                    "model_name": "gemini-2.0-flash",
                    "status": "deployed",
                }
            ),
            MagicMock(
                to_dict=lambda: {
                    "agent_id": "agent2",
                    "name": "Agent 2",
                    "version": "1.0.0",
                    "description": "Agent 2",
                    "role": "test",
                    "model_provider": "openai",
                    "model_name": "gpt-4o",
                    "status": "deployed",
                }
            ),
        ]
        mock_firestore.collection.return_value.stream.return_value = mock_docs

        # Agent 목록 조회
        agents = await agent_registry.list_agents()

        # 검증
        assert len(agents) == 2
        assert agents[0].agent_id == "agent1"
        assert agents[1].agent_id == "agent2"

    @pytest.mark.asyncio
    async def test_update_status(self, agent_registry, mock_firestore):
        """Agent 상태 변경 테스트"""
        # 상태 변경
        await agent_registry.update_status("test-agent", "1.0.0", AgentStatus.DEPLOYED)

        # Firestore update 호출 확인
        mock_firestore.collection.return_value.document.return_value.update.assert_called_once()

    @pytest.mark.asyncio
    async def test_deploy_agent(self, agent_registry, mock_firestore):
        """Agent 배포 테스트"""
        # Mock: list_agents에서 빈 리스트 반환 (기존 배포 Agent 없음)
        mock_firestore.collection.return_value.stream.return_value = []

        # Agent 배포
        await agent_registry.deploy_agent("test-agent", "2.0.0")

        # Firestore update 호출 확인 (최소 1회 - 새 버전 배포)
        assert (
            mock_firestore.collection.return_value.document.return_value.update.call_count >= 1
        )


class TestAgentStatus:
    """AgentStatus Enum 테스트"""

    def test_agent_status_values(self):
        """상태 값 테스트"""
        assert AgentStatus.DRAFT.value == "draft"
        assert AgentStatus.TESTING.value == "testing"
        assert AgentStatus.DEPLOYED.value == "deployed"
        assert AgentStatus.DEPRECATED.value == "deprecated"

    def test_agent_status_enum(self):
        """Enum 비교 테스트"""
        status = AgentStatus.DEPLOYED
        assert status == AgentStatus.DEPLOYED
        assert status != AgentStatus.DRAFT
        assert status.value == "deployed"
