#!/usr/bin/env bash
# Refresh the consumer event-state Google Sheet (DATA-2053). Single entry point for the
# manual, event-metadata-skill, and health-monitor triggers. Runs event_state_gsheet.py
# refresh, passing through flags (--dry-run, --override <file>, --spreadsheet-id).
#
# Requires: uv; Databricks env vars; GP_EVENT_STATE_SHEET_ID. On the FIRST run only (no
# cached Google token) it also needs `op` (1Password CLI, unlocked) to fetch the OAuth
# client secrets and a browser for consent. Not for headless/cloud use — DATA-2045 owns that.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY_DIR="$HERE/../python"
ENV_FILE="$HERE/../.env"
TOKEN="$PY_DIR/instrumentation_data/gsheet_token.pickle"
OP_ITEM="${GP_SHEETS_OP_ITEM:-GoodParty Sheets OAuth client}"

# Load non-secret fallback config, but let an already-exported shell env value win
# (source would otherwise overwrite it). Only fill vars that are currently unset.
if [[ -f "$ENV_FILE" ]]; then
  while IFS='=' read -r _k _v; do
    [[ "$_k" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue   # skip comments/blank lines
    [[ -n "${!_k:-}" ]] && continue                        # already set → shell env wins
    export "$_k=$_v"
  done < "$ENV_FILE"
fi

secret_args=()
if [[ ! -f "$TOKEN" ]]; then
  secrets_file="$(mktemp -t gp-sheets-oauth.XXXXXX)"
  trap 'rm -f "$secrets_file"' EXIT
  op document get "$OP_ITEM" --out-file "$secrets_file" >/dev/null || {
    echo "Failed to fetch OAuth client secrets from 1Password. Is 'op' signed in?" >&2
    exit 1
  }
  secret_args=(--client-secrets "$secrets_file")
fi

cd "$PY_DIR"
uv run python event_state_gsheet.py refresh "${secret_args[@]+"${secret_args[@]}"}" "$@"
