"""Campaign fan-out: one brand agent negotiating with several creator agents at once.

Budget safety has two layers:
  * BudgetLedger reserves each candidate's private ceiling before its negotiation
    starts, so N parallel negotiations can never commit more than the promotion's
    total budget even if every one of them agrees.
  * Each BrandNegotiator also runs validate_brand_terms with the ledger's committed
    total, so the policy engine independently blocks a cumulative overspend.

Events are pushed through `on_event` so the HTTP layer can stream them (SSE).
"""

from __future__ import annotations

import threading
from collections import deque
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field

from libs.a2a.client import CreatorA2AClient, CreatorA2AClientError
from libs.a2a.registry import record_agent_probe, record_negotiation_outcome
from libs.agents.agreements import (
    AgreementTermsMismatch,
    build_agreement_document,
    build_negotiation_document,
    write_agreement_milestones,
)
from libs.agents.brand_discovery import DiscoveryReport, discover_creator_agents
from libs.agents.brand_negotiator import (
    A2ATransport,
    BrandNegotiationResult,
    BrandNegotiationStrategy,
    BrandNegotiator,
    DisplayProvider,
    NegotiationTurn,
)
from libs.domain.models import CreatorProfile, Promotion
from libs.repositories.firestore_paths import FirestorePaths
from libs.repositories.store import KnotRepository

CampaignOutcome = Literal["TARGET_REACHED", "PARTIAL", "NO_AGREEMENT", "NO_CANDIDATES"]
TransportFactory = Callable[[str], A2ATransport]  # base_url -> transport
# agreement document -> escrow summary
#   {"status": "LOCKED" | "SKIPPED" | "FAILED", "reason"?, "escrowId"?, "signature"?}
SettlementHook = Callable[[dict[str, Any]], dict[str, Any]]


