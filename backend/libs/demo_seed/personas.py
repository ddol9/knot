from collections import Counter
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any
from urllib.parse import quote

from libs.a2a.registry import creator_agent_registry_entry
from libs.domain.discovery import build_creator_discovery_projection
from libs.domain.models import AgentPolicy, CreatorProfile, RateCard, UsageRights
from libs.repositories.firestore_paths import FirestorePaths
from libs.repositories.serialization import model_to_document

DEMO_NAMESPACE = "knot-demo-persona-v1"
DEMO_SOURCE = "PUBLIC_DATA"
SYNTHETIC_PROVENANCE = "SYNTHETIC_DEMO"
AI_PROVENANCE = "AI_DERIVED"
DEMO_AUTH_PASSWORD = "000000"
DEMO_CREATOR_SETTLEMENT_WALLET = "BTsMioiaKhxQzPBJV2hNYp6xHovY85dnE73v6CSqRQsX"
DEMO_AUTH_ALIASES = (
    {
        "uid": "user-brand-1",
        "email": "t1@knot.com",
        "targetType": "BRAND",
        "targetId": "brand-demo-cheriexx",
    },
    {
        "uid": "user-creator-1",
        "email": "c1@knot.com",
        "targetType": "CREATOR",
        "targetId": "creator-demo-ssin",
    },
)


@dataclass(frozen=True)
class PersonaDocumentSet:
    documents: list[tuple[str, dict[str, object]]]
    brand_ids: list[str]
    creator_ids: list[str]
    promotion_ids: list[str]


def build_demo_persona_documents(
    *,
    today: date | None = None,
    refreshed_snapshots: Mapping[str, Mapping[str, object]] | None = None,
) -> PersonaDocumentSet:
    seed_today = today or date.today()
    collected_at = _now()
    docs: list[tuple[str, dict[str, object]]] = []
    brand_ids: list[str] = []
    creator_ids: list[str] = []
    promotion_ids: list[str] = []
    snapshots = dict(refreshed_snapshots or {})

    for brand in BRAND_SEEDS:
        brand_id = str(brand["brandId"])
        brand_agent_id = str(brand["brandAgentId"])
        brand_ids.append(brand_id)
        docs.append(
            (
                FirestorePaths.user(_brand_demo_uid(brand)),
                _brand_demo_user_document(brand, collected_at),
            )
        )
        docs.append((FirestorePaths.brand(brand_id), _brand_document(brand, collected_at)))
        docs.append(
            (FirestorePaths.agent(brand_agent_id), _brand_agent_document(brand, collected_at))
        )
        docs.append(
            (
                FirestorePaths.agent_policy(brand_agent_id),
                _brand_policy_document(brand, collected_at),
            )
        )
        if brand.get("demoScenario"):
            promotion = _promotion_document(brand, seed_today, collected_at)
            promotion_ids.append(str(promotion["promotionId"]))
            docs.append((FirestorePaths.promotion(str(promotion["promotionId"])), promotion))

    for creator in CREATOR_SEEDS:
        creator_id = str(creator["creatorId"])
        creator_agent_id = str(creator["creatorAgentId"])
        creator_ids.append(creator_id)
        docs.append(
            (
                FirestorePaths.user(_creator_demo_uid(creator)),
                _creator_demo_user_document(creator, collected_at),
            )
        )
        snapshot = dict(snapshots.get(creator_id) or _fallback_snapshot(creator, collected_at))
        snapshot_id = str(snapshot["snapshotId"])
        docs.append((FirestorePaths.social_snapshot(snapshot_id), snapshot))

        creator_profile = _creator_profile_document(creator, snapshot, seed_today, collected_at)
        docs.append((FirestorePaths.creator_profile(creator_id), creator_profile))

        agent = _creator_agent_document(creator, collected_at)
        docs.append((FirestorePaths.agent(creator_agent_id), agent))
        docs.append(
            (FirestorePaths.agent_policy(creator_agent_id), _creator_policy_document(creator))
        )
        docs.append(
            (
                FirestorePaths.creator_discovery_profile(creator_id),
                _creator_discovery_document(creator_profile, agent, snapshot, collected_at),
            )
        )
        docs.append(
            (
                FirestorePaths.agent_registry_entry(creator_agent_id),
                creator_agent_registry_entry(agent, updated_at=collected_at),
            )
        )

    docs.extend(_demo_auth_alias_documents(collected_at))

    docs.append((FirestorePaths.analysis_job("demo-persona-unresolved-candidates"), {
        "analysisId": "demo-persona-unresolved-candidates",
        "demoNamespace": DEMO_NAMESPACE,
        "type": "DEMO_PERSONA_UNRESOLVED_SOCIAL_CANDIDATES",
        "status": "COMPLETED",
        "items": UNRESOLVED_SOCIAL_CANDIDATES,
        "createdAt": collected_at,
        "updatedAt": collected_at,
    }))
    return PersonaDocumentSet(
        documents=docs,
        brand_ids=brand_ids,
        creator_ids=creator_ids,
        promotion_ids=promotion_ids,
    )


def validate_demo_persona_documents(document_set: PersonaDocumentSet) -> list[str]:
    errors: list[str] = []
    by_path = {path: document for path, document in document_set.documents}
    if len(document_set.brand_ids) != 10:
        errors.append(f"expected 10 brands, got {len(document_set.brand_ids)}")
    if len(document_set.creator_ids) < 10:
        errors.append(f"expected at least 10 creators, got {len(document_set.creator_ids)}")

    category_counts: Counter[str] = Counter()
    for creator_id in document_set.creator_ids:
        profile = by_path.get(FirestorePaths.creator_profile(creator_id))
        discovery = by_path.get(FirestorePaths.creator_discovery_profile(creator_id))
        if profile is None:
            errors.append(f"{creator_id}: creator profile missing")
            continue
        if discovery is None:
            errors.append(f"{creator_id}: discovery profile missing")
            continue
        categories = _string_list(profile.get("categories"))
        category_counts.update(item for item in categories if item in REQUIRED_CREATOR_CATEGORIES)
        if not profile.get("platforms"):
            errors.append(f"{creator_id}: platform data missing")
        agent_id = profile.get("creatorAgentId")
        if not isinstance(agent_id, str):
            errors.append(f"{creator_id}: creatorAgentId missing")
            continue
        for path in (FirestorePaths.agent(agent_id), FirestorePaths.agent_policy(agent_id)):
            if path not in by_path:
                errors.append(f"{creator_id}: required document missing: {path}")
        if discovery.get("agentStatus") != "PUBLISHED":
            errors.append(f"{creator_id}: discovery agentStatus is not PUBLISHED")
        if discovery.get("acceptingOffers") is not True:
            errors.append(f"{creator_id}: acceptingOffers is not true")
        if discovery.get("capacityAvailable") is not True:
            errors.append(f"{creator_id}: capacityAvailable is not true")

    for category in REQUIRED_CREATOR_CATEGORIES:
        if category_counts[category] < 2:
            errors.append(f"category {category} needs at least 2 creators")
    return errors


def document_paths_for_reset(document_set: PersonaDocumentSet) -> list[str]:
    return [path for path, _ in document_set.documents]


def _brand_document(seed: Mapping[str, object], collected_at: str) -> dict[str, object]:
    logo_url = str(seed.get("logoUrl") or _demo_avatar_url(str(seed["displayName"]), "brand"))
    return {
        "brandId": seed["brandId"],
        "displayName": seed["displayName"],
        "logoUrl": logo_url,
        "logoImageUrl": logo_url,
        "imageSource": {
            "type": "GENERATED_DEMO_INITIALS",
            "provenance": SYNTHETIC_PROVENANCE,
        },
        "websiteUrl": seed.get("websiteUrl"),
        "categories": seed["categories"],
        "targetAudience": seed["targetAudience"],
        "description": seed["description"],
        "socialProfiles": seed["socialProfiles"],
        "publicSources": seed["publicSources"],
        "dataUsage": _data_usage(demo_permission=bool(seed.get("demoPermission"))),
        "demoNamespace": DEMO_NAMESPACE,
        "profileType": "DEMO_SEED",
        "demoAuth": {
            "uid": _brand_demo_uid(seed),
            "email": _brand_demo_email(seed),
            "passwordHint": DEMO_AUTH_PASSWORD,
        },
        "active": True,
        "createdAt": collected_at,
        "updatedAt": collected_at,
    }


