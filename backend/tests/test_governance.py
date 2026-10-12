"""Governance Engine 테스트"""

import pytest
from datetime import date, datetime
from unittest.mock import MagicMock, AsyncMock, patch

from libs.agent_ops.governance import GovernanceEngine, GovernanceCheck, GOVERNANCE_VERSION
from libs.domain.models import (
    AgreementTerms,
    Compensation,
    CompensationStructure,
    Promotion,
    PromotionBudget,
)


@pytest.fixture
def mock_firestore():
    """Firestore 클라이언트 mock"""
    client = MagicMock()
    client.collection.return_value.document.return_value.set = MagicMock()
    return client


@pytest.fixture
def governance_engine(mock_firestore):
    """GovernanceEngine 인스턴스"""
    return GovernanceEngine(mock_firestore)


@pytest.fixture
def sample_promotion():
    """테스트용 프로모션"""
    return Promotion(
        promotion_id="promo-123",
        brand_id="brand-456",
        category="beauty",
        posting_window=MagicMock(start=date(2024, 1, 1), end=date(2024, 1, 31)),
        budget=PromotionBudget(
            total_usdc=10000,
            max_per_creator_usdc=1000,
        ),
        deliverables=[],
        usage_rights="social_media_only",
        constraints=MagicMock(
            required_categories=[],
            required_disclosures=[],
            prohibited_claims=[],
        ),
    )


@pytest.fixture
def sample_terms():
    """테스트용 계약 조건"""
    return AgreementTerms(
        compensation=Compensation(
            structure=CompensationStructure.FLAT,
            baseAmountUsdc=800,
            performancePct=0,
        ),
        deliverables=[],
        usageRights="social_media_only",
        milestones=[],
        constraints=MagicMock(
            requiredDisclosures=[],
            prohibitedClaims=[],
            exclusivityDays=0,
        ),
    )


