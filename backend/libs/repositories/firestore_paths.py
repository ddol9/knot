from dataclasses import dataclass


def _validate_segment(name: str, value: str) -> None:
    if not value or "/" in value:
        raise ValueError(f"{name} must be a non-empty Firestore path segment")


def document_path(collection: str, document_id: str) -> str:
    _validate_segment("collection", collection)
    _validate_segment("document_id", document_id)
    return f"{collection}/{document_id}"


def subcollection_document_path(
    parent_collection: str,
    parent_id: str,
    subcollection: str,
    document_id: str,
) -> str:
    return (
        f"{document_path(parent_collection, parent_id)}/"
        f"{document_path(subcollection, document_id)}"
    )


@dataclass(frozen=True)
class FirestoreCollection:
    users: str = "users"
    brands: str = "brands"
    creator_profiles: str = "creatorProfiles"
    product_profiles: str = "productProfiles"
    social_snapshots: str = "socialSnapshots"
    analysis_jobs: str = "analysisJobs"
    agents: str = "agents"
    agent_policies: str = "agentPolicies"
    agent_authorities: str = "agentAuthorities"
    agent_registry: str = "agentRegistry"
    creator_discovery_profiles: str = "creatorDiscoveryProfiles"
    promotions: str = "promotions"
    promotion_events: str = "events"
    match_runs: str = "matchRuns"
    match_candidates: str = "candidates"
    match_run_events: str = "events"
    negotiations: str = "negotiations"
    negotiation_messages: str = "messages"
    negotiation_decisions: str = "decisions"
    a2a_tasks: str = "a2aTasks"
    a2a_events: str = "events"
    a2a_artifacts: str = "artifacts"
    agreements: str = "agreements"
    milestones: str = "milestones"
    evidence: str = "evidence"
    verification_results: str = "verificationResults"
    disputes: str = "disputes"
    escrows: str = "escrows"
    settlements: str = "settlements"
    agent_activities: str = "agentActivities"
    onboarding_sessions: str = "onboardingSessions"
    payment_operations: str = "paymentOperations"
    transaction_receipts: str = "transactionReceipts"
    agent_payment_events: str = "agentPaymentEvents"
    audit_events: str = "auditEvents"
    notifications: str = "notifications"
    idempotency_records: str = "idempotencyRecords"
    admin_jobs: str = "adminJobs"
    deletion_jobs: str = "deletionJobs"
    wallet_challenges: str = "walletChallenges"
    approvals: str = "approvals"


COLLECTIONS = FirestoreCollection()