def _brand_agent_document(seed: Mapping[str, object], collected_at: str) -> dict[str, object]:
    return {
        "agentId": seed["brandAgentId"],
        "agentType": "BRAND",
        "ownerId": seed["brandId"],
        "ownerType": "BRAND",
        "displayName": f"{seed['displayName']} 브랜드 에이전트",
        "service": "knot-api",
        "status": "ACTIVE",
        "demoNamespace": DEMO_NAMESPACE,
        "active": True,
        "createdAt": collected_at,
        "updatedAt": collected_at,
    }


def _brand_policy_document(seed: Mapping[str, object], collected_at: str) -> dict[str, object]:
    policy = dict(_required_mapping(seed, "agentPolicy"))
    return {
        "agentId": seed["brandAgentId"],
        "policyVersion": 1,
        "agentType": "BRAND",
        "brand": policy,
        "syntheticFields": sorted(policy),
        "provenance": SYNTHETIC_PROVENANCE,
        "demoNamespace": DEMO_NAMESPACE,
        "active": True,
        "createdAt": collected_at,
    }


def _promotion_document(
    seed: Mapping[str, object],
    today: date,
    collected_at: str,
) -> dict[str, object]:
    scenario = _required_mapping(seed, "demoScenario")
    policy = _required_mapping(seed, "agentPolicy")
    start = today + timedelta(days=int(scenario.get("startInDays", 14)))
    end = start + timedelta(days=int(scenario.get("windowDays", 7)))
    promotion_id = f"promotion-demo-{seed['slug']}"
    return {
        "promotionId": promotion_id,
        "brandId": seed["brandId"],
        "brandAgentId": seed["brandAgentId"],
        "title": scenario["title"],
        "objective": scenario["objective"],
        "category": scenario["category"],
        "targetAudience": scenario["targetAudience"],
        "productName": scenario["productName"],
        "productSnapshot": {
            "name": scenario["productName"],
            "category": scenario["category"],
            "summary": scenario["summary"],
            "provenance": SYNTHETIC_PROVENANCE,
        },
        "budget": {
            "totalUsdc": policy["campaignBudgetUsdc"],
            "maxPerCreatorUsdc": policy["maximumCreatorRateUsdc"],
        },
        "initialOffer": policy["targetCreatorRateUsdc"],
        "deliverables": [{"format": scenario["format"], "count": 1}],
        "postingWindow": {"start": start.isoformat(), "end": end.isoformat()},
        "usageRights": scenario["usageRights"],
        "constraints": {
            "requiredDisclosures": ["ad"],
            "prohibitedClaims": scenario.get("prohibitedClaims", []),
            "requiredCategories": [scenario["category"]],
            "prohibitedCategories": ["gambling", "tobacco"],
            "maxPerformancePct": int(scenario.get("maxPerformancePct", 0)),
        },
        "autonomy": {
            "maxNegotiationRounds": policy["maximumNegotiationRounds"],
            "autoEscrow": True,
            "autoRelease": True,
        },
        "status": "ACTIVE",
        "dataUsage": _data_usage(demo_permission=bool(seed.get("demoPermission"))),
        "syntheticFields": [
            "productSnapshot",
            "budget",
            "initialOffer",
            "postingWindow",
            "constraints",
            "autonomy",
        ],
        "demoNamespace": DEMO_NAMESPACE,
        "createdAt": collected_at,
        "updatedAt": collected_at,
    }


def _brand_demo_user_document(
    seed: Mapping[str, object],
    collected_at: str,
    *,
    uid: str | None = None,
    email: str | None = None,
) -> dict[str, object]:
    uid = uid or _brand_demo_uid(seed)
    return {
        "uid": uid,
        "userId": uid,
        "email": email or _brand_demo_email(seed),
        "displayName": seed["displayName"],
        "role": "BRAND",
        "onboardingStatus": "COMPLETED",
        "status": "ACTIVE",
        "brandId": seed["brandId"],
        "agentId": seed["brandAgentId"],
        "brandAgentId": seed["brandAgentId"],
        "environment": "demo",
        "profileType": "DEMO_SEED",
        "demoNamespace": DEMO_NAMESPACE,
        "dataUsage": _data_usage(demo_permission=bool(seed.get("demoPermission"))),
        "createdAt": collected_at,
        "updatedAt": collected_at,
    }


def _creator_profile_document(
    seed: Mapping[str, object],
    snapshot: Mapping[str, object],
    today: date,
    collected_at: str,
) -> dict[str, object]:
    policy = _required_mapping(seed, "demoPolicy")
    creator = CreatorProfile(
        creatorId=str(seed["creatorId"]),
        creatorAgentId=str(seed["creatorAgentId"]),
        displayName=str(seed["displayName"]),
        categories=list(seed["categories"]),  # type: ignore[arg-type]
        prohibitedIndustries=list(policy.get("blockedIndustries", [])),
        supportedDeliverableFormats=list(seed["formats"]),  # type: ignore[arg-type]
        allowedUsageRights=list(policy["allowedUsageRights"]),  # type: ignore[arg-type]
        minDaysToPost=int(policy["minDaysToPost"]),
        availableFrom=today + timedelta(days=int(seed.get("availableInDays", -2))),
        monthlyCapacity=int(policy["maxDeliverablesPerMonth"]),
        activeDeliverablesThisMonth=0,
        completedDealCount=int(seed.get("completedDealCount", 0)),
        rateCard=RateCard(
            minBaseUsdc=int(policy["minBaseUsdc"]),
            maxBaseUsdc=int(policy["maxBaseUsdc"]),
        ),
        active=True,
    )
    document = model_to_document(creator)
    snapshot_image_url = _snapshot_thumbnail(snapshot)
    profile_image_url = snapshot_image_url or _demo_avatar_url(
        str(seed["displayName"]),
        "creator",
    )
    document.update(
        {
            "profileImageUrl": profile_image_url,
            "imageSource": {
                "type": "PUBLIC_PROFILE_IMAGE" if snapshot_image_url else "GENERATED_DEMO_INITIALS",
                "provenance": DEMO_SOURCE if snapshot_image_url else SYNTHETIC_PROVENANCE,
            },
            "profileType": "DEMO_SEED",
            "primaryPlatform": seed["primaryPlatform"],
            "demoAuth": {
                "uid": _creator_demo_uid(seed),
                "email": _creator_demo_email(seed),
                "passwordHint": DEMO_AUTH_PASSWORD,
            },
            "platforms": snapshot.get("normalizedPlatforms", {}),
            "publicProfile": {
                "source": snapshot.get("source"),
                "observed": snapshot.get("observed", {}),
            },
            "contentProfile": {
                "provenance": AI_PROVENANCE,
                **dict(seed.get("contentProfile", {})),
            },
            "matchingProfile": {
                "brandFitNotes": seed.get("brandFitNotes", []),
                "derivedMetricFields": seed.get("derivedMetricFields", []),
            },
            "dataUsage": _data_usage(demo_permission=False),
            "walletAddress": str(seed.get("demoSettlementWallet", DEMO_CREATOR_SETTLEMENT_WALLET)),
            "walletNetwork": "devnet",
            "walletCustody": "DEMO_SEEDED_DESTINATION",
            "walletSource": {
                "provenance": SYNTHETIC_PROVENANCE,
                "purpose": "Solana devnet escrow settlement demo destination",
            },
            "syntheticFields": [
                "rateCard",
                "minDaysToPost",
                "monthlyCapacity",
                "prohibitedIndustries",
                "allowedUsageRights",
                "availableFrom",
                "completedDealCount",
                "demoNegotiationPersona",
                "walletAddress",
                "walletNetwork",
                "walletCustody",
                "walletSource",
            ],
            "demoNegotiationPersona": {
                "label": seed["persona"],
                "provenance": SYNTHETIC_PROVENANCE,
            },
            "analysisRef": FirestorePaths.social_snapshot(str(snapshot["snapshotId"])),
            "demoNamespace": DEMO_NAMESPACE,
            "createdAt": collected_at,
            "updatedAt": collected_at,
        }
    )
    return document


