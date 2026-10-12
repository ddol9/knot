"""AI Governance Engine - Agent 결정 검증 및 감사

모든 Agent 결정이 정책을 준수하는지 검증하고 감사 로그를 기록합니다.

주요 기능:
- 예산 초과 검증
- PII(개인정보) 노출 감지 (Gemini)
- 정책 제약 검증
- 감사 로그 Firestore 저장
"""

import logging
import re
from datetime import datetime
from typing import Any
from uuid import uuid4

from google.cloud import firestore
from pydantic import BaseModel, Field

from libs.domain.models import AgreementTerms, Promotion
from libs.observability.langsmith import traceable
from libs.policies.decision import PolicyDecision, Violation

logger = logging.getLogger(__name__)

# Governance 설정
GOVERNANCE_VERSION = "governance-v1"
PII_PATTERNS = {
    "email": r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b",
    "phone": r"\b\d{3}[-.]?\d{3,4}[-.]?\d{4}\b",
    "ssn": r"\b\d{6}[-]?\d{7}\b",  # 주민등록번호
    "card": r"\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b",  # 카드번호
}


class GovernanceCheck(BaseModel):
    """Governance 검증 결과"""

    check_id: str = Field(default_factory=lambda: f"check-{uuid4()}")
    agent_id: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    decision: PolicyDecision
    budget_check: dict[str, Any] = Field(default_factory=dict)
    pii_check: dict[str, Any] = Field(default_factory=dict)
    audit_log_saved: bool = False


