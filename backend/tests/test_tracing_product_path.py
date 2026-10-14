"""The product API's single-negotiation path leaves the same trace tree as a campaign.

`POST /promotions/{id}/matches:run` → `match.run` (+ `match.verify` when pay.sh is on);
`POST /match-runs/{id}:start-negotiation` → `negotiation.run` → `a2a.agent_card`,
`a2a.send` → `creator.decide`, with one `turn` event per persisted message. Both share the
request's `X-Trace-Id`, and the persisted `matchRuns/{id}` / `negotiations/{id}` carry it.
"""

from __future__ import annotations

import json
import logging

import pytest

from libs.repositories.firestore_paths import FirestorePaths
from tests.test_api_promotions import client_and_repository_with_seed, set_creator_min_base


@pytest.fixture
def trace_log(caplog: pytest.LogCaptureFixture) -> pytest.LogCaptureFixture:
    caplog.set_level(logging.INFO, logger="knot.trace")
    return caplog


def _spans(caplog: pytest.LogCaptureFixture) -> dict[str, list[dict]]:
    by_name: dict[str, list[dict]] = {}
    for record in caplog.records:
        if record.name != "knot.trace":
            continue
        span = json.loads(record.getMessage())
        by_name.setdefault(span["name"], []).append(span)
    return by_name


def _assert_no_private_state(caplog: pytest.LogCaptureFixture) -> None:
    joined = "\n".join(r.getMessage() for r in caplog.records if r.name == "knot.trace").lower()
    assert "ceiling" not in joined
    assert '"policy' not in joined
    assert '"minbaseusdc"' not in joined


def test_match_run_and_single_negotiation_share_the_campaign_trace_shape(trace_log) -> None:
    client, repository = client_and_repository_with_seed()

    run_response = client.post("/api/v1/promotions/promotion-001/matches:run")
    assert run_response.status_code == 201, run_response.text
    match_run = run_response.json()["data"]["matchRun"]
    match_trace_id = run_response.headers["X-Trace-Id"]
    assert run_response.json()["meta"]["traceId"] == match_trace_id
    assert match_run["traceId"] == match_trace_id
    stored_run = repository.get_raw_document(FirestorePaths.match_run(match_run["matchRunId"]))
    assert stored_run and stored_run["traceId"] == match_trace_id

    start_response = client.post(f"/api/v1/match-runs/{match_run['matchRunId']}:start-negotiation")
    assert start_response.status_code == 201, start_response.text
    body = start_response.json()
    negotiation_trace_id = start_response.headers["X-Trace-Id"]
    assert negotiation_trace_id != match_trace_id
    assert body["meta"]["traceId"] == negotiation_trace_id
    negotiation = body["data"]["negotiation"]
    agreement = body["data"]["agreement"]
    assert negotiation["traceId"] == negotiation_trace_id
    stored = repository.get_raw_document(FirestorePaths.negotiation(negotiation["negotiationId"]))
    assert stored and stored["traceId"] == negotiation_trace_id

    by_name = _spans(trace_log)

    # match.run is the root of the first request's trace.
    (match,) = by_name["match.run"]
    assert match["traceId"] == match_trace_id
    assert match["parentSpanId"] is None
    assert match["status"] == "ok"
    assert match["attrs"]["matchRunId"] == match_run["matchRunId"]
    assert match["attrs"]["promotionId"] == "promotion-001"
    assert match["attrs"]["selected"] == 1
    assert match["attrs"]["selectedCreatorAgentId"] == "agent-creator-1"
    assert match["attrs"]["ranked"] >= 1
    assert match["attrs"]["verificationStatus"] == match_run["paidVerification"]["status"]
    # Default settings run pay.sh in sandbox mode with no resource configured: the
    # verification step still runs (and is skipped inside), so it shows up as a child.
    (verify,) = by_name["match.verify"]
    assert verify["parentSpanId"] == match["spanId"]
    assert verify["traceId"] == match_trace_id
    assert verify["attrs"]["provider"] == "pay.sh"
    assert verify["attrs"]["status"] == match_run["paidVerification"]["status"]
    assert "receipt" not in json.dumps(verify["attrs"]).lower()

    # negotiation.run is the root of the second request's trace, same attrs as a campaign's.
    (run,) = by_name["negotiation.run"]
    assert run["traceId"] == negotiation_trace_id
    assert run["parentSpanId"] is None
    assert run["status"] == "ok"
    attrs = run["attrs"]
    assert attrs["brandAgentId"] == negotiation["brandAgentId"]
    assert attrs["creatorAgentId"] == "agent-creator-1"
    assert attrs["promotionId"] == "promotion-001"
    assert attrs["contextId"] == negotiation["contextId"]
    assert attrs["negotiationId"] == negotiation["negotiationId"]
    assert attrs["maxRounds"] == negotiation["maxRounds"]
    assert attrs["outcome"] == "AGREED"
    assert attrs["rounds"] == negotiation["currentRound"] == 1
    assert attrs["finalAmountUsdc"] == negotiation["currentAmountUsdc"]
    assert attrs["agreementId"] == agreement["agreementId"]
    assert attrs["taskId"] == negotiation["taskId"]
    assert attrs["taskState"] == "TASK_STATE_COMPLETED"
    assert attrs["turns"] == 2
    turns = [e for e in run["events"] if e["name"] == "turn"]
    assert [(t["round"], t["role"], t["type"]) for t in turns] == [
        (1, "brand", "OFFER"),
        (1, "creator", "ACCEPT"),
    ]
    assert turns[0]["amountUsdc"] == negotiation["initialAmountUsdc"]
    assert turns[0]["messageProvider"] == "deterministic"
    assert turns[1]["allowed"] is True

    # Agent-card discovery and every A2A send hang under the negotiation; the creator's
    # in-process decision hangs under its send.
    (card,) = by_name["a2a.agent_card"]
    assert card["parentSpanId"] == run["spanId"]
    assert card["attrs"]["mode"] == "local"
    assert card["attrs"]["discovered"] is False
    sends = by_name["a2a.send"]
    assert [s["attrs"]["type"] for s in sends] == ["OFFER"]
    assert {s["parentSpanId"] for s in sends} == {run["spanId"]}
    assert {s["traceId"] for s in sends} == {negotiation_trace_id}
    assert sends[0]["attrs"]["replyType"] == "ACCEPT"
    assert sends[0]["attrs"]["taskId"] == negotiation["taskId"]
    assert sends[0]["attrs"]["taskState"] == "TASK_STATE_COMPLETED"
    decides = by_name["creator.decide"]
    assert len(decides) == 1
    assert decides[0]["parentSpanId"] == sends[0]["spanId"]
    assert decides[0]["traceId"] == negotiation_trace_id
    assert decides[0]["attrs"]["decisionType"] == "ACCEPT"

    # Nothing else leaked into either trace, and no private negotiation state anywhere.
    all_spans = [s for spans in by_name.values() for s in spans]
    assert {s["traceId"] for s in all_spans} == {match_trace_id, negotiation_trace_id}
    assert {s["name"] for s in all_spans if s["traceId"] == negotiation_trace_id} <= {
        "negotiation.run",
        "a2a.agent_card",
        "a2a.send",
        "creator.decide",
        "llm.call",
    }
    _assert_no_private_state(trace_log)


