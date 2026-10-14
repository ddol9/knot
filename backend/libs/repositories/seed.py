import json
import re
from collections.abc import Mapping
from datetime import date, datetime, timedelta
from pathlib import Path

from libs.a2a.registry import creator_agent_registry_entry
from libs.domain.discovery import build_creator_discovery_projection
from libs.domain.models import AgentPolicy, CreatorProfile, Promotion
from libs.repositories.firestore_paths import FirestorePaths
from libs.repositories.store import KnotRepository

# 데모 픽스처가 작성된 기준일. 픽스처 안의 날짜는 모두 이 날짜를 "오늘"로 가정한 상대값이다.
FIXTURE_ANCHOR_DATE = date(2026, 7, 24)

_DATE_ONLY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_DATE_TIME = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$")


def fixture_date_shift(today: date | None = None) -> timedelta:
    """픽스처 기준일부터 오늘까지의 간격. 기준일 이전이면 0."""
    delta = (today or date.today()) - FIXTURE_ANCHOR_DATE
    return delta if delta > timedelta(0) else timedelta(0)


def rebase_fixture_document(
    document: Mapping[str, object],
    shift: timedelta,
) -> dict[str, object]:
    """픽스처 문서 안의 ISO 날짜/시각을 shift 만큼 미룬다.

    Promotion 의 postingWindow 가 과거로 밀리면 creator 정책의 minDaysToPost 가 항상
    걸려서(CREATOR_LEAD_TIME_TOO_SHORT) 데모 협상이 ESCALATED 로 끝난다. 픽스처 날짜를
    고정값으로 두면 작성 시점이 지나는 순간 데모와 테스트가 같이 죽으므로 상대값으로 되돌린다.
    """
    return {key: _rebase_value(value, shift) for key, value in document.items()}


def _rebase_value(value: object, shift: timedelta) -> object:
    if shift == timedelta(0):
        return value
    if isinstance(value, Mapping):
        return {key: _rebase_value(item, shift) for key, item in value.items()}
    if isinstance(value, list):
        return [_rebase_value(item, shift) for item in value]
    if isinstance(value, str):
        if _DATE_ONLY.match(value):
            return (date.fromisoformat(value) + shift).isoformat()
        if _DATE_TIME.match(value):
            moment = datetime.fromisoformat(value.replace("Z", "+00:00")) + shift
            return moment.isoformat().replace("+00:00", "Z")
    return value


def backend_root() -> Path:
    return Path(__file__).resolve().parents[2]


