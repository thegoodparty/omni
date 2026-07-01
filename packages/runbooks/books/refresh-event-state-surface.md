Refresh the consumer-facing analytics event-state surface (the Google Sheet).

## Prerequisites

**scripts/.env variables**: `GP_EVENT_STATE_SHEET_ID`, `DATABRICKS_SERVER_HOSTNAME`, `DATABRICKS_HTTP_PATH`, `DATABRICKS_API_KEY`
**Tools**: `uv`, Databricks access, a Google OAuth client (Sheets write scope)

## Steps

1. Make sure the provenance CSV is current — run the provenance walk first if needed:
   `cd scripts/python && uv run python amplitude_event_provenance_backfill.py walk`
2. Preview the surface without writing (prints matrix dimensions; reads Databricks but skips Google auth and the sheet write):
   `uv run python event_state_gsheet.py refresh --dry-run`
3. Write/update the Google Sheet (full overwrite of the `events` tab):
   `uv run python event_state_gsheet.py refresh`
   - First run only: pass `--client-secrets <path/to/oauth-client.json>` and approve the
     browser consent. The token is then cached (gitignored) and later runs are headless.
4. Open the sheet and confirm the data refreshed. The ClickUp landing page links/embeds
   this sheet, so no separate page write is needed.

## Troubleshooting

- `--spreadsheet-id or GP_EVENT_STATE_SHEET_ID required` → export the sheet id (see scripts/.env) or pass `--spreadsheet-id`.
- `Missing Google OAuth client creds` → pass `--client-secrets <json>` on the first run (or set the env vars it names); after the first consent the cached token is reused.
- The target sheet must have a tab named `events`.
- Status looks wrong → status comes from `analytics_event_health.reconcile`; re-run the provenance walk so the code axis is fresh.
