#!/usr/bin/env bash
# Daily database backup (keeps 14 days). Add to cron:  0 3 * * * bash /path/to/backup.sh
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p backups
sudo docker compose --env-file server.env exec -T db pg_dump -U ride -Fc ride > "backups/ride-$(date +%F).dump"
find backups -name 'ride-*.dump' -mtime +14 -delete
