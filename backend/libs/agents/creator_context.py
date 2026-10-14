"""Resolve a creator agent's private negotiation context from the repository.

Used by the creator agent service (multi-tenant hosting) and by the product API's
in-process A2A mode, so both read exactly the same policy source and neither needs
the brand to send policy over the wire.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import date

from libs.agents.negotiation import CreatorNegotiationContext
from libs.repositories.store import KnotRepository

ContextResolver = Callable[[str], CreatorNegotiationContext | None]


def repository_context_resolver(
    repository: KnotRepository, *, today: Callable[[], date] = date.today
) -> ContextResolver:
    def resolve(tenant: str) -> CreatorNegotiationContext | None:
        creator = repository.get_creator_profile_by_agent_id(tenant)
        if creator is None or not creator.active:
            return None
        policy = repository.get_agent_policy(tenant)
        if policy is None or not policy.active:
            return None
        return CreatorNegotiationContext(
            creatorAgentId=tenant,
            policy=policy.creator,
            today=today(),
            currentMonthDeliverables=creator.active_deliverables_this_month,
        )

    return resolve
