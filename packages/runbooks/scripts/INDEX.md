# Script Index

Quick reference for all available scripts. Keep this updated when adding or removing scripts.

| Script | Description | Used By |
|--------|-------------|---------|
| `python/databricks_query.py` | Execute SQL queries against Databricks and return results as a DataFrame | books/query-voter-data.md |
| `python/analytics_event_health.py` | Deterministic flatline / hard-drop detection for key Win + Serve Amplitude events (Databricks). Reads `monitored_events.yaml`, compares recent vs. baseline daily rates, emits a JSON report (flagged events + candidate replacements + new events in watched families). Pure threshold logic is unit-tested in `test_analytics_event_health.py`. | books/monitor-event-health.md |
| `python/circle_query.py` | GET wrapper for the Circle Admin API v2 (Bearer auth). CLI prints JSON; `get()` helper for programmatic use | books/connect-circle-api.md |
| `python/circle_engagement.py` | Full engagement snapshot — DAU/WAU/MAU, stickiness, contribution mix, content rate, top spaces/contributors, cohort retention | books/circle-engagement-snapshot.md |
| `python/clickup_api.py` | ClickUp API wrapper (GET/POST/PUT/DELETE) with token auth; v2 by default, `--api-version=v3` for the Docs/Pages API. CLI prints JSON; `get/post/put/delete()` helpers for programmatic use | commands/clickup-epic-create.md, commands/clickup-epic-edit.md, commands/work-on-clickup.md, commands/prd-to-tech-design.md |
| `python/qa_validate.py` | Validate a qa-spine-compliant artifact JSON: deterministic checks + Phase 1 LLM triage + Phase 2 adversarial escalation → release_verdict (ok/warn/block) + per-claim verdicts in qa_bundle.json. Product-agnostic; product-specific rules live in a `<product>_product_spec.json`. | books/qa-validate.md |
| `python/verify_urls.py` | Verify a list of URLs return HTTP 200 (HEAD first, fallback to GET on 403/405/501). Follows redirects, returns `{url, status, final_url, ok, error?}` per row as JSON. Reads URLs from argv or stdin. | Standalone local/dev URL vetting only. NOT invoked by any experiment at runtime — agents verify URLs with `pmf_runtime.http.head` inside the sandbox (direct HTTP / this script would hang in the quarantined network). |
| `shell/generate-roadmap-pdf.sh` | Convert an EO's roadmap markdown variants to clean PDFs (pandoc + headless Chrome) | books/generate-governing-roadmap.md |
