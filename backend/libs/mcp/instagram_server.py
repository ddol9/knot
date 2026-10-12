"""MCP Instagram API Server - Instagram 데이터를 MCP 프로토콜로 제공

Agent가 Instagram API를 통해 크리에이터 데이터를 조회할 수 있도록
MCP Tool 형태로 제공합니다.
"""

import logging
from typing import Any

from pydantic import BaseModel, Field

from libs.observability.langsmith import traceable

logger = logging.getLogger(__name__)


class InstagramProfile(BaseModel):
    """Instagram 프로필"""

    username: str
    follower_count: int = Field(alias="followerCount")
    following_count: int = Field(alias="followingCount")
    post_count: int = Field(alias="postCount")
    engagement_rate: float = Field(alias="engagementRate")
    avg_likes: float = Field(alias="avgLikes")
    avg_comments: float = Field(alias="avgComments")
    bio: str | None = None
    verified: bool = False


class InstagramPost(BaseModel):
    """Instagram 게시물"""

    post_id: str = Field(alias="postId")
    caption: str | None = None
    like_count: int = Field(alias="likeCount")
    comment_count: int = Field(alias="commentCount")
    engagement_rate: float = Field(alias="engagementRate")
    posted_at: str = Field(alias="postedAt")
    media_type: str = Field(alias="mediaType")  # "photo", "video", "carousel"


