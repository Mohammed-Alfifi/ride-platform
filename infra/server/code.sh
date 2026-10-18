#!/usr/bin/env bash
# Prints a dashboard access code for a team member's phone (servers without SMS).
# The person must already be on the team (dashboard > Team), or be the platform admin from admin.sh.
# Usage:  bash code.sh 05XXXXXXXX
set -euo pipefail
cd "$(dirname "$0")"
PHONE=${1:?usage: code.sh 05XXXXXXXX}
sudo docker compose --env-file server.env exec -T api node dist/database/access-code.js "$PHONE"
