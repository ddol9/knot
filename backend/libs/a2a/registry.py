"""Creator agent registry entries: endpoint resolution, liveness and track record.

`agentRegistry/{agentId}` is the one document the brand side reads about an agent
before talking to it. Besides the static publication data it carries two kinds of
operational signal, both written from observed behaviour, never from policy:

* liveness  - `healthStatus`/`lastSeenAt`: creator agents heartbeat their own tenants,
              brand discovery records the outcome of each agent-card probe.
* track record - `negotiationStats`: how negotiations with this agent ended.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from libs.repositories.firestore_paths import FirestorePaths
from libs.repositories.store import KnotRepository

HEALTH_UP = "UP"
HEALTH_DOWN = "DOWN"
HEALTH_UNKNOWN = "UNKNOWN"

# Negotiation outcomes that count as an attempt the creator agent answered. A brand-side
# cancel (target reached elsewhere) says nothing about the creator and is tracked apart.
_ATTEMPT_OUTCOMES = {"AGREED", "REJECTED", "ESCALATED", "WALKED_AWAY", "ROUND_LIMIT"}
RECENT_OUTCOMES_LIMIT = 10
_STAT_FIELD = {
    "AGREED": "agreements",
    "REJECTED": "rejections",
    "ESCALATED": "escalations",
    "WALKED_AWAY": "walkedAway",
    "ROUND_LIMIT": "roundLimit",
    "CANCELED": "canceled",
}


def creator_agent_registry_entry(
    agent: Mapping[str, object],
    *,
    updated_at: str,
    base_url: str | None = None,
) -> dict[str, object]:
    agent_id = _required_str(agent, "agentId")
    return {
        "agentId": agent_id,
        "agentType": "CREATOR",
        "ownerId": agent.get("ownerId"),
        "ownerUid": agent.get("ownerUid"),
        "service": agent.get("service") or "knot-creator-agent",
        "status": agent.get("status") or "ACTIVE",
        "publicationStatus": agent.get("publicationStatus") or "DRAFT",
        "a2aEndpoint": agent.get("a2aEndpoint") or "/a2a/v1",
        # Full A2A base URL of the process hosting this tenant. Lets creator agents live on
        # different hosts; None means "the default creator service".
        "baseUrl": base_url or agent.get("a2aBaseUrl") or agent.get("baseUrl"),
        "protocolBinding": "HTTP+JSON",
        "protocolVersion": "1.0",
        "tenant": agent_id,
        "skillIds": ["promotion-negotiation", "sponsorship-negotiation"],
        "inputModes": ["application/json"],
        "outputModes": ["application/json"],
        "updatedAt": updated_at,
    }


def _required_str(document: Mapping[str, object], field_name: str) -> str:
    value = document.get(field_name)
    if not isinstance(value, str) or not value:
        raise ValueError(f"{field_name} must be a non-empty string")
    return value


def registry_base_url(
    entry: Mapping[str, object] | None,
    *,
    tenant: str,
    overrides: Mapping[str, str],
    default: str,
) -> str:
    """Resolve where to send A2A traffic for a tenant.

    Precedence: explicit override (env) > registry baseUrl > default creator service.
    """
    override = overrides.get(tenant)
    if override:
        return override.rstrip("/")
    if entry is not None:
        base_url = entry.get("baseUrl")
        if isinstance(base_url, str) and base_url:
            return base_url.rstrip("/")
    return default.rstrip("/")


# --- liveness --------------------------------------------------------------------------


def registry_health(entry: Mapping[str, object] | None) -> dict[str, Any]:
    if entry is None:
        return {"healthStatus": HEALTH_UNKNOWN, "lastSeenAt": None, "lastProbeError": None}
    status = entry.get("healthStatus")
    return {
        "healthStatus": status if status in (HEALTH_UP, HEALTH_DOWN) else HEALTH_UNKNOWN,
        "lastSeenAt": _optional_str(entry.get("lastSeenAt")),
        "lastProbeError": _optional_str(entry.get("lastProbeError")),
    }


def record_agent_heartbeat(
    repository: KnotRepository,
    agent_id: str,
    *,
    base_url: str,
    hosted_by: str,
    now: str,
) -> dict[str, Any]:
    """A creator agent process says "I host this tenant here, and I am alive"."""
    return _update_entry(
        repository,
        agent_id,
        {
            "baseUrl": base_url,
            "hostedBy": hosted_by,
            "healthStatus": HEALTH_UP,
            "lastSeenAt": now,
            "lastHeartbeatAt": now,
            "lastProbeError": None,
        },
        now=now,
    )


def record_agent_probe(
    repository: KnotRepository,
    agent_id: str,
    *,
    status: str,
    error: str | None,
    now: str,
) -> dict[str, Any]:
    """Brand-side observation: UP (card served, skill present), NO_SKILL or DOWN."""
    alive = status in (HEALTH_UP, "NO_SKILL")
    fields: dict[str, Any] = {
        "healthStatus": HEALTH_UP if alive else HEALTH_DOWN,
        "lastProbeAt": now,
        "lastProbeStatus": status,
        "lastProbeError": error,
    }
    if alive:
        fields["lastSeenAt"] = now
    return _update_entry(repository, agent_id, fields, now=now)


# --- track record ------------------------------------------------------------------------


class TrackRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    attempts: int = 0
    agreements: int = 0
    rejections: int = 0
    escalations: int = 0
    walked_away: int = Field(default=0, alias="walkedAway")
    round_limit: int = Field(default=0, alias="roundLimit")
    canceled: int = 0
    last_outcome: str | None = Field(default=None, alias="lastOutcome")
    last_negotiated_at: str | None = Field(default=None, alias="lastNegotiatedAt")
    # Most recent attempt outcomes, oldest first (bounded; governance anomaly flags read it).
    recent_outcomes: list[str] = Field(default_factory=list, alias="recentOutcomes")

    @property
    def agreement_rate(self) -> float:
        """Laplace-smoothed agreement rate: no history -> 0.5 (neutral)."""
        return round((self.agreements + 1) / (self.attempts + 2), 4)


def track_record(entry: Mapping[str, object] | None) -> TrackRecord:
    stats = entry.get("negotiationStats") if entry is not None else None
    if not isinstance(stats, Mapping):
        return TrackRecord()
    return TrackRecord.model_validate(dict(stats))


def record_negotiation_outcome(
    repository: KnotRepository,
    agent_id: str,
    *,
    outcome: str,
    now: str,
) -> TrackRecord:
    entry = repository.get_raw_document(FirestorePaths.agent_registry_entry(agent_id))
    record = track_record(entry)
    update: dict[str, Any] = {"lastOutcome": outcome, "lastNegotiatedAt": now}
    if outcome in _ATTEMPT_OUTCOMES:
        update["attempts"] = record.attempts + 1
        update["recentOutcomes"] = [*record.recent_outcomes, outcome][-RECENT_OUTCOMES_LIMIT:]
    field = _STAT_FIELD.get(outcome)
    if field is not None:
        current = record.model_dump(by_alias=True)[field]
        update[field] = int(current) + 1
    merged = TrackRecord.model_validate({**record.model_dump(by_alias=True), **update})
    _update_entry(
        repository,
        agent_id,
        {"negotiationStats": merged.model_dump(by_alias=True)},
        now=now,
        existing=entry,
    )
    return merged


# --- internals -------------------------------------------------------------------------


def _update_entry(
    repository: KnotRepository,
    agent_id: str,
    fields: Mapping[str, Any],
    *,
    now: str,
    existing: Mapping[str, object] | None = None,
) -> dict[str, Any]:
    path = FirestorePaths.agent_registry_entry(agent_id)
    entry = dict(existing if existing is not None else (repository.get_raw_document(path) or {}))
    if not entry:
        # Unknown to the registry: keep a minimal, clearly unpublished stub so operational
        # signals are not lost, without pretending the agent was published.
        entry = {"agentId": agent_id, "tenant": agent_id, "publicationStatus": "UNKNOWN"}
    entry.update(fields)
    entry["updatedAt"] = now
    repository.save_raw_document(path, entry)
    return entry


def _optional_str(value: object) -> str | None:
    return value if isinstance(value, str) and value else None
