"""Governance guardrails: deterministic settlement decisions and anomaly flags."""

from apps.brand_agent.main import demo_promotion
from libs.a2a.registry import TrackRecord, record_negotiation_outcome, track_record
from libs.policies.governance import (
    FLAG_CONSECUTIVE_FAILURES,
    FLAG_LOW_AGREEMENT_RATE,
    GOVERNANCE_RULE_VERSION,
    RULE_CAMPAIGN_TOTAL_LIMIT,
    RULE_PROMOTION_AUTO_ESCROW_DISABLED,
    RULE_SINGLE_AGREEMENT_LIMIT,
    GovernanceRules,
    evaluate_settlement,
    flag_track_record,
)
from libs.repositories.firestore_paths import FirestorePaths
from libs.repositories.store import InMemoryDocumentStore, KnotRepository
from libs.settings.config import Settings

RULES = GovernanceRules(maxAutoAgreementUsdc=500, maxAutoCampaignTotalUsdc=1000)


def _promotion(auto_escrow: bool = True):  # type: ignore[no-untyped-def]
    promotion = demo_promotion(category="beauty", max_per_creator_usdc=800, total_usdc=2000)
    return promotion.model_copy(
        update={"autonomy": promotion.autonomy.model_copy(update={"auto_escrow": auto_escrow})}
    )


# --- settlement ---------------------------------------------------------------------------


def test_defaults_come_from_settings_env_names() -> None:
    rules = GovernanceRules.from_settings(Settings())
    assert rules.max_auto_agreement_usdc == 800
    assert rules.max_auto_campaign_total_usdc == 2000
    assert rules.max_consecutive_failures == 3
    custom = GovernanceRules.from_settings(
        Settings(
            gov_max_auto_agreement_usdc=100,
            gov_max_auto_campaign_total_usdc=300,
            gov_max_consecutive_failures=2,
        )
    )
    assert (custom.max_auto_agreement_usdc, custom.max_auto_campaign_total_usdc) == (100, 300)
    assert custom.max_consecutive_failures == 2


def test_small_agreement_is_auto_fundable() -> None:
    decision = evaluate_settlement(
        RULES, agreement_amount_usdc=400, campaign_committed_usdc=400, promotion=_promotion()
    )
    assert decision.allowed_auto is True
    assert decision.requires_approval is False
    assert decision.reasons == []
    assert decision.rule_version == GOVERNANCE_RULE_VERSION


def test_single_agreement_over_limit_requires_a_person() -> None:
    decision = evaluate_settlement(
        RULES, agreement_amount_usdc=600, campaign_committed_usdc=600, promotion=_promotion()
    )
    assert decision.allowed_auto is False and decision.requires_approval is True
    assert decision.reasons == [RULE_SINGLE_AGREEMENT_LIMIT]


def test_cumulative_campaign_spend_over_limit_requires_a_person() -> None:
    # Each agreement is small, but the third one pushes the campaign past 1000.
    decision = evaluate_settlement(
        RULES, agreement_amount_usdc=400, campaign_committed_usdc=1200, promotion=_promotion()
    )
    assert decision.requires_approval is True
    assert decision.reasons == [RULE_CAMPAIGN_TOTAL_LIMIT]
    both = evaluate_settlement(
        RULES, agreement_amount_usdc=700, campaign_committed_usdc=1500, promotion=_promotion()
    )
    assert both.reasons == [RULE_SINGLE_AGREEMENT_LIMIT, RULE_CAMPAIGN_TOTAL_LIMIT]


def test_limits_are_inclusive() -> None:
    at_limit = evaluate_settlement(
        RULES, agreement_amount_usdc=500, campaign_committed_usdc=1000, promotion=_promotion()
    )
    assert at_limit.allowed_auto is True


def test_auto_escrow_off_is_not_queued_for_approval() -> None:
    # The promotion owner turned autonomy off: the manual funding path owns it, nothing to
    # approve. Still never auto-fundable.
    decision = evaluate_settlement(
        RULES,
        agreement_amount_usdc=900,
        campaign_committed_usdc=900,
        promotion=_promotion(auto_escrow=False),
    )
    assert decision.allowed_auto is False and decision.requires_approval is False
    assert decision.reasons == [RULE_SINGLE_AGREEMENT_LIMIT, RULE_PROMOTION_AUTO_ESCROW_DISABLED]


# --- anomaly flags ----------------------------------------------------------------------


def test_no_history_is_not_flagged() -> None:
    assert flag_track_record(GovernanceRules(), TrackRecord()) is None


def test_consecutive_failures_are_flagged_and_an_agreement_clears_it() -> None:
    rules = GovernanceRules(maxConsecutiveFailures=3)
    record = TrackRecord(attempts=3, rejections=3, recentOutcomes=["REJECTED"] * 3)
    flag = flag_track_record(rules, record)
    assert flag is not None and flag.code == FLAG_CONSECUTIVE_FAILURES
    assert flag.rule_version == GOVERNANCE_RULE_VERSION
    # Two failures are below the window.
    assert (
        flag_track_record(rules, TrackRecord(attempts=2, recentOutcomes=["REJECTED"] * 2)) is None
    )
    # A recent agreement breaks the streak even with older failures.
    recovered = TrackRecord(
        attempts=4, agreements=1, recentOutcomes=["REJECTED", "REJECTED", "AGREED", "WALKED_AWAY"]
    )
    assert flag_track_record(rules, recovered) is None


def test_low_agreement_rate_needs_enough_attempts() -> None:
    rules = GovernanceRules(maxConsecutiveFailures=10)  # keep the streak rule out of the way
    few = TrackRecord(attempts=3, recentOutcomes=["REJECTED", "ESCALATED", "ROUND_LIMIT"])
    assert flag_track_record(rules, few) is None
    many = TrackRecord(attempts=8, agreements=0, recentOutcomes=["REJECTED"] * 8)
    flag = flag_track_record(rules, many)
    assert flag is not None and flag.code == FLAG_LOW_AGREEMENT_RATE


def test_registry_keeps_recent_outcomes_for_the_flag() -> None:
    repository = KnotRepository(InMemoryDocumentStore())
    for outcome in ("AGREED", "CANCELED", "REJECTED", "WALKED_AWAY", "ESCALATED"):
        record_negotiation_outcome(repository, "agent-x", outcome=outcome, now="t")
    record = track_record(
        repository.get_raw_document(FirestorePaths.agent_registry_entry("agent-x"))
    )
    # Brand-side cancels are not attempts and do not enter the streak.
    assert record.recent_outcomes == ["AGREED", "REJECTED", "WALKED_AWAY", "ESCALATED"]
    assert flag_track_record(GovernanceRules(), record) is not None