def _creator_demo_user_document(
    seed: Mapping[str, object],
    collected_at: str,
    *,
    uid: str | None = None,
    email: str | None = None,
) -> dict[str, object]:
    uid = uid or _creator_demo_uid(seed)
    return {
        "uid": uid,
        "userId": uid,
        "email": email or _creator_demo_email(seed),
        "displayName": seed["displayName"],
        "role": "CREATOR",
        "onboardingStatus": "COMPLETED",
        "status": "ACTIVE",
        "creatorId": seed["creatorId"],
        "agentId": seed["creatorAgentId"],
        "creatorAgentId": seed["creatorAgentId"],
        "environment": "demo",
        "profileType": "DEMO_SEED",
        "demoNamespace": DEMO_NAMESPACE,
        "dataUsage": _data_usage(demo_permission=False),
        "createdAt": collected_at,
        "updatedAt": collected_at,
    }


def _creator_agent_document(seed: Mapping[str, object], collected_at: str) -> dict[str, object]:
    return {
        "agentId": seed["creatorAgentId"],
        "agentType": "CREATOR",
        "ownerId": seed["creatorId"],
        "ownerType": "CREATOR",
        "displayName": f"{seed['displayName']} 크리에이터 에이전트",
        "service": "knot-creator-agent",
        "a2aEndpoint": "/a2a/v1",
        "status": "ACTIVE",
        "publicationStatus": "PUBLISHED",
        "acceptingOffers": True,
        "availability": "AVAILABLE",
        "activeNegotiations": 0,
        "maxConcurrentNegotiations": 2,
        "activeCollaborations": 0,
        "maxActiveCollaborations": 3,
        "profileRef": FirestorePaths.creator_profile(str(seed["creatorId"])),
        "policyRef": FirestorePaths.agent_policy(str(seed["creatorAgentId"])),
        "demoNamespace": DEMO_NAMESPACE,
        "active": True,
        "createdAt": collected_at,
        "updatedAt": collected_at,
    }


def _creator_policy_document(seed: Mapping[str, object]) -> dict[str, object]:
    policy = _required_mapping(seed, "demoPolicy")
    model = AgentPolicy(
        agentId=str(seed["creatorAgentId"]),
        policyVersion=1,
        agentType="CREATOR",
        creator={
            "minBaseUsdc": policy["minBaseUsdc"],
            "blockedIndustries": policy.get("blockedIndustries", []),
            "maxDeliverablesPerMonth": policy["maxDeliverablesPerMonth"],
            "minDaysToPost": policy["minDaysToPost"],
            "allowedUsageRights": policy["allowedUsageRights"],
            "maxRevisionRounds": policy.get("maxRevisionRounds", 1),
            "maxExclusivityDays": policy.get("maxExclusivityDays", 0),
        },
        active=True,
    )
    document = model_to_document(model)
    document.update(
        {
            "demoPersona": {
                "label": seed["persona"],
                "description": seed["personaDescription"],
                "provenance": SYNTHETIC_PROVENANCE,
            },
            "syntheticFields": [
                "creator.minBaseUsdc",
                "creator.blockedIndustries",
                "creator.maxDeliverablesPerMonth",
                "creator.minDaysToPost",
                "creator.allowedUsageRights",
                "creator.maxRevisionRounds",
                "creator.maxExclusivityDays",
            ],
            "demoNamespace": DEMO_NAMESPACE,
        }
    )
    return document


def _creator_discovery_document(
    creator_document: Mapping[str, object],
    agent: Mapping[str, object],
    snapshot: Mapping[str, object],
    collected_at: str,
) -> dict[str, object]:
    creator = CreatorProfile.model_validate(creator_document)
    projection = build_creator_discovery_projection(creator, agent, updated_at=collected_at)
    observed = _required_mapping(snapshot, "observed")
    metrics = _required_mapping(observed, "metrics")
    projection.update(
        {
            "profileImageUrl": creator_document.get("profileImageUrl"),
            "platformKeys": list(_required_mapping(creator_document, "platforms")),
            "averageRecentViews": metrics.get("averageRecentViews"),
            "medianRecentViews": metrics.get("medianRecentViews"),
            "subscriberOrFollowerCount": metrics.get("subscriberOrFollowerCount"),
            "contentKeywords": _required_mapping(creator_document, "contentProfile").get(
                "contentKeywords", []
            ),
            "matchReasons": _match_reasons(creator_document, metrics),
            "publicDataRef": creator_document.get("analysisRef"),
            "demoNamespace": DEMO_NAMESPACE,
        }
    )
    return projection


def demo_auth_users() -> list[dict[str, object]]:
    users: list[dict[str, object]] = []
    for brand in BRAND_SEEDS:
        users.append(
            {
                "uid": _brand_demo_uid(brand),
                "email": _brand_demo_email(brand),
                "displayName": str(brand["displayName"]),
                "role": "BRAND",
                "profileId": str(brand["brandId"]),
            }
        )
    for creator in CREATOR_SEEDS:
        users.append(
            {
                "uid": _creator_demo_uid(creator),
                "email": _creator_demo_email(creator),
                "displayName": str(creator["displayName"]),
                "role": "CREATOR",
                "profileId": str(creator["creatorId"]),
            }
        )
    by_brand = {str(brand["brandId"]): brand for brand in BRAND_SEEDS}
    by_creator = {str(creator["creatorId"]): creator for creator in CREATOR_SEEDS}
    for alias in DEMO_AUTH_ALIASES:
        target_type = str(alias["targetType"])
        target_id = str(alias["targetId"])
        if target_type == "BRAND":
            display_name = str(by_brand[target_id]["displayName"])
        else:
            display_name = str(by_creator[target_id]["displayName"])
        users.append(
            {
                "uid": str(alias["uid"]),
                "email": str(alias["email"]),
                "displayName": display_name,
                "role": target_type,
                "profileId": target_id,
            }
        )
    return users


def _demo_auth_alias_documents(collected_at: str) -> list[tuple[str, dict[str, object]]]:
    by_brand = {str(brand["brandId"]): brand for brand in BRAND_SEEDS}
    by_creator = {str(creator["creatorId"]): creator for creator in CREATOR_SEEDS}
    documents: list[tuple[str, dict[str, object]]] = []
    for alias in DEMO_AUTH_ALIASES:
        uid = str(alias["uid"])
        email = str(alias["email"])
        target_type = str(alias["targetType"])
        target_id = str(alias["targetId"])
        if target_type == "BRAND":
            document = _brand_demo_user_document(
                by_brand[target_id],
                collected_at,
                uid=uid,
                email=email,
            )
        else:
            document = _creator_demo_user_document(
                by_creator[target_id],
                collected_at,
                uid=uid,
                email=email,
            )
        document["demoAlias"] = True
        document["aliasTargetId"] = target_id
        documents.append((FirestorePaths.user(uid), document))
    return documents


def _brand_demo_uid(seed: Mapping[str, object]) -> str:
    return f"user-{seed['brandId']}"


def _brand_demo_email(seed: Mapping[str, object]) -> str:
    return f"{seed['brandId']}@knot.demo"


def _creator_demo_uid(seed: Mapping[str, object]) -> str:
    return f"user-{seed['creatorId']}"


def _creator_demo_email(seed: Mapping[str, object]) -> str:
    return f"{seed['creatorId']}@knot.demo"


def _fallback_snapshot(seed: Mapping[str, object], collected_at: str) -> dict[str, object]:
    observed = dict(seed["observed"])  # type: ignore[arg-type]
    platforms = dict(seed["platforms"])  # type: ignore[arg-type]
    primary_platform = str(seed["primaryPlatform"])
    return {
        "snapshotId": f"snapshot-{seed['creatorId']}",
        "provider": "fixture-fallback",
        "sourceUrl": _platform_url(platforms, primary_platform),
        "source": {
            "platform": primary_platform,
            "url": _platform_url(platforms, primary_platform),
            "collectedAt": collected_at,
            "provenance": DEMO_SOURCE,
        },
        "observed": observed,
        "normalizedPlatforms": platforms,
        "raw": {
            "note": "Fallback snapshot. Use --refresh-social with provider credentials to refresh.",
            "sourceUrls": platforms,
        },
        "demoNamespace": DEMO_NAMESPACE,
        "createdAt": collected_at,
        "updatedAt": collected_at,
    }


