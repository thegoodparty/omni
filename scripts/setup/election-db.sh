#!/usr/bin/env bash
# Local election database: creates `electiondb` in the gp-api docker Postgres,
# applies the election migrations, and loads the local election seed (Michigan,
# North Carolina and Wyoming from the dev election database). Idempotent:
# a database that already holds races is left alone unless --reload is given.
#
#   bash scripts/setup/election-db.sh [--fetch] [--reload] [--api-url <url>]
#
#   --fetch    download a fresh seed first (GitHub sign-in, same as setup)
#   --reload   load the seed even if electiondb already holds data
#
# `npm run seed:election` is --fetch --reload. scripts/setup.sh runs this with
# no flags after the gp-api migrate step, using the seed its device flow
# fetched. The seed is restricted data and is never committed (see
# packages/gp-api/prisma-election/seed/.gitignore).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
GP_API="$ROOT/packages/gp-api"
SEED="$GP_API/prisma-election/seed/election-seed.sql.gz"
# Matches packages/gp-api/docker-compose.yml and .env.example.
LOCAL_URL="postgresql://postgres:postgres@localhost:5432/electiondb"
API_URL="https://gp-api-dev.goodparty.org"
FETCH=false
RELOAD=false

while [ $# -gt 0 ]; do
  case "$1" in
    --fetch) FETCH=true; shift ;;
    --reload) RELOAD=true; shift ;;
    --api-url) API_URL="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

psql_in() {
  (cd "$GP_API" && docker compose exec -T postgres psql -U postgres -v ON_ERROR_STOP=1 "$@")
}

if ! (cd "$GP_API" && docker compose exec -T postgres pg_isready -U postgres >/dev/null 2>&1); then
  echo "ERROR: the gp-api postgres container is not running." >&2
  echo "Start it with: (cd packages/gp-api && docker compose up -d)" >&2
  exit 1
fi

if [ "$(psql_in -tAc "SELECT 1 FROM pg_database WHERE datname = 'electiondb'")" != "1" ]; then
  psql_in -qc 'CREATE DATABASE electiondb'
  echo "  created electiondb"
fi

(cd "$GP_API" && ELECTION_DATABASE_URL="$LOCAL_URL" npx prisma migrate deploy --schema prisma-election/schema >/dev/null)
echo "  election migrations applied"

if [ "$FETCH" = true ]; then
  # shellcheck source=scripts/setup-config.sh
  source "$ROOT/scripts/setup-config.sh"
  # The seed response is validated against @goodparty_org/contracts, whose
  # dist/ may not exist yet on a fresh clone.
  npm run build -w packages/contracts >/dev/null
  npx tsx "$ROOT/scripts/setup/lib/cli.ts" election-seed \
    "$GITHUB_OAUTH_CLIENT_ID" "$API_URL" "$SEED"
fi

if [ ! -f "$SEED" ]; then
  echo "  no local election seed yet; election pages and test-user creation"
  echo "  will have no data. Fetch it with: npm run seed:election"
  exit 0
fi

races="$(psql_in -d electiondb -tAc 'SELECT count(*) FROM "Race"' | tr -d '[:space:]')"
if [ "$races" != "0" ] && [ "$RELOAD" != true ]; then
  echo "  electiondb already holds $races races; leaving it (--reload to replace)"
  exit 0
fi

gunzip -c "$SEED" | psql_in -d electiondb -q
races="$(psql_in -d electiondb -tAc 'SELECT count(*) FROM "Race"' | tr -d '[:space:]')"
echo "  loaded the local election seed ($races races)"
