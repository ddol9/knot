from pydantic import BaseModel, Field

from libs.domain.categories import category_matches, category_set
from libs.domain.models import CreatorProfile, Promotion
from libs.observability.langsmith import traceable

MATCHING_WEIGHTS_VERSION = "matching-v1"


class ComponentScores(BaseModel):
    category: float
    budget: float
    schedule: float
    deliverable: float
    reputation: float


class MatchResult(BaseModel):
    creator_agent_id: str = Field(alias="creatorAgentId")
    eligible: bool
    score: float
    component_scores: ComponentScores = Field(alias="componentScores")
    hard_filter_reasons: list[str] = Field(alias="hardFilterReasons")
    rank: int | None = None


@traceable(run_type="chain", name="CreatorRanking", tags=["agent:matching", "phase:ranking"])
def rank_creators(promotion: Promotion, creators: list[CreatorProfile]) -> list[MatchResult]:
    results = [score_creator(promotion, creator) for creator in creators]
    results.sort(
        key=lambda result: (
            not result.eligible,
            -result.score,
            -_creator_by_agent_id(creators, result.creator_agent_id).completed_deal_count,
            _creator_by_agent_id(creators, result.creator_agent_id).rate_card.min_base_usdc,
            result.creator_agent_id,
        )
    )

    rank = 1
    for result in results:
        if result.eligible:
            result.rank = rank
            rank += 1
    return results


@traceable(run_type="tool", name="CreatorScoring", tags=["agent:matching", "phase:scoring"])
def score_creator(promotion: Promotion, creator: CreatorProfile) -> MatchResult:
    hard_filter_reasons = hard_filter_creator(promotion, creator)
    component_scores = ComponentScores(
        category=_category_score(promotion, creator),
        budget=_budget_score(promotion, creator),
        schedule=_schedule_score(promotion, creator),
        deliverable=_deliverable_score(promotion, creator),
        reputation=_reputation_score(creator),
    )
    score = round(
        component_scores.category * 0.30
        + component_scores.budget * 0.25
        + component_scores.schedule * 0.20
        + component_scores.deliverable * 0.15
        + component_scores.reputation * 0.10,
        6,
    )
    return MatchResult(
        creatorAgentId=creator.creator_agent_id,
        eligible=not hard_filter_reasons,
        score=score if not hard_filter_reasons else 0.0,
        componentScores=component_scores,
        hardFilterReasons=hard_filter_reasons,
    )


def hard_filter_creator(promotion: Promotion, creator: CreatorProfile) -> list[str]:
    reasons: list[str] = []
    requested_formats = {deliverable.format for deliverable in promotion.deliverables}
    deliverable_count = sum(deliverable.count for deliverable in promotion.deliverables)
    required_categories = promotion.constraints.required_categories or [promotion.category]

    if not creator.active:
        reasons.append("CREATOR_INACTIVE")
    if not category_matches(required_categories, creator.categories):
        reasons.append("CATEGORY_MISMATCH")
    if category_matches([promotion.category], creator.prohibited_industries):
        reasons.append("PROHIBITED_INDUSTRY")
    if creator.rate_card.min_base_usdc > promotion.budget.max_per_creator_usdc:
        reasons.append("RATE_EXCEEDS_MAX_PER_CREATOR")
    if creator.available_from > promotion.posting_window.start:
        reasons.append("SCHEDULE_UNAVAILABLE")
    if not requested_formats.issubset(set(creator.supported_deliverable_formats)):
        reasons.append("DELIVERABLE_FORMAT_UNSUPPORTED")
    if promotion.usage_rights not in creator.allowed_usage_rights:
        reasons.append("USAGE_RIGHTS_UNSUPPORTED")
    if deliverable_count > creator.remaining_capacity:
        reasons.append("CAPACITY_UNAVAILABLE")
    return reasons


def _category_score(promotion: Promotion, creator: CreatorProfile) -> float:
    required_categories = category_set(
        promotion.constraints.required_categories or [promotion.category]
    )
    if not required_categories:
        return 1.0
    matches = len(required_categories.intersection(category_set(creator.categories)))
    return matches / len(required_categories)


def _budget_score(promotion: Promotion, creator: CreatorProfile) -> float:
    max_budget = promotion.budget.max_per_creator_usdc
    if max_budget == 0 or creator.rate_card.min_base_usdc > max_budget:
        return 0.0
    return round(1 - (creator.rate_card.min_base_usdc / max_budget) * 0.5, 6)


def _schedule_score(promotion: Promotion, creator: CreatorProfile) -> float:
    if creator.available_from > promotion.posting_window.end:
        return 0.0
    if creator.available_from <= promotion.posting_window.start:
        return 1.0
    window_days = max((promotion.posting_window.end - promotion.posting_window.start).days, 1)
    delay_days = (creator.available_from - promotion.posting_window.start).days
    return round(max(1 - delay_days / window_days, 0.0), 6)


def _deliverable_score(promotion: Promotion, creator: CreatorProfile) -> float:
    requested_formats = {deliverable.format for deliverable in promotion.deliverables}
    if not requested_formats:
        return 0.0
    supported = requested_formats.intersection(creator.supported_deliverable_formats)
    return len(supported) / len(requested_formats)


def _reputation_score(creator: CreatorProfile) -> float:
    return min(creator.completed_deal_count / 20, 1.0)


def _creator_by_agent_id(creators: list[CreatorProfile], creator_agent_id: str) -> CreatorProfile:
    return next(creator for creator in creators if creator.creator_agent_id == creator_agent_id)
