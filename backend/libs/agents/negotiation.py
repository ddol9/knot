from datetime import date
from uuid import uuid4

from pydantic import BaseModel, Field

from libs.a2a.models import NegotiationMessageType, NegotiationPayload
from libs.domain.hashing import terms_hash
from libs.domain.models import AgreementTerms, CreatorPolicy, Promotion
from libs.observability.langsmith import traceable
from libs.policies.creator import validate_creator_terms
from libs.policies.decision import PolicyDecision


class CreatorNegotiationDecision(BaseModel):
    type: NegotiationMessageType
    terms: AgreementTerms | None = None
    changed_fields: list[str] = Field(default_factory=list, alias="changedFields")
    rationale: str
    policy_decision: PolicyDecision = Field(alias="policyDecision")
    agreement_id: str | None = Field(default=None, alias="agreementId")
    terms_hash: str | None = Field(default=None, alias="termsHash")


class CreatorNegotiationContext(BaseModel):
    creator_agent_id: str = Field(alias="creatorAgentId")
    policy: CreatorPolicy
    today: date
    current_month_deliverables: int = Field(default=0, alias="currentMonthDeliverables")
    max_rounds: int = Field(default=5, alias="maxRounds")


@traceable(run_type="agent", name="CreatorNegotiationEvaluation", tags=["agent:creator", "phase:negotiation"])
def evaluate_creator_message(
    context: CreatorNegotiationContext,
    payload: NegotiationPayload,
) -> CreatorNegotiationDecision:
    if payload.round > context.max_rounds:
        return _reject(
            promotion=payload.promotion,
            terms=payload.terms,
            policy=context.policy,
            today=context.today,
            current_month_deliverables=context.current_month_deliverables,
            rationale="Negotiation round limit exceeded.",
        )

    policy_decision = validate_creator_terms(
        payload.promotion,
        context.policy,
        payload.terms,
        today=context.today,
        current_month_deliverables=context.current_month_deliverables,
    )
    violation_codes = {violation.code for violation in policy_decision.violations}

    if policy_decision.allowed:
        return CreatorNegotiationDecision(
            type=NegotiationMessageType.ACCEPT,
            terms=payload.terms,
            rationale="Terms satisfy the creator policy.",
            policyDecision=policy_decision,
            agreementId=f"agreement-{uuid4()}",
            termsHash=terms_hash(payload.terms),
        )

    if violation_codes == {"CREATOR_MIN_BASE_NOT_MET"}:
        counter_terms = payload.terms.model_copy(deep=True)
        counter_terms.compensation.base_amount_usdc = context.policy.min_base_usdc
        return CreatorNegotiationDecision(
            type=NegotiationMessageType.COUNTER,
            terms=counter_terms,
            changedFields=["compensation.baseAmountUsdc"],
            rationale="The offered amount is below the creator minimum.",
            policyDecision=policy_decision,
        )

    if "CREATOR_BLOCKED_INDUSTRY" in violation_codes:
        return CreatorNegotiationDecision(
            type=NegotiationMessageType.REJECT,
            terms=payload.terms,
            rationale="The promotion category is blocked by the creator policy.",
            policyDecision=policy_decision,
            agreementId=f"agreement-{uuid4()}",
        )

    return CreatorNegotiationDecision(
        type=NegotiationMessageType.ESCALATE,
        terms=payload.terms,
        rationale="Terms require human review before the creator can continue.",
        policyDecision=policy_decision,
    )


def _reject(
    *,
    promotion: Promotion,
    terms: AgreementTerms,
    policy: CreatorPolicy,
    today: date,
    current_month_deliverables: int,
    rationale: str,
) -> CreatorNegotiationDecision:
    policy_decision = validate_creator_terms(
        promotion,
        policy,
        terms,
        today=today,
        current_month_deliverables=current_month_deliverables,
    )
    return CreatorNegotiationDecision(
        type=NegotiationMessageType.REJECT,
        terms=terms,
        rationale=rationale,
        policyDecision=policy_decision,
        agreementId=f"agreement-{uuid4()}",
    )