class GovernanceEngine:
    """AI Governance Engine

    Agent 결정이 정책을 준수하는지 검증하고 감사 로그를 기록합니다.
    """

    def __init__(self, firestore_client: firestore.Client):
        self.db = firestore_client
        self.collection = "agent_governance_logs"

    @traceable(
        run_type="tool",
        name="GovernanceValidation",
        tags=["governance", "validation"],
    )
    async def validate_agent_decision(
        self,
        agent_id: str,
        promotion: Promotion,
        terms: AgreementTerms,
        agent_output: dict[str, Any],
    ) -> GovernanceCheck:
        """
        Agent 결정 검증

        Args:
            agent_id: Agent ID
            promotion: 프로모션 정보
            terms: 제안된 계약 조건
            agent_output: Agent 출력 (PII 검사용)

        Returns:
            GovernanceCheck 결과
        """
        violations: list[Violation] = []

        # 1. 예산 초과 검증
        budget_result = self._check_budget_exceeded(promotion, terms)
        if not budget_result["passed"]:
            violations.append(
                Violation(
                    code="BUDGET_EXCEEDED",
                    field="compensation.baseAmountUsdc",
                    rule=f"Budget must not exceed {promotion.budget.max_per_creator_usdc} USDC",
                )
            )

        # 2. PII 노출 검증
        pii_result = self._check_pii_exposure(agent_output)
        if not pii_result["passed"]:
            violations.append(
                Violation(
                    code="PII_EXPOSURE_DETECTED",
                    field="agent_output",
                    rule="Agent output must not contain PII",
                )
            )

        # 3. 정책 결정 생성
        if violations:
            decision = PolicyDecision(
                allowed=False,
                action="BLOCK",
                violations=violations,
                ruleVersion=GOVERNANCE_VERSION,
            )
        else:
            decision = PolicyDecision(
                allowed=True,
                action="ALLOW",
                violations=[],
                ruleVersion=GOVERNANCE_VERSION,
            )

        # 4. Governance 검증 결과 생성
        check = GovernanceCheck(
            agent_id=agent_id,
            decision=decision,
            budget_check=budget_result,
            pii_check=pii_result,
        )

        # 5. 감사 로그 저장
        try:
            await self._save_audit_log(check, promotion, terms, agent_output)
            check.audit_log_saved = True
        except Exception as e:
            logger.error(f"Failed to save audit log: {e}")
            check.audit_log_saved = False

        return check

    def _check_budget_exceeded(
        self, promotion: Promotion, terms: AgreementTerms
    ) -> dict[str, Any]:
        """
        예산 초과 검증

        Args:
            promotion: 프로모션 정보
            terms: 제안된 계약 조건

        Returns:
            {
                "passed": bool,
                "proposed_amount": int,
                "max_budget": int,
                "exceeded_by": int (음수면 예산 내)
            }
        """
        proposed = terms.compensation.base_amount_usdc
        max_budget = promotion.budget.max_per_creator_usdc

        return {
            "passed": proposed <= max_budget,
            "proposed_amount": proposed,
            "max_budget": max_budget,
            "exceeded_by": proposed - max_budget,
        }

    def _check_pii_exposure(self, agent_output: dict[str, Any]) -> dict[str, Any]:
        """
        PII 노출 감지 (정규식 기반)

        실제 프로덕션에서는 Gemini를 사용하여 더 정교한 PII 감지를 수행합니다.

        Args:
            agent_output: Agent 출력

        Returns:
            {
                "passed": bool,
                "detected_pii_types": list[str],
                "details": dict
            }
        """
        output_str = str(agent_output)
        detected_types = []
        details = {}

        for pii_type, pattern in PII_PATTERNS.items():
            matches = re.findall(pattern, output_str)
            if matches:
                detected_types.append(pii_type)
                details[pii_type] = {
                    "count": len(matches),
                    # 실제 값은 로그에 저장하지 않음 (보안)
                    "masked_samples": ["***" for _ in matches[:3]],
                }

        return {
            "passed": len(detected_types) == 0,
            "detected_pii_types": detected_types,
            "details": details,
        }

    async def _check_pii_with_gemini(
        self, agent_output: dict[str, Any]
    ) -> dict[str, Any]:
        """
        Gemini를 사용한 고급 PII 감지

        TODO: Gemini API 통합 구현

        Args:
            agent_output: Agent 출력

        Returns:
            {
                "passed": bool,
                "confidence": float,
                "detected_entities": list[str]
            }
        """
        # Placeholder for Gemini integration
        # 실제 구현 시:
        # 1. Gemini API 호출
        # 2. PII 감지 프롬프트 전송
        # 3. 결과 파싱
        return {
            "passed": True,
            "confidence": 0.0,
            "detected_entities": [],
            "note": "Gemini integration pending",
        }

    async def _save_audit_log(
        self,
        check: GovernanceCheck,
        promotion: Promotion,
        terms: AgreementTerms,
        agent_output: dict[str, Any],
    ) -> None:
        """
        감사 로그를 Firestore에 저장

        Args:
            check: Governance 검증 결과
            promotion: 프로모션 정보
            terms: 계약 조건
            agent_output: Agent 출력
        """
        doc_ref = self.db.collection(self.collection).document(check.check_id)

        audit_log = {
            "check_id": check.check_id,
            "agent_id": check.agent_id,
            "timestamp": check.timestamp,
            "decision": check.decision.model_dump(by_alias=True, mode="json"),
            "budget_check": check.budget_check,
            "pii_check": {
                # PII 상세 정보는 로그에 저장하지 않음
                "passed": check.pii_check["passed"],
                "detected_pii_types": check.pii_check["detected_pii_types"],
            },
            "promotion": {
                "promotion_id": promotion.promotion_id,
                "brand_id": promotion.brand_id,
                "category": promotion.category,
                "max_budget": promotion.budget.max_per_creator_usdc,
            },
            "terms": {
                "base_amount_usdc": terms.compensation.base_amount_usdc,
                "structure": terms.compensation.structure,
            },
            # Agent 출력은 PII가 있을 수 있으므로 저장하지 않음
            "agent_output_hash": str(hash(str(agent_output))),
            "governance_version": GOVERNANCE_VERSION,
        }

        doc_ref.set(audit_log)
        logger.info(f"Audit log saved: {check.check_id}")

    async def get_audit_logs(
        self,
        agent_id: str | None = None,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        """
        감사 로그 조회

        Args:
            agent_id: Agent ID 필터 (None이면 전체)
            start_date: 시작 날짜
            end_date: 종료 날짜
            limit: 최대 결과 수

        Returns:
            감사 로그 리스트
        """
        query = self.db.collection(self.collection)

        if agent_id:
            query = query.where("agent_id", "==", agent_id)

        if start_date:
            query = query.where("timestamp", ">=", start_date)

        if end_date:
            query = query.where("timestamp", "<=", end_date)

        query = query.order_by("timestamp", direction=firestore.Query.DESCENDING).limit(
            limit
        )

        docs = query.stream()
        return [doc.to_dict() for doc in docs]

    async def get_violation_stats(
        self, agent_id: str | None = None, days: int = 7
    ) -> dict[str, Any]:
        """
        정책 위반 통계

        Args:
            agent_id: Agent ID (None이면 전체)
            days: 조회 기간 (일)

        Returns:
            {
                "total_checks": int,
                "violations": int,
                "violation_rate": float,
                "top_violation_codes": list[dict]
            }
        """
        start_date = datetime.utcnow()
        # days를 빼서 과거 날짜 계산
        from datetime import timedelta

        start_date = start_date - timedelta(days=days)

        logs = await self.get_audit_logs(
            agent_id=agent_id, start_date=start_date, limit=1000
        )

        total = len(logs)
        violations = sum(1 for log in logs if not log["decision"]["allowed"])

        # 위반 코드별 집계
        violation_codes: dict[str, int] = {}
        for log in logs:
            if not log["decision"]["allowed"]:
                for violation in log["decision"]["violations"]:
                    code = violation["code"]
                    violation_codes[code] = violation_codes.get(code, 0) + 1

        # 상위 위반 코드
        top_violations = [
            {"code": code, "count": count}
            for code, count in sorted(
                violation_codes.items(), key=lambda x: x[1], reverse=True
            )[:5]
        ]

        return {
            "total_checks": total,
            "violations": violations,
            "violation_rate": violations / total if total > 0 else 0.0,
            "top_violation_codes": top_violations,
        }
