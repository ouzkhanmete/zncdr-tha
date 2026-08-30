#!/usr/bin/env bash
# One command to get the whole thing running: install, build the database, fill it
# with believable data, start both servers, and say where to look.
set -euo pipefail

API_PORT=3001
WEB_PORT=5173
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

say()  { printf "\n\033[1m%s\033[0m\n" "$1"; }
step() { printf "  %s\n" "$1"; }
die()  { printf "\n\033[31m%s\033[0m\n\n" "$1" >&2; exit 1; }

command -v bun >/dev/null 2>&1 || die "Bun is not installed. Get it from https://bun.sh and run this again."

# Anything of ours still listening from a previous run would stop the new one binding.
for port in $API_PORT $WEB_PORT; do
  pid="$(lsof -ti:"$port" 2>/dev/null || true)"
  if [ -n "$pid" ]; then
    step "Port $port was busy — stopping what was there."
    kill $pid 2>/dev/null || true
    sleep 1
  fi
done

say "1/3  Installing"
bun install --silent

say "2/3  Building the database and filling it"
# The seed runs the migrations itself, so a clean clone needs nothing else.
# Same fixed seed every time, so everyone sees the same org.
bun run seed

say "3/3  Starting"
mkdir -p .logs
bun run api > .logs/api.log 2>&1 &
API_PID=$!
bun run web > .logs/web.log 2>&1 &
WEB_PID=$!

# Ctrl+C should take both down, not leave one orphaned holding a port.
cleanup() {
  printf "\n  Stopping.\n"
  kill "$API_PID" "$WEB_PID" 2>/dev/null || true
  wait "$API_PID" "$WEB_PID" 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

wait_for() { # url, name, log
  for _ in $(seq 1 60); do
    if curl -sf -o /dev/null "$1" 2>/dev/null; then return 0; fi
    if ! kill -0 "$4" 2>/dev/null; then
      printf "\n\033[31m  %s died on startup. Last lines of %s:\033[0m\n\n" "$2" "$3" >&2
      tail -20 "$3" >&2; exit 1
    fi
    sleep 0.5
  done
  printf "\n\033[31m  %s did not come up in 30s. See %s\033[0m\n" "$2" "$3" >&2; exit 1
}

step "Waiting for the API..."
wait_for "http://localhost:$API_PORT/api/teams" "The API" ".logs/api.log" "$API_PID"
step "Waiting for the dashboard..."
wait_for "http://localhost:$WEB_PORT/" "The dashboard" ".logs/web.log" "$WEB_PID"

cat <<BANNER

  ────────────────────────────────────────────────────────────

    Open  ->  http://localhost:$WEB_PORT

    The API is on http://localhost:$API_PORT if you want to poke at it.
    Logs are in .logs/. Press Ctrl+C to stop both.

  ────────────────────────────────────────────────────────────

  Worth a look:
    /                 the whole org, and whether it is paying for itself
    /teams/7          Nova — over its spending stop line
    /teams/8          Pinnacle — 7 of its 9 setup failures are one missing secret
    /runs/7402        a run that reported success while leaking a token
    /runs/6129        a task that took three attempts, all three counted

BANNER

wait "$API_PID" "$WEB_PID"