class InstagramMCPServer:
    """MCP Instagram API Server

    Instagram API를 MCP Tool로 제공합니다.

    Agent는 이 서버를 통해:
    - Creator Instagram 프로필 조회
    - 최근 게시물 분석
    - 참여율 계산
    - 오디언스 인사이트 조회
    """

    def __init__(self, api_key: str | None = None):
        """
        Args:
            api_key: Instagram Graph API 키 (None이면 환경 변수 사용)
        """
        self.api_key = api_key
        # TODO: 실제 Instagram API 클라이언트 초기화

    @traceable(
        run_type="tool",
        name="InstagramGetProfile",
        tags=["mcp", "instagram", "profile"],
    )
    async def get_profile(self, username: str) -> InstagramProfile | None:
        """
        Instagram 프로필 조회

        Args:
            username: Instagram 사용자명

        Returns:
            Instagram 프로필 (없으면 None)

        Example:
            ```python
            profile = await server.get_profile("fashionista_kr")
            # {
            #   "username": "fashionista_kr",
            #   "followerCount": 150000,
            #   "engagementRate": 0.045,
            #   ...
            # }
            ```
        """
        logger.info(f"MCP Instagram get profile: {username}")

        try:
            # TODO: 실제 Instagram Graph API 호출
            # 현재는 Mock 데이터 반환
            return InstagramProfile(
                username=username,
                followerCount=100000,
                followingCount=500,
                postCount=850,
                engagementRate=0.042,
                avgLikes=4200,
                avgComments=180,
                bio=f"Beauty & Fashion Creator | Seoul 🇰🇷",
                verified=False,
            )

        except Exception as e:
            logger.error(f"Instagram profile error: {e}")
            return None

    @traceable(
        run_type="tool",
        name="InstagramGetRecentPosts",
        tags=["mcp", "instagram", "posts"],
    )
    async def get_recent_posts(
        self, username: str, limit: int = 12
    ) -> list[InstagramPost]:
        """
        최근 Instagram 게시물 조회

        Args:
            username: Instagram 사용자명
            limit: 조회할 게시물 수 (1-50)

        Returns:
            최근 게시물 리스트

        Example:
            ```python
            posts = await server.get_recent_posts("fashionista_kr", limit=12)
            # [
            #   {
            #     "postId": "post-123",
            #     "likeCount": 5200,
            #     "commentCount": 230,
            #     "engagementRate": 0.054,
            #     ...
            #   },
            #   ...
            # ]
            ```
        """
        logger.info(f"MCP Instagram get posts: {username} (limit={limit})")

        try:
            # TODO: 실제 Instagram Graph API 호출
            # 현재는 Mock 데이터 반환
            mock_posts = []
            for i in range(min(limit, 12)):
                mock_posts.append(
                    InstagramPost(
                        postId=f"post-{i+1}",
                        caption=f"Sample post {i+1} #fashion #beauty",
                        likeCount=4000 + i * 200,
                        commentCount=150 + i * 10,
                        engagementRate=0.04 + i * 0.001,
                        postedAt=f"2024-01-{(i+1):02d}T12:00:00Z",
                        mediaType="photo" if i % 2 == 0 else "video",
                    )
                )
            return mock_posts

        except Exception as e:
            logger.error(f"Instagram posts error: {e}")
            return []

    @traceable(
        run_type="tool",
        name="InstagramAnalyzeEngagement",
        tags=["mcp", "instagram", "analytics"],
    )
    async def analyze_engagement(
        self, username: str, days: int = 30
    ) -> dict[str, Any]:
        """
        Instagram 참여율 분석

        Args:
            username: Instagram 사용자명
            days: 분석 기간 (일)

        Returns:
            참여율 분석 결과

        Example:
            ```python
            analysis = await server.analyze_engagement("fashionista_kr", days=30)
            # {
            #   "avg_engagement_rate": 0.045,
            #   "avg_likes": 4200,
            #   "avg_comments": 180,
            #   "best_performing_post": {...},
            #   "engagement_trend": "increasing"
            # }
            ```
        """
        logger.info(f"MCP Instagram analyze engagement: {username} ({days} days)")

        try:
            # TODO: 실제 분석 로직 구현
            # 현재는 Mock 데이터 반환
            return {
                "username": username,
                "period_days": days,
                "avg_engagement_rate": 0.045,
                "avg_likes": 4200,
                "avg_comments": 180,
                "avg_saves": 320,
                "avg_shares": 85,
                "best_performing_post": {
                    "post_id": "post-5",
                    "engagement_rate": 0.072,
                    "like_count": 7200,
                },
                "engagement_trend": "increasing",  # "increasing", "stable", "decreasing"
                "content_performance": {
                    "photo": {"count": 15, "avg_engagement": 0.042},
                    "video": {"count": 8, "avg_engagement": 0.051},
                    "carousel": {"count": 3, "avg_engagement": 0.038},
                },
            }

        except Exception as e:
            logger.error(f"Instagram engagement analysis error: {e}")
            return {
                "error": str(e),
                "username": username,
            }

    def as_langchain_tool(self) -> list[dict[str, Any]]:
        """
        LangChain Tool 형태로 변환

        Instagram API 기능을 여러 개의 Tool로 제공합니다.

        Returns:
            LangChain Tool 스펙 리스트

        Example:
            ```python
            server = InstagramMCPServer(api_key="...")
            tools = server.as_langchain_tool()

            # Agent에 Tool 추가
            agent = Agent(tools=tools)
            ```
        """
        return [
            {
                "name": "instagram_get_profile",
                "description": (
                    "Get Instagram profile information including follower count, "
                    "engagement rate, and bio. "
                    "Use this to evaluate creator's audience size and engagement."
                ),
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "username": {
                            "type": "string",
                            "description": "Instagram username (without @)",
                        }
                    },
                    "required": ["username"],
                },
                "function": self.get_profile,
            },
            {
                "name": "instagram_get_recent_posts",
                "description": (
                    "Get recent Instagram posts with engagement metrics. "
                    "Use this to analyze creator's content performance."
                ),
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "username": {
                            "type": "string",
                            "description": "Instagram username (without @)",
                        },
                        "limit": {
                            "type": "integer",
                            "description": "Number of posts to fetch (1-50)",
                            "default": 12,
                        },
                    },
                    "required": ["username"],
                },
                "function": self.get_recent_posts,
            },
            {
                "name": "instagram_analyze_engagement",
                "description": (
                    "Analyze Instagram engagement metrics over a time period. "
                    "Use this to understand creator's performance trends."
                ),
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "username": {
                            "type": "string",
                            "description": "Instagram username (without @)",
                        },
                        "days": {
                            "type": "integer",
                            "description": "Analysis period in days (7-90)",
                            "default": 30,
                        },
                    },
                    "required": ["username"],
                },
                "function": self.analyze_engagement,
            },
        ]