def _match_reasons(
    creator_document: Mapping[str, object],
    metrics: Mapping[str, object],
) -> list[str]:
    categories = ", ".join(_string_list(creator_document.get("categories"))[:2])
    formats = ", ".join(_string_list(creator_document.get("supportedDeliverableFormats"))[:2])
    average_views = metrics.get("averageRecentViews")
    reasons = [f"{categories} 카테고리 콘텐츠 비중이 높음", f"요구 포맷과 {formats} 제작 경험 일치"]
    if isinstance(average_views, int):
        reasons.append(f"최근 평균 조회수 {average_views:,} 기준의 공개 성과 보유")
    reasons.append("현재 demo capacity가 열려 있어 즉시 협상 가능")
    return reasons


def _data_usage(*, demo_permission: bool) -> dict[str, object]:
    data: dict[str, object] = {
        "type": "DEMO_SEED",
        "registeredUser": False,
        "source": DEMO_SOURCE,
    }
    if demo_permission:
        data["demoPermission"] = True
    return data


def _snapshot_thumbnail(snapshot: Mapping[str, object]) -> str:
    observed = _required_mapping(snapshot, "observed")
    value = observed.get("thumbnailUrl") or observed.get("profileImageUrl")
    return value if isinstance(value, str) else ""


def _platform_url(platforms: Mapping[str, object], platform: str) -> str | None:
    value = platforms.get(platform)
    if not isinstance(value, Mapping):
        return None
    url = value.get("url")
    return url if isinstance(url, str) else None


def _demo_avatar_url(label: str, kind: str) -> str:
    palette = "f4b183,92c5de,86c5a8,f6d365,e8a5c9" if kind == "brand" else (
        "9cc9ff,b8e1dd,ffcf8b,dda0dd,b7d78b"
    )
    return (
        "https://api.dicebear.com/9.x/initials/svg"
        f"?seed={quote(label)}"
        f"&backgroundColor={palette}"
        "&fontWeight=700"
    )


def _required_mapping(document: Mapping[str, object], field_name: str) -> Mapping[str, object]:
    value = document.get(field_name)
    if not isinstance(value, Mapping):
        raise ValueError(f"{field_name} must be an object")
    return value


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str)]


def _now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


REQUIRED_CREATOR_CATEGORIES = ["beauty", "tech", "fitness", "crypto", "gaming"]


