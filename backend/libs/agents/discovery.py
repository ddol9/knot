import logging
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from hashlib import sha256
from typing import Protocol

from libs.domain.categories import category_set
from libs.domain.models import CreatorProfile, Promotion
from libs.observability.langsmith import traceable
from libs.payments import PaymentReceipt, PayShError, verify_creator
from libs.repositories.firestore_paths import COLLECTIONS
from libs.repositories.serialization import DocumentData
from libs.repositories.store import DocumentQueryFilter, KnotRepository

logger = logging.getLogger(__name__)

DISCOVERY_LIMIT = 100
DETAIL_READ_LIMIT = 20
DISCOVERY_RANKING_VERSION = "discovery-ranking-v1"


@dataclass(frozen=True)
class DiscoveryMetrics:
    query_limit: int
    returned_count: int
    detail_read_limit: int
    detail_read_count: int


@dataclass(frozen=True)
class DiscoverySearchResult:
    projections: list[DocumentData]
    metrics: DiscoveryMetrics


class CreatorDiscoveryRepository(Protocol):
    def search(
        self,
        promotion: Promotion,
        *,
        limit: int = DISCOVERY_LIMIT,
    ) -> DiscoverySearchResult:
        pass


class FirestoreCreatorDiscoveryRepository:
    def __init__(self, repository: KnotRepository) -> None:
        self._repository = repository

    def search(
        self,
        promotion: Promotion,
        *,
        limit: int = DISCOVERY_LIMIT,
    ) -> DiscoverySearchResult:
        if limit <= 0 or limit > DISCOVERY_LIMIT:
            raise ValueError("creator discovery limit must be between 1 and 100")
        filters = _public_filters(promotion)
        # Query with larger limit to account for post-filtering
        query_limit = min(limit * 3, DISCOVERY_LIMIT)
        try:
            projections = self._repository.query_raw_documents(
                COLLECTIONS.creator_discovery_profiles,
                filters,
                limit=query_limit,
            )
        except Exception as exc:
            if not _query_requires_index(exc):
                raise
            logger.warning(
                "creator discovery index missing; falling back to bounded real-document scan"
            )
            projections = _filter_without_composite_index(
                self._repository.list_raw_documents(COLLECTIONS.creator_discovery_profiles),
                filters,
                limit=query_limit,
            )
        # Post-filter for format (can't use 2 array_contains in Firestore)
        required_format = _required_format(promotion)
        filtered = [
            p for p in projections
            if required_format in _string_list(p.get("formatKeys"))
        ]
        # Limit results after filtering
        filtered = filtered[:limit]
        return DiscoverySearchResult(
            projections=filtered,
            metrics=DiscoveryMetrics(
                query_limit=query_limit,
                returned_count=len(filtered),
                detail_read_limit=DETAIL_READ_LIMIT,
                detail_read_count=0,
            ),
        )


@dataclass(frozen=True)
class RankedDiscoveryCandidate:
    creator_id: str
    creator_agent_id: str
    eligible: bool
    score: float
    score_components: dict[str, float]
    hard_filter_reasons: list[str]
    rank: int | None
    projection: DocumentData


@traceable(run_type="chain", name="DiscoveryRanking", tags=["agent:discovery", "phase:ranking"])
def rank_discovery_candidates(
    promotion: Promotion,
    projections: Sequence[Mapping[str, object]],
) -> list[RankedDiscoveryCandidate]:
    ranked = [_score_projection(promotion, projection) for projection in projections]
    ranked.sort(
        key=lambda candidate: (
            not candidate.eligible,
            -candidate.score,
            -candidate.score_components["semanticMoodFit"],
            str(candidate.projection.get("nextAvailableAt") or ""),
            _stable_creator_tiebreak(candidate.creator_id),
        )
    )

    rank = 1
    results: list[RankedDiscoveryCandidate] = []
    for candidate in ranked:
        if candidate.eligible:
            candidate = RankedDiscoveryCandidate(
                creator_id=candidate.creator_id,
                creator_agent_id=candidate.creator_agent_id,
                eligible=candidate.eligible,
                score=candidate.score,
                score_components=candidate.score_components,
                hard_filter_reasons=candidate.hard_filter_reasons,
                rank=rank,
                projection=candidate.projection,
            )
            rank += 1
        results.append(candidate)
    return results