def test_single_negotiation_counter_flow_records_one_turn_per_message(trace_log) -> None:
    client, repository = client_and_repository_with_seed()
    set_creator_min_base(repository, "agent-creator-1", 650)
    promotion_path = FirestorePaths.promotion("promotion-001")
    promotion = repository.get_raw_document(promotion_path)
    assert promotion is not None
    repository.save_raw_document(promotion_path, {**promotion, "initialOffer": 300})
    match_run = client.post("/api/v1/promotions/promotion-001/matches:run").json()["data"][
        "matchRun"
    ]

    start_response = client.post(f"/api/v1/match-runs/{match_run['matchRunId']}:start-negotiation")

    assert start_response.status_code == 201, start_response.text
    negotiation = start_response.json()["data"]["negotiation"]
    assert negotiation["currentRound"] == 3
    by_name = _spans(trace_log)
    (run,) = by_name["negotiation.run"]
    assert run["attrs"]["outcome"] == "AGREED"
    assert run["attrs"]["rounds"] == 3
    assert run["attrs"]["finalAmountUsdc"] == 650
    assert run["attrs"]["turns"] == 6
    # OFFER → creator COUNTER → brand bridge COUNTER → creator COUNTER → ACCEPT → ACCEPT
    turns = [e for e in run["events"] if e["name"] == "turn"]
    assert [(t["role"], t["type"], t["amountUsdc"]) for t in turns] == [
        ("brand", "OFFER", 300),
        ("creator", "COUNTER", 650),
        ("brand", "COUNTER", 475),
        ("creator", "COUNTER", 650),
        ("brand", "ACCEPT", 650),
        ("creator", "ACCEPT", 650),
    ]
    assert [t["round"] for t in turns] == [1, 1, 2, 2, 3, 3]
    # Event offsets grow with the negotiation: events are recorded as messages happen.
    offsets = [t["offsetMs"] for t in turns]
    assert offsets == sorted(offsets)
    sends = by_name["a2a.send"]
    assert [(s["attrs"]["type"], s["attrs"]["round"], s["attrs"]["replyType"]) for s in sends] == [
        ("OFFER", 1, "COUNTER"),
        ("COUNTER", 2, "COUNTER"),
        ("ACCEPT", 3, "ACCEPT"),
    ]
    assert {s["parentSpanId"] for s in sends} == {run["spanId"]}
    # Every send after the first continues the same A2A task.
    assert {s["attrs"]["taskId"] for s in sends} == {negotiation["taskId"]}
    decides = by_name["creator.decide"]
    assert [d["parentSpanId"] for d in decides] == [s["spanId"] for s in sends]
    assert [d["attrs"]["decisionType"] for d in decides] == ["COUNTER", "COUNTER", "ACCEPT"]
    assert decides[0]["attrs"]["violationCodes"] == ["CREATOR_MIN_BASE_NOT_MET"]
    _assert_no_private_state(trace_log)


def test_failed_single_negotiation_leaves_an_error_span(trace_log, monkeypatch) -> None:
    from apps.api import routes as api_routes

    client, _ = client_and_repository_with_seed()
    match_run = client.post("/api/v1/promotions/promotion-001/matches:run").json()["data"][
        "matchRun"
    ]

    def broken(**_: object) -> None:
        raise api_routes.CreatorA2AClientError("creator agent is down")

    monkeypatch.setattr(api_routes, "_send_creator_a2a_task_untraced", broken)
    response = client.post(f"/api/v1/match-runs/{match_run['matchRunId']}:start-negotiation")

    assert response.status_code == 502
    by_name = _spans(trace_log)
    (run,) = by_name["negotiation.run"]
    assert run["traceId"] == response.headers["X-Trace-Id"]
    assert run["status"] == "error"
    assert "A2A_CREATOR_AGENT_UNAVAILABLE" in run["error"] or "502" in run["error"]
    (send,) = by_name["a2a.send"]
    assert send["parentSpanId"] == run["spanId"]
    assert send["status"] == "error"
    assert "creator agent is down" in send["error"]
    # Only the brand offer was recorded before the failure.
    assert [e["type"] for e in run["events"] if e["name"] == "turn"] == ["OFFER"]
    _assert_no_private_state(trace_log)
