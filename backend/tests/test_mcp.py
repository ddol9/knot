"""MCP (Model Context Protocol) 테스트"""

import pytest
from unittest.mock import MagicMock, AsyncMock, patch

from libs.mcp.firestore_server import (
    FirestoreMCPServer,
    FirestoreQuery,
    FirestoreQueryResult,
)
from libs.mcp.instagram_server import InstagramMCPServer, InstagramProfile
from libs.mcp.semantic_layer import SemanticLayer, MetricCategory
from libs.mcp.agent_integration import MCPToolRegistry


@pytest.fixture
def mock_firestore():
    """Firestore 클라이언트 mock"""
    return MagicMock()


@pytest.fixture
def firestore_server(mock_firestore):
    """FirestoreMCPServer 인스턴스"""
    return FirestoreMCPServer(mock_firestore)


@pytest.fixture
def instagram_server():
    """InstagramMCPServer 인스턴스"""
    return InstagramMCPServer(api_key="test-key")


@pytest.fixture
def semantic_layer(firestore_server, instagram_server):
    """SemanticLayer 인스턴스"""
    return SemanticLayer(firestore_server, instagram_server)


class TestFirestoreMCPServer:
    """Firestore MCP Server 테스트"""

    @pytest.mark.asyncio
    async def test_query_collection(self, firestore_server, mock_firestore):
        """Firestore 컬렉션 쿼리 테스트"""
        # Mock Firestore 응답
        mock_docs = [
            MagicMock(
                to_dict=lambda: {
                    "creatorId": "creator-1",
                    "active": True,
                    "category": "beauty",
                }
            ),
            MagicMock(
                to_dict=lambda: {
                    "creatorId": "creator-2",
                    "active": True,
                    "category": "beauty",
                }
            ),
        ]
        mock_firestore.collection.return_value.where.return_value.where.return_value.where.return_value.order_by.return_value.limit.return_value.stream.return_value = (
            mock_docs
        )

        # 쿼리 실행
        query = FirestoreQuery(
            collection="creator_profiles",
            filters=[
                {"field": "active", "op": "==", "value": True},
                {"field": "category", "op": "==", "value": "beauty"},
            ],
            limit=10,
        )
        result = await firestore_server.query_collection(query)

        # 검증
        assert result.count == 2
        assert len(result.documents) == 2
        assert result.documents[0]["creatorId"] == "creator-1"

    @pytest.mark.asyncio
    async def test_get_document(self, firestore_server, mock_firestore):
        """Firestore 문서 조회 테스트"""
        # Mock Firestore 응답
        mock_doc = MagicMock()
        mock_doc.exists = True
        mock_doc.to_dict.return_value = {
            "creatorId": "creator-123",
            "name": "Test Creator",
        }
        mock_firestore.collection.return_value.document.return_value.get.return_value = (
            mock_doc
        )

        # 문서 조회
        result = await firestore_server.get_document("creator_profiles", "creator-123")

        # 검증
        assert result is not None
        assert result["creatorId"] == "creator-123"
        assert result["name"] == "Test Creator"

    @pytest.mark.asyncio
    async def test_get_document_not_found(self, firestore_server, mock_firestore):
        """Firestore 문서 없음 테스트"""
        # Mock: 문서 없음
        mock_doc = MagicMock()
        mock_doc.exists = False
        mock_firestore.collection.return_value.document.return_value.get.return_value = (
            mock_doc
        )

        # 문서 조회
        result = await firestore_server.get_document("creator_profiles", "nonexistent")

        # 검증
        assert result is None

    @pytest.mark.asyncio
    async def test_aggregate_count(self, firestore_server, mock_firestore):
        """Firestore count 집계 테스트"""
        # Mock Firestore 응답
        mock_docs = [MagicMock() for _ in range(5)]
        mock_firestore.collection.return_value.where.return_value.stream.return_value = (
            mock_docs
        )

        # 집계 실행
        result = await firestore_server.aggregate_metrics(
            collection="creator_profiles",
            metric="count",
            filters=[{"field": "active", "op": "==", "value": True}],
        )

        # 검증
        assert result["count"] == 5
        assert result["metric"] == "count"

    def test_as_langchain_tool(self, firestore_server):
        """LangChain Tool 변환 테스트"""
        tool = firestore_server.as_langchain_tool()

        # 검증
        assert tool["name"] == "firestore_query"
        assert "Query Firestore database" in tool["description"]
        assert "collection" in tool["input_schema"]["properties"]
        assert tool["function"] == firestore_server.query_collection


