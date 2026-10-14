"""Agreement documents from negotiated term sheets (docs/13 §1-2).

Everything here is deterministic and repository-shape only: the brand side of a
negotiation (the product API or the standalone brand agent) turns a COMPLETED A2A
task's term-sheet artifact into the `negotiations/` and `agreements/` documents the
rest of the product (dashboards, escrow lock, evidence, settlement) already reads.

The creator's artifact carries an `agreementId` and a `termsHash`; we never trust the
hash, we recompute it from canonical terms and treat a mismatch as a hard failure.
"""

from __future__ import annotations

from typing import Any

from libs.domain.hashing import canonical_terms_json, terms_hash
from libs.domain.models import AgreementTerms, CreatorProfile, Promotion
from libs.payments.settlement import lock_amount_base_units, milestone_amounts_base_units
from libs.repositories.firestore_paths import FirestorePaths
from libs.repositories.store import KnotRepository

AGREEMENT_HASH_VERSION = "knot.agreement-terms.v1"


class AgreementTermsMismatch(ValueError):
    """The artifact's termsHash does not match the canonical hash of its terms."""


# --- term/document projections (shared with apps/api/routes.py) -------------------------


def terms_base_amount_usdc(terms: dict[str, object]) -> int | None:
    compensation = terms.get("compensation")
    if not isinstance(compensation, dict):
        return None
    amount = compensation.get("baseAmountUsdc")
    if isinstance(amount, int):
        return amount
    if isinstance(amount, str) and amount.isdigit():
        return int(amount)
    return None


def terms_work_items(terms: dict[str, object]) -> list[dict[str, object]]:
    deliverables = terms.get("deliverables")
    if not isinstance(deliverables, list):
        return []
    items: list[dict[str, object]] = []
    for deliverable in deliverables:
        if not isinstance(deliverable, dict):
            continue
        count = deliverable.get("count")
        if not isinstance(count, int) or count <= 0:
            continue
        items.append(
            {
                "format": deliverable.get("format"),
                "count": count,
                "postWindow": deliverable.get("postWindow"),
                "revisionRounds": deliverable.get("revisionRounds"),
            }
        )
    return items


def terms_deliverable_summary(terms: dict[str, object]) -> str:
    labels = {"reel": "릴스", "short": "숏츠", "post": "게시글", "story": "스토리"}
    parts: list[str] = []
    for item in terms_work_items(terms):
        format_value = str(item.get("format") or "content")
        label = labels.get(format_value, format_value)
        parts.append(f"{label} {item.get('count')}개")
    return ", ".join(parts) if parts else "작업 조건 미정"


def brand_display_name(brand: dict[str, object] | None, *, fallback: str) -> str:
    if brand is None:
        return fallback
    value = brand.get("displayName") or brand.get("brandName")
    return str(value) if isinstance(value, str) and value else fallback


def public_brand_snapshot(brand: dict[str, object] | None) -> dict[str, object] | None:
    if brand is None:
        return None
    return {
        "brandId": brand.get("brandId"),
        "displayName": brand.get("displayName") or brand.get("brandName"),
        "websiteUrl": brand.get("websiteUrl"),
        "categories": brand.get("categories", []),
        "targetAudience": brand.get("targetAudience"),
        "description": brand.get("description"),
    }


def public_promotion_snapshot(promotion: dict[str, object] | None) -> dict[str, object] | None:
    if promotion is None:
        return None
    return {
        "promotionId": promotion.get("promotionId"),
        "title": promotion.get("title"),
        "productName": promotion.get("productName") or promotion.get("title"),
        "category": promotion.get("category"),
        "objective": promotion.get("objective"),
    }


def public_creator_snapshot(creator: CreatorProfile | None) -> dict[str, object] | None:
    if creator is None:
        return None
    return {
        "creatorId": creator.creator_id,
        "creatorAgentId": creator.creator_agent_id,
        "displayName": creator.display_name,
        "categories": creator.categories,
        "completedDealCount": creator.completed_deal_count,
    }


# --- documents --------------------------------------------------------------------------


