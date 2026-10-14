"""Agreement documents are built only from provably shared, canonical terms."""

from datetime import date

import pytest

from apps.brand_agent.main import demo_promotion
from libs.agents.agreements import (
    AgreementTermsMismatch,
    agreement_milestone_documents,
    build_agreement_document,
    build_negotiation_document,
)
from libs.agents.brand import build_initial_terms
from libs.domain.hashing import terms_hash
from libs.payments.settlement import lock_amount_base_units
from libs.repositories.seed import seed_demo_repository
from libs.repositories.store import InMemoryDocumentStore, KnotRepository


def _fixture():
    repository = KnotRepository(InMemoryDocumentStore())
    seed_demo_repository(repository)
    promotion = demo_promotion(category="beauty", today=date(2026, 10, 14))
    creator = repository.get_creator_profile_by_agent_id("agent-creator-1")
    terms = build_initial_terms(promotion, creator, base_amount_usdc=450)
    negotiation = build_negotiation_document(
        negotiation_id="negotiation-x",
        match_run_id="match-run-x",
        match_candidate_id=creator.creator_id,
        promotion=promotion,
        promotion_document=None,
        brand={"brandId": promotion.brand_id, "displayName": "데모 브랜드"},
        creator=creator,
        creator_agent_id="agent-creator-1",
        context_id="context-x",
        task_id="task-x",
        status="AGREED",
        rounds=2,
        initial_amount_usdc=400,
        current_terms=terms.model_dump(by_alias=True, mode="json"),
        brand_policy_snapshot={"ruleVersion": "brand-campaign.v1"},
        created_at="2026-10-14T00:00:00Z",
    )
    return promotion, creator, terms, negotiation


def test_agreement_document_recomputes_hash_and_projects_terms() -> None:
    promotion, creator, terms, negotiation = _fixture()
    agreement = build_agreement_document(
        negotiation=negotiation,
        agreement_id="agreement-x",
        artifact_terms_hash=terms_hash(terms),
        terms=terms,
        artifact_id=None,
        task_id="task-x",
        promotion_document=None,
        brand={"brandId": promotion.brand_id, "displayName": "데모 브랜드"},
        creator=creator,
        created_at="2026-10-14T00:00:00Z",
    )
    assert agreement["status"] == "FUNDING_REQUIRED"
    assert agreement["termsHash"] == terms_hash(terms)
    assert agreement["currentAmountUsdc"] == 450
    assert agreement["negotiationId"] == "negotiation-x"
    assert agreement["creatorAgentId"] == "agent-creator-1"
    assert agreement["brandDisplayName"] == "데모 브랜드"
    assert "개" in agreement["deliverableSummary"]
    # Negotiation document never carries the creator's private policy.
    assert negotiation["creatorPolicySnapshot"] == {"redacted": True}

    milestones = agreement_milestone_documents(agreement)
    assert [m["milestoneId"] for m in milestones] == [m.id for m in terms.milestones]
    assert sum(int(m["amountBaseUnits"]) for m in milestones) == lock_amount_base_units(terms)
    assert all(m["status"] == "PENDING" for m in milestones)


def test_agreement_document_rejects_hash_the_creator_did_not_prove() -> None:
    promotion, creator, terms, negotiation = _fixture()
    with pytest.raises(AgreementTermsMismatch):
        build_agreement_document(
            negotiation=negotiation,
            agreement_id="agreement-x",
            artifact_terms_hash="deadbeef",
            terms=terms,
            artifact_id=None,
            task_id="task-x",
            promotion_document=None,
            brand=None,
            creator=creator,
            created_at="2026-10-14T00:00:00Z",
        )