def detail_candidates(
    repository: KnotRepository,
    ranked: Sequence[RankedDiscoveryCandidate],
    *,
    limit: int = DETAIL_READ_LIMIT,
) -> tuple[list[tuple[RankedDiscoveryCandidate, CreatorProfile]], int]:
    bounded = ranked[:limit]
    results: list[tuple[RankedDiscoveryCandidate, CreatorProfile]] = []
    for candidate in bounded:
        creator = repository.get_creator_profile(candidate.creator_id)
        if creator is not None:
            results.append((candidate, creator))
    return results, len(bounded)


@dataclass(frozen=True)
class VerifiedCandidate:
    """Creator candidate with pay.sh authenticity verification"""
    candidate: RankedDiscoveryCandidate
    profile: CreatorProfile
    verification_receipt: PaymentReceipt | None
    bot_percentage: float
    engagement_quality: str
    verification_passed: bool


@traceable(run_type="tool", name="CreatorVerification", tags=["agent:discovery", "phase:verification", "tool:paysh"])
def verify_candidates(
    detailed: Sequence[tuple[RankedDiscoveryCandidate, CreatorProfile]],
    *,
    sandbox: bool = True,
    bot_threshold: float = 0.25,
) -> list[VerifiedCandidate]:
    """
    Verify creator authenticity using pay.sh verification API

    Args:
        detailed: Ranked candidates with full profiles
        sandbox: If True, simulate verification without real payment
        bot_threshold: Maximum acceptable bot percentage (0.0 to 1.0)

    Returns:
        List of VerifiedCandidate with verification results
        Candidates with bot_percentage > threshold will have verification_passed=False
    """
    verified_list: list[VerifiedCandidate] = []

    for candidate, profile in detailed:
        # Get profile URL from social links
        profile_url = _get_primary_social_url(profile)

        if not profile_url:
            # No social URL to verify - mark as failed verification
            logger.warning(f"Creator {profile.creator_id} has no social profile URL")
            verified_list.append(VerifiedCandidate(
                candidate=candidate,
                profile=profile,
                verification_receipt=None,
                bot_percentage=1.0,  # Assume worst case
                engagement_quality="unknown",
                verification_passed=False,
            ))
            continue

        try:
            # Call pay.sh verification API
            receipt = verify_creator(
                profile_url=profile_url,
                sandbox=sandbox,
                max_price_usdc=0.10,
                provider="nansen",
            )

            result = receipt.verification_result
            bot_pct = result.get("bot_percentage", 1.0)
            engagement = result.get("engagement_quality", "unknown")
            passed = bot_pct <= bot_threshold

            logger.info(
                f"Creator {profile.creator_id} verified: "
                f"bot={bot_pct:.2%}, engagement={engagement}, passed={passed}"
            )

            verified_list.append(VerifiedCandidate(
                candidate=candidate,
                profile=profile,
                verification_receipt=receipt,
                bot_percentage=bot_pct,
                engagement_quality=engagement,
                verification_passed=passed,
            ))

        except PayShError as e:
            # Verification failed - treat as suspicious
            logger.error(f"pay.sh verification failed for {profile.creator_id}: {e}")
            verified_list.append(VerifiedCandidate(
                candidate=candidate,
                profile=profile,
                verification_receipt=None,
                bot_percentage=1.0,
                engagement_quality="unknown",
                verification_passed=False,
            ))

    return verified_list


def _get_primary_social_url(profile: CreatorProfile) -> str | None:
    """Extract primary social media profile URL from creator profile"""
    # Try Instagram first (most common for creators)
    if profile.social_accounts.instagram:
        return f"https://instagram.com/{profile.social_accounts.instagram}"

    # Try YouTube
    if profile.social_accounts.youtube:
        return f"https://youtube.com/@{profile.social_accounts.youtube}"

    # Try TikTok
    if profile.social_accounts.tiktok:
        return f"https://tiktok.com/@{profile.social_accounts.tiktok}"

    return None