class TestInstagramMCPServer:
    """Instagram MCP Server 테스트"""

    @pytest.mark.asyncio
    async def test_get_profile(self, instagram_server):
        """Instagram 프로필 조회 테스트"""
        profile = await instagram_server.get_profile("test_user")

        # 검증 (Mock 데이터)
        assert profile is not None
        assert profile.username == "test_user"
        assert profile.follower_count > 0
        assert 0 <= profile.engagement_rate <= 1

    @pytest.mark.asyncio
    async def test_get_recent_posts(self, instagram_server):
        """Instagram 최근 게시물 조회 테스트"""
        posts = await instagram_server.get_recent_posts("test_user", limit=5)

        # 검증 (Mock 데이터)
        assert len(posts) == 5
        assert all(post.post_id.startswith("post-") for post in posts)
        assert all(post.like_count > 0 for post in posts)

    @pytest.mark.asyncio
    async def test_analyze_engagement(self, instagram_server):
        """Instagram 참여율 분석 테스트"""
        analysis = await instagram_server.analyze_engagement("test_user", days=30)

        # 검증 (Mock 데이터)
        assert "avg_engagement_rate" in analysis
        assert "engagement_trend" in analysis
        assert analysis["engagement_trend"] in ["increasing", "stable", "decreasing"]
        assert "content_performance" in analysis

    def test_as_langchain_tools(self, instagram_server):
        """LangChain Tools 변환 테스트"""
        tools = instagram_server.as_langchain_tool()

        # 검증
        assert len(tools) == 3
        tool_names = [tool["name"] for tool in tools]
        assert "instagram_get_profile" in tool_names
        assert "instagram_get_recent_posts" in tool_names
        assert "instagram_analyze_engagement" in tool_names


class TestSemanticLayer:
    """Semantic Layer 테스트"""

    def test_list_metrics(self, semantic_layer):
        """메트릭 목록 조회 테스트"""
        all_metrics = semantic_layer.list_metrics()

        # 검증
        assert len(all_metrics) > 0
        assert all(hasattr(m, "metric_id") for m in all_metrics)
        assert all(hasattr(m, "category") for m in all_metrics)

        # 카테고리 필터
        creator_metrics = semantic_layer.list_metrics(category=MetricCategory.CREATOR)
        assert all(m.category == MetricCategory.CREATOR for m in creator_metrics)

    @pytest.mark.asyncio
    async def test_get_metric_active_creator_count(self, semantic_layer, mock_firestore):
        """활성 크리에이터 수 메트릭 테스트"""
        # Mock Firestore
        with patch.object(
            semantic_layer.firestore,
            "query_collection",
            return_value=FirestoreQueryResult(documents=[{} for _ in range(10)], count=10),
        ):
            result = await semantic_layer.get_metric("active_creator_count")

        # 검증
        assert result["value"] == 10
        assert result["unit"] == "count"
        assert result["metric"] == "active_creator_count"

    @pytest.mark.asyncio
    async def test_get_metric_with_filter(self, semantic_layer):
        """필터 적용 메트릭 조회 테스트"""
        # Mock Firestore
        with patch.object(
            semantic_layer.firestore,
            "query_collection",
            return_value=FirestoreQueryResult(documents=[{} for _ in range(5)], count=5),
        ):
            result = await semantic_layer.get_metric(
                "active_creator_count", filters={"category": "beauty"}
            )

        # 검증
        assert result["value"] == 5
        assert result["metric"] == "active_creator_count"

    @pytest.mark.asyncio
    async def test_get_metric_unknown(self, semantic_layer):
        """알 수 없는 메트릭 조회 테스트"""
        result = await semantic_layer.get_metric("nonexistent_metric")

        # 검증
        assert "error" in result
        assert "Unknown metric" in result["error"]

    def test_as_langchain_tool(self, semantic_layer):
        """LangChain Tool 변환 테스트"""
        tool = semantic_layer.as_langchain_tool()

        # 검증
        assert tool["name"] == "get_business_metric"
        assert "business metrics" in tool["description"]
        assert "metric_id" in tool["input_schema"]["properties"]


