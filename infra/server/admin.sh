#!/usr/bin/env bash
# Creates the first platform admin (sign in to the dashboard with this phone).
# Usage:  bash admin.sh +9665XXXXXXXX "Your name" [--demo]
#   --demo also adds a demo partner, zone and plans to try things out.
set -euo pipefail
cd "$(dirname "$0")"
PHONE=${1:?usage: admin.sh +9665XXXXXXXX "Your name" [--demo]}
NAME=${2:-Platform Owner}
sudo docker compose --env-file server.env exec -e SUPER_ADMIN_PHONE="$PHONE" -e SUPER_ADMIN_NAME="$NAME" api \
  node dist/database/seed.js ${3:-}
# Without SMS (SMS_PROVIDER=none) the admin signs in with an access code:
if grep -q '^SMS_PROVIDER=none' server.env; then
  sudo docker compose --env-file server.env exec -T api node dist/database/access-code.js "$PHONE"
  echo "Sign in to the dashboard with this phone and code. New code any time: bash code.sh $PHONE"
fi
