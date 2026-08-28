#!/usr/bin/env bash
# Soak the ClickMonkey dashboard (clickmonkey ui).
# Starts the UI against this leash, maps it, then reports.
# skip: Restart UI — that button respawns the server under the walker.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
CONFIG="$HERE/ui/clickmonkey.json"
PORT="${UI_PORT:-4174}"
STEPS="${STEPS:-50}"
URL="http://127.0.0.1:${PORT}/"

cm() {
  if [ -n "${CLICKMONKEY:-}" ]; then
    command "$CLICKMONKEY" "$@"
  else
    node "$ROOT/bin/clickmonkey.mjs" "$@"
  fi
}

if [ ! -f "$ROOT/web/dist/index.html" ] && [ ! -f "$ROOT/dist/ui/index.html" ]; then
  echo "dashboard is not built. From the repo root: npm run build" >&2
  exit 2
fi

cleanup() {
  cm ui --config "$CONFIG" --port "$PORT" --stop >/dev/null || true
}
trap cleanup EXIT INT TERM

cm ui --config "$CONFIG" --port "$PORT" --stop >/dev/null || true
cm ui --config "$CONFIG" --port "$PORT" --no-open &
UI_BG=$!

wait_http() {
  local url="$1"
  local i
  for i in $(seq 1 80); do
    if curl -sf -o /dev/null "$url"; then
      return 0
    fi
    if ! kill -0 "$UI_BG" 2>/dev/null; then
      echo "clickmonkey ui exited" >&2
      return 2
    fi
    sleep 0.1
  done
  echo "not reachable: $url" >&2
  return 2
}

wait_http "$URL"
body="$(curl -sf "$URL" || true)"
if echo "$body" | grep -q "ui not built"; then
  echo "dashboard is not built. From the repo root: npm run build" >&2
  exit 2
fi
echo "target $URL"

status=0
cm map --config "$CONFIG" --url "$URL" --steps "$STEPS" || status=$?
if [ "$status" -ge 2 ]; then
  exit "$status"
fi

runs_dir="$HERE/ui/clickmonkey/runs"
run_id="$(ls -1 "$runs_dir" 2>/dev/null | sort | tail -n 1 || true)"
if [ -z "$run_id" ]; then
  echo "no run to report" >&2
  exit "$status"
fi
cm report --config "$CONFIG" --runs "$run_id" --quality-full || status=$?
if [ "$status" -ge 2 ]; then
  exit "$status"
fi
exit "$status"