def _public_filters(promotion: Promotion) -> list[DocumentQueryFilter]:
    # NOTE: Firestore allows max 1 array_contains filter per query
    # Format filtering is done in-memory in search() method
    return [
        DocumentQueryFilter("agentStatus", "==", "PUBLISHED"),
        DocumentQueryFilter("acceptingOffers", "==", True),
        DocumentQueryFilter("availability", "==", "AVAILABLE"),
        DocumentQueryFilter("capacityAvailable", "==", True),
        DocumentQueryFilter("countryCode", "==", "KR"),
        DocumentQueryFilter(
            "categoryKeys",
            "array_contains",
            _primary_required_category(promotion),
        ),
        DocumentQueryFilter("nextAvailableAt", "<=", promotion.posting_window.start.isoformat()),
    ]


def _filter_without_composite_index(
    documents: Sequence[DocumentData],
    filters: Sequence[DocumentQueryFilter],
    *,
    limit: int,
) -> list[DocumentData]:
    results: list[DocumentData] = []
    for document in documents:
        if all(_matches_query_filter(document, query_filter) for query_filter in filters):
            results.append(document)
        if len(results) >= limit:
            break
    return results


def _matches_query_filter(
    document: Mapping[str, object],
    query_filter: DocumentQueryFilter,
) -> bool:
    value = document.get(query_filter.field_path)
    expected = query_filter.value
    if query_filter.op == "==":
        return value == expected
    if query_filter.op == "<=":
        return isinstance(value, type(expected)) and value <= expected
    if query_filter.op == "array_contains":
        return expected in _string_list(value)
    raise ValueError(f"unsupported discovery filter op: {query_filter.op}")


def _query_requires_index(exc: Exception) -> bool:
    message = str(exc)
    return "requires an index" in message or "FAILED_PRECONDITION" in message


def _score_projection(
    promotion: Promotion,
    projection: Mapping[str, object],
) -> RankedDiscoveryCandidate:
    hard_filter_reasons = _projection_hard_filter_reasons(promotion, projection)
    components = {
        "semanticMoodFit": 0.5,
        "categoryAudienceFit": _category_audience_fit(promotion, projection),
        "formatFit": _format_fit(promotion, projection),
        "scheduleFit": _schedule_fit(promotion, projection),
        "coarseBudgetFit": _coarse_budget_fit(promotion, projection),
        "reliabilityFit": _reliability_fit(projection),
    }
    score = round(
        components["semanticMoodFit"] * 35
        + components["categoryAudienceFit"] * 20
        + components["formatFit"] * 15
        + components["scheduleFit"] * 10
        + components["coarseBudgetFit"] * 10
        + components["reliabilityFit"] * 10,
        6,
    )
    return RankedDiscoveryCandidate(
        creator_id=_required_str(projection, "creatorId"),
        creator_agent_id=_required_str(projection, "creatorAgentId"),
        eligible=not hard_filter_reasons,
        score=score if not hard_filter_reasons else 0.0,
        score_components=components,
        hard_filter_reasons=hard_filter_reasons,
        rank=None,
        projection=dict(projection),
    )


def _projection_hard_filter_reasons(
    promotion: Promotion,
    projection: Mapping[str, object],
) -> list[str]:
    reasons: list[str] = []
    if projection.get("agentStatus") != "PUBLISHED":
        reasons.append("AGENT_NOT_PUBLISHED")
    if projection.get("acceptingOffers") is not True:
        reasons.append("NOT_ACCEPTING_OFFERS")
    if projection.get("availability") != "AVAILABLE":
        reasons.append("AGENT_UNAVAILABLE")
    if projection.get("capacityAvailable") is not True:
        reasons.append("CAPACITY_UNAVAILABLE")
    if _required_format(promotion) not in _string_list(projection.get("formatKeys")):
        reasons.append("DELIVERABLE_FORMAT_UNSUPPORTED")
    if not category_set(_required_categories(promotion)).intersection(
        category_set(_string_list(projection.get("categoryKeys")))
    ):
        reasons.append("CATEGORY_MISMATCH")
    next_available = projection.get("nextAvailableAt")
    latest_start = promotion.posting_window.start.isoformat()
    if isinstance(next_available, str) and next_available > latest_start:
        reasons.append("SCHEDULE_UNAVAILABLE")
    return reasons


