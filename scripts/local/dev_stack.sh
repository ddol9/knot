#!/usr/bin/env bash
# knot — 로컬 풀스택 (지갑/top-up 스택 수동 검증용).
#
#   scripts/local/dev_stack.sh          # 전체 기동
#   scripts/local/dev_stack.sh --no-fe  # 프론트 제외(백엔드만)
#
# 띄우는 것:
#   Firebase Auth 에뮬레이터 :9099 (UI :4000)   — 로그인/구글가입 (실제 Firebase 미접속)
#   Creator A2A              :8081
#   Brand Agent              :8083  (apps/brand_agent — A2A로 Creator와 협상)
#   여러 크리에이터 프로세스로 쪼개서 보려면 scripts/local/a2a_multi_agent.sh
#   Product API              :18080
#   Web3 Gateway             :8082
#   Frontend (next dev)      :3000
#
# 환경: 루트 .env.local(KNOT_AUTH_MODE=emulator, 메모리 저장소) + frontend/.env.local.
#   .env.local 을 `.env`로 옮기지 말 것 — config.py 가 pytest에도 주입해 테스트가 깨진다.
# 온체인 에스크로 실측은 이 스크립트가 아니라 scripts/localnet_settlement.sh.
# 로그: /tmp/knot-local/<서비스>.log
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"
HERE="$ROOT/scripts/local"
LOGS="${KNOT_LOG_DIR:-/tmp/knot-local}"; mkdir -p "$LOGS"
PY="$ROOT/.venv/bin"
WITH_FE=1
[[ "${1:-}" == "--no-fe" ]] && WITH_FE=0

ENV_FILE="${KNOT_ENV_FILE:-.env.local}"
[[ -f "$ROOT/$ENV_FILE" ]] || { echo "❌ $ENV_FILE 없음 (.env.example 참고해서 작성)"; exit 1; }
[[ -x "$PY/uvicorn" ]] || { echo "❌ .venv 없음 → python3 -m venv .venv && .venv/bin/python -m pip install -e 'backend[dev]'"; exit 1; }

# 서비스에 로컬 환경 주입 (파일명을 .env로 바꾸면 pytest까지 오염되므로 여기서 명시적으로 source)
echo "▸ 환경: $ENV_FILE"
set -a; . "$ROOT/$ENV_FILE"; set +a
if [[ "${KNOT_CREATOR_A2A_MODE:-http}" == "local" ]]; then
  export KNOT_CREATOR_A2A_MODE=http
fi
export KNOT_AGENT_AUTO_SETTLEMENT="${KNOT_AGENT_AUTO_SETTLEMENT:-1}"
echo "  + Agent 정산 자동화: KNOT_AGENT_AUTO_SETTLEMENT=$KNOT_AGENT_AUTO_SETTLEMENT"
echo "  + A2A 경계: KNOT_CREATOR_A2A_MODE=$KNOT_CREATOR_A2A_MODE"

# 정산 배선(localnet_bootstrap.py)이 돌아 있으면 덧입힌다 → 게이트웨이 실서명 모드 + 로컬 mint
if [[ -f "$LOGS/env.localnet" ]]; then
  set -a; . "$LOGS/env.localnet"; set +a
  echo "  + 정산 배선 적용: 게이트웨이 실서명(localnet), mint=${KNOT_USDC_MINT:0:8}…"
else
  echo "  (정산 배선 없음 → 에스크로 락은 실패한다. 필요하면 scripts/local/localnet_bootstrap.py 먼저 실행)"
fi

pids=()
cleanup() { for p in "${pids[@]:-}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

start() { local name="$1"; shift; echo "▸ $name"; ( "$@" >"$LOGS/$name.log" 2>&1 ) & pids+=("$!"); }
wait_http() { local url="$1" n="${2:-60}"; for _ in $(seq 1 "$n"); do curl -fsS -m 1 "$url" >/dev/null 2>&1 && return 0; sleep 1; done; return 1; }

# 에뮬레이터는 cwd에 firebase-debug.log 를 남기므로 로그 디렉터리에서 실행(레포 오염 방지)
start auth-emulator sh -c "cd '$LOGS' && exec npx -y firebase-tools emulators:start --only auth --project demo-knot --config '$HERE/firebase.json'"
start creator-a2a env KNOT_SERVICE_NAME=knot-creator-agent "$PY/uvicorn" apps.creator_agent.main:app --app-dir "$ROOT/backend" --host 127.0.0.1 --port 8081
start brand-agent env KNOT_SERVICE_NAME=knot-brand-agent "$PY/uvicorn" apps.brand_agent.main:app --app-dir "$ROOT/backend" --host 127.0.0.1 --port 8083
start product-api env KNOT_SERVICE_NAME=knot-api "$PY/uvicorn" apps.api.main:app --app-dir "$ROOT/backend" --host 127.0.0.1 --port 18080
start web3-gateway env PORT=8082 npm --prefix "$ROOT/web3/gateway" run dev
[[ $WITH_FE == 1 ]] && start frontend npm --prefix "$ROOT/frontend" run dev

echo
for probe in "product-api|http://127.0.0.1:18080/healthz" "creator-a2a|http://127.0.0.1:8081/healthz" "brand-agent|http://127.0.0.1:8083/healthz" \
             "web3-gateway|http://127.0.0.1:8082/healthz" "auth-emulator|http://127.0.0.1:9099"; do
  name="${probe%%|*}"; url="${probe#*|}"
  if wait_http "$url"; then echo "  ✅ $name  $url"; else echo "  ❌ $name  $url  → $LOGS/$name.log"; fi
done
[[ $WITH_FE == 1 ]] && { wait_http http://127.0.0.1:3000 90 && echo "  ✅ frontend  http://127.0.0.1:3000" || echo "  ❌ frontend → $LOGS/frontend.log"; }

if curl -fsS -m 1 http://127.0.0.1:9099 >/dev/null 2>&1; then
  echo
  echo "▸ demo auth accounts"
  "$HERE/demo_login.sh" user-brand-1 >/dev/null
  "$HERE/demo_login.sh" user-creator-1 >/dev/null
  python3 "$HERE/seed_demo_accounts.py"
fi

echo
echo "Auth 에뮬레이터 UI: http://127.0.0.1:4000   로그: $LOGS"
echo "종료: Ctrl-C"
wait
