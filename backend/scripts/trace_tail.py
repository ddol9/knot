#!/usr/bin/env python3
"""`knot.trace` JSON 로그를 traceId별 스팬 트리로 보여준다.

    python scripts/trace_tail.py /tmp/knot-local/brand-agent.log            # 파일 전체
    python scripts/trace_tail.py brand-agent.log creator-a.log creator-b.log  # 여러 프로세스 병합
    python scripts/trace_tail.py -f /tmp/knot-local/brand-agent.log         # tail -f 처럼 따라가기
    cat brand-agent.log | python scripts/trace_tail.py                       # stdin

브랜드/크리에이터 로그를 함께 주면 A2A 헤더(X-Trace-Id / X-Parent-Span-Id)로 이어진
creator.decide 스팬이 브랜드의 a2a.send 아래에 붙는다.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections import defaultdict
from collections.abc import Iterable, Iterator
from typing import Any

DIM = "\033[90m"
BOLD = "\033[1m"
RED = "\033[91m"
GREEN = "\033[92m"
RESET = "\033[0m"

# Attributes worth showing inline, per span name (everything else stays in the log line).
SUMMARY_KEYS: dict[str, tuple[str, ...]] = {
    "campaign.run": ("campaignId", "outcome", "agreedCount", "committedUsdc", "budgetUsdc"),
    "campaign.discovery": ("queried", "ranked", "probed", "selected"),
    "negotiation.run": ("creatorAgentId", "outcome", "rounds", "finalAmountUsdc", "agreementId"),
    "a2a.send": ("type", "round", "replyType", "taskState"),
    "a2a.cancel": ("taskState",),
    "creator.decide": ("tenant", "messageType", "decisionType", "violationCodes", "taskState"),
    "llm.call": ("purpose", "provider", "model", "fallbackReason"),
}


def parse_line(line: str) -> dict[str, Any] | None:
    start = line.find("{")
    if start < 0 or '"traceId"' not in line:
        return None
    try:
        record = json.loads(line[start:])
    except json.JSONDecodeError:
        return None
    if not isinstance(record, dict) or "spanId" not in record or "name" not in record:
        return None
    return record


def read_records(lines: Iterable[str]) -> Iterator[dict[str, Any]]:
    for line in lines:
        record = parse_line(line)
        if record is not None:
            yield record


def format_tree(spans: list[dict[str, Any]], *, color: bool) -> str:
    by_id = {s["spanId"]: s for s in spans}
    children: dict[str | None, list[dict[str, Any]]] = defaultdict(list)
    for s in spans:
        parent = s.get("parentSpanId")
        children[parent if parent in by_id else None].append(s)
    for siblings in children.values():
        siblings.sort(key=lambda s: str(s.get("startedAt") or ""))

    out: list[str] = []
    trace_id = spans[0]["traceId"]
    total = max((float(s.get("durationMs") or 0) for s in children[None]), default=0.0)
    services = sorted({str(s["service"]) for s in spans if s.get("service")})
    header = f"trace {trace_id}  {len(spans)} spans  {total:.0f} ms"
    if services:
        header += f"  [{', '.join(services)}]"
    out.append(_c(BOLD, header, color))

    def walk(node: dict[str, Any], depth: int) -> None:
        out.append(_format_span(node, depth, color))
        for event in node.get("events") or []:
            out.append(_format_event(event, depth + 1, color))
        for child in children.get(node["spanId"], []):
            walk(child, depth + 1)

    for root in children[None]:
        walk(root, 0)
    return "\n".join(out)


def _format_span(s: dict[str, Any], depth: int, color: bool) -> str:
    attrs = s.get("attrs") or {}
    keys = SUMMARY_KEYS.get(str(s["name"]), tuple(attrs)[:5])
    summary = " ".join(f"{k}={_short(attrs[k])}" for k in keys if attrs.get(k) is not None)
    status = s.get("status", "ok")
    mark = _c(GREEN, "ok", color) if status == "ok" else _c(RED, f"ERROR {s.get('error')}", color)
    duration = f"{float(s.get('durationMs') or 0):.1f} ms"
    service = f" @{s['service']}" if s.get("service") else ""
    redacted = (
        f" {_c(DIM, 'redacted=' + ','.join(s['redacted']), color)}" if s.get("redacted") else ""
    )
    return (
        f"{'  ' * depth}{_c(BOLD, s['name'], color)} {duration} {mark}"
        f"{_c(DIM, service, color)}  {summary}{redacted}"
    )


def _format_event(event: dict[str, Any], depth: int, color: bool) -> str:
    body = {k: v for k, v in event.items() if k not in {"name", "offsetMs"}}
    summary = " ".join(f"{k}={_short(v)}" for k, v in body.items() if v is not None)
    return _c(
        DIM, f"{'  ' * depth}· {event.get('name')} +{event.get('offsetMs', 0)} ms  {summary}", color
    )


def _short(value: Any) -> str:
    text = json.dumps(value, ensure_ascii=False) if isinstance(value, list | dict) else str(value)
    return text if len(text) <= 48 else text[:45] + "..."


def _c(code: str, text: str, color: bool) -> str:
    return f"{code}{text}{RESET}" if color else text


def _follow(path: str) -> Iterator[str]:
    with open(path, encoding="utf-8", errors="replace") as handle:
        while True:
            line = handle.readline()
            if line:
                yield line.rstrip("\n")
            else:
                time.sleep(0.3)


def _lines(paths: list[str], follow: bool) -> Iterator[str]:
    if not paths:
        yield from (line.rstrip("\n") for line in sys.stdin)
        return
    if follow:
        yield from _follow(paths[0])
        return
    for path in paths:
        with open(path, encoding="utf-8", errors="replace") as handle:
            yield from (line.rstrip("\n") for line in handle)


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("paths", nargs="*", help="로그 파일(들); 없으면 stdin")
    parser.add_argument("-f", "--follow", action="store_true", help="첫 파일을 계속 따라간다")
    parser.add_argument("--trace", help="이 traceId만 출력")
    parser.add_argument("--no-color", action="store_true")
    args = parser.parse_args()
    color = not args.no_color and sys.stdout.isatty()

    traces: dict[str, list[dict[str, Any]]] = defaultdict(list)
    order: list[str] = []
    try:
        for record in read_records(_lines(args.paths, args.follow)):
            trace_id = str(record["traceId"])
            if args.trace and trace_id != args.trace:
                continue
            if trace_id not in traces:
                order.append(trace_id)
            traces[trace_id].append(record)
            # Follow mode: a root span closing means the trace is complete; print and drop it.
            if args.follow and record.get("parentSpanId") is None:
                print(format_tree(traces.pop(trace_id), color=color), end="\n\n", flush=True)
                order.remove(trace_id)
    except KeyboardInterrupt:
        pass
    for trace_id in order:
        if trace_id in traces:
            print(format_tree(traces[trace_id], color=color), end="\n\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
