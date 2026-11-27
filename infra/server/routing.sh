#!/usr/bin/env bash
# Prepares the road map for OSRM once (and again when you want newer roads, e.g. every quarter).
# Downloads the OpenStreetMap extract of the Gulf states (includes Saudi Arabia) from Geofabrik
# and builds the car routing files into ./routing. Needs ~4 GB of free memory and ~20 minutes.
#   ./routing.sh && docker compose --profile routing up -d
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p routing
IMAGE=ghcr.io/project-osrm/osrm-backend:v5.27.1
FILE=gcc-states-latest.osm.pbf

echo "Downloading the map extract..."
curl -fL -o "routing/$FILE.part" "https://download.geofabrik.de/asia/$FILE"
mv "routing/$FILE.part" "routing/$FILE"

echo "Building car routes (extract, partition, customize)..."
docker run --rm -v "$PWD/routing:/data" "$IMAGE" osrm-extract -p /opt/car.lua "/data/$FILE"
docker run --rm -v "$PWD/routing:/data" "$IMAGE" osrm-partition /data/gcc-states-latest.osrm
docker run --rm -v "$PWD/routing:/data" "$IMAGE" osrm-customize /data/gcc-states-latest.osrm
rm -f "routing/$FILE"

cat <<MSG
Done. Now:
  1. docker compose --profile routing up -d
  2. In server.env set:
       OSRM_URL=http://osrm:5000
       VROOM_URL=http://vroom:3000
  3. docker compose up -d api
MSG
