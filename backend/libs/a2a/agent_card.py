def build_creator_agent_card(base_url: str) -> dict[str, object]:
    return {
        "name": "KNOT Creator Negotiation Agent",
        "description": "Evaluates and negotiates creator promotion offers.",
        "supportedInterfaces": [
            {
                "url": base_url,
                "protocolBinding": "HTTP+JSON",
                "protocolVersion": "1.0",
            }
        ],
        "provider": {"organization": "KNOT", "url": "https://knot.example"},
        "version": "1.0.0",
        "capabilities": {
            "streaming": True,
            "pushNotifications": False,
            "extendedAgentCard": False,
        },
        "defaultInputModes": ["application/json"],
        "defaultOutputModes": ["application/json"],
        "skills": [
            {
                "id": "promotion-negotiation",
                "name": "Promotion Negotiation",
                "description": "Returns counter, accept, reject or escalation decisions.",
                "tags": ["creator", "promotion", "negotiation"],
                "inputModes": ["application/json"],
                "outputModes": ["application/json"],
            }
        ],
    }


def build_brand_agent_card(base_url: str) -> dict[str, object]:
    return {
        "name": "KNOT Brand Negotiation Agent",
        "description": "Runs autonomous promotion negotiations against creator agents over A2A.",
        "supportedInterfaces": [
            {
                "url": base_url,
                "protocolBinding": "HTTP+JSON",
                "protocolVersion": "1.0",
            }
        ],
        "provider": {"organization": "KNOT", "url": "https://knot.example"},
        "version": "1.0.0",
        "capabilities": {
            "streaming": False,
            "pushNotifications": False,
            "extendedAgentCard": False,
        },
        "defaultInputModes": ["application/json"],
        "defaultOutputModes": ["application/json"],
        "skills": [
            {
                "id": "promotion-offer",
                "name": "Promotion Offer",
                "description": (
                    "Opens an offer, concedes within a private ceiling, accepts or walks away."
                ),
                "tags": ["brand", "promotion", "negotiation"],
                "inputModes": ["application/json"],
                "outputModes": ["application/json"],
            }
        ],
    }
