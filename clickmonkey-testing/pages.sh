#!/usr/bin/env bash
# Soak the finding catalog GitHub Pages publishes from docs/.
# Default: the live generated site (the leash url).
# Current docs/ tree: PAGES_LOCAL=1 ./pages.sh
# Other host: PAGES_URL=https://example.com/clickmonkey/ ./pages.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
CONFIG="$HERE/pages/clickmonkey.json"
STEPS="${STEPS:-100}"
DOCS_PID=""
URL=""
URL_ARGS=()

cm() {
  if [ -n "${CLICKMONKEY:-}" ]; then
    command "$CLICKMONKEY" "$@"
  else
    node "$ROOT/bin/clickmonkey.mjs" "$@"
  fi
}

leash_url() {
  node -e 'const fs=require("fs"); process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).url)' "$CONFIG"
}

cleanup() {
  if [ -n "${DOCS_PID:-}" ] && kill -0 "$DOCS_PID" 2>/dev/null; then
    kill "$DOCS_PID" 2>/dev/null || true
    wait "$DOCS_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

wait_http() {
  local url="$1"
  local i
  for i in $(seq 1 50); do
    if curl -sf -o /dev/null "$url"; then
      return 0
    fi
    sleep 0.1
  done
  echo "not reachable: $url" >&2
  return 2
}

start_docs() {
  local log i
  log="$(mktemp)"
  PAGES_PORT="${PAGES_PORT:-4175}" node "$HERE/serve-docs.mjs" >"$log" &
  DOCS_PID=$!
  for i in $(seq 1 50); do
    if [ -s "$log" ]; then
      URL="$(head -n 1 "$log")"
      rm -f "$log"
      return 0
    fi
    if ! kill -0 "$DOCS_PID" 2>/dev/null; then
      cat "$log" >&2 || true
      rm -f "$log"
      echo "docs preview exited" >&2
      return 2
    fi
    sleep 0.1
  done
  rm -f "$log"
  echo "docs preview did not print a URL" >&2
  return 2
}

if [ -n "${PAGES_URL:-}" ]; then
  URL="${PAGES_URL%/}/"
  URL_ARGS=(--url "$URL")
elif [ "${PAGES_LOCAL:-}" = 1 ]; then
  start_docs
  URL_ARGS=(--url "$URL")
else
  URL="$(leash_url)"
fi

wait_http "$URL"
echo "target $URL"

status=0
if [ ${#URL_ARGS[@]} -gt 0 ]; then
  cm map --config "$CONFIG" "${URL_ARGS[@]}" --steps "$STEPS" || status=$?
else
  cm map --config "$CONFIG" --steps "$STEPS" || status=$?
fi
if [ "$status" -ge 2 ]; then
  exit "$status"
fi

runs_dir="$HERE/pages/clickmonkey/runs"
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
