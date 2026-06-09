#!/usr/bin/env bash
#
# dev.sh — start the core local stack: Postgres (for gp-api) + gp-api + gp-webapp.
#
# This is a convenience wrapper for the most common local loop. Other apps
# (election-api, people-api, gp-admin, candidate-sites) can be started the same
# way with `npm run start:dev -w <app>` / `npm run dev -w <app>`.
#
# Prereqs (see README): `nvm use`, root `npm install`, and each app's .env files.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

cleanup() { echo; echo "Shutting down dev stack..."; kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "==> Starting Postgres (gp-api docker-compose)"
( cd packages/gp-api && docker compose up -d )

echo "==> Starting gp-api on :3000"
npm run start:dev -w gp-api &

echo "==> Starting gp-webapp on :4000"
npm run dev -w packages/gp-webapp &

echo "==> gp-api: http://localhost:3000   gp-webapp: http://localhost:4000"
echo "==> Press Ctrl+C to stop."
wait
