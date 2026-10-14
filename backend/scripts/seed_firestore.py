#!/usr/bin/env python3
"""데모 픽스처를 Firestore(에뮬레이터)에 시드한다. 여러 번 실행해도 같은 결과(멱등).

    FIRESTORE_EMULATOR_HOST=127.0.0.1:8780 GOOGLE_CLOUD_PROJECT=demo-knot \\
      python scripts/seed_firestore.py --creator-agent-base-url http://127.0.0.1:8091/a2a/v1

기본은 에뮬레이터 전용이다. 실제 Firestore에 쓰려면 --allow-remote 를 명시해야 한다.
레지스트리(agentRegistry/*)에 이미 쌓인 운영 신호(heartbeat/프로브/협상 이력)는 재시드해도
지우지 않는다 — 시드는 정적 발행 데이터만 다시 쓴다.
"""

from __future__ import annotations

import argparse
import os
import sys
from collections.abc import Mapping
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from apps.api.repository_factory import build_repository  # noqa: E402
from libs.repositories.firestore_paths import COLLECTIONS, FirestorePaths  # noqa: E402
from libs.repositories.seed import seed_demo_repository  # noqa: E402
from libs.repositories.store import KnotRepository  # noqa: E402
from libs.settings.config import Settings  # noqa: E402

# Written by creator heartbeats / brand probes / campaign outcomes, never by the seed.
OPERATIONAL_REGISTRY_FIELDS = (
    "healthStatus",
    "lastSeenAt",
    "lastHeartbeatAt",
    "hostedBy",
    "lastProbeAt",
    "lastProbeStatus",
    "lastProbeError",
    "negotiationStats",
)

SEEDED_COLLECTIONS = (
    COLLECTIONS.users,
    COLLECTIONS.brands,
    COLLECTIONS.agents,
    COLLECTIONS.creator_profiles,
    COLLECTIONS.creator_discovery_profiles,
    COLLECTIONS.agent_registry,
    COLLECTIONS.agent_policies,
    COLLECTIONS.promotions,
)


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--project",
        default=os.getenv("GOOGLE_CLOUD_PROJECT") or os.getenv("GCP_PROJECT_ID") or "demo-knot",
    )
    parser.add_argument(
        "--creator-agent-base-url",
        default=os.getenv("CREATOR_AGENT_BASE_URL"),
        help="registry baseUrl for every published creator agent (heartbeats override it)",
    )
    parser.add_argument(
        "--include-business-flow",
        action="store_true",
        help="also load matchRuns/negotiations/agreements/escrows/settlements fixtures",
    )
    parser.add_argument(
        "--allow-remote",
        action="store_true",
        help="write to a real Firestore project (default: refuse unless FIRESTORE_EMULATOR_HOST)",
    )
    args = parser.parse_args()

    emulator = os.getenv("FIRESTORE_EMULATOR_HOST")
    if not emulator and not args.allow_remote:
        print(
            "❌ FIRESTORE_EMULATOR_HOST 가 없습니다. "
            "실제 Firestore 에 쓰려면 --allow-remote 를 주세요.",
            file=sys.stderr,
        )
        return 2

    settings = Settings(repository_backend="firestore", firestore_project_id=args.project)
    repository = build_repository(settings)
    target = f"emulator {emulator}" if emulator else "REMOTE Firestore"
    print(f"▸ seed → project={args.project} ({target}) baseUrl={args.creator_agent_base_url}")

    preserved = _operational_registry_fields(repository)
    seed_demo_repository(
        repository,
        creator_agent_base_url=args.creator_agent_base_url,
        include_business_flow=args.include_business_flow,
    )
    restored = _restore_operational_registry_fields(repository, preserved)

    for collection in SEEDED_COLLECTIONS:
        print(f"  {collection:<26} {len(repository.list_raw_documents(collection)):>3}")
    if restored:
        print(f"  (registry operational signals kept on {restored} existing entries)")
    return 0


def _operational_registry_fields(repository: KnotRepository) -> dict[str, dict[str, object]]:
    kept: dict[str, dict[str, object]] = {}
    for entry in repository.list_raw_documents(COLLECTIONS.agent_registry):
        agent_id = entry.get("agentId")
        if not isinstance(agent_id, str):
            continue
        fields = {k: entry[k] for k in OPERATIONAL_REGISTRY_FIELDS if k in entry}
        if not fields:
            continue
        # A heartbeat also moved baseUrl to the hosting process; keep that pairing intact.
        if "hostedBy" in fields and isinstance(entry.get("baseUrl"), str):
            fields["baseUrl"] = entry["baseUrl"]
        kept[agent_id] = fields
    return kept


def _restore_operational_registry_fields(
    repository: KnotRepository, preserved: Mapping[str, Mapping[str, object]]
) -> int:
    restored = 0
    for agent_id, fields in preserved.items():
        path = FirestorePaths.agent_registry_entry(agent_id)
        entry = repository.get_raw_document(path)
        if entry is None:
            continue
        repository.save_raw_document(path, {**entry, **fields})
        restored += 1
    return restored


if __name__ == "__main__":
    raise SystemExit(main())
