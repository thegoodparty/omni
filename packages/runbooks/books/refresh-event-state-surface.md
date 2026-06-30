Refresh the consumer-facing analytics event-state surface (the ClickUp doc page).

## Prerequisites

**scripts/.env variables**: `CLICKUP_API_KEY`, `CLICKUP_TEAM_ID`, `DATABRICKS_SERVER_HOSTNAME`, `DATABRICKS_HTTP_PATH`, `DATABRICKS_API_KEY`
**Tools**: `uv`, Databricks access, ClickUp API token

## Steps

1. Make sure the provenance CSV is current — run the provenance walk first if needed:
   `cd scripts/python && uv run python amplitude_event_provenance_backfill.py walk`
2. Preview the surface without writing:
   `uv run python event_state_clickup_doc.py refresh --dry-run | head -40`
3. Write/update the ClickUp doc page:
   `uv run python event_state_clickup_doc.py refresh`
4. Open the doc in ClickUp and confirm the page updated in place (no duplicate).

## Troubleshooting

- `CLICKUP_API_KEY and CLICKUP_TEAM_ID must be set` → export them (see scripts/.env).
- 404 listing the doc pages → the doc id may need its suffix trimmed; see `DEFAULT_DOC_ID` in `scripts/python/event_state_clickup_doc.py`.
- Status looks wrong → status comes from `analytics_event_health.reconcile`; re-run the provenance walk so the code axis is fresh.
