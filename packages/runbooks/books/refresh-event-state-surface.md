Refresh the consumer-facing analytics event-state surface (the Google Sheet).

## Prerequisites

**scripts/.env variables**: `GP_EVENT_STATE_SHEET_ID`, `DATABRICKS_SERVER_HOSTNAME`, `DATABRICKS_HTTP_PATH`, `DATABRICKS_API_KEY`
**Tools**: `uv`, Databricks access, a Google OAuth client (Sheets write scope)

## Manual trigger (one command)

`scripts/shell/refresh-event-state.sh`            — full refresh
`scripts/shell/refresh-event-state.sh --dry-run`  — preview only (no Google write)

Do the one-time browser consent once with `scripts/shell/mint-sheets-token.sh` (fetches the
OAuth client secrets from 1Password, or takes a saved secrets JSON as an argument). The token
caches **outside the checkout** (`GP_SHEETS_TOKEN_PATH`, else `$XDG_CONFIG_HOME/gp-event-state`,
else `~/.config/gp-event-state`) so it survives worktree removal and is shared across checkouts;
later runs are non-interactive. If no token exists, the wrapper will also do the first-run fetch
inline. The `uv run` steps below are the underlying detail.

## Automated triggers (DATA-2053)

Beyond the manual command, the refresh fires automatically, each as an independent,
non-fatal step (a failure never blocks the triggering work). The wrapper is **host-gated**:
on a machine without the shared Sheets credentials (no cached token and no
`GP_EVENT_STATE_SHEET_ID`) it exits 0 without contacting 1Password or OAuth, so the triggers
are a clean no-op for engineers who are not set up. Only a configured host actually writes
the sheet, keeping it eventually-consistent until a shared service account lands
(DATA-2044/2045).

- **Metadata write** — the `event-metadata` skill, after writing to Amplitude, calls the
  wrapper with `--override <file>` carrying the just-written `govern_*` fields, so the change
  shows before the daily Databricks sync. Covers new events, governance updates, and
  retire/supersede.
- **Health monitor** — `books/monitor-analytics-event-health.md` calls the plain wrapper
  after its run (status is recomputed live, so no override).

The `--override` file is `{ "<event_type — raw event name as fired in code>": {
govern_display_name, govern_description, govern_tags } }`, built from the prod Amplitude
project. Key on the raw `event_type`, not the Govern display name (which can differ) —
`assemble()` matches overrides to catalog rows by `event_type`, so a mismatched key would
inject a phantom row and leave the real one stale. `assemble()` overlays it onto (or injects
it into) the Databricks catalog.

## Steps

1. Make sure the provenance CSV is current — run the provenance walk first if needed:
   `cd scripts/python && uv run python amplitude_event_provenance_backfill.py walk`
2. Preview the surface without writing (prints matrix dimensions; reads Databricks but skips Google auth and the sheet write):
   `uv run python event_state_gsheet.py refresh --dry-run`
3. Write/update the Google Sheet (full overwrite of the `events` tab):
   `uv run python event_state_gsheet.py refresh`
   - First run only: mint the token once with `scripts/shell/mint-sheets-token.sh` (or pass
     `--client-secrets <path/to/oauth-client.json>` here) and approve the browser consent. The
     token then caches outside the checkout and later runs are headless.
4. Open the sheet and confirm the data refreshed. The ClickUp landing page links/embeds
   this sheet, so no separate page write is needed.

## Troubleshooting

- `--spreadsheet-id or GP_EVENT_STATE_SHEET_ID required` → export the sheet id (see scripts/.env) or pass `--spreadsheet-id`.
- `Missing Google OAuth client creds` → pass `--client-secrets <json>` on the first run (or set the env vars it names); after the first consent the cached token is reused.
- The target sheet must have a tab named `events`.
- Status looks wrong → status comes from `analytics_event_health.reconcile`; re-run the provenance walk so the code axis is fresh.
