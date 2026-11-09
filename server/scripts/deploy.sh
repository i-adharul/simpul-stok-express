#!/usr/bin/env bash
# Deploy the checked-out commit on the EC2 host. Run from anywhere: ./server/scripts/deploy.sh [branch]
# Migrations are NOT run here: they use the postgres role from a laptop (ADR 0008).
set -euo pipefail

cd "$(dirname "$0")/.."
BRANCH="${1:-main}"

git fetch --quiet origin
git switch "$BRANCH"
git pull --ff-only origin "$BRANCH"
npm ci --omit=dev

# GET /api/health shows this value. A variable set in the shell wins over server/.env (dotenv does
# not override), so the commit is never written to a file that could go stale.
COMMIT_SHA="$(git rev-parse --short HEAD)" pm2 restart simpul-api --update-env
pm2 save

sleep 2
curl -fsS "https://simpulstok-api.adharul.my.id/api/health"
echo
