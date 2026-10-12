"""MCP Firestore Server - Firestore 데이터를 MCP 프로토콜로 제공

Agent가 Firestore 데이터에 안전하게 접근할 수 있도록
MCP Tool 형태로 제공합니다.
"""

import logging
from typing import Any

from google.cloud import firestore
from pydantic import BaseModel, Field

from libs.observability.langsmith import traceable

logger = logging.getLogger(__name__)


class FirestoreQuery(BaseModel):
    """Firestore 쿼리 요청"""

    collection: str
    filters: list[dict[str, Any]] = Field(default_factory=list)
    limit: int = Field(100, ge=1, le=1000)
    order_by: str | None = Field(None, alias="orderBy")


class FirestoreQueryResult(BaseModel):
    """Firestore 쿼리 결과"""

    documents: list[dict[str, Any]]
    count: int


class FirestoreMCPServer:
    """MCP Firestore Server

    Firestore 데이터를 MCP Tool로 제공합니다.

    Agent는 이 서버를 통해:
    - Creator 프로필 조회
    - Promotion 데이터 조회
    - Agreement 데이터 조회
    - Agent 실행 이력 조회
    """

    def __init__(self, firestore_client: firestore.Client):
        self.db = firestore_client

    @traceable(
        run_type="tool",
        name="FirestoreQuery",
        tags=["mcp", "firestore"],
    )
    async def query_collection(self, query: FirestoreQuery) -> FirestoreQueryResult:
        """
        Firestore 컬렉션 쿼리

        Args:
            query: 쿼리 요청

        Returns:
            쿼리 결과

        Example:
            ```python
            query = FirestoreQuery(
                collection="creator_profiles",
                filters=[
                    {"field": "active", "op": "==", "value": True},
                    {"field": "category", "op": "==", "value": "beauty"}
                ],
                limit=10,
                orderBy="completed_deal_count"
            )
            result = await server.query_collection(query)
            ```
        """
        logger.info(f"MCP Firestore query: {query.collection}")

        try:
            # Firestore 쿼리 구성
            collection_ref = self.db.collection(query.collection)
            firestore_query = collection_ref

            # 필터 적용
            for filter_spec in query.filters:
                field = filter_spec.get("field")
                op = filter_spec.get("op", "==")
                value = filter_spec.get("value")
                firestore_query = firestore_query.where(field, op, value)

            # 정렬
            if query.order_by:
                firestore_query = firestore_query.order_by(query.order_by)

            # 제한
            firestore_query = firestore_query.limit(query.limit)

            # 실행
            docs = firestore_query.stream()
            documents = [doc.to_dict() for doc in docs]

            return FirestoreQueryResult(
                documents=documents,
                count=len(documents),
            )

        except Exception as e:
            logger.error(f"Firestore query error: {e}")
            return FirestoreQueryResult(documents=[], count=0)

    @traceable(
        run_type="tool",
        name="FirestoreGetDocument",
        tags=["mcp", "firestore"],
    )
    async def get_document(
        self, collection: str, document_id: str
    ) -> dict[str, Any] | None:
        """
        Firestore 문서 단건 조회

        Args:
            collection: 컬렉션 이름
            document_id: 문서 ID

        Returns:
            문서 데이터 (없으면 None)

        Example:
            ```python
            creator = await server.get_document(
                "creator_profiles",
                "creator-123"
            )
            ```
        """
        logger.info(f"MCP Firestore get: {collection}/{document_id}")

        try:
            doc_ref = self.db.collection(collection).document(document_id)
            doc = doc_ref.get()

            if doc.exists:
                return doc.to_dict()
            else:
                return None

        except Exception as e:
            logger.error(f"Firestore get error: {e}")
            return None

    @traceable(
        run_type="tool",
        name="FirestoreAggregate",
        tags=["mcp", "firestore", "analytics"],
    )
    async def aggregate_metrics(
        self,
        collection: str,
        metric: str,
        filters: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """
        Firestore 집계 쿼리

        Args:
            collection: 컬렉션 이름
            metric: 집계 메트릭 (count, sum, avg)
            filters: 필터 조건

        Returns:
            집계 결과

        Example:
            ```python
            # 활성 크리에이터 수
            result = await server.aggregate_metrics(
                collection="creator_profiles",
                metric="count",
                filters=[{"field": "active", "op": "==", "value": True}]
            )
            # {"count": 150}
            ```
        """
        logger.info(f"MCP Firestore aggregate: {collection}/{metric}")

        try:
            collection_ref = self.db.collection(collection)
            query = collection_ref

            # 필터 적용
            if filters:
                for filter_spec in filters:
                    field = filter_spec.get("field")
                    op = filter_spec.get("op", "==")
                    value = filter_spec.get("value")
                    query = query.where(field, op, value)

            # 집계 실행
            if metric == "count":
                docs = list(query.stream())
                return {"count": len(docs), "metric": "count"}

            elif metric in ["sum", "avg"]:
                # sum/avg는 특정 필드에 대해 계산
                # 실제 구현 시 field 파라미터 추가 필요
                return {
                    "error": f"Metric '{metric}' requires field parameter",
                    "metric": metric,
                }

            else:
                return {"error": f"Unknown metric: {metric}", "metric": metric}

        except Exception as e:
            logger.error(f"Firestore aggregate error: {e}")
            return {"error": str(e), "metric": metric}

    def as_langchain_tool(self) -> dict[str, Any]:
        """
        LangChain Tool 형태로 변환

        Agent가 이 MCP 서버를 Tool로 사용할 수 있도록 변환합니다.

        Returns:
            LangChain Tool 스펙

        Example:
            ```python
            server = FirestoreMCPServer(firestore_client)
            tool_spec = server.as_langchain_tool()

            # Agent에 Tool 추가
            agent = Agent(tools=[tool_spec])
            ```
        """
        return {
            "name": "firestore_query",
            "description": (
                "Query Firestore database. "
                "Use this to fetch creator profiles, promotions, agreements, "
                "and other data from Firestore. "
                "Supports filters, ordering, and limits."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "collection": {
                        "type": "string",
                        "description": "Collection name (e.g., 'creator_profiles')",
                    },
                    "filters": {
                        "type": "array",
                        "description": "Filter conditions",
                        "items": {
                            "type": "object",
                            "properties": {
                                "field": {"type": "string"},
                                "op": {"type": "string", "enum": ["==", "!=", "<", "<=", ">", ">="]},
                                "value": {},
                            },
                        },
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of results (1-1000)",
                        "default": 100,
                    },
                    "orderBy": {
                        "type": "string",
                        "description": "Field to order by",
                    },
                },
                "required": ["collection"],
            },
            "function": self.query_collection,
        }
