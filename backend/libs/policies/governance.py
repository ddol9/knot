"""Governance guardrails on the autonomous settlement path.

Deterministic, LLM-free rules in the style of `libs.policies.brand`:

* `evaluate_settlement`  - may this agreement be funded (escrow locked) without a person?
                           Large single agreements and large cumulative campaign spend stop
                           before escrow and wait in the approval queue (`approvals/{id}`).
* `flag_track_record`    - does an agent's observed negotiation history look abnormal?
                           The flag only demotes the agent in discovery; it never excludes it.

Thresholds come from settings (`KNOT_GOV_*`); every decision carries the rule version and
the rule ids that fired so a reviewer can see exactly why a person was pulled in.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from libs.a2a.registry import TrackRecord
from libs.domain.models import Promotion

GOVERNANCE_RULE_VERSION = "governance-v1"

# Rule ids (stable identifiers; appear in approval documents and SSE events).
RULE_SINGLE_AGREEMENT_LIMIT = "GOV_SINGLE_AGREEMENT_OVER_AUTO_LIMIT"
RULE_CAMPAIGN_TOTAL_LIMIT = "GOV_CAMPAIGN_TOTAL_OVER_AUTO_LIMIT"
RULE_PROMOTION_AUTO_ESCROW_DISABLED = "GOV_PROMOTION_AUTO_ESCROW_DISABLED"
FLAG_CONSECUTIVE_FAILURES = "GOV_CONSECUTIVE_NEGOTIATION_FAILURES"
FLAG_LOW_AGREEMENT_RATE = "GOV_LOW_AGREEMENT_RATE"

# Attempt outcomes that are not an agreement (brand-side CANCELED is not an attempt).
FAILURE_OUTCOMES = frozenset({"REJECTED", "ESCALATED", "WALKED_AWAY", "ROUND_LIMIT"})


class GovernanceRules(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    # A single agreement above this is never funded without a person.
    max_auto_agreement_usdc: int = Field(default=800, alias="maxAutoAgreementUsdc", ge=0)
    # Cumulative committed amount in one campaign (including the agreement under review).
    max_auto_campaign_total_usdc: int = Field(default=2000, alias="maxAutoCampaignTotalUsdc", ge=0)
    # Anomaly: this many most recent attempts all failed.
    max_consecutive_failures: int = Field(default=3, alias="maxConsecutiveFailures", ge=1)
    # Anomaly: agreement rate below the floor once there are enough attempts to judge.
    anomaly_min_attempts: int = Field(default=4, alias="anomalyMinAttempts", ge=1)
    anomaly_agreement_rate_floor: float = Field(
        default=0.2, alias="anomalyAgreementRateFloor", ge=0.0, le=1.0
    )

    @classmethod
    def from_settings(cls, settings: Any) -> GovernanceRules:
        return cls(
            maxAutoAgreementUsdc=int(settings.gov_max_auto_agreement_usdc),
            maxAutoCampaignTotalUsdc=int(settings.gov_max_auto_campaign_total_usdc),
            maxConsecutiveFailures=int(settings.gov_max_consecutive_failures),
        )


class GovernanceDecision(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    allowed_auto: bool = Field(alias="allowedAuto")
    requires_approval: bool = Field(alias="requiresApproval")
    reasons: list[str] = Field(default_factory=list)
    rule_version: str = Field(default=GOVERNANCE_RULE_VERSION, alias="ruleVersion")


class AnomalyFlag(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    code: str
    detail: str
    rule_version: str = Field(default=GOVERNANCE_RULE_VERSION, alias="ruleVersion")


def evaluate_settlement(
    rules: GovernanceRules,
    *,
    agreement_amount_usdc: int,
    campaign_committed_usdc: int,
    promotion: Promotion,
) -> GovernanceDecision:
    """Decide whether the agent may lock escrow for this agreement on its own.

    `campaign_committed_usdc` is the campaign ledger's committed total *including* this
    agreement. When the promotion itself has auto-escrow off there is nothing to approve:
    the product's manual funding path owns it, so `requiresApproval` stays False.
    """
    reasons: list[str] = []
    if agreement_amount_usdc > rules.max_auto_agreement_usdc:
        reasons.append(RULE_SINGLE_AGREEMENT_LIMIT)
    if campaign_committed_usdc > rules.max_auto_campaign_total_usdc:
        reasons.append(RULE_CAMPAIGN_TOTAL_LIMIT)
    if not promotion.autonomy.auto_escrow:
        return GovernanceDecision(
            allowedAuto=False,
            requiresApproval=False,
            reasons=[*reasons, RULE_PROMOTION_AUTO_ESCROW_DISABLED],
        )
    return GovernanceDecision(
        allowedAuto=not reasons, requiresApproval=bool(reasons), reasons=reasons
    )


def flag_track_record(rules: GovernanceRules, record: TrackRecord) -> AnomalyFlag | None:
    """Surface an abnormal negotiation history. Observational only: never a hard exclude."""
    n = rules.max_consecutive_failures
    recent = record.recent_outcomes[-n:]
    if len(recent) >= n and all(outcome in FAILURE_OUTCOMES for outcome in recent):
        return AnomalyFlag(
            code=FLAG_CONSECUTIVE_FAILURES,
            detail=f"last {n} negotiations ended {', '.join(recent)}",
        )
    if (
        record.attempts >= rules.anomaly_min_attempts
        and record.agreement_rate < rules.anomaly_agreement_rate_floor
    ):
        return AnomalyFlag(
            code=FLAG_LOW_AGREEMENT_RATE,
            detail=(
                f"agreement rate {record.agreement_rate} below "
                f"{rules.anomaly_agreement_rate_floor} after {record.attempts} attempts"
            ),
        )
    return None