class FirestorePaths:
    @staticmethod
    def user(user_id: str) -> str:
        return document_path(COLLECTIONS.users, user_id)

    @staticmethod
    def wallet_challenge(challenge_id: str) -> str:
        return document_path(COLLECTIONS.wallet_challenges, challenge_id)

    @staticmethod
    def user_notifications(user_id: str) -> str:
        return f"{document_path(COLLECTIONS.users, user_id)}/{COLLECTIONS.notifications}"

    @staticmethod
    def user_notification(user_id: str, notification_id: str) -> str:
        return subcollection_document_path(
            COLLECTIONS.users, user_id, COLLECTIONS.notifications, notification_id
        )

    @staticmethod
    def brand(brand_id: str) -> str:
        return document_path(COLLECTIONS.brands, brand_id)

    @staticmethod
    def creator_profile(creator_id: str) -> str:
        return document_path(COLLECTIONS.creator_profiles, creator_id)

    @staticmethod
    def product_profile(product_profile_id: str) -> str:
        return document_path(COLLECTIONS.product_profiles, product_profile_id)

    @staticmethod
    def social_snapshot(snapshot_id: str) -> str:
        return document_path(COLLECTIONS.social_snapshots, snapshot_id)

    @staticmethod
    def analysis_job(analysis_id: str) -> str:
        return document_path(COLLECTIONS.analysis_jobs, analysis_id)

    @staticmethod
    def agent(agent_id: str) -> str:
        return document_path(COLLECTIONS.agents, agent_id)

    @staticmethod
    def agent_policy(agent_id: str) -> str:
        return document_path(COLLECTIONS.agent_policies, agent_id)

    @staticmethod
    def agent_authority(agent_id: str) -> str:
        return document_path(COLLECTIONS.agent_authorities, agent_id)

    @staticmethod
    def agent_registry_entry(agent_id: str) -> str:
        return document_path(COLLECTIONS.agent_registry, agent_id)

    @staticmethod
    def creator_discovery_profile(creator_id: str) -> str:
        return document_path(COLLECTIONS.creator_discovery_profiles, creator_id)

    @staticmethod
    def promotion(promotion_id: str) -> str:
        return document_path(COLLECTIONS.promotions, promotion_id)

    @staticmethod
    def promotion_event(promotion_id: str, event_id: str) -> str:
        return subcollection_document_path(
            COLLECTIONS.promotions,
            promotion_id,
            COLLECTIONS.promotion_events,
            event_id,
        )

    @staticmethod
    def match_run(match_run_id: str) -> str:
        return document_path(COLLECTIONS.match_runs, match_run_id)

    @staticmethod
    def match_candidate(match_run_id: str, creator_id: str) -> str:
        return subcollection_document_path(
            COLLECTIONS.match_runs,
            match_run_id,
            COLLECTIONS.match_candidates,
            creator_id,
        )

    @staticmethod
    def match_run_event(match_run_id: str, event_id: str) -> str:
        return subcollection_document_path(
            COLLECTIONS.match_runs,
            match_run_id,
            COLLECTIONS.match_run_events,
            event_id,
        )

    @staticmethod
    def negotiation(negotiation_id: str) -> str:
        return document_path(COLLECTIONS.negotiations, negotiation_id)

    @staticmethod
    def negotiation_message(negotiation_id: str, message_id: str) -> str:
        return subcollection_document_path(
            COLLECTIONS.negotiations,
            negotiation_id,
            COLLECTIONS.negotiation_messages,
            message_id,
        )

    @staticmethod
    def negotiation_decision(negotiation_id: str, decision_id: str) -> str:
        return subcollection_document_path(
            COLLECTIONS.negotiations,
            negotiation_id,
            COLLECTIONS.negotiation_decisions,
            decision_id,
        )

    @staticmethod
    def a2a_task(task_id: str) -> str:
        return document_path(COLLECTIONS.a2a_tasks, task_id)

    @staticmethod
    def a2a_task_event(task_id: str, event_id: str) -> str:
        return subcollection_document_path(
            COLLECTIONS.a2a_tasks,
            task_id,
            COLLECTIONS.a2a_events,
            event_id,
        )

    @staticmethod
    def a2a_task_artifact(task_id: str, artifact_id: str) -> str:
        return subcollection_document_path(
            COLLECTIONS.a2a_tasks,
            task_id,
            COLLECTIONS.a2a_artifacts,
            artifact_id,
        )

    @staticmethod
    def agreement(agreement_id: str) -> str:
        return document_path(COLLECTIONS.agreements, agreement_id)

    @staticmethod
    def milestone(agreement_id: str, milestone_id: str) -> str:
        return subcollection_document_path(
            COLLECTIONS.agreements,
            agreement_id,
            COLLECTIONS.milestones,
            milestone_id,
        )

    @staticmethod
    def evidence(evidence_id: str) -> str:
        return document_path(COLLECTIONS.evidence, evidence_id)

    @staticmethod
    def verification_result(verification_result_id: str) -> str:
        return document_path(COLLECTIONS.verification_results, verification_result_id)

    @staticmethod
    def dispute(dispute_id: str) -> str:
        return document_path(COLLECTIONS.disputes, dispute_id)

    @staticmethod
    def escrow(escrow_id: str) -> str:
        return document_path(COLLECTIONS.escrows, escrow_id)

    @staticmethod
    def settlement(settlement_id: str) -> str:
        return document_path(COLLECTIONS.settlements, settlement_id)

    @staticmethod
    def agent_activity(activity_id: str) -> str:
        return document_path(COLLECTIONS.agent_activities, activity_id)

    @staticmethod
    def onboarding_session(owner_id: str) -> str:
        return document_path(COLLECTIONS.onboarding_sessions, owner_id)

    @staticmethod
    def payment_operation(operation_id: str) -> str:
        return document_path(COLLECTIONS.payment_operations, operation_id)

    @staticmethod
    def transaction_receipt(receipt_id: str) -> str:
        return document_path(COLLECTIONS.transaction_receipts, receipt_id)

    @staticmethod
    def agent_payment_event(event_id: str) -> str:
        return document_path(COLLECTIONS.agent_payment_events, event_id)

    @staticmethod
    def audit_event(event_id: str) -> str:
        return document_path(COLLECTIONS.audit_events, event_id)

    @staticmethod
    def idempotency_record(key: str) -> str:
        return document_path(COLLECTIONS.idempotency_records, key)

    @staticmethod
    def admin_job(job_id: str) -> str:
        return document_path(COLLECTIONS.admin_jobs, job_id)

    @staticmethod
    def deletion_job(job_id: str) -> str:
        return document_path(COLLECTIONS.deletion_jobs, job_id)

    @staticmethod
    def approval(approval_id: str) -> str:
        return document_path(COLLECTIONS.approvals, approval_id)
