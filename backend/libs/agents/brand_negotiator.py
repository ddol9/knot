"""Brand Agent autonomous negotiation loop (A2A client side).

The Creator Agent (apps/creator_agent) answers each message with COUNTER / ACCEPT /
REJECT / ESCALATE. This module is the *other* agent: it opens an OFFER, reads the
creator's reply, and either accepts, concedes toward the creator's number within a
private ceiling, or walks away. The transport is pluggable so the same loop runs
over real HTTP (CreatorA2AClient) and in-process (InMemoryA2ATaskStore) for tests.

Amount, action and policy result are decided deterministically here. An optional
display provider (Vertex Gemini) only phrases the visible chat bubble.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any, Literal, Protocol
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field

from libs.a2a.client import CreatorA2AClientError, first_part_data
from libs.a2a.models import (
    A2AMessage,
    A2APart,
    A2ARole,
    A2ATask,
    NegotiationMessageType,
    NegotiationPayload,
)
from libs.agents.brand import build_initial_terms
from libs.agents.negotiation import CreatorNegotiationContext
from libs.domain.models import AgreementTerms, CreatorProfile, Promotion
from libs.policies.brand import validate_brand_terms
from libs.policies.decision import PolicyDecision, Violation, allow, block

Outcome = Literal["AGREED", "REJECTED", "ESCALATED", "WALKED_AWAY", "ROUND_LIMIT", "CANCELED"]
TurnRole = Literal["brand", "creator"]


class A2ATransport(Protocol):
    def send_message(
        self,
        tenant: str,
        message: A2AMessage,
        *,
        metadata: dict[str, Any] | None = None,
    ) -> A2ATask: ...

    def cancel_task(self, task_id: str) -> A2ATask: ...


class BrandDisplayText(BaseModel):
    text: str
    provider: str = "deterministic"
    model: str | None = None


# (message type, terms, deterministic text) -> phrased text
DisplayProvider = Callable[[NegotiationMessageType, AgreementTerms, str], BrandDisplayText]


class BrandNegotiationStrategy(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    opening_amount_usdc: int = Field(alias="openingAmountUsdc", ge=0)
    # Private walk-away. Never revealed to the creator agent.
    ceiling_usdc: int = Field(alias="ceilingUsdc", ge=0)
    # Share of the gap (brand -> creator ask) closed on each counter.
    concession_pct: int = Field(default=50, alias="concessionPct", ge=1, le=100)
    # Defaults to promotion.autonomy.max_negotiation_rounds.
    max_rounds: int | None = Field(default=None, alias="maxRounds", ge=1)


class NegotiationTurn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    round: int
    role: TurnRole
    type: NegotiationMessageType
    amount_usdc: int = Field(alias="amountUsdc")
    message: str
    rationale: str
    message_provider: str = Field(default="deterministic", alias="messageProvider")
    message_model: str | None = Field(default=None, alias="messageModel")
    message_id: str = Field(alias="messageId")
    task_id: str | None = Field(default=None, alias="taskId")
    policy_decision: dict[str, Any] | None = Field(default=None, alias="policyDecision")


class BrandNegotiationResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    outcome: Outcome
    brand_agent_id: str = Field(alias="brandAgentId")
    creator_agent_id: str = Field(alias="creatorAgentId")
    context_id: str = Field(alias="contextId")
    task_id: str | None = Field(default=None, alias="taskId")
    task_state: str | None = Field(default=None, alias="taskState")
    rounds: int
    final_amount_usdc: int = Field(alias="finalAmountUsdc")
    agreement_id: str | None = Field(default=None, alias="agreementId")
    terms_hash: str | None = Field(default=None, alias="termsHash")
    terms: AgreementTerms | None = None
    turns: list[NegotiationTurn] = Field(default_factory=list)


class BrandNegotiator:
    def __init__(
        self,
        transport: A2ATransport,
        *,
        promotion: Promotion,
        creator_agent_id: str,
        strategy: BrandNegotiationStrategy,
        creator: CreatorProfile | None = None,
        creator_context: CreatorNegotiationContext | None = None,
        display_provider: DisplayProvider | None = None,
        context_id: str | None = None,
        on_turn: Callable[[NegotiationTurn], None] | None = None,
        should_stop: Callable[[], bool] | None = None,
        committed_usdc_provider: Callable[[], int] | None = None,
    ) -> None:
        self._transport = transport
        self._promotion = promotion
        self.promotion = promotion
        self._creator_agent_id = creator_agent_id
        self._strategy = strategy
        self._creator = creator
        self._creator_context = creator_context
        self._display_provider = display_provider
        self._context_id = context_id or f"ctx-{uuid4()}"
        self._on_turn = on_turn
        self._should_stop = should_stop
        self._committed_usdc_provider = committed_usdc_provider
        self._max_rounds = strategy.max_rounds or promotion.autonomy.max_negotiation_rounds

    def run(self) -> BrandNegotiationResult:
        promotion = self._promotion
        strategy = self._strategy
        turns: list[NegotiationTurn] = []
        task_id: str | None = None
        task: A2ATask | None = None

        brand_amount = min(strategy.opening_amount_usdc, strategy.ceiling_usdc)
        terms = build_initial_terms(promotion, self._creator, base_amount_usdc=brand_amount)
        round_ = 1
        outgoing = self._brand_message(
            round_=round_,
            message_type=NegotiationMessageType.OFFER,
            terms=terms,
            changed_fields=[],
            rationale="Initial promotion offer within brand budget.",
            fallback_text=(
                f"{_summary(terms)} 기준으로 {brand_amount} USDC를 제안합니다. "
                "일정과 사용 범위는 공개 조건에 맞춰 정리해두었습니다."
            ),
            task_id=None,
        )
        turns.append(self._record(outgoing, "brand", round_, terms, None))
        if self._on_turn:
            self._on_turn(turns[-1])

        outcome: Outcome
        while True:
            if self._should_stop and self._should_stop():
                outcome = "CANCELED"
                task = self._cancel(task_id) or task
                break
            task = self._send(outgoing.message)
            task_id = task.id
            creator_turn, creator_terms, creator_type = self._read_creator_reply(task, round_)
            turns.append(creator_turn)
            if self._on_turn:
                self._on_turn(creator_turn)

            if creator_type == NegotiationMessageType.ACCEPT:
                outcome = "AGREED"
                break
            if creator_type == NegotiationMessageType.REJECT:
                outcome = "REJECTED"
                break
            if creator_type == NegotiationMessageType.ESCALATE:
                outcome = "ESCALATED"
                break

            # COUNTER: decide our next move.
            next_round = round_ + 1
            if next_round > self._max_rounds:
                outcome = "ROUND_LIMIT"
                task = self._cancel(task_id) or task
                break

            creator_amount = creator_terms.compensation.base_amount_usdc
            brand_decision = self._brand_policy(creator_terms, next_round)
            if creator_amount <= strategy.ceiling_usdc and brand_decision.allowed:
                round_ = next_round
                outgoing = self._brand_message(
                    round_=round_,
                    message_type=NegotiationMessageType.ACCEPT,
                    terms=creator_terms,
                    changed_fields=[],
                    rationale="Brand policy accepted the creator counteroffer.",
                    fallback_text=(
                        f"제안해주신 {creator_amount} USDC 조건이 브랜드 권한 범위 안이라 "
                        "사람 승인 없이 이 조건으로 확정하겠습니다."
                    ),
                    task_id=task_id,
                )
                turns.append(self._record(outgoing, "brand", round_, creator_terms, brand_decision))
                if self._on_turn:
                    self._on_turn(turns[-1])
                continue

            gap = creator_amount - brand_amount
            step = math.ceil(gap * strategy.concession_pct / 100) if gap > 0 else 0
            new_amount = min(brand_amount + step, strategy.ceiling_usdc)
            if new_amount <= brand_amount:
                outcome = "WALKED_AWAY"
                task = self._cancel(task_id) or task
                break

            brand_amount = new_amount
            round_ = next_round
            terms = creator_terms.model_copy(deep=True)
            terms.compensation.base_amount_usdc = brand_amount
            counter_decision = self._brand_policy(terms, round_)
            outgoing = self._brand_message(
                round_=round_,
                message_type=NegotiationMessageType.COUNTER,
                terms=terms,
                changed_fields=["compensation.baseAmountUsdc"],
                rationale="Brand concedes part of the gap within its private ceiling.",
                fallback_text=(
                    f"예산 안에서 {brand_amount} USDC까지 조정해 다시 제안합니다. "
                    "산출물과 게시 일정은 기존 조건을 유지합니다."
                ),
                task_id=task_id,
            )
            turns.append(self._record(outgoing, "brand", round_, terms, counter_decision))
            if self._on_turn:
                self._on_turn(turns[-1])

        agreement_id, terms_hash, final_terms = _agreement_from_task(task)
        last_creator = next((t for t in reversed(turns) if t.role == "creator"), turns[-1])
        return BrandNegotiationResult(
            outcome=outcome,
            brandAgentId=promotion.brand_agent_id,
            creatorAgentId=self._creator_agent_id,
            contextId=self._context_id,
            taskId=task_id,
            taskState=task.status.state.value if task else None,
            rounds=round_,
            finalAmountUsdc=last_creator.amount_usdc,
            agreementId=agreement_id,
            termsHash=terms_hash,
            terms=final_terms,
            turns=turns,
        )

    # -- helpers -----------------------------------------------------------------

    def _send(self, message: A2AMessage) -> A2ATask:
        metadata: dict[str, Any] = {}
        if self._creator_context is not None:
            metadata["creatorNegotiationContext"] = self._creator_context.model_dump(
                by_alias=True, mode="json"
            )
        return self._transport.send_message(self._creator_agent_id, message, metadata=metadata)

    def _cancel(self, task_id: str | None) -> A2ATask | None:
        if task_id is None:
            return None
        try:
            return self._transport.cancel_task(task_id)
        except CreatorA2AClientError:
            return None

    def _brand_policy(self, terms: AgreementTerms, round_: int) -> PolicyDecision:
        committed = self._committed_usdc_provider() if self._committed_usdc_provider else 0
        if self._creator is not None:
            return validate_brand_terms(
                self._promotion,
                self._creator,
                terms,
                current_round=round_,
                cumulative_committed_usdc=committed,
            )
        # No creator profile (demo / direct mode): budget and round checks only.
        violations: list[Violation] = []
        amount = terms.compensation.base_amount_usdc
        if amount > self._promotion.budget.max_per_creator_usdc:
            violations.append(
                Violation(
                    code="POLICY_MAX_PER_CREATOR_EXCEEDED",
                    field="terms.compensation.baseAmountUsdc",
                    rule="maxPerCreatorUsdc",
                )
            )
        if committed + amount > self._promotion.budget.total_usdc:
            violations.append(
                Violation(
                    code="POLICY_CUMULATIVE_BUDGET_EXCEEDED",
                    field="terms.compensation.baseAmountUsdc",
                    rule="cumulativeCommittedBudget",
                )
            )
        if amount > self._promotion.budget.total_usdc:
            violations.append(
                Violation(
                    code="POLICY_TOTAL_BUDGET_EXCEEDED",
                    field="terms.compensation.baseAmountUsdc",
                    rule="budget.totalUsdc",
                )
            )
        if round_ > self._max_rounds:
            violations.append(
                Violation(
                    code="POLICY_NEGOTIATION_ROUND_EXCEEDED",
                    field="negotiation.currentRound",
                    rule="maxNegotiationRounds",
                )
            )
        return block("brand-policy-v1", violations) if violations else allow("brand-policy-v1")

    def _brand_message(
        self,
        *,
        round_: int,
        message_type: NegotiationMessageType,
        terms: AgreementTerms,
        changed_fields: list[str],
        rationale: str,
        fallback_text: str,
        task_id: str | None,
    ) -> _Outgoing:
        display = (
            self._display_provider(message_type, terms, fallback_text)
            if self._display_provider
            else BrandDisplayText(text=fallback_text)
        )
        amount = terms.compensation.base_amount_usdc
        payload = NegotiationPayload(
            type=message_type,
            round=round_,
            promotion=self._promotion,
            terms=terms,
            changedFields=changed_fields,
            rationale=rationale,
            display={
                "agentLabel": self._promotion.brand_agent_id,
                "headline": f"{amount} USDC",
                "message": display.text,
                "messageProvider": display.provider,
                "messageModel": display.model,
            },
        )
        message = A2AMessage(
            messageId=f"message-{uuid4()}",
            contextId=self._context_id,
            taskId=task_id,
            role=A2ARole.USER,
            parts=[
                A2APart(
                    mediaType="application/json",
                    data=payload.model_dump(by_alias=True, mode="json"),
                )
            ],
        )
        return _Outgoing(message=message, payload=payload, display=display)

    def _record(
        self,
        outgoing: _Outgoing,
        role: TurnRole,
        round_: int,
        terms: AgreementTerms,
        decision: PolicyDecision | None,
    ) -> NegotiationTurn:
        return NegotiationTurn(
            round=round_,
            role=role,
            type=outgoing.payload.type,
            amountUsdc=terms.compensation.base_amount_usdc,
            message=outgoing.display.text,
            rationale=outgoing.payload.rationale,
            messageProvider=outgoing.display.provider,
            messageModel=outgoing.display.model,
            messageId=outgoing.message.message_id,
            taskId=outgoing.message.task_id,
            policyDecision=decision.model_dump(by_alias=True, mode="json") if decision else None,
        )

    def _read_creator_reply(
        self, task: A2ATask, round_: int
    ) -> tuple[NegotiationTurn, AgreementTerms, NegotiationMessageType]:
        reply = task.status.message
        document = first_part_data(reply)
        creator_type = NegotiationMessageType(str(document.get("type")))
        raw_terms = document.get("terms")
        if isinstance(raw_terms, dict):
            creator_terms = AgreementTerms.model_validate(raw_terms)
        else:
            raise CreatorA2AClientError("Creator A2A reply is missing terms")
        display = document.get("display") if isinstance(document.get("display"), dict) else {}
        message_text = display.get("message") if isinstance(display, dict) else None
        rationale = str(document.get("rationale") or "")
        policy = document.get("policyDecision")
        turn = NegotiationTurn(
            round=round_,
            role="creator",
            type=creator_type,
            amountUsdc=creator_terms.compensation.base_amount_usdc,
            message=str(message_text or rationale),
            rationale=rationale,
            messageProvider=str(document.get("rationaleProvider") or "deterministic"),
            messageModel=(
                str(document["rationaleModel"]) if document.get("rationaleModel") else None
            ),
            messageId=reply.message_id if reply else f"message-{uuid4()}",
            taskId=task.id,
            policyDecision=policy if isinstance(policy, dict) else None,
        )
        return turn, creator_terms, creator_type


class _Outgoing(BaseModel):
    message: A2AMessage
    payload: NegotiationPayload
    display: BrandDisplayText


def _summary(terms: AgreementTerms) -> str:
    first = terms.deliverables[0]
    return f"{first.format} {first.count}건"


def _agreement_from_task(
    task: A2ATask | None,
) -> tuple[str | None, str | None, AgreementTerms | None]:
    if task is None:
        return None, None, None
    for artifact in task.artifacts:
        for part in artifact.parts:
            data = part.data or {}
            if data.get("schema") != "knot.term-sheet.v1":
                continue
            terms_raw = data.get("terms")
            terms = (
                AgreementTerms.model_validate(terms_raw) if isinstance(terms_raw, dict) else None
            )
            agreement_id = data.get("agreementId")
            terms_hash = data.get("termsHash")
            return (
                str(agreement_id) if agreement_id else None,
                str(terms_hash) if terms_hash else None,
                terms,
            )
    return None, None, None


class InProcessTransport:
    """Adapter so the negotiator can talk to an InMemoryA2ATaskStore without HTTP."""

    def __init__(self, store: Any) -> None:
        self._store = store

    def send_message(
        self,
        tenant: str,
        message: A2AMessage,
        *,
        metadata: dict[str, Any] | None = None,
    ) -> A2ATask:
        context = (metadata or {}).get("creatorNegotiationContext")
        if isinstance(context, dict):
            self._store.register_context(tenant, CreatorNegotiationContext.model_validate(context))
        return self._store.send_message(tenant, message)

    def cancel_task(self, task_id: str) -> A2ATask:
        return self._store.cancel_task(task_id)
