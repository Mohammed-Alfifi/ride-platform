#!/usr/bin/env bash
# macOS / Linux: start the platform locally.
set -e
cd "$(dirname "$0")"
docker compose up -d --build
echo "Dashboard: http://localhost:3001  (sign in: 0500000000, code 123456)"
