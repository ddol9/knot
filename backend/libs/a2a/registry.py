from collections.abc import Mapping


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
