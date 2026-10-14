#!/usr/bin/env bash
# knot — 에이전트 월드 로컬 데모, Firestore 공유 저장소 버전.
#
# a2a_multi_agent.sh 와 같은 구성(크리에이터 A/B + 브랜드)이지만 세 프로세스가 **하나의 Firestore
# 에뮬레이터**를 본다. 그래서 크리에이터 heartbeat → 브랜드 탐색(🟢) → 캠페인 이력(n/m)이 프로세스를
# 넘어 흐른다. 메모리 모드(a2a_multi_agent.sh)는 그대로 둔다.
#
#   scripts/local/a2a_multi_agent_firestore.sh        # 기동 (Ctrl+C 로 전부 종료)
#   그 다음:  cd backend && python scripts/a2a_campaign.py --category beauty --total 1300 --target 2
#   브라우저: http://127.0.0.1:8083/brand/v1/campaign   Firestore UI: http://127.0.0.1:4000/firestore
#
# 포트: Firestore 에뮬레이터 :8780 (firebase.json), 크리에이터 A :8091, 크리에이터 B :8092, 브랜드 :8083
#       KNOT_CREATOR_A_PORT / KNOT_CREATOR_B_PORT / KNOT_BRAND_PORT 로 바꿀 수 있다.
# 필요: Java 11+ (Firestore 에뮬레이터), node/npx (firebase-tools), google-cloud-firestore (venv).
# 로그: /tmp/knot-local/{firestore-emulator,creator-a,creator-b,brand-agent}.log
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"
HERE="$ROOT/scripts/local"
LOGS="${KNOT_LOG_DIR:-/tmp/knot-local}"; mkdir -p "$LOGS"
PY="${KNOT_VENV_BIN:-$ROOT/.venv/bin}"
[[ -x "$PY/uvicorn" ]] || PY="$ROOT/backend/.venv/bin"
[[ -x "$PY/uvicorn" ]] || { echo "❌ .venv 없음 (KNOT_VENV_BIN 으로 지정 가능)"; exit 1; }
ENV_FILE="${KNOT_ENV_FILE:-.env.local}"
[[ -f "$ROOT/$ENV_FILE" ]] && { set -a; . "$ROOT/$ENV_FILE"; set +a; }

if ! command -v java >/dev/null 2>&1; then
  echo "❌ java 가 없습니다. Firestore 에뮬레이터는 Java 11+ 가 필요합니다 (brew install openjdk@21)."; exit 1
fi
command -v npx >/dev/null 2>&1 || { echo "❌ npx 가 없습니다 (node 설치 필요)."; exit 1; }
"$PY/python" -c "import google.cloud.firestore" 2>/dev/null \
  || { echo "❌ google-cloud-firestore 가 venv 에 없습니다 → $PY/python -m pip install -e backend"; exit 1; }

# --- 공유 Firestore (에뮬레이터) -------------------------------------------------------
FS_PORT="$(python3 -c "import json;print(json.load(open('$HERE/firebase.json'))['emulators']['firestore']['port'])")"
export FIRESTORE_EMULATOR_HOST="127.0.0.1:$FS_PORT"
export GOOGLE_CLOUD_PROJECT=demo-knot GCP_PROJECT_ID=demo-knot
export KNOT_REPOSITORY_BACKEND=firestore
unset KNOT_MEMORY_SEED_DEMO KNOT_EXTRA_MEMORY_SEED_FILE
export KNOT_CREATOR_A2A_MODE=http
export KNOT_CREATOR_AGENT_HEARTBEAT_SECONDS="${KNOT_CREATOR_AGENT_HEARTBEAT_SECONDS:-30}"

A_PORT="${KNOT_CREATOR_A_PORT:-8091}"; B_PORT="${KNOT_CREATOR_B_PORT:-8092}"; BRAND_PORT="${KNOT_BRAND_PORT:-8083}"
A_URL="http://127.0.0.1:$A_PORT/a2a/v1"
B_URL="http://127.0.0.1:$B_PORT/a2a/v1"
A_TENANTS="agent-creator-1,creator-agent-001,creator-agent-002,creator-agent-004,creator-agent-006,creator-agent-007,creator-agent-008,creator-agent-009,creator-agent-010,agent-creator-2"
B_TENANTS="creator-agent-003,creator-agent-005"