def load_json_array(path: Path) -> list[dict[str, object]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise ValueError(f"{path} must contain a JSON array")
    return [_as_document(item, path) for item in raw]


def seed_demo_repository(
    repository: KnotRepository,
    *,
    fixtures_dir: Path | None = None,
    include_business_flow: bool = False,
    creator_agent_base_url: str | None = None,
) -> None:
    fixture_root = fixtures_dir or backend_root() / "fixtures"

    users_path = fixture_root / "users.json"
    if users_path.exists():
        for user in load_json_array(users_path):
            repository.save_raw_document(FirestorePaths.user(_require_str(user, "userId")), user)

    for brand in load_json_array(fixture_root / "brands.json"):
        repository.save_raw_document(FirestorePaths.brand(_require_str(brand, "brandId")), brand)

    agents_by_id: dict[str, dict[str, object]] = {}
    for agent in load_json_array(fixture_root / "agents.json"):
        agents_by_id[_require_str(agent, "agentId")] = agent

    creators: list[CreatorProfile] = []
    for payload in load_json_array(fixture_root / "creators.json"):
        creators.append(CreatorProfile.model_validate(payload))

    for creator in creators:
        creator_agent = agents_by_id.get(creator.creator_agent_id)
        if creator_agent is None:
            continue
        agents_by_id[creator.creator_agent_id] = _seed_creator_agent(creator_agent, creator)

    for stored_agent in agents_by_id.values():
        repository.save_raw_document(
            FirestorePaths.agent(_require_str(stored_agent, "agentId")),
            stored_agent,
        )

    for creator in creators:
        repository.save_creator_profile(creator)
        discovery_agent = agents_by_id.get(creator.creator_agent_id)
        if discovery_agent is None or discovery_agent.get("publicationStatus") != "PUBLISHED":
            continue
        repository.save_raw_document(
            FirestorePaths.creator_discovery_profile(creator.creator_id),
            build_creator_discovery_projection(
                creator,
                discovery_agent,
                updated_at=_require_str(discovery_agent, "updatedAt"),
            ),
        )
        repository.save_raw_document(
            FirestorePaths.agent_registry_entry(creator.creator_agent_id),
            creator_agent_registry_entry(
                discovery_agent,
                updated_at=_require_str(discovery_agent, "updatedAt"),
                base_url=creator_agent_base_url,
            ),
        )

    for payload in load_json_array(fixture_root / "agent_policies.json"):
        repository.save_agent_policy(AgentPolicy.model_validate(payload))

    shift = fixture_date_shift()
    for raw_payload in load_json_array(fixture_root / "promotions.json"):
        payload = rebase_fixture_document(raw_payload, shift)
        promotion = Promotion.model_validate(payload)
        repository.save_promotion(promotion)
        repository.save_raw_document(FirestorePaths.promotion(promotion.promotion_id), payload)

    if include_business_flow:
        raw_fixture_paths = {
            "match_runs.json": FirestorePaths.match_run,
            "negotiations.json": FirestorePaths.negotiation,
            "agreements.json": FirestorePaths.agreement,
            "escrows.json": FirestorePaths.escrow,
            "settlements.json": FirestorePaths.settlement,
        }
        for filename, path_factory in raw_fixture_paths.items():
            path = fixture_root / filename
            if not path.exists():
                continue
            for document in load_json_array(path):
                document_id = _fixture_document_id(document)
                repository.save_raw_document(path_factory(document_id), document)


def _as_document(item: object, path: Path) -> dict[str, object]:
    if not isinstance(item, dict):
        raise ValueError(f"{path} contains a non-object item")
    return dict(item)


def _require_str(document: Mapping[str, object], field_name: str) -> str:
    value = document.get(field_name)
    if not isinstance(value, str) or not value:
        raise ValueError(f"{field_name} must be a non-empty string")
    return value


def _seed_creator_agent(
    agent: Mapping[str, object],
    creator: CreatorProfile,
) -> dict[str, object]:
    publication_status = "PUBLISHED" if creator.active else "DRAFT"
    accepting_offers = creator.active
    if not accepting_offers:
        availability = "UNAVAILABLE"
    elif creator.remaining_capacity > 0:
        availability = "AVAILABLE"
    else:
        availability = "AT_CAPACITY"
    return {
        **agent,
        "status": str(agent.get("status") or "ACTIVE"),
        "publicationStatus": str(agent.get("publicationStatus") or publication_status),
        "acceptingOffers": bool(agent.get("acceptingOffers", accepting_offers)),
        "availability": str(agent.get("availability") or availability),
        "activeNegotiations": _int_value(agent.get("activeNegotiations"), 0),
        "maxConcurrentNegotiations": _int_value(agent.get("maxConcurrentNegotiations"), 1),
        "activeCollaborations": _int_value(agent.get("activeCollaborations"), 0),
        "maxActiveCollaborations": _int_value(agent.get("maxActiveCollaborations"), 1),
    }


def _int_value(value: object, default: int) -> int:
    return value if isinstance(value, int) else default


def _fixture_document_id(document: Mapping[str, object]) -> str:
    for field_name in (
        "settlementId",
        "escrowId",
        "agreementId",
        "negotiationId",
        "matchCandidateId",
        "matchRunId",
    ):
        value = document.get(field_name)
        if isinstance(value, str) and value:
            return value
    raise ValueError("fixture document must include a supported id field")