def build_negotiation_document(
    *,
    negotiation_id: str,
    match_run_id: str,
    match_candidate_id: str,
    promotion: Promotion,
    promotion_document: dict[str, object] | None,
    brand: dict[str, object] | None,
    creator: CreatorProfile | None,
    creator_agent_id: str,
    context_id: str,
    task_id: str | None,
    status: str,
    rounds: int,
    initial_amount_usdc: int,
    current_terms: dict[str, object] | None,
    brand_policy_snapshot: dict[str, object],
    created_at: str,
) -> dict[str, object]:
    """Shape-compatible with the product API's single-negotiation document."""
    promotion_document = promotion_document or {}
    terms = current_terms or {}
    return {
        "negotiationId": negotiation_id,
        "matchRunId": match_run_id,
        "matchCandidateId": match_candidate_id,
        "matchCandidatePath": FirestorePaths.match_candidate(match_run_id, match_candidate_id),
        "promotionId": promotion.promotion_id,
        "promotionTitle": promotion.title,
        "productName": promotion_document.get("productName") or promotion.title,
        "brandId": promotion.brand_id,
        "brandAgentId": promotion.brand_agent_id,
        "brandDisplayName": brand_display_name(brand, fallback=promotion.brand_id),
        "brandSnapshot": public_brand_snapshot(brand),
        "creatorId": creator.creator_id if creator else match_candidate_id,
        "creatorAgentId": creator_agent_id,
        "creatorDisplayName": creator.display_name if creator else creator_agent_id,
        "creatorSnapshot": public_creator_snapshot(creator),
        "promotionSnapshot": public_promotion_snapshot(
            promotion_document or _promotion_as_document(promotion)
        ),
        "contextId": context_id,
        "taskId": task_id,
        "status": status,
        "currentRound": rounds,
        "maxRounds": promotion.autonomy.max_negotiation_rounds,
        "currentTerms": current_terms,
        "initialAmountUsdc": initial_amount_usdc,
        "currentAmountUsdc": terms_base_amount_usdc(terms),
        "workItems": terms_work_items(terms),
        "deliverableSummary": terms_deliverable_summary(terms),
        "brandPolicySnapshot": brand_policy_snapshot,
        "creatorPolicySnapshot": {"redacted": True},
        "createdAt": created_at,
        "updatedAt": created_at,
    }


def build_agreement_document(
    *,
    negotiation: dict[str, object],
    agreement_id: str,
    artifact_terms_hash: str,
    terms: AgreementTerms,
    artifact_id: str | None,
    task_id: str | None,
    promotion_document: dict[str, object] | None,
    brand: dict[str, object] | None,
    creator: CreatorProfile | None,
    created_at: str,
) -> dict[str, object]:
    """Create the `agreements/{id}` document for an ACCEPTed term sheet.

    Raises AgreementTermsMismatch when the artifact's hash is not the canonical hash:
    an agreement must never be created from terms the two agents don't provably share.
    """
    computed = terms_hash(terms)
    if artifact_terms_hash != computed:
        raise AgreementTermsMismatch(
            f"artifact termsHash {artifact_terms_hash} != canonical {computed}"
        )
    terms_document = terms.model_dump(by_alias=True, mode="json")
    return {
        "agreementId": agreement_id,
        "negotiationId": negotiation["negotiationId"],
        "taskId": task_id,
        "artifactId": artifact_id,
        "promotionId": negotiation["promotionId"],
        "promotionTitle": negotiation.get("promotionTitle"),
        "productName": negotiation.get("productName"),
        "brandId": negotiation.get("brandId"),
        "brandAgentId": negotiation["brandAgentId"],
        "brandDisplayName": negotiation.get("brandDisplayName"),
        "creatorId": negotiation.get("creatorId"),
        "creatorAgentId": negotiation["creatorAgentId"],
        "creatorDisplayName": negotiation.get("creatorDisplayName"),
        "terms": terms_document,
        "workItems": terms_work_items(terms_document),
        "deliverableSummary": terms_deliverable_summary(terms_document),
        "currentAmountUsdc": terms_base_amount_usdc(terms_document),
        "brandSnapshot": public_brand_snapshot(brand),
        "promotionSnapshot": public_promotion_snapshot(promotion_document),
        "creatorSnapshot": public_creator_snapshot(creator),
        "canonicalTermsJson": canonical_terms_json(terms),
        "termsHash": computed,
        "hashAlgorithm": "sha256",
        "hashVersion": AGREEMENT_HASH_VERSION,
        "status": "FUNDING_REQUIRED",
        "brandAuthority": None,
        "creatorDestination": None,
        "escrowId": None,
        "fundingTransactionSignature": None,
        "createdAt": created_at,
    }


def agreement_milestone_documents(agreement: dict[str, object]) -> list[dict[str, object]]:
    """Milestone rows whose base-unit amounts sum exactly to the escrow lock amount."""
    agreement_id = str(agreement["agreementId"])
    terms = AgreementTerms.model_validate(agreement["terms"])
    locked_amount = lock_amount_base_units(terms)
    milestone_amounts = milestone_amounts_base_units(locked_amount, terms.milestones)
    documents: list[dict[str, object]] = []
    for milestone in terms.milestones:
        amount_base_units = milestone_amounts.get(milestone.id, 0)
        documents.append(
            {
                "milestoneId": milestone.id,
                "agreementId": agreement_id,
                "title": milestone.trigger,
                "trigger": milestone.trigger,
                "releasePct": milestone.release_pct,
                "amountBaseUnits": str(amount_base_units),
                "amountUsdc": str(amount_base_units // 1_000_000),
                "status": "PENDING",
                "evidence": {},
                "verificationResult": {},
                "releaseTransactionSignature": None,
                "releasedAt": None,
                "createdAt": agreement["createdAt"],
            }
        )
    return documents


def write_agreement_milestones(repository: KnotRepository, agreement: dict[str, object]) -> None:
    agreement_id = str(agreement["agreementId"])
    for document in agreement_milestone_documents(agreement):
        repository.save_raw_document(
            FirestorePaths.milestone(agreement_id, str(document["milestoneId"])), document
        )


def _promotion_as_document(promotion: Promotion) -> dict[str, Any]:
    return promotion.model_dump(by_alias=True, mode="json")
