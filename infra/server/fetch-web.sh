#!/usr/bin/env bash
# Downloads the rider web app (for iPhone and browsers) from the project's latest GitHub release
# into ./web, which Caddy serves at https://API_DOMAIN/app/. Safe to run any time.
set -euo pipefail
cd "$(dirname "$0")"
REPO=${REPO:-Mohammed-Alfifi/ride-platform}
mkdir -p web
tmp=$(mktemp -d)
if curl -fsSL -o "$tmp/web.zip" "https://github.com/$REPO/releases/latest/download/mishwar-rider-web.zip"; then
  mkdir -p "$tmp/web"
  unzip -q "$tmp/web.zip" -d "$tmp/web"
  rm -rf web.old && mv web web.old && mv "$tmp/web" web && rm -rf web.old
  echo "Rider web app updated."
else
  echo "No release with the web app yet (run 'Release builds' on GitHub). Skipping."
  [ -f web/index.html ] || echo '<!doctype html><meta charset="utf-8"><p dir="rtl">نسخة الويب غير جاهزة بعد.</p>' > web/index.html
fi
rm -rf "$tmp"
