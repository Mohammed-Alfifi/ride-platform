#!/usr/bin/env bash
# Rebuilds and restarts after pulling new code. Migrations run automatically when the API starts.
set -euo pipefail
cd "$(dirname "$0")"
git -C ../.. pull --ff-only || true
bash fetch-web.sh || true
sudo docker compose --env-file server.env up -d --build
sudo docker image prune -f >/dev/null
