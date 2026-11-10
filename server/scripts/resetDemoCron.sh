#!/usr/bin/env bash
# Daily demo reset on the EC2 host (ADR 0017). Started by crontab, never by the API:
#   0 20 * * * /srv/simpul-stok/server/scripts/resetDemoCron.sh >> /home/ubuntu/logs/demo-reset.log 2>&1
# 20:00 UTC is 03:00 WIB. The credential of the reset role is read from a file outside the repository
# and outside server/.env (default ~/.simpul-reset.env, override with DEMO_RESET_ENV_FILE), so the API
# process never holds it. The file holds DEMO_RESET_DATABASE_URL, SEED_ALLOW_REMOTE=true, SEED_PASSWORD
# and DEMO_RESET_WIPE_OTHERS=true. It must be mode 600; the script refuses otherwise.
set -euo pipefail

ENV_FILE="${DEMO_RESET_ENV_FILE:-$HOME/.simpul-reset.env}"
LOCK_FILE="${DEMO_RESET_LOCK_FILE:-/tmp/simpul-demo-reset.lock}"
stamp() { date -u +%Y-%m-%dT%H:%M:%SZ; }

if [ ! -f "$ENV_FILE" ]; then
  echo "[$(stamp)] refused: $ENV_FILE does not exist" >&2
  exit 1
fi
# Linux (the host) prints the mode with -c, macOS with -f.
mode="$(stat -c %a "$ENV_FILE" 2>/dev/null || stat -f %Lp "$ENV_FILE")"
if [ "$mode" != "600" ]; then
  echo "[$(stamp)] refused: $ENV_FILE has mode $mode, it must be 600" >&2
  exit 1
fi

if ! command -v flock >/dev/null; then
  echo "[$(stamp)] refused: flock is not installed (package util-linux)" >&2
  exit 1
fi
# Two runs must never overlap (a manual run while the timer fires): the second one leaves quietly.
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[$(stamp)] skipped: another demo reset is running"
  exit 0
fi

cd "$(dirname "$0")/.."
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

echo "[$(stamp)] demo reset starting"
status=0
NODE_ENV=production node scripts/resetDemo.js || status=$?
echo "[$(stamp)] demo reset finished with exit code $status"
exit "$status"
