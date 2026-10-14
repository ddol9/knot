from datetime import date

from libs.a2a.models import A2AMessage, A2APart, A2ARole, A2ASendConfiguration, A2ASendRequest
from libs.agents.matching import rank_creators
from libs.domain.models import (
    AgreementTerms,
    Compensation,
    CompensationStructure,
    CreatorProfile,
    Milestone,
    PostingWindow,
    Promotion,
    TermConstraints,
    TermDeliverable,
)
from libs.payments.settlement import (
    CONTENT_MILESTONE_ID,
    DEFAULT_DEPOSIT_PCT,
    DEPOSIT_MILESTONE_ID,
)


def select_creator_for_negotiation(
    promotion: Promotion, creators: list[CreatorProfile]
) -> CreatorProfile | None:
    ranked = rank_creators(promotion, creators)
    selected = next((result for result in ranked if result.eligible), None)
    if selected is None:
        return None
    return next(
        creator for creator in creators if creator.creator_agent_id == selected.creator_agent_id
    )


def build_initial_terms(
    promotion: Promotion,
    creator: CreatorProfile | None,
    *,
    base_amount_usdc: int | None = None,
) -> AgreementTerms:
    amount = base_amount_usdc
    if amount is None:
        if creator is None:
            raise ValueError("base_amount_usdc is required when no creator profile is given")
        amount = min(creator.rate_card.min_base_usdc, promotion.budget.max_per_creator_usdc)

    return AgreementTerms(
        compensation=Compensation(
            structure=CompensationStructure.FLAT,
            baseAmountUsdc=amount,
            performancePct=0,
        ),
        deliverables=[
            TermDeliverable(
                format=deliverable.format,
                count=deliverable.count,
                postWindow=PostingWindow(
                    start=promotion.posting_window.start,
                    end=promotion.posting_window.end,
                ),
                revisionRounds=1,
            )
            for deliverable in promotion.deliverables
        ],
        usageRights=promotion.usage_rights,
        # 계약금 + 잔금 2분할 (docs/17 D3·N1).
        #
        # 계약금은 크리에이터가 Agreement 를 수락한 시점에 "귀속" 이 확정되지만 전송은
        # 계약 종결 시에 일어난다. 수락 즉시 전송하면 "수락 → 계약금 수령 → 잠수" 를
        # 반복하는 어뷰징이 성립한다(docs/17 §0.6).
        #
        # 이 분할만으로 브랜드 단순변심 처리가 기존 instruction 조합으로 나온다:
        #   release_milestone(deposit) + refund_remaining → 계약금은 크리에이터, 잔금은 브랜드
        milestones=[
            Milestone(
                id=DEPOSIT_MILESTONE_ID,
                trigger="creatorAccepted",
                releasePct=DEFAULT_DEPOSIT_PCT,
            ),
            Milestone(
                id=CONTENT_MILESTONE_ID,
                trigger="contentLiveVerified",
                releasePct=100 - DEFAULT_DEPOSIT_PCT,
            ),
        ],
        constraints=TermConstraints(
            requiredDisclosures=promotion.constraints.required_disclosures,
            prohibitedClaims=promotion.constraints.prohibited_claims,
            exclusivityDays=0,
        ),
    )


def build_a2a_offer_request(
    *,
    tenant: str,
    promotion: Promotion,
    terms: AgreementTerms,
    message_id: str,
    context_id: str,
    round_: int = 1,
    rationale: str = "Initial promotion offer",
) -> A2ASendRequest:
    return A2ASendRequest(
        tenant=tenant,
        message=A2AMessage(
            messageId=message_id,
            contextId=context_id,
            role=A2ARole.USER,
            parts=[
                A2APart(
                    mediaType="application/json",
                    data={
                        "schema": "knot.negotiation.v1",
                        "type": "OFFER",
                        "round": round_,
                        "promotion": promotion.model_dump(by_alias=True, mode="json"),
                        "terms": terms.model_dump(by_alias=True, mode="json"),
                        "changedFields": [],
                        "rationale": rationale,
                    },
                )
            ],
        ),
        configuration=A2ASendConfiguration(acceptedOutputModes=["application/json"]),
    )


def planned_posting_date(promotion: Promotion) -> date:
    return promotion.posting_window.start
