#!/usr/bin/env bash
# knot — 에이전트 월드 로컬 데모: 크리에이터 에이전트 2 프로세스(테넌트 분할) + 브랜드 에이전트.
#
#   scripts/local/a2a_multi_agent.sh          # 기동 (Ctrl+C 로 종료)
#   그 다음:  cd backend && python scripts/a2a_campaign.py --category beauty --total 1300 --target 2
#   브라우저: http://127.0.0.1:8083/brand/v1/campaign
#
# 포트: 크리에이터 A :8091, 크리에이터 B :8092, 브랜드 :8083  (8081은 로컬 Docker 와 충돌할 수 있어 피함)
# 환경: 루트 .env.local (KNOT_MEMORY_SEED_DEMO=1 이면 fixtures 12명이 전부 테넌트)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"
LOGS="${KNOT_LOG_DIR:-/tmp/knot-local}"; mkdir -p "$LOGS"
PY="$ROOT/.venv/bin"
ENV_FILE="${KNOT_ENV_FILE:-.env.local}"
[[ -f "$ROOT/$ENV_FILE" ]] && { set -a; . "$ROOT/$ENV_FILE"; set +a; }
export KNOT_CREATOR_A2A_MODE=http

A_URL=http://127.0.0.1:8091/a2a/v1
B_URL=http://127.0.0.1:8092/a2a/v1
A_TENANTS="agent-creator-1,creator-agent-001,creator-agent-002,creator-agent-004,creator-agent-006,creator-agent-007,creator-agent-008,creator-agent-009,creator-agent-010,agent-creator-2"
B_TENANTS="creator-agent-003,creator-agent-005"

pids=()
cleanup() { for p in "${pids[@]:-}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM
start() { local name="$1"; shift; echo "▸ $name"; ( "$@" >"$LOGS/$name.log" 2>&1 ) & pids+=("$!"); }
wait_http() { for _ in $(seq 1 60); do curl -fsS -m 1 "$1" >/dev/null 2>&1 && return 0; sleep 1; done; return 1; }

start creator-a env KNOT_SERVICE_NAME=knot-creator-agent CREATOR_AGENT_BASE_URL=$A_URL KNOT_CREATOR_AGENT_TENANTS="$A_TENANTS" \
  "$PY/uvicorn" apps.creator_agent.main:app --app-dir "$ROOT/backend" --host 127.0.0.1 --port 8091
start creator-b env KNOT_SERVICE_NAME=knot-creator-agent CREATOR_AGENT_BASE_URL=$B_URL KNOT_CREATOR_AGENT_TENANTS="$B_TENANTS" \
  "$PY/uvicorn" apps.creator_agent.main:app --app-dir "$ROOT/backend" --host 127.0.0.1 --port 8092
start brand-agent env KNOT_SERVICE_NAME=knot-brand-agent CREATOR_AGENT_BASE_URL=$A_URL \
  KNOT_CREATOR_AGENT_ENDPOINTS="creator-agent-003=$B_URL,creator-agent-005=$B_URL" \
  "$PY/uvicorn" apps.brand_agent.main:app --app-dir "$ROOT/backend" --host 127.0.0.1 --port 8083

for probe in "creator-a|http://127.0.0.1:8091/healthz" "creator-b|http://127.0.0.1:8092/healthz" "brand-agent|http://127.0.0.1:8083/healthz"; do
  name="${probe%%|*}"; url="${probe#*|}"
  if wait_http "$url"; then echo "  ✅ $name  $url"; else echo "  ❌ $name  $url  → $LOGS/$name.log"; fi
done
echo
echo "관전:  http://127.0.0.1:8083/brand/v1/campaign"
echo "CLI :  cd backend && python scripts/a2a_campaign.py --category beauty --total 1300 --target 2"
echo "로그:  $LOGS/{creator-a,creator-b,brand-agent}.log   (Ctrl+C 로 전부 종료)"
wait
