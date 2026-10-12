"""Governance API Routes - Agent 거버넌스 관리"""

from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from libs.agent_ops.governance import GovernanceCheck, GovernanceEngine
from libs.domain.models import AgreementTerms, Promotion
from libs.repositories.store import KnotRepository


class ValidateDecisionRequest(BaseModel):
    """Agent 결정 검증 요청"""

    agent_id: str = Field(..., alias="agentId")
    promotion: Promotion
    terms: AgreementTerms
    agent_output: dict[str, Any] = Field(..., alias="agentOutput")


class ValidateDecisionResponse(BaseModel):
    """Agent 결정 검증 응답"""

    check: GovernanceCheck
    passed: bool
    violations: list[dict[str, Any]]


class AuditLogQuery(BaseModel):
    """감사 로그 조회 쿼리"""

    agent_id: str | None = Field(None, alias="agentId")
    start_date: datetime | None = Field(None, alias="startDate")
    end_date: datetime | None = Field(None, alias="endDate")
    limit: int = Field(100, ge=1, le=1000)


class ViolationStatsQuery(BaseModel):
    """위반 통계 조회 쿼리"""

    agent_id: str | None = Field(None, alias="agentId")
    days: int = Field(7, ge=1, le=90)


def build_governance_router(repository: KnotRepository) -> APIRouter:
    """Governance API 라우터 생성"""
    router = APIRouter(prefix="/api/v1/governance", tags=["governance"])
    governance_engine = GovernanceEngine(repository.db)

    @router.post("/validate", response_model=ValidateDecisionResponse)
    async def validate_agent_decision(request: ValidateDecisionRequest):
        """
        Agent 결정 검증

        Agent가 제안한 계약 조건이 정책을 준수하는지 검증합니다.

        **검증 항목:**
        - 예산 초과 여부
        - PII 노출 여부
        - 정책 제약 위반 여부

        **Returns:**
        - check: 검증 결과
        - passed: 통과 여부
        - violations: 위반 사항 리스트
        """
        try:
            check = await governance_engine.validate_agent_decision(
                agent_id=request.agent_id,
                promotion=request.promotion,
                terms=request.terms,
                agent_output=request.agent_output,
            )

            return ValidateDecisionResponse(
                check=check,
                passed=check.decision.allowed,
                violations=[
                    v.model_dump(by_alias=True) for v in check.decision.violations
                ],
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.post("/audit-logs")
    async def get_audit_logs(query: AuditLogQuery):
        """
        감사 로그 조회

        Governance 검증 이력을 조회합니다.

        **Query Parameters:**
        - agent_id: Agent ID 필터 (optional)
        - start_date: 시작 날짜 (optional)
        - end_date: 종료 날짜 (optional)
        - limit: 최대 결과 수 (1-1000, 기본 100)

        **Returns:**
        - logs: 감사 로그 리스트
        - count: 결과 개수
        """
        try:
            logs = await governance_engine.get_audit_logs(
                agent_id=query.agent_id,
                start_date=query.start_date,
                end_date=query.end_date,
                limit=query.limit,
            )

            return {"logs": logs, "count": len(logs)}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.post("/violation-stats")
    async def get_violation_stats(query: ViolationStatsQuery):
        """
        정책 위반 통계

        Agent별 정책 위반 통계를 조회합니다.

        **Query Parameters:**
        - agent_id: Agent ID 필터 (optional, None이면 전체)
        - days: 조회 기간 (1-90일, 기본 7일)

        **Returns:**
        - total_checks: 총 검증 횟수
        - violations: 위반 횟수
        - violation_rate: 위반율
        - top_violation_codes: 상위 위반 코드
        """
        try:
            stats = await governance_engine.get_violation_stats(
                agent_id=query.agent_id, days=query.days
            )

            return stats
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.get("/health")
    async def governance_health():
        """
        Governance Engine 상태 확인

        Returns:
            status: "healthy"
            version: governance 버전
        """
        from libs.agent_ops.governance import GOVERNANCE_VERSION

        return {"status": "healthy", "version": GOVERNANCE_VERSION}

    return router
