"""LangSmith 통합 - Agent 실행 추적 및 모니터링

LangSmith로 모든 Agent 실행을 추적하여:
- 입력/출력 기록
- LLM 호출 토큰 수 및 비용 추적
- 에러 디버깅
- 성능 병목 구간 식별
"""

import functools
import os
from contextvars import ContextVar
from typing import Any, Callable, TypeVar

from langsmith import Client
from langsmith.run_helpers import traceable as langsmith_traceable

# LangSmith 설정
current_trace_id: ContextVar[str | None] = ContextVar("current_trace_id", default=None)

F = TypeVar("F", bound=Callable[..., Any])


def configure_langsmith(
    api_key: str | None = None,
    project: str = "knot-agent-ops",
    endpoint: str = "https://api.smith.langchain.com",
) -> Client:
    """
    LangSmith 클라이언트 설정

    Args:
        api_key: LangSmith API 키 (None이면 환경 변수 LANGCHAIN_API_KEY 사용)
        project: LangSmith 프로젝트 이름
        endpoint: LangSmith API 엔드포인트

    Returns:
        설정된 LangSmith Client

    Environment Variables:
        LANGCHAIN_TRACING_V2: "true"로 설정하면 추적 활성화
        LANGCHAIN_API_KEY: LangSmith API 키
        LANGCHAIN_PROJECT: 프로젝트 이름 (기본값: knot-agent-ops)
        LANGCHAIN_ENDPOINT: API 엔드포인트
    """
    # 환경 변수 설정
    os.environ["LANGCHAIN_TRACING_V2"] = "true"
    os.environ["LANGCHAIN_ENDPOINT"] = endpoint
    os.environ["LANGCHAIN_PROJECT"] = project

    if api_key:
        os.environ["LANGCHAIN_API_KEY"] = api_key

    return Client()


def traceable(
    *,
    run_type: str = "chain",
    name: str | None = None,
    tags: list[str] | None = None,
    metadata: dict[str, Any] | None = None,
) -> Callable[[F], F]:
    """
    Agent 함수를 LangSmith로 추적하는 데코레이터

    Args:
        run_type: 실행 타입 ("llm", "chain", "tool", "agent", "retriever")
        name: 추적 이름 (None이면 함수 이름 사용)
        tags: 태그 리스트 (예: ["model:gemini", "phase:discovery"])
        metadata: 추가 메타데이터

    Returns:
        데코레이터 함수

    Example:
        ```python
        @traceable(run_type="agent", name="BrandNegotiationAgent")
        async def run_brand_agent(promotion: dict, creator: dict):
            # Agent 로직
            return result
        ```

        LangSmith 대시보드에서 확인 가능:
        - 실행 시간
        - 입력: promotion, creator
        - 출력: result
        - 에러 (있는 경우)
    """
    return langsmith_traceable(
        run_type=run_type, name=name, tags=tags or [], metadata=metadata or {}
    )


def trace_agent_execution(agent_id: str, version: str):
    """
    Agent 실행 컨텍스트 데코레이터

    Agent ID와 버전을 자동으로 태그에 추가합니다.

    Args:
        agent_id: Agent ID
        version: Agent 버전

    Example:
        ```python
        @trace_agent_execution("brand-negotiator", "2.1.0")
        async def execute_negotiation(params):
            # 자동으로 태그 추가: ["agent:brand-negotiator", "version:2.1.0"]
            pass
        ```
    """

    def decorator(func: F) -> F:
        @functools.wraps(func)
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            tags = [f"agent:{agent_id}", f"version:{version}"]
            metadata = {"agent_id": agent_id, "version": version}

            # LangSmith traceable 적용
            traced_func = langsmith_traceable(
                run_type="agent",
                name=f"{agent_id}_v{version}",
                tags=tags,
                metadata=metadata,
            )(func)

            return await traced_func(*args, **kwargs)

        return wrapper  # type: ignore

    return decorator


class AgentTracer:
    """
    Agent 실행 추적 헬퍼 클래스

    LangSmith Client를 래핑하여 Agent 관련 추적 기능 제공
    """

    def __init__(self, client: Client | None = None):
        self.client = client or Client()

    def get_agent_metrics(self, agent_id: str, days: int = 7) -> dict[str, Any]:
        """
        특정 Agent의 메트릭 조회

        Args:
            agent_id: Agent ID
            days: 조회 기간 (일)

        Returns:
            {
                "total_runs": 150,
                "success_rate": 0.92,
                "avg_latency": 2.3,
                "total_cost": 15.50,
                "error_types": {"ValueError": 5, "Timeout": 3}
            }
        """
        # TODO: LangSmith API로 메트릭 조회 구현
        # 현재는 placeholder
        return {
            "total_runs": 0,
            "success_rate": 0.0,
            "avg_latency": 0.0,
            "total_cost": 0.0,
            "error_types": {},
        }

    def get_bottlenecks(self, limit: int = 10) -> list[dict[str, Any]]:
        """
        느린 Agent/단계 식별

        Args:
            limit: 반환할 최대 개수

        Returns:
            [
                {"name": "RAG Search", "avg_latency": 3.8, "p95_latency": 5.2},
                {"name": "Brand Negotiate", "avg_latency": 2.1, "p95_latency": 3.5}
            ]
        """
        # TODO: LangSmith API로 병목 구간 분석 구현
        return []
