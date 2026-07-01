#!/usr/bin/env bash
# One-time Google OAuth consent for the event-state Sheet refresh (DATA-2061).
#
# Caches the token at the checkout-independent path event_state_gsheet.py resolves
# (GP_SHEETS_TOKEN_PATH, else $XDG_CONFIG_HOME/gp-event-state, else ~/.config/gp-event-state),
# so one consent survives worktree removal and is shared across checkouts. Run this once; after
# that refresh-event-state.sh is non-interactive until the token is revoked.
#
# Usage:
#   scripts/shell/mint-sheets-token.sh                 # fetch client secrets from 1Password (op)
#   scripts/shell/mint-sheets-token.sh <secrets.json>  # use a client-secrets JSON you saved manually
#
# Requires: uv; a browser for the one-time consent. The op path also needs the 1Password CLI
# signed in (desktop-app integration enabled and the app unlocked). If op is unavailable, save the
# client-secrets document from 1Password by hand and pass its path as the argument instead.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY_DIR="$HERE/../python"
ENV_FILE="$HERE/../.env"
OP_ITEM="${GP_SHEETS_OP_ITEM:-GoodParty Sheets OAuth client}"

# Load scripts/.env the same way refresh-event-state.sh does, so a GP_SHEETS_TOKEN_PATH set only
# there reaches the Python child below and the token is minted to the exact path refresh reads.
# Let an already-exported shell value win; only fill vars that are currently unset.
if [[ -f "$ENV_FILE" ]]; then
  while IFS='=' read -r _k _v; do
    [[ "$_k" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue   # skip comments/blank lines
    [[ -n "${!_k:-}" ]] && continue                        # already set → shell env wins
    _v="${_v%$'\r'}"                                       # strip a trailing CR (CRLF .env)
    _v="${_v#\"}" ; _v="${_v%\"}"                          # strip surrounding double quotes
    _v="${_v#\'}" ; _v="${_v%\'}"                          # strip surrounding single quotes
    export "$_k=$_v"
  done < "$ENV_FILE"
fi

if [[ $# -ge 1 && -s "$1" ]]; then
  SECRETS="$1"
  echo "Using client secrets from: $SECRETS"
else
  SECRETS="$(mktemp -t gp-sheets-oauth.XXXXXX)"
  trap 'rm -f "$SECRETS"' EXIT
  echo "Fetching OAuth client secrets from 1Password item: $OP_ITEM"
  op document get "$OP_ITEM" --out-file "$SECRETS" >/dev/null || {
    echo "Failed to fetch client secrets from 1Password. Is 'op' signed in (desktop-app" >&2
    echo "integration enabled and unlocked)? Alternatively save the '$OP_ITEM' document" >&2
    echo "manually and pass it: $0 <secrets.json>" >&2
    exit 1
  }
fi

echo "Opening a browser for the one-time consent (approve with your GoodParty Google account)..."
cd "$PY_DIR"
uv run python -c "import sys; from event_state_gsheet import get_sheets_service, TOKEN_PATH; get_sheets_service(client_secrets_file=sys.argv[1]); print('Token cached at:', TOKEN_PATH)" "$SECRETS"
echo "Done. Future refreshes are non-interactive."
