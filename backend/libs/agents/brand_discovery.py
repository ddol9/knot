"""Brand-side creator agent discovery.

Four-stage funnel, cheapest first:
  1. public projection query  (creatorDiscoveryProfiles, indexed; discovery.py)
  2. projection ranking        (discovery.py)      -> coarse score, hard filters
  3. full-profile refinement   (matching.py)       -> precise hard filters / score
  4. liveness probe            (A2A agent card)    -> drop dead / incapable agents

Only public data is read. Creator policies (exact minimums etc.) never leave the
creator agent; the brand learns them through COUNTER messages, not discovery.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from libs.a2a.registry import (
    record_agent_probe,
    registry_base_url,
    registry_health,
    track_record,
)
from libs.agents.discovery import (
    FirestoreCreatorDiscoveryRepository,
    detail_candidates,
    rank_discovery_candidates,
)
from libs.agents.matching import score_creator
from libs.domain.models import CreatorProfile, Promotion
from libs.repositories.firestore_paths import FirestorePaths
from libs.repositories.store import KnotRepository

NEGOTIATION_SKILL_ID = "promotion-negotiation"
# Operational signals adjust the order, not the matching score itself.
DOWN_RANK_MULTIPLIER = 0.85  # last known DOWN: probe later, but still probe
TRACK_RECORD_WEIGHT = 0.05  # +-0.025 around a neutral (0.5) agreement rate

# (base_url) -> agent card dict; raises on failure.
CardProbe = Callable[[str], dict[str, Any]]


class CandidateAgent(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    creator_agent_id: str = Field(alias="creatorAgentId")
    creator_id: str = Field(alias="creatorId")
    display_name: str = Field(alias="displayName")
    base_url: str = Field(alias="baseUrl")
    rank: int | None = None
    eligible: bool
    score: float
    score_components: dict[str, float] = Field(alias="scoreComponents")
    hard_filter_reasons: list[str] = Field(default_factory=list, alias="hardFilterReasons")
    public_rate_band: str | None = Field(default=None, alias="publicRateBand")
    categories: list[str] = Field(default_factory=list)
    completed_deal_count: int = Field(default=0, alias="completedDealCount")
    card_status: str = Field(
        default="SKIPPED", alias="cardStatus"
    )  # UP / DOWN / NO_SKILL / SKIPPED
    card_error: str | None = Field(default=None, alias="cardError")
    selected: bool = False
    # From the registry (observed, never policy): liveness + how past negotiations ended.
    health_status: str = Field(default="UNKNOWN", alias="healthStatus")
    last_seen_at: str | None = Field(default=None, alias="lastSeenAt")
    track_record: dict[str, Any] = Field(default_factory=dict, alias="trackRecord")
    rank_score: float = Field(default=0.0, alias="rankScore")


class DiscoveryReport(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    promotion_id: str = Field(alias="promotionId")
    queried: int
    ranked: int
    probed: int
    candidates: list[CandidateAgent]

    @property
    def selected(self) -> list[CandidateAgent]:
        return [c for c in self.candidates if c.selected]


def discover_creator_agents(
    repository: KnotRepository,
    promotion: Promotion,
    *,
    limit: int = 5,
    default_base_url: str,
    endpoint_overrides: Mapping[str, str] | None = None,
    card_probe: CardProbe | None = None,
    probe_workers: int = 5,
    record_probes: bool = True,
) -> tuple[DiscoveryReport, dict[str, CreatorProfile]]:
    """Return the funnel result plus the full profiles of everything that reached stage 3."""
    overrides = dict(endpoint_overrides or {})

    # 1 + 2: public projections, coarse rank.
    search = FirestoreCreatorDiscoveryRepository(repository).search(promotion, limit=limit * 4)
    ranked = rank_discovery_candidates(promotion, search.projections)

    # 3: read full profiles for the eligible head of the list and re-check precisely.
    eligible_ranked = [c for c in ranked if c.eligible]
    detailed, _ = detail_candidates(repository, eligible_ranked, limit=limit * 2)
    profiles: dict[str, CreatorProfile] = {}
    candidates: list[CandidateAgent] = []
    for coarse, profile in detailed:
        precise = score_creator(promotion, profile)
        entry = repository.get_raw_document(
            FirestorePaths.agent_registry_entry(profile.creator_agent_id)
        )
        base_url = registry_base_url(
            entry, tenant=profile.creator_agent_id, overrides=overrides, default=default_base_url
        )
        profiles[profile.creator_agent_id] = profile
        health = registry_health(entry)
        record = track_record(entry)
        candidates.append(
            CandidateAgent(
                creatorAgentId=profile.creator_agent_id,
                creatorId=profile.creator_id,
                displayName=profile.display_name,
                baseUrl=base_url,
                eligible=precise.eligible,
                score=precise.score,
                scoreComponents=precise.component_scores.model_dump(),
                hardFilterReasons=precise.hard_filter_reasons,
                publicRateBand=_optional_str(coarse.projection.get("publicRateBand")),
                categories=list(profile.categories),
                completedDealCount=profile.completed_deal_count,
                healthStatus=health["healthStatus"],
                lastSeenAt=health["lastSeenAt"],
                trackRecord={
                    "attempts": record.attempts,
                    "agreements": record.agreements,
                    "agreementRate": record.agreement_rate,
                    "lastOutcome": record.last_outcome,
                },
                rankScore=rank_score(
                    precise.score if precise.eligible else 0.0,
                    health_status=health["healthStatus"],
                    agreement_rate=record.agreement_rate,
                ),
            )
        )

    # Coarse-stage rejects are reported too so the UI can show why they fell out.
    for coarse in ranked:
        if coarse.eligible:
            continue
        candidates.append(
            CandidateAgent(
                creatorAgentId=coarse.creator_agent_id,
                creatorId=coarse.creator_id,
                displayName=_optional_str(coarse.projection.get("displayName"))
                or coarse.creator_id,
                baseUrl=registry_base_url(
                    None,
                    tenant=coarse.creator_agent_id,
                    overrides=overrides,
                    default=default_base_url,
                ),
                eligible=False,
                score=0.0,
                scoreComponents={},
                hardFilterReasons=coarse.hard_filter_reasons,
                publicRateBand=_optional_str(coarse.projection.get("publicRateBand")),
            )
        )

    candidates.sort(
        key=lambda c: (
            not c.eligible,
            -c.rank_score,
            -c.score,
            -c.completed_deal_count,
            c.creator_agent_id,
        )
    )
    rank = 1
    for candidate in candidates:
        if candidate.eligible:
            candidate.rank = rank
            rank += 1

    # 4: probe the top `limit` eligible agents in parallel.
    head = [c for c in candidates if c.eligible][:limit]
    if card_probe is not None and head:
        with ThreadPoolExecutor(max_workers=max(1, min(probe_workers, len(head)))) as pool:
            results = list(pool.map(lambda c: _probe(card_probe, c.base_url), head))
        now = datetime.now(UTC).isoformat()
        for candidate, (status, error) in zip(head, results, strict=True):
            candidate.card_status = status
            candidate.card_error = error
            candidate.selected = status == "UP"
            if record_probes:
                # Feed the observation back so the next discovery orders by it.
                record_agent_probe(
                    repository, candidate.creator_agent_id, status=status, error=error, now=now
                )
    else:
        for candidate in head:
            candidate.selected = True

    report = DiscoveryReport(
        promotionId=promotion.promotion_id,
        queried=len(search.projections),
        ranked=len(ranked),
        probed=len(head) if card_probe is not None else 0,
        candidates=candidates,
    )
    return report, profiles


def rank_score(score: float, *, health_status: str, agreement_rate: float) -> float:
    """Matching score nudged by liveness and track record (neutral history = unchanged)."""
    multiplier = DOWN_RANK_MULTIPLIER if health_status == "DOWN" else 1.0
    return round(score * multiplier + TRACK_RECORD_WEIGHT * (agreement_rate - 0.5), 4)


def _probe(card_probe: CardProbe, base_url: str) -> tuple[str, str | None]:
    try:
        card = card_probe(base_url)
    except Exception as exc:  # any transport error = agent is down for our purposes
        return "DOWN", str(exc)[:200]
    skills = card.get("skills") if isinstance(card, dict) else None
    skill_ids = (
        {s.get("id") for s in skills if isinstance(s, dict)} if isinstance(skills, list) else set()
    )
    if NEGOTIATION_SKILL_ID not in skill_ids:
        return "NO_SKILL", f"agent card lacks skill {NEGOTIATION_SKILL_ID}"
    return "UP", None


def _optional_str(value: object) -> str | None:
    return value if isinstance(value, str) and value else None