class TestGovernanceEngine:
    """GovernanceEngine 테스트"""

    @pytest.mark.asyncio
    async def test_validate_agent_decision_pass(
        self, governance_engine, sample_promotion, sample_terms, mock_firestore
    ):
        """정상적인 Agent 결정 검증 - 통과"""
        agent_output = {"rationale": "Fair offer for creator"}

        check = await governance_engine.validate_agent_decision(
            agent_id="test-agent",
            promotion=sample_promotion,
            terms=sample_terms,
            agent_output=agent_output,
        )

        # 검증 통과
        assert check.decision.allowed is True
        assert check.decision.action == "ALLOW"
        assert len(check.decision.violations) == 0
        assert check.budget_check["passed"] is True
        assert check.pii_check["passed"] is True

    @pytest.mark.asyncio
    async def test_validate_agent_decision_budget_exceeded(
        self, governance_engine, sample_promotion, mock_firestore
    ):
        """예산 초과 검증 - 실패"""
        # 예산 초과 계약 조건
        terms = AgreementTerms(
            compensation=Compensation(
                structure=CompensationStructure.FLAT,
                baseAmountUsdc=1500,  # max_per_creator_usdc=1000 초과
                performancePct=0,
            ),
            deliverables=[],
            usageRights="social_media_only",
            milestones=[],
            constraints=MagicMock(
                requiredDisclosures=[],
                prohibitedClaims=[],
                exclusivityDays=0,
            ),
        )

        agent_output = {"rationale": "High value creator"}

        check = await governance_engine.validate_agent_decision(
            agent_id="test-agent",
            promotion=sample_promotion,
            terms=terms,
            agent_output=agent_output,
        )

        # 검증 실패
        assert check.decision.allowed is False
        assert check.decision.action == "BLOCK"
        assert len(check.decision.violations) == 1
        assert check.decision.violations[0].code == "BUDGET_EXCEEDED"
        assert check.budget_check["passed"] is False
        assert check.budget_check["exceeded_by"] == 500

    @pytest.mark.asyncio
    async def test_validate_agent_decision_pii_detected(
        self, governance_engine, sample_promotion, sample_terms, mock_firestore
    ):
        """PII 노출 감지 - 실패"""
        # PII가 포함된 Agent 출력
        agent_output = {
            "rationale": "Contact creator at test@example.com or call 010-1234-5678"
        }

        check = await governance_engine.validate_agent_decision(
            agent_id="test-agent",
            promotion=sample_promotion,
            terms=sample_terms,
            agent_output=agent_output,
        )

        # 검증 실패
        assert check.decision.allowed is False
        assert check.decision.action == "BLOCK"
        assert any(v.code == "PII_EXPOSURE_DETECTED" for v in check.decision.violations)
        assert check.pii_check["passed"] is False
        assert "email" in check.pii_check["detected_pii_types"]
        assert "phone" in check.pii_check["detected_pii_types"]

    def test_check_budget_exceeded_pass(self, governance_engine, sample_promotion):
        """예산 검증 - 통과"""
        terms = AgreementTerms(
            compensation=Compensation(
                structure=CompensationStructure.FLAT,
                baseAmountUsdc=800,
                performancePct=0,
            ),
            deliverables=[],
            usageRights="social_media_only",
            milestones=[],
            constraints=MagicMock(),
        )

        result = governance_engine._check_budget_exceeded(sample_promotion, terms)

        assert result["passed"] is True
        assert result["proposed_amount"] == 800
        assert result["max_budget"] == 1000
        assert result["exceeded_by"] == -200

    def test_check_budget_exceeded_fail(self, governance_engine, sample_promotion):
        """예산 검증 - 실패"""
        terms = AgreementTerms(
            compensation=Compensation(
                structure=CompensationStructure.FLAT,
                baseAmountUsdc=1200,
                performancePct=0,
            ),
            deliverables=[],
            usageRights="social_media_only",
            milestones=[],
            constraints=MagicMock(),
        )

        result = governance_engine._check_budget_exceeded(sample_promotion, terms)

        assert result["passed"] is False
        assert result["proposed_amount"] == 1200
        assert result["max_budget"] == 1000
        assert result["exceeded_by"] == 200

    def test_check_pii_exposure_none(self, governance_engine):
        """PII 검증 - PII 없음"""
        agent_output = {"rationale": "Good fit for promotion"}

        result = governance_engine._check_pii_exposure(agent_output)

        assert result["passed"] is True
        assert result["detected_pii_types"] == []

    def test_check_pii_exposure_email(self, governance_engine):
        """PII 검증 - 이메일 감지"""
        agent_output = {"rationale": "Contact: user@example.com"}

        result = governance_engine._check_pii_exposure(agent_output)

        assert result["passed"] is False
        assert "email" in result["detected_pii_types"]
        assert result["details"]["email"]["count"] == 1

    def test_check_pii_exposure_phone(self, governance_engine):
        """PII 검증 - 전화번호 감지"""
        agent_output = {"rationale": "Call 010-1234-5678 or 02-123-4567"}

        result = governance_engine._check_pii_exposure(agent_output)

        assert result["passed"] is False
        assert "phone" in result["detected_pii_types"]
        assert result["details"]["phone"]["count"] == 2

    def test_check_pii_exposure_multiple(self, governance_engine):
        """PII 검증 - 여러 PII 유형 감지"""
        agent_output = {
            "rationale": "Email: test@example.com, Phone: 010-1234-5678, "
            "Card: 1234-5678-9012-3456"
        }

        result = governance_engine._check_pii_exposure(agent_output)

        assert result["passed"] is False
        assert len(result["detected_pii_types"]) == 3
        assert "email" in result["detected_pii_types"]
        assert "phone" in result["detected_pii_types"]
        assert "card" in result["detected_pii_types"]

    @pytest.mark.asyncio
    async def test_save_audit_log(
        self, governance_engine, sample_promotion, sample_terms, mock_firestore
    ):
        """감사 로그 저장 테스트"""
        check = GovernanceCheck(
            agent_id="test-agent",
            decision=MagicMock(
                allowed=True,
                action="ALLOW",
                violations=[],
                ruleVersion=GOVERNANCE_VERSION,
                model_dump=lambda **kwargs: {
                    "allowed": True,
                    "action": "ALLOW",
                    "violations": [],
                    "ruleVersion": GOVERNANCE_VERSION,
                },
            ),
            budget_check={"passed": True},
            pii_check={"passed": True, "detected_pii_types": []},
        )

        agent_output = {"rationale": "Test"}

        await governance_engine._save_audit_log(
            check, sample_promotion, sample_terms, agent_output
        )

        # Firestore set 호출 확인
        mock_firestore.collection.assert_called_once_with("agent_governance_logs")
        mock_firestore.collection.return_value.document.assert_called_once()

    @pytest.mark.asyncio
    async def test_get_violation_stats_empty(self, governance_engine, mock_firestore):
        """위반 통계 - 데이터 없음"""
        # Mock: 빈 로그
        mock_firestore.collection.return_value.where.return_value.order_by.return_value.limit.return_value.stream.return_value = (
            []
        )

        with patch.object(governance_engine, "get_audit_logs", return_value=[]):
            stats = await governance_engine.get_violation_stats(
                agent_id="test-agent", days=7
            )

        assert stats["total_checks"] == 0
        assert stats["violations"] == 0
        assert stats["violation_rate"] == 0.0
        assert stats["top_violation_codes"] == []

    @pytest.mark.asyncio
    async def test_get_violation_stats_with_violations(
        self, governance_engine, mock_firestore
    ):
        """위반 통계 - 위반 있음"""
        # Mock: 로그 데이터
        mock_logs = [
            {
                "decision": {
                    "allowed": True,
                    "violations": [],
                }
            },
            {
                "decision": {
                    "allowed": False,
                    "violations": [{"code": "BUDGET_EXCEEDED"}],
                }
            },
            {
                "decision": {
                    "allowed": False,
                    "violations": [{"code": "BUDGET_EXCEEDED"}],
                }
            },
            {
                "decision": {
                    "allowed": False,
                    "violations": [{"code": "PII_EXPOSURE_DETECTED"}],
                }
            },
        ]

        with patch.object(governance_engine, "get_audit_logs", return_value=mock_logs):
            stats = await governance_engine.get_violation_stats(
                agent_id="test-agent", days=7
            )

        assert stats["total_checks"] == 4
        assert stats["violations"] == 3
        assert stats["violation_rate"] == 0.75
        assert len(stats["top_violation_codes"]) == 2
        assert stats["top_violation_codes"][0]["code"] == "BUDGET_EXCEEDED"
        assert stats["top_violation_codes"][0]["count"] == 2
