#!/usr/bin/env bash
#
# gp-pi-testdb.sh — give a gp-pi instance the Postgres that gp-api's test
# harness would otherwise start itself with testcontainers.
#
# Run on the host, not inside gp-pi:
#   scripts/gp-pi-testdb.sh [gp-pi instance]
#
# gp-pi's sandbox has no Docker socket. `gp-pi sidecar run` starts this on the
# host inside the instance's network namespace, so it is on the sandbox's own
# 127.0.0.1, which the harness's loopback-only check requires. Settings mirror
# startTestPostgres in packages/gp-api/src/test-postgres.ts; keep them in step.
# Port 55432 so a dev .env still pointing at localhost:5432 is refused rather
# than logged in to the test database.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT=55432

command -v gp-pi >/dev/null 2>&1 || {
  echo "ERROR: gp-pi is not on PATH. Run this on the host, not inside the sandbox." >&2
  exit 1
}

# `q` rather than `| head -1`: an early-exiting consumer under pipefail can
# kill this with SIGPIPE.
IMAGE="$(sed -n "/TEST_POSTGRES_IMAGE =/{n;s/^ *'\([^']*\)'.*/\1/p;q;}" \
  "$ROOT/packages/gp-api/src/test-postgres.ts")"
if [ -z "$IMAGE" ]; then
  echo "ERROR: could not read TEST_POSTGRES_IMAGE from packages/gp-api/src/test-postgres.ts." >&2
  exit 1
fi

instance_args=()
if [ -n "${1:-}" ]; then
  instance_args=(--instance "$1")
fi

gp-pi sidecar run ${instance_args[@]+"${instance_args[@]}"} testdb \
  -e POSTGRES_USER=test_user \
  -e POSTGRES_PASSWORD=test_password \
  -e POSTGRES_DB=postgres \
  -e PGPORT="$PORT" \
  "$IMAGE" \
  postgres \
  -c listen_addresses=127.0.0.1 \
  -c fsync=off -c synchronous_commit=off -c full_page_writes=off \
  -c max_connections=300

echo "==> Inside the sandbox, before running gp-api's tests:"
echo "    export OMNI_TEST_POSTGRES_URL=postgresql://test_user:test_password@127.0.0.1:$PORT/postgres"