def _category_audience_fit(promotion: Promotion, projection: Mapping[str, object]) -> float:
    required = category_set(_required_categories(promotion))
    available = category_set(_string_list(projection.get("categoryKeys")))
    if not required:
        return 1.0
    overlap = len(required.intersection(available)) / len(required)
    primary = projection.get("primaryCategoryKey")
    if isinstance(primary, str) and primary in required:
        overlap = min(overlap + 0.15, 1.0)
    return round(overlap, 6)


def _format_fit(promotion: Promotion, projection: Mapping[str, object]) -> float:
    requested = _required_format(promotion)
    if projection.get("primaryFormatKey") == requested:
        return 1.0
    if requested in _string_list(projection.get("formatKeys")):
        return 0.7
    return 0.0


def _schedule_fit(promotion: Promotion, projection: Mapping[str, object]) -> float:
    next_available = projection.get("nextAvailableAt")
    if not isinstance(next_available, str):
        return 0.5
    try:
        available_from = date.fromisoformat(next_available)
    except ValueError:
        return 0.5
    if available_from > promotion.posting_window.end:
        return 0.0
    if available_from <= promotion.posting_window.start:
        return 1.0
    window_days = max((promotion.posting_window.end - promotion.posting_window.start).days, 1)
    delay_days = (available_from - promotion.posting_window.start).days
    return round(max(1 - delay_days / window_days, 0.0), 6)


def _coarse_budget_fit(promotion: Promotion, projection: Mapping[str, object]) -> float:
    band = projection.get("publicRateBand")
    if not isinstance(band, str):
        return 0.5
    max_budget = promotion.budget.max_per_creator_usdc
    band_floor = {
        "under_250": 0,
        "250_400": 250,
        "400_700": 400,
        "700_plus": 700,
    }.get(band)
    if band_floor is None:
        return 0.5
    if max_budget < band_floor:
        return 0.2
    return {
        "under_250": 1.0,
        "250_400": 0.9,
        "400_700": 0.75,
        "700_plus": 0.55,
    }[band]


def _reliability_fit(projection: Mapping[str, object]) -> float:
    completed = projection.get("verifiedDealsCount")
    completion_rate = projection.get("completionRate")
    on_time_rate = projection.get("onTimeRate")
    cancellation_rate = projection.get("cancellationRate")
    completed_score = min(completed / 20, 1.0) if isinstance(completed, int) else 0.25
    completion = completion_rate if isinstance(completion_rate, int | float) else 0.75
    on_time = on_time_rate if isinstance(on_time_rate, int | float) else 0.75
    cancellation = cancellation_rate if isinstance(cancellation_rate, int | float) else 0.0
    adjusted = completed_score * 0.35 + completion * 0.3 + on_time * 0.25 + (1 - cancellation) * 0.1
    return round(max(min(adjusted, 1.0), 0.2), 6)


def _required_categories(promotion: Promotion) -> list[str]:
    return promotion.constraints.required_categories or [promotion.category]


def _primary_required_category(promotion: Promotion) -> str:
    categories = sorted(category_set(_required_categories(promotion)))
    return categories[0] if categories else ""


def _required_format(promotion: Promotion) -> str:
    return promotion.deliverables[0].format if promotion.deliverables else ""


def _required_str(document: Mapping[str, object], field_name: str) -> str:
    value = document.get(field_name)
    if not isinstance(value, str) or not value:
        raise ValueError(f"{field_name} must be a non-empty string")
    return value


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str)]


def _stable_creator_tiebreak(creator_id: str) -> str:
    return sha256(creator_id.encode("utf-8")).hexdigest()