class TestMCPToolRegistry:
    """MCP Tool Registry 테스트"""

    def test_get_all_tools(self, mock_firestore):
        """모든 Tool 조회 테스트"""
        registry = MCPToolRegistry(mock_firestore)
        tools = registry.get_all_tools()

        # 검증
        assert len(tools) >= 5  # Firestore(1) + Instagram(3) + Semantic(1)

        tool_names = [tool["name"] for tool in tools]
        assert "firestore_query" in tool_names
        assert "instagram_get_profile" in tool_names
        assert "get_business_metric" in tool_names

    def test_get_tool_by_name(self, mock_firestore):
        """특정 Tool 조회 테스트"""
        registry = MCPToolRegistry(mock_firestore)

        # Firestore Tool 조회
        tool = registry.get_tool_by_name("firestore_query")
        assert tool is not None
        assert tool["name"] == "firestore_query"

        # 없는 Tool 조회
        tool = registry.get_tool_by_name("nonexistent_tool")
        assert tool is None


class TestAgentIntegration:
    """Agent MCP 통합 테스트"""

    @pytest.mark.asyncio
    async def test_run_mcp_enabled_agent_example(self, mock_firestore):
        """MCP Agent 실행 예제 테스트"""
        from libs.mcp.agent_integration import run_mcp_enabled_agent_example

        # Mock Firestore
        mock_docs = [MagicMock(to_dict=lambda: {"creatorId": f"creator-{i}"}) for i in range(5)]
        mock_firestore.collection.return_value.where.return_value.where.return_value.limit.return_value.stream.return_value = (
            mock_docs
        )

        # Agent 실행
        result = await run_mcp_enabled_agent_example(mock_firestore)

        # 검증
        assert result["status"] == "success"
        assert "metrics" in result
        assert "instagram_profile" in result
        assert "beauty_creators_count" in result

    @pytest.mark.asyncio
    async def test_run_discovery_agent_with_mcp(self, mock_firestore):
        """Discovery Agent MCP 통합 테스트"""
        from libs.mcp.agent_integration import run_discovery_agent_with_mcp

        # Mock Firestore
        mock_docs = [
            MagicMock(
                to_dict=lambda: {
                    "creatorId": f"creator-{i}",
                    "instagramUsername": f"user_{i}",
                    "verifiedDealsCount": 10 + i,
                }
            )
            for i in range(5)
        ]
        mock_firestore.collection.return_value.where.return_value.where.return_value.limit.return_value.order_by.return_value.stream.return_value = (
            mock_docs
        )

        # 프로모션
        promotion = {
            "category": "beauty",
            "budget": {"maxPerCreatorUsdc": 1000},
        }

        # Agent 실행
        recommendations = await run_discovery_agent_with_mcp(promotion, mock_firestore)

        # 검증
        assert len(recommendations) > 0
        assert all("creator_id" in rec for rec in recommendations)
        assert all("recommendation_score" in rec for rec in recommendations)
        # 추천 점수로 정렬되어 있는지 확인
        scores = [rec["recommendation_score"] for rec in recommendations]
        assert scores == sorted(scores, reverse=True)