class CampaignStrategy(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    target_creator_count: int = Field(default=2, alias="targetCreatorCount", ge=1)
    max_candidates: int = Field(default=5, alias="maxCandidates", ge=1, le=20)
    parallelism: int = Field(default=3, ge=1, le=10)
    opening_amount_usdc: int = Field(alias="openingAmountUsdc", ge=0)
    # Per-creator private ceiling; also capped by promotion.budget.maxPerCreatorUsdc.
    ceiling_usdc: int = Field(alias="ceilingUsdc", ge=0)
    concession_pct: int = Field(default=50, alias="concessionPct", ge=1, le=100)
    max_rounds: int | None = Field(default=None, alias="maxRounds", ge=1)


class CampaignEvent(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    event: str
    creator_agent_id: str | None = Field(default=None, alias="creatorAgentId")
    data: dict[str, Any] = Field(default_factory=dict)


class CandidateNegotiation(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    creator_agent_id: str = Field(alias="creatorAgentId")
    display_name: str = Field(alias="displayName")
    base_url: str = Field(alias="baseUrl")
    status: Literal["QUEUED", "RUNNING", "DONE", "SKIPPED"] = "QUEUED"
    skip_reason: str | None = Field(default=None, alias="skipReason")
    reserved_usdc: int = Field(default=0, alias="reservedUsdc")
    committed_usdc: int = Field(default=0, alias="committedUsdc")
    result: BrandNegotiationResult | None = None
    negotiation_id: str | None = Field(default=None, alias="negotiationId")
    agreement_id: str | None = Field(default=None, alias="agreementId")
    terms_hash: str | None = Field(default=None, alias="termsHash")
    escrow: dict[str, Any] | None = None


class CampaignResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    campaign_id: str = Field(alias="campaignId")
    match_run_id: str = Field(alias="matchRunId")
    outcome: CampaignOutcome
    promotion_id: str = Field(alias="promotionId")
    target_creator_count: int = Field(alias="targetCreatorCount")
    agreed_count: int = Field(alias="agreedCount")
    total_budget_usdc: int = Field(alias="totalBudgetUsdc")
    committed_usdc: int = Field(alias="committedUsdc")
    agreement_ids: list[str] = Field(default_factory=list, alias="agreementIds")
    discovery: DiscoveryReport
    negotiations: list[CandidateNegotiation]


class BudgetLedger:
    """Thread-safe reservation ledger over one promotion budget."""

    def __init__(self, total_usdc: int) -> None:
        self.total_usdc = total_usdc
        self._reserved: dict[str, int] = {}
        self._committed: dict[str, int] = {}
        self._lock = threading.Lock()
        self._changed = threading.Condition(self._lock)
        # FIFO of agents waiting for funds: callers arrive in rank order, so the
        # best-ranked candidate gets the next freed budget, not whoever wakes first.
        self._waiting: deque[str] = deque()

    def reserve(self, agent_id: str, amount: int) -> bool:
        with self._lock:
            if self._in_use() + amount > self.total_usdc:
                return False
            self._reserved[agent_id] = amount
            return True

    def reserve_or_wait(
        self, agent_id: str, amount: int, *, give_up: Callable[[], bool]
    ) -> Literal["RESERVED", "EXHAUSTED", "STOPPED"]:
        """Reserve now, or queue (FIFO) and retry whenever funds are committed/released.

        Returns EXHAUSTED only when this caller is at the head of the queue, nothing is
        in flight, and the budget still cannot cover `amount` (waiting would never help)."""
        with self._lock:
            self._waiting.append(agent_id)
            try:
                while True:
                    if give_up():
                        return "STOPPED"
                    at_head = self._waiting[0] == agent_id
                    if at_head and self._in_use() + amount <= self.total_usdc:
                        self._reserved[agent_id] = amount
                        return "RESERVED"
                    if at_head and not self._reserved:
                        return "EXHAUSTED"
                    self._changed.wait(timeout=0.5)
            finally:
                self._waiting.remove(agent_id)
                self._changed.notify_all()

    def commit(self, agent_id: str, amount: int) -> None:
        with self._lock:
            self._reserved.pop(agent_id, None)
            self._committed[agent_id] = amount
            self._changed.notify_all()

    def release(self, agent_id: str) -> None:
        with self._lock:
            self._reserved.pop(agent_id, None)
            self._changed.notify_all()

    def wake_all(self) -> None:
        with self._lock:
            self._changed.notify_all()

    def committed_excluding(self, agent_id: str) -> int:
        with self._lock:
            return sum(v for k, v in self._committed.items() if k != agent_id)

    @property
    def committed_usdc(self) -> int:
        with self._lock:
            return sum(self._committed.values())

    @property
    def available_usdc(self) -> int:
        with self._lock:
            return self.total_usdc - self._in_use()

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {
                "totalUsdc": self.total_usdc,
                "reservedUsdc": sum(self._reserved.values()),
                "committedUsdc": sum(self._committed.values()),
                "availableUsdc": self.total_usdc - self._in_use(),
            }

    def _in_use(self) -> int:
        return sum(self._reserved.values()) + sum(self._committed.values())


class CampaignRunner:
    def __init__(
        self,
        *,
        repository: KnotRepository,
        promotion: Promotion,
        strategy: CampaignStrategy,
        transport_factory: TransportFactory,
        default_base_url: str,
        endpoint_overrides: dict[str, str] | None = None,
        display_provider: DisplayProvider | None = None,
        on_event: Callable[[CampaignEvent], None] | None = None,
        probe_cards: bool = True,
        brand: dict[str, Any] | None = None,
        promotion_document: dict[str, Any] | None = None,
        settlement_hook: SettlementHook | None = None,
    ) -> None:
        self._repository = repository
        self._promotion = promotion
        self._brand = brand
        self._promotion_document = promotion_document or promotion.model_dump(
            by_alias=True, mode="json"
        )
        self._settlement_hook = settlement_hook
        self._strategy = strategy
        self._transport_factory = transport_factory
        self._default_base_url = default_base_url
        self._endpoint_overrides = endpoint_overrides or {}
        self._display_provider = display_provider
        self._on_event = on_event or (lambda _event: None)
        self._probe_cards = probe_cards
        self._campaign_id = f"campaign-{uuid4()}"
        self._match_run_id = f"match-run-{uuid4()}"
        self._agreed = 0
        self._agreed_lock = threading.Lock()
        self._stop = threading.Event()
        self._creator_id_by_agent: dict[str, str] = {}
        self._agreement_ids: list[str] = []

    @property
    def campaign_id(self) -> str:
        return self._campaign_id

    def run(self) -> CampaignResult:
        promotion, strategy = self._promotion, self._strategy
        ledger = BudgetLedger(promotion.budget.total_usdc)

        report, profiles = discover_creator_agents(
            self._repository,
            promotion,
            limit=strategy.max_candidates,
            default_base_url=self._default_base_url,
            endpoint_overrides=self._endpoint_overrides,
            card_probe=self._probe if self._probe_cards else None,
        )
        self._emit("discovery", data={"report": report.model_dump(by_alias=True, mode="json")})
        self._persist_match_run(report)

        negotiations = [
            CandidateNegotiation(
                creatorAgentId=c.creator_agent_id, displayName=c.display_name, baseUrl=c.base_url
            )
            for c in report.selected
        ]
        if not negotiations:
            return self._result("NO_CANDIDATES", report, negotiations, ledger)

        per_creator_ceiling = min(
            strategy.ceiling_usdc,
            promotion.budget.max_per_creator_usdc,
            promotion.budget.total_usdc,
        )
        by_id = {n.creator_agent_id: n for n in negotiations}

        def work(negotiation: CandidateNegotiation) -> None:
            agent_id = negotiation.creator_agent_id
            reservation = ledger.reserve_or_wait(
                agent_id, per_creator_ceiling, give_up=self._stop.is_set
            )
            if reservation != "RESERVED":
                reason = "TARGET_REACHED" if reservation == "STOPPED" else "BUDGET_EXHAUSTED"
                negotiation.status, negotiation.skip_reason = "SKIPPED", reason
                self._emit(
                    "negotiation_skipped",
                    agent_id,
                    {"reason": reason, "ledger": ledger.snapshot()},
                )
                return
            negotiation.status = "RUNNING"
            negotiation.reserved_usdc = per_creator_ceiling
            self._emit(
                "negotiation_started",
                agent_id,
                {
                    "baseUrl": negotiation.base_url,
                    "reservedUsdc": per_creator_ceiling,
                    "ledger": ledger.snapshot(),
                },
            )
            try:
                result = BrandNegotiator(
                    self._transport_factory(negotiation.base_url),
                    promotion=promotion,
                    creator_agent_id=agent_id,
                    strategy=BrandNegotiationStrategy(
                        openingAmountUsdc=min(strategy.opening_amount_usdc, per_creator_ceiling),
                        ceilingUsdc=per_creator_ceiling,
                        concessionPct=strategy.concession_pct,
                        maxRounds=strategy.max_rounds,
                    ),
                    creator=profiles.get(agent_id),
                    display_provider=self._display_provider,
                    on_turn=lambda turn, _id=agent_id: self._on_turn(_id, turn),
                    should_stop=self._stop.is_set,
                    committed_usdc_provider=lambda _id=agent_id: ledger.committed_excluding(_id),
                ).run()
            except CreatorA2AClientError as exc:
                ledger.release(agent_id)
                negotiation.status, negotiation.skip_reason = "SKIPPED", f"A2A_ERROR: {exc}"
                # Could not talk to it: the registry should order it later next time.
                record_agent_probe(
                    self._repository, agent_id, status="DOWN", error=str(exc)[:200], now=_now()
                )
                self._emit("negotiation_error", agent_id, {"detail": str(exc)})
                return

            negotiation.result = result
            negotiation.status = "DONE"
            record_negotiation_outcome(
                self._repository, agent_id, outcome=result.outcome, now=_now()
            )
            agreement: dict[str, Any] | None = None
            if result.outcome == "AGREED":
                try:
                    agreement = self._record_agreement(negotiation, result, profiles.get(agent_id))
                except AgreementTermsMismatch as exc:
                    # Not a shared, provable term sheet: never count it, give the budget back.
                    ledger.release(agent_id)
                    negotiation.skip_reason = "TERMS_HASH_MISMATCH"
                    self._emit("negotiation_error", agent_id, {"detail": str(exc)})
                else:
                    ledger.commit(agent_id, result.final_amount_usdc)
                    negotiation.committed_usdc = result.final_amount_usdc
                    with self._agreed_lock:
                        self._agreed += 1
                        self._agreement_ids.append(str(agreement["agreementId"]))
                        if self._agreed >= strategy.target_creator_count:
                            self._stop.set()
                            ledger.wake_all()
            else:
                ledger.release(agent_id)
            self._emit(
                "negotiation_result",
                agent_id,
                {
                    "result": result.model_dump(by_alias=True, mode="json"),
                    "ledger": ledger.snapshot(),
                },
            )
            self._persist_candidate(negotiation)
            if agreement is not None:
                self._emit(
                    "agreement_created",
                    agent_id,
                    {
                        "agreementId": agreement["agreementId"],
                        "negotiationId": agreement["negotiationId"],
                        "termsHash": agreement["termsHash"],
                        "amountUsdc": agreement["currentAmountUsdc"],
                        "deliverableSummary": agreement["deliverableSummary"],
                        "status": agreement["status"],
                    },
                )
                self._settle(negotiation, agreement)
                self._persist_candidate(negotiation)

        with ThreadPoolExecutor(max_workers=strategy.parallelism) as pool:
            list(pool.map(work, [by_id[n.creator_agent_id] for n in negotiations]))

        if self._agreed >= strategy.target_creator_count:
            outcome: CampaignOutcome = "TARGET_REACHED"
        elif self._agreed > 0:
            outcome = "PARTIAL"
        else:
            outcome = "NO_AGREEMENT"
        return self._result(outcome, report, negotiations, ledger)

    # -- helpers -----------------------------------------------------------------

    def _probe(self, base_url: str) -> dict[str, Any]:
        transport = self._transport_factory(base_url)
        card = getattr(transport, "agent_card", None)
        if card is None:
            return {"skills": [{"id": "promotion-negotiation"}]}
        return card()

    def _record_agreement(
        self,
        negotiation: CandidateNegotiation,
        result: BrandNegotiationResult,
        creator: CreatorProfile | None,
    ) -> dict[str, Any]:
        """Persist negotiations/{id}, agreements/{id} (+milestones) and link the candidate."""
        if result.agreement_id is None or result.terms_hash is None or result.terms is None:
            raise AgreementTermsMismatch("creator task completed without a knot.term-sheet.v1")
        agent_id = negotiation.creator_agent_id
        creator_id = self._creator_id_by_agent.get(agent_id, agent_id)
        negotiation_id = f"negotiation-{uuid4()}"
        now = _now()
        strategy = self._strategy
        negotiation_document = build_negotiation_document(
            negotiation_id=negotiation_id,
            match_run_id=self._match_run_id,
            match_candidate_id=creator_id,
            promotion=self._promotion,
            promotion_document=self._promotion_document,
            brand=self._brand,
            creator=creator,
            creator_agent_id=agent_id,
            context_id=result.context_id,
            task_id=result.task_id,
            status="AGREED",
            rounds=result.rounds,
            initial_amount_usdc=min(strategy.opening_amount_usdc, negotiation.reserved_usdc),
            current_terms=result.terms.model_dump(by_alias=True, mode="json"),
            # The private ceiling stays out of every persisted document.
            brand_policy_snapshot={
                "ruleVersion": "brand-campaign.v1",
                "campaignId": self._campaign_id,
                "concessionPct": strategy.concession_pct,
                "maxRounds": strategy.max_rounds,
            },
            created_at=now,
        )
        agreement = build_agreement_document(
            negotiation=negotiation_document,
            agreement_id=result.agreement_id,
            artifact_terms_hash=result.terms_hash,
            terms=result.terms,
            artifact_id=None,
            task_id=result.task_id,
            promotion_document=self._promotion_document,
            brand=self._brand,
            creator=creator,
            created_at=now,
        )
        self._repository.save_raw_document(
            FirestorePaths.negotiation(negotiation_id), negotiation_document
        )
        self._repository.save_raw_document(FirestorePaths.agreement(result.agreement_id), agreement)
        write_agreement_milestones(self._repository, agreement)
        negotiation.negotiation_id = negotiation_id
        negotiation.agreement_id = result.agreement_id
        negotiation.terms_hash = str(agreement["termsHash"])
        return agreement

    def _settle(self, negotiation: CandidateNegotiation, agreement: dict[str, Any]) -> None:
        agent_id = negotiation.creator_agent_id
        if self._settlement_hook is None:
            escrow: dict[str, Any] = {"status": "SKIPPED", "reason": "NO_SETTLEMENT_HOOK"}
        else:
            try:
                escrow = dict(self._settlement_hook(agreement))
            except Exception as exc:  # the hook crosses into payment code; never kill the campaign
                escrow = {"status": "FAILED", "reason": type(exc).__name__, "detail": str(exc)}
        negotiation.escrow = escrow
        status = str(escrow.get("status"))
        event = {"LOCKED": "escrow_locked", "SKIPPED": "escrow_skipped"}.get(
            status, "escrow_failed"
        )
        self._emit(event, agent_id, {"agreementId": agreement["agreementId"], **escrow})

    def _on_turn(self, agent_id: str, turn: NegotiationTurn) -> None:
        self._emit("turn", agent_id, turn.model_dump(by_alias=True, mode="json"))

    def _emit(
        self, event: str, creator_agent_id: str | None = None, data: dict[str, Any] | None = None
    ) -> None:
        self._on_event(CampaignEvent(event=event, creatorAgentId=creator_agent_id, data=data or {}))

    def _result(
        self,
        outcome: CampaignOutcome,
        report: DiscoveryReport,
        negotiations: list[CandidateNegotiation],
        ledger: BudgetLedger,
    ) -> CampaignResult:
        result = CampaignResult(
            campaignId=self._campaign_id,
            matchRunId=self._match_run_id,
            outcome=outcome,
            promotionId=self._promotion.promotion_id,
            targetCreatorCount=self._strategy.target_creator_count,
            agreedCount=self._agreed,
            totalBudgetUsdc=ledger.total_usdc,
            committedUsdc=ledger.committed_usdc,
            agreementIds=list(self._agreement_ids),
            discovery=report,
            negotiations=negotiations,
        )
        first_agreed = next((n for n in negotiations if n.agreement_id), None)
        self._emit(
            "campaign_result", data={"result": result.model_dump(by_alias=True, mode="json")}
        )
        self._repository.save_raw_document(
            FirestorePaths.match_run(self._match_run_id),
            {
                "matchRunId": self._match_run_id,
                "campaignId": self._campaign_id,
                "promotionId": self._promotion.promotion_id,
                # docs/07 vocabulary for the product; the campaign outcome sits beside it.
                "status": "AGREED" if self._agreed > 0 else "EXHAUSTED",
                "campaignOutcome": outcome,
                "agreedCount": self._agreed,
                "targetCreatorCount": self._strategy.target_creator_count,
                "agreementIds": list(self._agreement_ids),
                "selectedCreatorAgentId": first_agreed.creator_agent_id if first_agreed else None,
                "selectedCreatorId": (
                    self._creator_id_by_agent.get(first_agreed.creator_agent_id)
                    if first_agreed
                    else None
                ),
                "ledger": ledger.snapshot(),
                "updatedAt": _now(),
            },
        )
        return result

    def _persist_match_run(self, report: DiscoveryReport) -> None:
        self._repository.save_raw_document(
            FirestorePaths.match_run(self._match_run_id),
            {
                "matchRunId": self._match_run_id,
                "campaignId": self._campaign_id,
                "promotionId": self._promotion.promotion_id,
                "status": "NEGOTIATING",
                "queried": report.queried,
                "ranked": report.ranked,
                "probed": report.probed,
                "createdAt": _now(),
            },
        )
        for candidate in report.candidates:
            self._creator_id_by_agent[candidate.creator_agent_id] = candidate.creator_id
            self._repository.save_raw_document(
                FirestorePaths.match_candidate(self._match_run_id, candidate.creator_id),
                {**candidate.model_dump(by_alias=True, mode="json"), "updatedAt": _now()},
            )

    def _persist_candidate(self, negotiation: CandidateNegotiation) -> None:
        creator_id = self._creator_id_by_agent.get(
            negotiation.creator_agent_id, negotiation.creator_agent_id
        )
        document = negotiation.model_dump(by_alias=True, mode="json")
        if negotiation.result is not None:
            document["taskId"] = negotiation.result.task_id
            document["outcome"] = negotiation.result.outcome
        if negotiation.negotiation_id is not None:
            document["negotiationPath"] = FirestorePaths.negotiation(negotiation.negotiation_id)
            document["negotiationStatus"] = "AGREED"
        self._repository.save_raw_document(
            FirestorePaths.match_candidate(self._match_run_id, creator_id),
            {**document, "updatedAt": _now()},
        )


def http_transport_factory(
    *, timeout_seconds: float, service_token: str | None
) -> TransportFactory:
    def build(base_url: str) -> A2ATransport:
        return CreatorA2AClient(
            base_url, timeout_seconds=timeout_seconds, service_token=service_token
        )

    return build


def _now() -> str:
    return datetime.now(UTC).isoformat()
