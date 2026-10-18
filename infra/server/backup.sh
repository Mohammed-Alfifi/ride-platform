#!/usr/bin/env bash
# Daily database backup (keeps 14 days here). Add to cron:  0 3 * * * bash /path/to/backup.sh
# Off-server copy (recommended): install rclone, run `rclone config` once (Google Drive or Oracle
# Object Storage are free), then set BACKUP_REMOTE=name:folder in server.env.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p backups
file="backups/ride-$(date +%F).dump"
sudo docker compose --env-file server.env exec -T db pg_dump -U ride -Fc ride > "$file"
# Uploaded driver documents live in a Docker volume; archive them too.
sudo docker run --rm -v ride_uploads:/u:ro -v "$PWD/backups":/b alpine tar czf "/b/uploads-$(date +%F).tgz" -C /u . 2>/dev/null || true
find backups -name 'ride-*.dump' -mtime +14 -delete
find backups -name 'uploads-*.tgz' -mtime +14 -delete
remote=$(grep -E '^BACKUP_REMOTE=' server.env | cut -d= -f2- || true)
if [ -n "$remote" ] && command -v rclone >/dev/null; then
  rclone copy backups "$remote" --max-age 26h && echo "Copied to $remote"
fi
