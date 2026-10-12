"""Semantic Layer - 비즈니스 메트릭 정의

복잡한 DB 쿼리를 비즈니스 용어로 추상화합니다.
Agent는 "SQL을 어떻게 짜지?"가 아닌 "총 매출이 얼마지?"를 묻습니다.
"""

import logging
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field

from libs.mcp.firestore_server import FirestoreMCPServer
from libs.mcp.instagram_server import InstagramMCPServer
from libs.observability.langsmith import traceable

logger = logging.getLogger(__name__)


class MetricCategory(StrEnum):
    """메트릭 카테고리"""

    CREATOR = "creator"  # 크리에이터 관련
    PROMOTION = "promotion"  # 프로모션 관련
    AGREEMENT = "agreement"  # 계약 관련
    FINANCIAL = "financial"  # 재무 관련
    ENGAGEMENT = "engagement"  # 참여율 관련


class MetricDefinition(BaseModel):
    """메트릭 정의"""

    metric_id: str = Field(alias="metricId")
    name: str
    description: str
    category: MetricCategory
    unit: str  # "count", "usdc", "percentage", "rate"
    calculation: str  # 계산 방식 설명


class SemanticLayer:
    """Semantic Layer

    복잡한 쿼리를 비즈니스 메트릭으로 추상화합니다.

    Example:
        ```python
        layer = SemanticLayer(firestore_server, instagram_server)

        # "활성 크리에이터 수" 메트릭 조회
        result = await layer.get_metric("active_creator_count")
        # {"value": 150, "unit": "count"}

        # "평균 참여율" 메트릭 조회
        result = await layer.get_metric("avg_engagement_rate", {"category": "beauty"})
        # {"value": 0.045, "unit": "rate"}
        ```
    """

    def __init__(
        self,
        firestore_server: FirestoreMCPServer,
        instagram_server: InstagramMCPServer,
    ):
        self.firestore = firestore_server
        self.instagram = instagram_server

        # 메트릭 정의
        self.metrics = self._define_metrics()

    def _define_metrics(self) -> dict[str, MetricDefinition]:
        """
        비즈니스 메트릭 정의

        Returns:
            메트릭 정의 딕셔너리
        """
        return {
            # Creator 메트릭
            "active_creator_count": MetricDefinition(
                metricId="active_creator_count",
                name="Active Creator Count",
                description="Number of active creators accepting offers",
                category=MetricCategory.CREATOR,
                unit="count",
                calculation="COUNT(creator_profiles WHERE active=true AND acceptingOffers=true)",
            ),
            "avg_creator_rate": MetricDefinition(
                metricId="avg_creator_rate",
                name="Average Creator Rate",
                description="Average base rate across all creators",
                category=MetricCategory.CREATOR,
                unit="usdc",
                calculation="AVG(creator_profiles.rateCard.minBaseUsdc)",
            ),
            "creator_completion_rate": MetricDefinition(
                metricId="creator_completion_rate",
                name="Creator Completion Rate",
                description="Percentage of completed deals vs total deals",
                category=MetricCategory.CREATOR,
                unit="percentage",
                calculation="(completed_deals / total_deals) * 100",
            ),
            # Promotion 메트릭
            "active_promotion_count": MetricDefinition(
                metricId="active_promotion_count",
                name="Active Promotion Count",
                description="Number of active promotions",
                category=MetricCategory.PROMOTION,
                unit="count",
                calculation="COUNT(promotions WHERE status='active')",
            ),
            "total_promotion_budget": MetricDefinition(
                metricId="total_promotion_budget",
                name="Total Promotion Budget",
                description="Sum of all promotion budgets",
                category=MetricCategory.PROMOTION,
                unit="usdc",
                calculation="SUM(promotions.budget.totalUsdc)",
            ),
            # Agreement 메트릭
            "pending_agreement_count": MetricDefinition(
                metricId="pending_agreement_count",
                name="Pending Agreement Count",
                description="Number of agreements pending creator acceptance",
                category=MetricCategory.AGREEMENT,
                unit="count",
                calculation="COUNT(agreements WHERE status='pending')",
            ),
            "avg_negotiation_rounds": MetricDefinition(
                metricId="avg_negotiation_rounds",
                name="Average Negotiation Rounds",
                description="Average number of rounds before agreement",
                category=MetricCategory.AGREEMENT,
                unit="count",
                calculation="AVG(agreements.negotiationRounds)",
            ),
            # Financial 메트릭
            "total_committed_spend": MetricDefinition(
                metricId="total_committed_spend",
                name="Total Committed Spend",
                description="Total USDC committed to accepted agreements",
                category=MetricCategory.FINANCIAL,
                unit="usdc",
                calculation="SUM(agreements.terms.compensation.baseAmountUsdc WHERE status='accepted')",
            ),
            # Engagement 메트릭
            "avg_engagement_rate": MetricDefinition(
                metricId="avg_engagement_rate",
                name="Average Engagement Rate",
                description="Average Instagram engagement rate of creators",
                category=MetricCategory.ENGAGEMENT,
                unit="rate",
                calculation="AVG(instagram.engagementRate)",
            ),
        }

    @traceable(
        run_type="tool",
        name="GetMetric",
        tags=["semantic-layer", "metrics"],
    )
    async def get_metric(
        self, metric_id: str, filters: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        """
        비즈니스 메트릭 조회

        Args:
            metric_id: 메트릭 ID
            filters: 필터 조건 (optional)

        Returns:
            메트릭 값

        Example:
            ```python
            # 활성 크리에이터 수
            result = await layer.get_metric("active_creator_count")
            # {"value": 150, "unit": "count", "metric": "active_creator_count"}

            # 특정 카테고리의 평균 참여율
            result = await layer.get_metric(
                "avg_engagement_rate",
                {"category": "beauty"}
            )
            # {"value": 0.045, "unit": "rate", "metric": "avg_engagement_rate"}
            ```
        """
        logger.info(f"Semantic Layer get metric: {metric_id}")

        metric_def = self.metrics.get(metric_id)
        if not metric_def:
            return {"error": f"Unknown metric: {metric_id}"}

        try:
            # 메트릭별 계산 로직
            if metric_id == "active_creator_count":
                return await self._calc_active_creator_count(filters)

            elif metric_id == "avg_creator_rate":
                return await self._calc_avg_creator_rate(filters)

            elif metric_id == "active_promotion_count":
                return await self._calc_active_promotion_count(filters)

            elif metric_id == "total_promotion_budget":
                return await self._calc_total_promotion_budget(filters)

            elif metric_id == "avg_engagement_rate":
                return await self._calc_avg_engagement_rate(filters)

            else:
                return {
                    "error": f"Metric calculation not implemented: {metric_id}",
                    "metric": metric_id,
                }

        except Exception as e:
            logger.error(f"Metric calculation error: {e}")
            return {"error": str(e), "metric": metric_id}

    async def _calc_active_creator_count(
        self, filters: dict[str, Any] | None
    ) -> dict[str, Any]:
        """활성 크리에이터 수 계산"""
        from libs.mcp.firestore_server import FirestoreQuery

        query_filters = [
            {"field": "active", "op": "==", "value": True},
            {"field": "acceptingOffers", "op": "==", "value": True},
        ]

        # 카테고리 필터 추가
        if filters and "category" in filters:
            query_filters.append(
                {"field": "categories", "op": "array_contains", "value": filters["category"]}
            )

        query = FirestoreQuery(
            collection="creator_discovery_profiles",
            filters=query_filters,
            limit=1000,
        )

        result = await self.firestore.query_collection(query)

        return {
            "value": result.count,
            "unit": "count",
            "metric": "active_creator_count",
        }

    async def _calc_avg_creator_rate(
        self, filters: dict[str, Any] | None
    ) -> dict[str, Any]:
        """평균 크리에이터 요율 계산"""
        from libs.mcp.firestore_server import FirestoreQuery

        query_filters = [
            {"field": "active", "op": "==", "value": True},
        ]

        if filters and "category" in filters:
            query_filters.append(
                {"field": "categories", "op": "array_contains", "value": filters["category"]}
            )

        query = FirestoreQuery(
            collection="creator_discovery_profiles",
            filters=query_filters,
            limit=1000,
        )

        result = await self.firestore.query_collection(query)

        if result.count == 0:
            return {"value": 0, "unit": "usdc", "metric": "avg_creator_rate"}

        # 평균 계산 (Mock - 실제는 rateCard.minBaseUsdc 필드 사용)
        total = sum(doc.get("minBaseUsdc", 500) for doc in result.documents)
        avg = total / result.count

        return {
            "value": round(avg, 2),
            "unit": "usdc",
            "metric": "avg_creator_rate",
        }

    async def _calc_active_promotion_count(
        self, filters: dict[str, Any] | None
    ) -> dict[str, Any]:
        """활성 프로모션 수 계산"""
        result = await self.firestore.aggregate_metrics(
            collection="promotions",
            metric="count",
            filters=[{"field": "status", "op": "==", "value": "active"}],
        )

        return {
            "value": result.get("count", 0),
            "unit": "count",
            "metric": "active_promotion_count",
        }

    async def _calc_total_promotion_budget(
        self, filters: dict[str, Any] | None
    ) -> dict[str, Any]:
        """총 프로모션 예산 계산"""
        # TODO: Firestore sum 집계 구현
        # 현재는 Mock
        return {
            "value": 50000,
            "unit": "usdc",
            "metric": "total_promotion_budget",
        }

    async def _calc_avg_engagement_rate(
        self, filters: dict[str, Any] | None
    ) -> dict[str, Any]:
        """평균 참여율 계산"""
        # TODO: Instagram 데이터 기반 계산
        # 현재는 Mock
        return {
            "value": 0.042,
            "unit": "rate",
            "metric": "avg_engagement_rate",
        }

    def list_metrics(
        self, category: MetricCategory | None = None
    ) -> list[MetricDefinition]:
        """
        사용 가능한 메트릭 목록

        Args:
            category: 카테고리 필터 (optional)

        Returns:
            메트릭 정의 리스트
        """
        metrics = list(self.metrics.values())

        if category:
            metrics = [m for m in metrics if m.category == category]

        return metrics

    def as_langchain_tool(self) -> dict[str, Any]:
        """
        LangChain Tool 형태로 변환

        Agent가 Semantic Layer를 Tool로 사용할 수 있도록 변환합니다.

        Returns:
            LangChain Tool 스펙
        """
        return {
            "name": "get_business_metric",
            "description": (
                "Get business metrics like creator count, engagement rate, budget, etc. "
                "Use this instead of writing complex queries. "
                f"Available metrics: {', '.join(self.metrics.keys())}"
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "metric_id": {
                        "type": "string",
                        "description": "Metric ID",
                        "enum": list(self.metrics.keys()),
                    },
                    "filters": {
                        "type": "object",
                        "description": "Optional filters (e.g., {'category': 'beauty'})",
                    },
                },
                "required": ["metric_id"],
            },
            "function": self.get_metric,
        }
