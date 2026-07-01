#!/usr/bin/env bash
# Announce an analytics-event metadata change in Slack (DATA-2057, Source A). The terminal
# hook for the event-metadata skill: runs event_state_slack.py notify-metadata, passing
# through its flags (--event, --change, --status, --product, --family, --purpose, --source,
# --author, --supersession, --sheet-url, --changed).
#
# Requires: uv; a shared Slack bot token (SLACK_APP_BOT_TOKEN, chat:write) and the target
# channel (SLACK_EVENT_LIFECYCLE_CHANNEL_ID) in scripts/.env. Never a personal token.
#
# Host gate: on a machine NOT set up for Slack (either var unset) this exits 0 without
# posting, so the event-metadata trigger is a clean, silent no-op for engineers without the
# shared bot credentials — never a prompt or a bottleneck. Kept separate from
# refresh-event-state.sh so the Slack and Sheets surfaces gate independently (a host may
# have one credential and not the other).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY_DIR="$HERE/../python"
ENV_FILE="$HERE/../.env"

# Load non-secret fallback config, but let an already-exported shell env value win. Only
# fill vars that are currently unset. (Same loader as refresh-event-state.sh.)
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

# Configured? Skip cleanly if either credential is missing, before invoking uv/Python.
if [[ -z "${SLACK_APP_BOT_TOKEN:-}" || -z "${SLACK_EVENT_LIFECYCLE_CHANNEL_ID:-}" ]]; then
  echo "Slack event-lifecycle notify not configured on this host (SLACK_APP_BOT_TOKEN/SLACK_EVENT_LIFECYCLE_CHANNEL_ID unset); skipping. To enable, populate them in scripts/.env — see scripts/.env.example for the 1Password bootstrap." >&2
  exit 0
fi

cd "$PY_DIR"
uv run python event_state_slack.py notify-metadata "$@"