BRAND_SEEDS: list[dict[str, Any]] = [
    {
        "brandId": "brand-demo-kry-cheese-burger",
        "brandAgentId": "agent-demo-brand-kry-cheese-burger",
        "slug": "kry-cheese-burger",
        "displayName": "크라이치즈버거",
        "categories": ["food", "restaurant"],
        "targetAudience": "버거와 캐주얼 외식을 즐기는 20-30대 고객",
        "description": "수제 치즈버거 중심의 F&B 브랜드",
        "websiteUrl": "https://www.krycheeseburger.com",
        "socialProfiles": {"instagram": {"status": "UNRESOLVED"}},
        "publicSources": [{"url": "https://www.krycheeseburger.com", "type": "official_site"}],
        "demoPermission": True,
        "agentPolicy": {
            "campaignBudgetUsdc": 12,
            "targetCreatorRateUsdc": 2,
            "maximumCreatorRateUsdc": 4,
            "maximumNegotiationRounds": 4,
            "preferredFormats": ["short", "reel"],
        },
    },
    {
        "brandId": "brand-demo-cheriexx",
        "brandAgentId": "agent-demo-brand-cheriexx",
        "slug": "cheriexx",
        "displayName": "체리엑스엑스",
        "categories": ["beauty", "fashion"],
        "targetAudience": "트렌디한 뷰티/패션 제품에 반응하는 20대 고객",
        "description": "데모 허락 브랜드. 공개 채널은 seed 단계에서 검증 필요",
        "websiteUrl": None,
        "socialProfiles": {"instagram": {"status": "UNRESOLVED"}},
        "publicSources": [{"url": None, "type": "permissioned_demo_brand"}],
        "demoPermission": True,
        "agentPolicy": {
            "campaignBudgetUsdc": 10,
            "targetCreatorRateUsdc": 2,
            "maximumCreatorRateUsdc": 4,
            "maximumNegotiationRounds": 4,
            "preferredFormats": ["reel", "short"],
        },
        "demoScenario": {
            "title": "체리엑스엑스 뷰티 숏폼 협찬",
            "objective": "신제품 인지도와 사용 장면 확보",
            "category": "beauty",
            "targetAudience": ["20대 뷰티 관심 고객"],
            "productName": "체리 글로우 키트",
            "summary": "컬러 포인트가 있는 데일리 뷰티 키트",
            "format": "short",
            "usageRights": UsageRights.ORGANIC_ONLY.value,
            "startInDays": 14,
            "windowDays": 7,
        },
    },
    {
        "brandId": "brand-demo-thezonebio",
        "brandAgentId": "agent-demo-brand-thezonebio",
        "slug": "thezonebio",
        "displayName": "더존바이오",
        "categories": ["fitness", "wellness", "health"],
        "targetAudience": "건강관리와 생활 루틴에 관심 있는 고객",
        "description": "데모 허락 브랜드. 웰니스 협찬 시나리오용",
        "websiteUrl": None,
        "socialProfiles": {"instagram": {"status": "UNRESOLVED"}},
        "publicSources": [{"url": None, "type": "permissioned_demo_brand"}],
        "demoPermission": True,
        "agentPolicy": {
            "campaignBudgetUsdc": 10,
            "targetCreatorRateUsdc": 2,
            "maximumCreatorRateUsdc": 5,
            "maximumNegotiationRounds": 4,
            "preferredFormats": ["short", "reel"],
        },
        "demoScenario": {
            "title": "더존바이오 웰니스 루틴 협찬",
            "objective": "건강 루틴 콘텐츠에서 제품 사용 장면 확보",
            "category": "fitness",
            "targetAudience": ["홈트레이닝", "웰니스 관심 고객"],
            "productName": "데일리 웰니스 팩",
            "summary": "데일리 루틴에 넣기 쉬운 웰니스 제품",
            "format": "short",
            "usageRights": UsageRights.PAID_BOOST_30D.value,
            "startInDays": 14,
            "windowDays": 7,
        },
    },
    {
        "brandId": "brand-demo-workmore",
        "brandAgentId": "agent-demo-brand-workmore",
        "slug": "workmore",
        "displayName": "워크모어",
        "categories": ["lifestyle", "tech"],
        "targetAudience": "업무 생산성과 데스크 셋업에 관심 있는 고객",
        "description": "데모 허락 브랜드. 업무/생산성 시나리오용",
        "websiteUrl": None,
        "socialProfiles": {"instagram": {"status": "UNRESOLVED"}},
        "publicSources": [{"url": None, "type": "permissioned_demo_brand"}],
        "demoPermission": True,
        "agentPolicy": {
            "campaignBudgetUsdc": 10,
            "targetCreatorRateUsdc": 2,
            "maximumCreatorRateUsdc": 5,
            "maximumNegotiationRounds": 4,
            "preferredFormats": ["short"],
        },
    },
    {
        "brandId": "brand-demo-thehackathonkr",
        "brandAgentId": "agent-demo-brand-thehackathonkr",
        "slug": "thehackathonkr",
        "displayName": "The Hackathon Korea",
        "categories": ["tech", "community"],
        "targetAudience": "해커톤, 개발자 커뮤니티, AI/창업 행사에 관심 있는 고객",
        "description": "사용자 제공 Instagram 공개 핸들 기반 데모 seed. KNOT 고객 표시 아님",
        "websiteUrl": None,
        "socialProfiles": {"instagram": {"url": "https://www.instagram.com/thehackathonkr/"}},
        "publicSources": [
            {
                "url": "https://www.instagram.com/thehackathonkr/",
                "type": "user_provided_public_handle",
            }
        ],
        "agentPolicy": {
            "campaignBudgetUsdc": 12,
            "targetCreatorRateUsdc": 2,
            "maximumCreatorRateUsdc": 5,
            "maximumNegotiationRounds": 4,
            "preferredFormats": ["reel", "short"],
        },
    },
    {
        "brandId": "brand-demo-samsung",
        "brandAgentId": "agent-demo-brand-samsung",
        "slug": "samsung",
        "displayName": "Samsung",
        "categories": ["tech"],
        "targetAudience": "모바일/가전 테크 제품 관심 고객",
        "description": "공개 데이터 기반 데모 seed. KNOT 고객 표시 아님",
        "websiteUrl": "https://www.samsung.com",
        "socialProfiles": {"youtube": {"url": "https://www.youtube.com/@Samsung"}},
        "publicSources": [{"url": "https://www.samsung.com", "type": "official_site"}],
        "agentPolicy": {
            "campaignBudgetUsdc": 12,
            "targetCreatorRateUsdc": 2,
            "maximumCreatorRateUsdc": 5,
            "maximumNegotiationRounds": 4,
            "preferredFormats": ["short"],
        },
        "demoScenario": {
            "title": "테크 제품 숏폼 리뷰 협찬",
            "objective": "제품 기능을 쉽게 설명하는 숏폼 확보",
            "category": "tech",
            "targetAudience": ["테크", "신제품 관심 고객"],
            "productName": "데모 스마트 디바이스",
            "summary": "핵심 기능을 숏폼으로 설명하기 좋은 테크 제품",
            "format": "short",
            "usageRights": UsageRights.ORGANIC_ONLY.value,
            "startInDays": 14,
            "windowDays": 7,
        },
    },
    {
        "brandId": "brand-demo-dano",
        "brandAgentId": "agent-demo-brand-dano",
        "slug": "dano",
        "displayName": "DANO",
        "categories": ["fitness", "wellness"],
        "targetAudience": "운동과 건강한 식습관에 관심 있는 고객",
        "description": "공개 데이터 기반 데모 seed. KNOT 고객 표시 아님",
        "websiteUrl": "https://www.dano.me",
        "socialProfiles": {"youtube": {"url": "https://www.youtube.com/@danotv"}},
        "publicSources": [{"url": "https://www.dano.me", "type": "official_site"}],
        "agentPolicy": {
            "campaignBudgetUsdc": 12,
            "targetCreatorRateUsdc": 2,
            "maximumCreatorRateUsdc": 5,
            "maximumNegotiationRounds": 4,
            "preferredFormats": ["short"],
        },
    },
    {
        "brandId": "brand-demo-upbit",
        "brandAgentId": "agent-demo-brand-upbit",
        "slug": "upbit",
        "displayName": "Upbit",
        "categories": ["crypto", "tech"],
        "targetAudience": "디지털 자산과 Web3에 관심 있는 고객",
        "description": "공개 데이터 기반 데모 seed. KNOT 고객 표시 아님",
        "websiteUrl": "https://upbit.com",
        "socialProfiles": {"youtube": {"url": "https://www.youtube.com/@upbit_official"}},
        "publicSources": [{"url": "https://upbit.com", "type": "official_site"}],
        "agentPolicy": {
            "campaignBudgetUsdc": 12,
            "targetCreatorRateUsdc": 2,
            "maximumCreatorRateUsdc": 5,
            "maximumNegotiationRounds": 4,
            "preferredFormats": ["short"],
        },
        "demoScenario": {
            "title": "Web3 초보자 교육 숏폼 협찬",
            "objective": "복잡한 Web3 개념을 쉽게 설명하는 콘텐츠 확보",
            "category": "crypto",
            "targetAudience": ["Web3 입문자", "디지털 자산 관심 고객"],
            "productName": "데모 Web3 가이드",
            "summary": "지갑과 보안 개념을 쉽게 설명하는 교육형 콘텐츠",
            "format": "short",
            "usageRights": UsageRights.ORGANIC_ONLY.value,
            "startInDays": 14,
            "windowDays": 7,
        },
    },
    {
        "brandId": "brand-demo-neowiz",
        "brandAgentId": "agent-demo-brand-neowiz",
        "slug": "neowiz",
        "displayName": "NEOWIZ",
        "categories": ["gaming", "entertainment"],
        "targetAudience": "게임과 스트리밍 콘텐츠 시청자",
        "description": "공개 데이터 기반 데모 seed. KNOT 고객 표시 아님",
        "websiteUrl": "https://www.neowiz.com",
        "socialProfiles": {"youtube": {"url": "https://www.youtube.com/@NEOWIZ_OFFICIAL"}},
        "publicSources": [{"url": "https://www.neowiz.com", "type": "official_site"}],
        "agentPolicy": {
            "campaignBudgetUsdc": 12,
            "targetCreatorRateUsdc": 2,
            "maximumCreatorRateUsdc": 5,
            "maximumNegotiationRounds": 4,
            "preferredFormats": ["short"],
        },
        "demoScenario": {
            "title": "게임 출시 반응 숏폼 협찬",
            "objective": "신작 게임의 첫인상과 플레이 포인트 확보",
            "category": "gaming",
            "targetAudience": ["게임 시청자", "콘솔/PC 게임 관심 고객"],
            "productName": "데모 게임 타이틀",
            "summary": "첫 플레이 반응과 핵심 장면을 담기 좋은 게임 콘텐츠",
            "format": "short",
            "usageRights": UsageRights.ORGANIC_ONLY.value,
            "startInDays": 14,
            "windowDays": 7,
        },
    },
    {
        "brandId": "brand-demo-bzcf",
        "brandAgentId": "agent-demo-brand-bzcf",
        "slug": "bzcf",
        "displayName": "BZCF",
        "categories": ["lifestyle", "community"],
        "targetAudience": "브랜드 협업과 커뮤니티 기반 콘텐츠에 반응하는 고객",
        "description": "사용자 제공 Instagram 공개 핸들 기반 데모 seed. KNOT 고객 표시 아님",
        "websiteUrl": None,
        "socialProfiles": {"instagram": {"url": "https://www.instagram.com/bzcf/"}},
        "publicSources": [
            {
                "url": "https://www.instagram.com/bzcf/",
                "type": "user_provided_public_handle",
            }
        ],
        "agentPolicy": {
            "campaignBudgetUsdc": 12,
            "targetCreatorRateUsdc": 2,
            "maximumCreatorRateUsdc": 5,
            "maximumNegotiationRounds": 4,
            "preferredFormats": ["reel", "short"],
        },
    },
]


