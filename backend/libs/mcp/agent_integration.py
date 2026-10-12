"""Agent와 MCP 통합 - Agent가 MCP Tool을 사용하는 예제

Agent는 MCP 서버를 Tool로 등록하여 Firestore, Instagram 등
외부 데이터에 안전하게 접근할 수 있습니다.
"""

import logging
from typing import Any

from google.cloud import firestore

from libs.mcp.firestore_server import FirestoreMCPServer
from libs.mcp.instagram_server import InstagramMCPServer
from libs.mcp.semantic_layer import SemanticLayer
from libs.observability.langsmith import traceable

logger = logging.getLogger(__name__)


class MCPToolRegistry:
    """MCP Tool 레지스트리

    Agent가 사용할 MCP Tool들을 등록하고 관리합니다.
    """

    def __init__(self, firestore_client: firestore.Client, instagram_api_key: str | None = None):
        # MCP 서버 초기화
        self.firestore_server = FirestoreMCPServer(firestore_client)
        self.instagram_server = InstagramMCPServer(instagram_api_key)
        self.semantic_layer = SemanticLayer(self.firestore_server, self.instagram_server)

    def get_all_tools(self) -> list[dict[str, Any]]:
        """
        모든 MCP Tool 반환

        Returns:
            LangChain Tool 스펙 리스트

        Example:
            ```python
            registry = MCPToolRegistry(firestore_client)
            tools = registry.get_all_tools()

            # Agent에 Tool 추가
            agent = Agent(tools=tools)
            ```
        """
        tools = []

        # Firestore Tool
        tools.append(self.firestore_server.as_langchain_tool())

        # Instagram Tools
        tools.extend(self.instagram_server.as_langchain_tool())

        # Semantic Layer Tool
        tools.append(self.semantic_layer.as_langchain_tool())

        logger.info(f"Registered {len(tools)} MCP tools")
        return tools

    def get_tool_by_name(self, tool_name: str) -> dict[str, Any] | None:
        """
        특정 Tool 조회

        Args:
            tool_name: Tool 이름

        Returns:
            Tool 스펙 (없으면 None)
        """
        all_tools = self.get_all_tools()
        return next((tool for tool in all_tools if tool["name"] == tool_name), None)


@traceable(run_type="agent", name="MCPEnabledAgent", tags=["agent", "mcp"])
async def run_mcp_enabled_agent_example(
    firestore_client: firestore.Client,
) -> dict[str, Any]:
    """
    MCP Tool을 사용하는 Agent 실행 예제

    Agent가 MCP를 통해 데이터를 조회하고 결정을 내립니다.

    Args:
        firestore_client: Firestore 클라이언트

    Returns:
        Agent 실행 결과

    Example:
        ```python
        result = await run_mcp_enabled_agent_example(firestore_client)
        ```
    """
    logger.info("Running MCP-enabled agent example")

    # MCP Tool 레지스트리 생성
    registry = MCPToolRegistry(firestore_client)
    tools = registry.get_all_tools()

    # Tool 정보 로깅
    tool_names = [tool["name"] for tool in tools]
    logger.info(f"Agent has access to tools: {tool_names}")

    # 예제: Agent가 MCP Tool을 사용하여 데이터 조회
    # (실제 Agent 구현은 LangGraph 또는 LangChain으로)

    # 1. Semantic Layer로 비즈니스 메트릭 조회
    semantic_tool = registry.semantic_layer
    active_creators = await semantic_tool.get_metric("active_creator_count")
    logger.info(f"Active creators: {active_creators}")

    # 2. Instagram 프로필 조회
    instagram_tool = registry.instagram_server
    profile = await instagram_tool.get_profile("fashionista_kr")
    logger.info(f"Instagram profile: {profile}")

    # 3. Firestore 쿼리
    from libs.mcp.firestore_server import FirestoreQuery

    firestore_tool = registry.firestore_server
    query = FirestoreQuery(
        collection="creator_discovery_profiles",
        filters=[
            {"field": "active", "op": "==", "value": True},
            {"field": "categoryKeys", "op": "array_contains", "value": "beauty"},
        ],
        limit=10,
    )
    creators = await firestore_tool.query_collection(query)
    logger.info(f"Found {creators.count} beauty creators")

    return {
        "status": "success",
        "metrics": {
            "active_creators": active_creators,
        },
        "instagram_profile": profile.model_dump() if profile else None,
        "beauty_creators_count": creators.count,
    }


async def run_discovery_agent_with_mcp(
    promotion: dict[str, Any],
    firestore_client: firestore.Client,
) -> list[dict[str, Any]]:
    """
    MCP를 사용하는 Discovery Agent 예제

    Args:
        promotion: 프로모션 정보
        firestore_client: Firestore 클라이언트

    Returns:
        추천 크리에이터 리스트

    Example:
        ```python
        promotion = {
            "category": "beauty",
            "budget": {"maxPerCreatorUsdc": 1000},
        }
        recommendations = await run_discovery_agent_with_mcp(promotion, firestore_client)
        ```
    """
    logger.info("Running Discovery Agent with MCP")

    # MCP Tool 레지스트리
    registry = MCPToolRegistry(firestore_client)

    # 1. Semantic Layer로 카테고리별 평균 참여율 조회
    avg_engagement = await registry.semantic_layer.get_metric(
        "avg_engagement_rate",
        filters={"category": promotion["category"]},
    )
    logger.info(f"Category avg engagement: {avg_engagement}")

    # 2. Firestore에서 적합한 크리에이터 검색
    from libs.mcp.firestore_server import FirestoreQuery

    query = FirestoreQuery(
        collection="creator_discovery_profiles",
        filters=[
            {"field": "active", "op": "==", "value": True},
            {"field": "categoryKeys", "op": "array_contains", "value": promotion["category"]},
        ],
        limit=20,
        orderBy="verifiedDealsCount",
    )
    candidates = await registry.firestore_server.query_collection(query)

    # 3. 각 후보의 Instagram 데이터 조회
    recommendations = []
    for doc in candidates.documents[:5]:  # 상위 5명만
        username = doc.get("instagramUsername")
        if username:
            # Instagram 프로필 조회
            ig_profile = await registry.instagram_server.get_profile(username)
            # Instagram 참여율 분석
            ig_analysis = await registry.instagram_server.analyze_engagement(username, days=30)

            recommendations.append(
                {
                    "creator_id": doc.get("creatorId"),
                    "username": username,
                    "follower_count": ig_profile.follower_count if ig_profile else 0,
                    "engagement_rate": ig_analysis.get("avg_engagement_rate", 0),
                    "verified_deals": doc.get("verifiedDealsCount", 0),
                    "recommendation_score": (
                        ig_analysis.get("avg_engagement_rate", 0) * 0.6
                        + (doc.get("verifiedDealsCount", 0) / 20) * 0.4
                    ),
                }
            )

    # 추천 점수로 정렬
    recommendations.sort(key=lambda x: x["recommendation_score"], reverse=True)

    logger.info(f"Generated {len(recommendations)} recommendations")
    return recommendations
