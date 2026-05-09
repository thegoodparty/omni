# Script Index

Quick reference for all available scripts. Keep this updated when adding or removing scripts.

| Script | Description | Used By |
|--------|-------------|---------|
| `python/databricks_query.py` | Execute SQL queries against Databricks and return results as a DataFrame | books/query-voter-data.md |
| `python/circle_query.py` | GET wrapper for the Circle Admin API v2 (Bearer auth). CLI prints JSON; `get()` helper for programmatic use | books/connect-circle-api.md |
| `python/circle_engagement.py` | Full engagement snapshot — DAU/WAU/MAU, stickiness, contribution mix, content rate, top spaces/contributors, cohort retention | books/circle-engagement-snapshot.md |
| `python/clickup_api.py` | ClickUp API wrapper (GET/POST/PUT/DELETE) with token auth; v2 by default, `--api-version=v3` for the Docs/Pages API. CLI prints JSON; `get/post/put/delete()` helpers for programmatic use | commands/clickup-epic-create.md, commands/clickup-epic-edit.md, commands/work-on-clickup.md, commands/prd-to-tech-design.md |
| `python/generate_meeting_briefing.py` | Generate a structured meeting briefing from an agenda PDF. Two-pass Anthropic generation with Haystaq constituent data from Databricks. Outputs `briefing.json`, `claims.json`, `sources.json`, `source_snapshots/` | commands/meeting-briefing.md |
| `python/briefing_to_pdf.py` | Render `briefing.json` as human-readable Markdown. Standalone converter, no LLM calls | commands/meeting-briefing.md |
| `python/qa_init.py` | Scaffold an output/ folder with stub artifact files before a QA-enabled generation run | books/qa-spine.md |
| `python/qa_validate.py` | Validate a completed output/ folder: deterministic checks + Phase 1 Anthropic triage + Phase 2 Gemini escalation → Block/OK verdict + qa_bundle.json | books/qa-spine.md |
| `python/meeting_briefing_product_spec.json` | Single source of truth for meeting briefing QA rules: claim types, weights, blockable set, deterministic check routing. Edit here to update rules. | books/qa-spine.md |