CREATOR_SEEDS: list[dict[str, Any]] = [
    {
        "creatorId": "creator-demo-risabae",
        "creatorAgentId": "agent-demo-creator-risabae",
        "displayName": "RISABAE",
        "primaryPlatform": "youtube",
        "categories": ["beauty", "entertainment"],
        "formats": ["short", "reel", "post"],
        "persona": "brand_fit_first",
        "personaDescription": "가격보다 브랜드/콘텐츠 핏을 우선하는 demo policy",
        "completedDealCount": 20,
        "platforms": {
            "youtube": {"url": "https://www.youtube.com/channel/UC9kmlDcqksaOnCkC_qzGacA"},
            "instagram": {"url": "https://www.instagram.com/risabae_art/"},
        },
        "observed": {
            "displayName": "RISABAE",
            "thumbnailUrl": "",
            "metrics": {
                "subscriberOrFollowerCount": 2680000,
                "averageRecentViews": 120000,
                "medianRecentViews": 90000,
                "metricProvenance": "PUBLIC_THIRD_PARTY_OR_PROVIDER",
            },
            "sourceNotes": [
                "Public search results identify YouTube channel "
                "UC9kmlDcqksaOnCkC_qzGacA and Instagram @risabae_art."
            ],
        },
        "contentProfile": {
            "primaryCategory": "beauty",
            "secondaryCategories": ["entertainment"],
            "contentKeywords": ["makeup", "beauty", "K-beauty"],
            "contentFormats": ["YOUTUBE_LONGFORM", "YOUTUBE_SHORTS", "INSTAGRAM_REELS"],
            "contentStyle": ["TUTORIAL", "REVIEW", "ENTERTAINMENT"],
        },
        "demoPolicy": {
            "minBaseUsdc": 3,
            "maxBaseUsdc": 5,
            "blockedIndustries": ["gambling", "tobacco"],
            "maxDeliverablesPerMonth": 4,
            "minDaysToPost": 5,
            "allowedUsageRights": [
                UsageRights.ORGANIC_ONLY.value,
                UsageRights.PAID_BOOST_30D.value,
            ],
            "maxRevisionRounds": 1,
            "maxExclusivityDays": 0,
        },
    },
    {
        "creatorId": "creator-demo-ssin",
        "creatorAgentId": "agent-demo-creator-ssin",
        "displayName": "SSIN 씬님",
        "primaryPlatform": "youtube",
        "categories": ["beauty", "lifestyle"],
        "formats": ["short", "reel"],
        "persona": "usage_rights_sensitive",
        "personaDescription": "사용권 확장에는 보수적으로 반응하는 demo policy",
        "completedDealCount": 20,
        "platforms": {"youtube": {"url": "https://www.youtube.com/@ssin"}},
        "observed": {
            "displayName": "SSIN",
            "thumbnailUrl": "",
            "metrics": {
                "subscriberOrFollowerCount": 1000000,
                "averageRecentViews": 70000,
                "medianRecentViews": 55000,
                "metricProvenance": "FIXTURE_PENDING_PROVIDER_REFRESH",
            },
        },
        "contentProfile": {
            "primaryCategory": "beauty",
            "secondaryCategories": ["lifestyle"],
            "contentKeywords": ["makeup", "review", "daily"],
            "contentFormats": ["YOUTUBE_LONGFORM", "YOUTUBE_SHORTS"],
            "contentStyle": ["REVIEW", "TUTORIAL"],
        },
        "demoPolicy": {
            "minBaseUsdc": 4,
            "maxBaseUsdc": 6,
            "blockedIndustries": ["gambling", "tobacco", "alcohol"],
            "maxDeliverablesPerMonth": 3,
            "minDaysToPost": 7,
            "allowedUsageRights": [UsageRights.ORGANIC_ONLY.value],
            "maxRevisionRounds": 1,
            "maxExclusivityDays": 0,
        },
    },
    {
        "creatorId": "creator-demo-candofr",
        "creatorAgentId": "agent-demo-creator-candofr",
        "displayName": "이차녕 @candofr",
        "primaryPlatform": "instagram",
        "categories": ["lifestyle", "tech", "community"],
        "formats": ["reel", "post", "short"],
        "persona": "brand_fit_first",
        "personaDescription": "커뮤니티/창업 행사 맥락과 브랜드 핏을 우선하는 demo policy",
        "completedDealCount": 8,
        "platforms": {"instagram": {"url": "https://www.instagram.com/candofr/"}},
        "observed": {
            "displayName": "이차녕 @candofr",
            "thumbnailUrl": "",
            "metrics": {
                "subscriberOrFollowerCount": None,
                "averageRecentViews": None,
                "medianRecentViews": None,
                "metricProvenance": "PUBLIC_HANDLE_CONFIRMED_PENDING_PROVIDER_REFRESH",
            },
            "sourceNotes": [
                "User-provided Instagram handle @candofr.",
                "Event-us public page references Creator Founder Seoul with @candofr (이차녕).",
            ],
        },
        "contentProfile": {
            "primaryCategory": "lifestyle",
            "secondaryCategories": ["tech", "community"],
            "contentKeywords": ["creator founder", "startup", "community", "lifestyle"],
            "contentFormats": ["INSTAGRAM_REELS", "INSTAGRAM_FEED"],
            "contentStyle": ["COMMUNITY", "EVENT", "LIFESTYLE"],
        },
        "demoPolicy": {
            "minBaseUsdc": 2,
            "maxBaseUsdc": 5,
            "blockedIndustries": ["gambling", "tobacco"],
            "maxDeliverablesPerMonth": 4,
            "minDaysToPost": 5,
            "allowedUsageRights": [
                UsageRights.ORGANIC_ONLY.value,
                UsageRights.PAID_BOOST_30D.value,
            ],
            "maxRevisionRounds": 1,
            "maxExclusivityDays": 0,
        },
    },
    {
        "creatorId": "creator-demo-yubintmi",
        "creatorAgentId": "agent-demo-creator-yubintmi",
        "displayName": "유빈이TMI",
        "primaryPlatform": "instagram",
        "categories": ["lifestyle", "travel", "entertainment"],
        "formats": ["reel", "post", "short"],
        "persona": "schedule_sensitive",
        "personaDescription": "일상형 콘텐츠 일정과 촬영 부담을 중시하는 demo policy",
        "completedDealCount": 6,
        "platforms": {
            "instagram": {"url": "https://www.instagram.com/tmi_07070707/"},
            "youtube": {"url": "https://www.youtube.com/@yubintmi"},
        },
        "observed": {
            "displayName": "유빈이TMI",
            "thumbnailUrl": "",
            "metrics": {
                "subscriberOrFollowerCount": 67700,
                "averageRecentViews": 7060,
                "medianRecentViews": None,
                "metricProvenance": "PUBLIC_THIRD_PARTY_OR_PROVIDER",
            },
            "sourceNotes": [
                "Public articles identify Instagram @tmi_07070707 for 유빈이TMI.",
                "Public channel analytics pages report YouTube channel size "
                "around 67.7K subscribers.",
            ],
        },
        "contentProfile": {
            "primaryCategory": "lifestyle",
            "secondaryCategories": ["travel", "entertainment"],
            "contentKeywords": ["daily", "vlog", "travel", "challenge"],
            "contentFormats": ["INSTAGRAM_REELS", "YOUTUBE_SHORTS", "YOUTUBE_LONGFORM"],
            "contentStyle": ["VLOG", "STORYTELLING", "CHALLENGE"],
        },
        "demoPolicy": {
            "minBaseUsdc": 2,
            "maxBaseUsdc": 4,
            "blockedIndustries": ["gambling", "tobacco", "alcohol"],
            "maxDeliverablesPerMonth": 3,
            "minDaysToPost": 8,
            "allowedUsageRights": [UsageRights.ORGANIC_ONLY.value],
            "maxRevisionRounds": 1,
            "maxExclusivityDays": 0,
        },
    },
    {
        "creatorId": "creator-demo-amisho",
        "creatorAgentId": "agent-demo-creator-amisho",
        "displayName": "아미쇼",
        "primaryPlatform": "instagram",
        "categories": ["entertainment", "lifestyle"],
        "formats": ["reel", "short", "post"],
        "persona": "fast_accept_if_price_ok",
        "personaDescription": "숏폼 조건과 금액이 맞으면 빠르게 수락하는 demo policy",
        "completedDealCount": 10,
        "platforms": {
            "instagram": {"url": "https://www.instagram.com/amirsho_kh/"},
            "youtube": {"url": "https://www.youtube.com/@amishokh"},
        },
        "observed": {
            "displayName": "아미쇼",
            "thumbnailUrl": "",
            "metrics": {
                "subscriberOrFollowerCount": 101800,
                "averageRecentViews": None,
                "medianRecentViews": None,
                "metricProvenance": "PUBLIC_THIRD_PARTY_OR_PROVIDER",
            },
            "sourceNotes": [
                "Public profile pages identify 아미쇼 as an Instagram/YouTube/TikTok creator.",
                "Public influencer database lists Instagram @amirsho_kh around 101.8K followers.",
            ],
        },
        "contentProfile": {
            "primaryCategory": "entertainment",
            "secondaryCategories": ["lifestyle"],
            "contentKeywords": ["shortform", "humor", "culture", "daily"],
            "contentFormats": ["INSTAGRAM_REELS", "YOUTUBE_SHORTS"],
            "contentStyle": ["HUMOR", "SKIT", "CULTURE"],
        },
        "demoPolicy": {
            "minBaseUsdc": 2,
            "maxBaseUsdc": 5,
            "blockedIndustries": ["gambling", "tobacco"],
            "maxDeliverablesPerMonth": 5,
            "minDaysToPost": 4,
            "allowedUsageRights": [
                UsageRights.ORGANIC_ONLY.value,
                UsageRights.PAID_BOOST_30D.value,
            ],
            "maxRevisionRounds": 1,
            "maxExclusivityDays": 0,
        },
    },
    {
        "creatorId": "creator-demo-creatus",
        "creatorAgentId": "agent-demo-creator-creatus",
        "displayName": "크리투스",
        "primaryPlatform": "instagram",
        "categories": ["education", "tech", "lifestyle"],
        "formats": ["reel", "post", "short"],
        "persona": "detail_sensitive",
        "personaDescription": "브리프와 사용권 범위를 명확히 요구하는 demo policy",
        "completedDealCount": 12,
        "platforms": {"instagram": {"url": "https://www.instagram.com/crea__tus/"}},
        "observed": {
            "displayName": "크리투스",
            "thumbnailUrl": "",
            "metrics": {
                "subscriberOrFollowerCount": 195670,
                "averageRecentViews": 8469,
                "medianRecentViews": None,
                "metricProvenance": "PUBLIC_THIRD_PARTY_OR_PROVIDER",
            },
            "sourceNotes": [
                "Official Creatus Lounge page describes a creator growth platform.",
                "Public Instagram analytics page lists @crea__tus with follower "
                "and engagement metrics.",
            ],
        },
        "contentProfile": {
            "primaryCategory": "education",
            "secondaryCategories": ["tech", "lifestyle"],
            "contentKeywords": ["creator education", "reels", "growth", "community"],
            "contentFormats": ["INSTAGRAM_REELS", "INSTAGRAM_FEED"],
            "contentStyle": ["EDUCATIONAL", "HOW_TO", "COMMUNITY"],
        },
        "demoPolicy": {
            "minBaseUsdc": 3,
            "maxBaseUsdc": 6,
            "blockedIndustries": ["gambling", "tobacco"],
            "maxDeliverablesPerMonth": 4,
            "minDaysToPost": 6,
            "allowedUsageRights": [
                UsageRights.ORGANIC_ONLY.value,
                UsageRights.PAID_BOOST_30D.value,
            ],
            "maxRevisionRounds": 1,
            "maxExclusivityDays": 0,
        },
    },
    {
        "creatorId": "creator-demo-geekble",
        "creatorAgentId": "agent-demo-creator-geekble",
        "displayName": "긱블 Geekble",
        "primaryPlatform": "youtube",
        "categories": ["tech", "entertainment"],
        "formats": ["short", "video"],
        "persona": "fast_accept_if_price_ok",
        "personaDescription": "최소 금액 이상이면 빠르게 수락하는 demo policy",
        "completedDealCount": 20,
        "platforms": {"youtube": {"url": "https://www.youtube.com/channel/UCp94pzrtA5wPyZazbDq0CXA"}},
        "observed": {
            "displayName": "긱블 Geekble",
            "thumbnailUrl": "",
            "metrics": {
                "subscriberOrFollowerCount": 1200000,
                "averageRecentViews": 286000,
                "medianRecentViews": 183000,
                "metricProvenance": "PUBLIC_THIRD_PARTY_OR_PROVIDER",
            },
        },
        "contentProfile": {
            "primaryCategory": "tech",
            "secondaryCategories": ["entertainment"],
            "contentKeywords": ["engineering", "experiment", "robot", "science"],
            "contentFormats": ["YOUTUBE_LONGFORM", "YOUTUBE_SHORTS"],
            "contentStyle": ["EXPERIMENT", "EDUCATIONAL", "ENTERTAINMENT"],
        },
        "demoPolicy": {
            "minBaseUsdc": 2,
            "maxBaseUsdc": 5,
            "blockedIndustries": ["gambling", "tobacco"],
            "maxDeliverablesPerMonth": 5,
            "minDaysToPost": 4,
            "allowedUsageRights": [
                UsageRights.ORGANIC_ONLY.value,
                UsageRights.PAID_BOOST_30D.value,
            ],
            "maxRevisionRounds": 1,
            "maxExclusivityDays": 0,
        },
    },
    {
        "creatorId": "creator-demo-jocoding",
        "creatorAgentId": "agent-demo-creator-jocoding",
        "displayName": "조코딩 JoCoding",
        "primaryPlatform": "youtube",
        "categories": ["tech", "education"],
        "formats": ["short", "video"],
        "persona": "detail_sensitive",
        "personaDescription": "브리프 명확성과 산출물 범위를 중시하는 demo policy",
        "completedDealCount": 20,
        "platforms": {"youtube": {"url": "https://www.youtube.com/@jocoding"}},
        "observed": {
            "displayName": "조코딩 JoCoding",
            "thumbnailUrl": "",
            "metrics": {
                "subscriberOrFollowerCount": 600000,
                "averageRecentViews": 50000,
                "medianRecentViews": 40000,
                "metricProvenance": "FIXTURE_PENDING_PROVIDER_REFRESH",
            },
        },
        "contentProfile": {
            "primaryCategory": "tech",
            "secondaryCategories": ["education"],
            "contentKeywords": ["coding", "AI", "software", "education"],
            "contentFormats": ["YOUTUBE_LONGFORM", "YOUTUBE_SHORTS"],
            "contentStyle": ["EDUCATIONAL", "HOW_TO"],
        },
        "demoPolicy": {
            "minBaseUsdc": 3,
            "maxBaseUsdc": 5,
            "blockedIndustries": ["gambling", "tobacco"],
            "maxDeliverablesPerMonth": 4,
            "minDaysToPost": 6,
            "allowedUsageRights": [
                UsageRights.ORGANIC_ONLY.value,
                UsageRights.PAID_BOOST_30D.value,
            ],
            "maxRevisionRounds": 1,
            "maxExclusivityDays": 0,
        },
    },
    {
        "creatorId": "creator-demo-thankyou-bubu",
        "creatorAgentId": "agent-demo-creator-thankyou-bubu",
        "displayName": "Thankyou BUBU",
        "primaryPlatform": "youtube",
        "categories": ["fitness", "wellness"],
        "formats": ["short", "video"],
        "persona": "schedule_sensitive",
        "personaDescription": "납기와 루틴 일정을 중시하는 demo policy",
        "completedDealCount": 20,
        "platforms": {"youtube": {"url": "https://www.youtube.com/@ThankyouBUBU"}},
        "observed": {
            "displayName": "Thankyou BUBU",
            "thumbnailUrl": "",
            "metrics": {
                "subscriberOrFollowerCount": 3000000,
                "averageRecentViews": 130000,
                "medianRecentViews": 90000,
                "metricProvenance": "FIXTURE_PENDING_PROVIDER_REFRESH",
            },
        },
        "contentProfile": {
            "primaryCategory": "fitness",
            "secondaryCategories": ["wellness"],
            "contentKeywords": ["home workout", "routine", "wellness"],
            "contentFormats": ["YOUTUBE_LONGFORM", "YOUTUBE_SHORTS"],
            "contentStyle": ["ROUTINE", "EDUCATIONAL"],
        },
        "demoPolicy": {
            "minBaseUsdc": 3,
            "maxBaseUsdc": 5,
            "blockedIndustries": ["gambling", "tobacco", "alcohol"],
            "maxDeliverablesPerMonth": 3,
            "minDaysToPost": 8,
            "allowedUsageRights": [
                UsageRights.ORGANIC_ONLY.value,
                UsageRights.PAID_BOOST_30D.value,
            ],
            "maxRevisionRounds": 1,
            "maxExclusivityDays": 0,
        },
    },
    {
        "creatorId": "creator-demo-dano-tv",
        "creatorAgentId": "agent-demo-creator-dano-tv",
        "displayName": "DanoTV",
        "primaryPlatform": "youtube",
        "categories": ["fitness", "wellness"],
        "formats": ["short", "reel"],
        "persona": "brand_fit_first",
        "personaDescription": "웰니스 철학과 브랜드 핏을 중시하는 demo policy",
        "completedDealCount": 20,
        "platforms": {"youtube": {"url": "https://www.youtube.com/@danotv"}},
        "observed": {
            "displayName": "DanoTV",
            "thumbnailUrl": "",
            "metrics": {
                "subscriberOrFollowerCount": 400000,
                "averageRecentViews": 30000,
                "medianRecentViews": 25000,
                "metricProvenance": "FIXTURE_PENDING_PROVIDER_REFRESH",
            },
        },
        "contentProfile": {
            "primaryCategory": "fitness",
            "secondaryCategories": ["wellness", "lifestyle"],
            "contentKeywords": ["diet", "fitness", "healthy routine"],
            "contentFormats": ["YOUTUBE_SHORTS", "YOUTUBE_LONGFORM"],
            "contentStyle": ["ROUTINE", "REVIEW"],
        },
        "demoPolicy": {
            "minBaseUsdc": 2,
            "maxBaseUsdc": 4,
            "blockedIndustries": ["gambling", "tobacco"],
            "maxDeliverablesPerMonth": 4,
            "minDaysToPost": 5,
            "allowedUsageRights": [UsageRights.ORGANIC_ONLY.value],
            "maxRevisionRounds": 1,
            "maxExclusivityDays": 0,
        },
    },
    {
        "creatorId": "creator-demo-coin-bureau",
        "creatorAgentId": "agent-demo-creator-coin-bureau",
        "displayName": "Coin Bureau",
        "primaryPlatform": "youtube",
        "categories": ["crypto", "tech"],
        "formats": ["short", "video"],
        "persona": "compliance_sensitive",
        "personaDescription": "금융/투자 표현과 고지 문구를 중시하는 demo policy",
        "completedDealCount": 20,
        "platforms": {"youtube": {"url": "https://www.youtube.com/@CoinBureau"}},
        "observed": {
            "displayName": "Coin Bureau",
            "thumbnailUrl": "",
            "metrics": {
                "subscriberOrFollowerCount": 2500000,
                "averageRecentViews": 160000,
                "medianRecentViews": 130000,
                "metricProvenance": "FIXTURE_PENDING_PROVIDER_REFRESH",
            },
        },
        "contentProfile": {
            "primaryCategory": "crypto",
            "secondaryCategories": ["tech", "education"],
            "contentKeywords": ["crypto", "Web3", "blockchain", "market"],
            "contentFormats": ["YOUTUBE_LONGFORM", "YOUTUBE_SHORTS"],
            "contentStyle": ["EDUCATIONAL", "ANALYSIS"],
        },
        "demoPolicy": {
            "minBaseUsdc": 4,
            "maxBaseUsdc": 6,
            "blockedIndustries": ["gambling", "tobacco"],
            "maxDeliverablesPerMonth": 3,
            "minDaysToPost": 7,
            "allowedUsageRights": [UsageRights.ORGANIC_ONLY.value],
            "maxRevisionRounds": 1,
            "maxExclusivityDays": 0,
        },
    },
    {
        "creatorId": "creator-demo-99bitcoins",
        "creatorAgentId": "agent-demo-creator-99bitcoins",
        "displayName": "99Bitcoins",
        "primaryPlatform": "youtube",
        "categories": ["crypto", "education"],
        "formats": ["short", "video"],
        "persona": "price_sensitive",
        "personaDescription": "최소 단가 이하 제안에는 반드시 counter하는 demo policy",
        "completedDealCount": 20,
        "platforms": {"youtube": {"url": "https://www.youtube.com/@99Bitcoins"}},
        "observed": {
            "displayName": "99Bitcoins",
            "thumbnailUrl": "",
            "metrics": {
                "subscriberOrFollowerCount": 700000,
                "averageRecentViews": 45000,
                "medianRecentViews": 35000,
                "metricProvenance": "FIXTURE_PENDING_PROVIDER_REFRESH",
            },
        },
        "contentProfile": {
            "primaryCategory": "crypto",
            "secondaryCategories": ["education"],
            "contentKeywords": ["bitcoin", "wallet", "crypto basics"],
            "contentFormats": ["YOUTUBE_LONGFORM", "YOUTUBE_SHORTS"],
            "contentStyle": ["EDUCATIONAL", "EXPLAINER"],
        },
        "demoPolicy": {
            "minBaseUsdc": 5,
            "maxBaseUsdc": 7,
            "blockedIndustries": ["gambling", "tobacco"],
            "maxDeliverablesPerMonth": 4,
            "minDaysToPost": 5,
            "allowedUsageRights": [
                UsageRights.ORGANIC_ONLY.value,
                UsageRights.PAID_BOOST_30D.value,
            ],
            "maxRevisionRounds": 1,
            "maxExclusivityDays": 0,
        },
    },
    {
        "creatorId": "creator-demo-dotti",
        "creatorAgentId": "agent-demo-creator-dotti",
        "displayName": "도티 TV",
        "primaryPlatform": "youtube",
        "categories": ["gaming", "entertainment"],
        "formats": ["short", "video"],
        "persona": "fast_accept_if_price_ok",
        "personaDescription": "조건이 맞으면 빠르게 수락하는 demo policy",
        "completedDealCount": 20,
        "platforms": {"youtube": {"url": "https://www.youtube.com/@dotty"}},
        "observed": {
            "displayName": "도티 TV",
            "thumbnailUrl": "",
            "metrics": {
                "subscriberOrFollowerCount": 2000000,
                "averageRecentViews": 80000,
                "medianRecentViews": 60000,
                "metricProvenance": "FIXTURE_PENDING_PROVIDER_REFRESH",
            },
        },
        "contentProfile": {
            "primaryCategory": "gaming",
            "secondaryCategories": ["entertainment"],
            "contentKeywords": ["game", "creator", "entertainment"],
            "contentFormats": ["YOUTUBE_LONGFORM", "YOUTUBE_SHORTS"],
            "contentStyle": ["GAMEPLAY", "ENTERTAINMENT"],
        },
        "demoPolicy": {
            "minBaseUsdc": 2,
            "maxBaseUsdc": 5,
            "blockedIndustries": ["gambling", "tobacco"],
            "maxDeliverablesPerMonth": 5,
            "minDaysToPost": 4,
            "allowedUsageRights": [
                UsageRights.ORGANIC_ONLY.value,
                UsageRights.PAID_BOOST_30D.value,
            ],
            "maxRevisionRounds": 1,
            "maxExclusivityDays": 0,
        },
    },
    {
        "creatorId": "creator-demo-g-sik",
        "creatorAgentId": "agent-demo-creator-g-sik",
        "displayName": "김성회의 G식백과",
        "primaryPlatform": "youtube",
        "categories": ["gaming", "entertainment"],
        "formats": ["short", "video"],
        "persona": "detail_sensitive",
        "personaDescription": "콘텐츠 맥락과 표현 정확성을 중시하는 demo policy",
        "completedDealCount": 20,
        "platforms": {"youtube": {"url": "https://www.youtube.com/@gsik"}},
        "observed": {
            "displayName": "김성회의 G식백과",
            "thumbnailUrl": "",
            "metrics": {
                "subscriberOrFollowerCount": 900000,
                "averageRecentViews": 180000,
                "medianRecentViews": 140000,
                "metricProvenance": "FIXTURE_PENDING_PROVIDER_REFRESH",
            },
        },
        "contentProfile": {
            "primaryCategory": "gaming",
            "secondaryCategories": ["entertainment", "analysis"],
            "contentKeywords": ["game", "industry", "review"],
            "contentFormats": ["YOUTUBE_LONGFORM", "YOUTUBE_SHORTS"],
            "contentStyle": ["ANALYSIS", "REVIEW", "ENTERTAINMENT"],
        },
        "demoPolicy": {
            "minBaseUsdc": 4,
            "maxBaseUsdc": 6,
            "blockedIndustries": ["gambling", "tobacco"],
            "maxDeliverablesPerMonth": 3,
            "minDaysToPost": 7,
            "allowedUsageRights": [UsageRights.ORGANIC_ONLY.value],
            "maxRevisionRounds": 1,
            "maxExclusivityDays": 0,
        },
    },
]


UNRESOLVED_SOCIAL_CANDIDATES: list[dict[str, object]] = []
