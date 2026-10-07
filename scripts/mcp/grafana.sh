#!/usr/bin/env bash
#
# grafana.sh — what .mcp.json starts the Grafana MCP through. A token in the
# shell wins; otherwise it reads the one `npm run setup` vends into the
# gitignored .env.mcp.local, so a contributor never edits a shell profile.
# The main checkout's copy is the fallback because agent worktrees are not
# always provisioned by scripts/worktree-setup.sh, which would copy it.
set -euo pipefail

read_token() {
  [ -f "$1" ] && sed -n 's/^GRAFANA_SERVICE_ACCOUNT_TOKEN=//p' "$1" | tail -n 1
}

if [ -z "${GRAFANA_SERVICE_ACCOUNT_TOKEN:-}" ]; then
  here="$(git rev-parse --show-toplevel)"
  main="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
  GRAFANA_SERVICE_ACCOUNT_TOKEN="$(read_token "$here/.env.mcp.local" || true)"
  if [ -z "$GRAFANA_SERVICE_ACCOUNT_TOKEN" ]; then
    GRAFANA_SERVICE_ACCOUNT_TOKEN="$(read_token "$main/.env.mcp.local" || true)"
  fi
  export GRAFANA_SERVICE_ACCOUNT_TOKEN
fi

if [ -z "$GRAFANA_SERVICE_ACCOUNT_TOKEN" ]; then
  echo "grafana MCP: no token. Run: npm run setup -- --secrets-only --refresh" >&2
fi

exec uvx mcp-grafana