pids=()
cleanup() { for p in "${pids[@]:-}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM
start() { local name="$1"; shift; echo "▸ $name"; ( "$@" >"$LOGS/$name.log" 2>&1 ) & pids+=("$!"); }
wait_http() { local url="$1" n="${2:-60}"; for _ in $(seq 1 "$n"); do curl -fsS -m 1 "$url" >/dev/null 2>&1 && return 0; sleep 1; done; return 1; }

if curl -fsS -m 1 "http://$FIRESTORE_EMULATOR_HOST" >/dev/null 2>&1; then
  echo "▸ firestore-emulator  이미 떠 있음 ($FIRESTORE_EMULATOR_HOST) — 재사용"
else
  # 에뮬레이터는 cwd 에 firestore-debug.log 를 남기므로 로그 디렉터리에서 실행(레포 오염 방지)
  start firestore-emulator sh -c "cd '$LOGS' && exec npx -y firebase-tools emulators:start --only firestore --project demo-knot --config '$HERE/firebase.json'"
  if wait_http "http://$FIRESTORE_EMULATOR_HOST" 120; then echo "  ✅ firestore-emulator  $FIRESTORE_EMULATOR_HOST"
  else echo "  ❌ firestore-emulator → $LOGS/firestore-emulator.log"; exit 1; fi
fi

echo "▸ seed (once, idempotent)"
"$PY/python" backend/scripts/seed_firestore.py --creator-agent-base-url "$A_URL" | sed 's/^/  /'

# --- 세 프로세스, 같은 Firestore ------------------------------------------------------
# 브랜드에 KNOT_CREATOR_AGENT_ENDPOINTS 를 주지 않는다: B 가 호스팅하는 테넌트의 baseUrl 은
# B 의 heartbeat 가 레지스트리에 쓰고, 브랜드는 그걸 읽는다. (그게 이 스크립트의 요점)
start creator-a env KNOT_SERVICE_NAME=knot-creator-agent CREATOR_AGENT_BASE_URL=$A_URL KNOT_CREATOR_AGENT_TENANTS="$A_TENANTS" \
  "$PY/uvicorn" apps.creator_agent.main:app --app-dir "$ROOT/backend" --host 127.0.0.1 --port "$A_PORT"
start creator-b env KNOT_SERVICE_NAME=knot-creator-agent CREATOR_AGENT_BASE_URL=$B_URL KNOT_CREATOR_AGENT_TENANTS="$B_TENANTS" \
  "$PY/uvicorn" apps.creator_agent.main:app --app-dir "$ROOT/backend" --host 127.0.0.1 --port "$B_PORT"
start brand-agent env KNOT_SERVICE_NAME=knot-brand-agent CREATOR_AGENT_BASE_URL=$A_URL KNOT_CREATOR_AGENT_ENDPOINTS= \
  BRAND_AGENT_BASE_URL="http://127.0.0.1:$BRAND_PORT/brand/v1" \
  "$PY/uvicorn" apps.brand_agent.main:app --app-dir "$ROOT/backend" --host 127.0.0.1 --port "$BRAND_PORT"

for probe in "creator-a|http://127.0.0.1:$A_PORT/healthz" "creator-b|http://127.0.0.1:$B_PORT/healthz" "brand-agent|http://127.0.0.1:$BRAND_PORT/healthz"; do
  name="${probe%%|*}"; url="${probe#*|}"
  if wait_http "$url"; then echo "  ✅ $name  $url"; else echo "  ❌ $name  $url  → $LOGS/$name.log"; fi
done
echo
echo "Firestore : $FIRESTORE_EMULATOR_HOST (project demo-knot)   UI http://127.0.0.1:4000/firestore"
echo "관전:  http://127.0.0.1:$BRAND_PORT/brand/v1/campaign"
echo "CLI :  cd backend && python scripts/a2a_campaign.py --category beauty --total 1300 --target 2 --brand-url http://127.0.0.1:$BRAND_PORT/brand/v1"
echo "로그:  $LOGS/{firestore-emulator,creator-a,creator-b,brand-agent}.log   (Ctrl+C 로 전부 종료)"
wait
