# PostgreSQL 16 with PostGIS, built on the official image so it runs on ARM (Oracle Ampere) and x86 alike.
FROM postgres:16-bookworm
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-16-postgis-3 \
 && rm -rf /var/lib/apt/lists/*
COPY init.sql /docker-entrypoint-initdb.d/10-extensions.sql
