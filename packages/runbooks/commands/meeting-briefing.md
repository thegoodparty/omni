<!-- v1 — 2026-05-09 -->

Generate a structured meeting briefing from a city council or municipal agenda PDF.

<!-- BEGIN: resolve-runbooks-dir -->
## Where this runs

This command can be invoked as `/meeting-briefing` (after `./install.sh`) or read
directly as `commands/meeting-briefing.md`. The scripts it references live inside
the runbooks repo. Set `$RUNBOOKS_DIR` to the repo root before running, or let the
fallback logic below resolve it.

```bash
# Option 1 — env var
export RUNBOOKS_DIR=/path/to/runbooks

# Option 2 — fallback: resolve from this file's location (agent use)
RUNBOOKS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
```
<!-- END: resolve-runbooks-dir -->

## Prerequisites

**scripts/.env variables**: `DATABRICKS_SERVER_HOSTNAME`, `DATABRICKS_HTTP_PATH`, `DATABRICKS_API_KEY`
**~/Research/.env variables**: `ANTHROPIC_API_KEY`
**Tools**: `uv` (Python runtime), WireGuard VPN connected (for Databricks/RDS access)
**Input**: A machine-readable agenda PDF (not a scanned image)

## What this produces

Running this procedure generates three output files and one directory:

| File | Description |
|------|-------------|
| `briefing.json` | Structured meeting briefing — priority items, constituent sentiment, sources |
| `claims.json` | Per-claim source extracts — input for the QA spine (`books/qa-spine.md`) |
| `sources.json` | Source registry — input for the QA spine |
| `source_snapshots/agenda_text.txt` | Full extracted text from the agenda PDF |

To render a human-readable Markdown version: see Step 4.

## Steps

### 1. Set inputs

```bash
PDF=/path/to/agenda.pdf        # agenda PDF — must be machine-readable, not scanned
CITY=chapel-hill-NC            # city slug: lowercase city name + hyphen + state code
DATE=2026-04-16                # meeting date YYYY-MM-DD
OUTPUT=output/${CITY}_${DATE}  # output directory
```

### 2. Generate the briefing

```bash
cd "$RUNBOOKS_DIR/scripts/python"
uv run python generate_meeting_briefing.py \
  --pdf "$PDF" \
  --city "$CITY" \
  --date "$DATE" \
  --output "$OUTPUT"
```

The script runs two LLM passes:
- **Pass 1** — extracts and categorizes all agenda items; identifies which require a vote or major decision
- **Pass 2** — generates card content for each priority item, grounded in the agenda text

Haystaq constituent data is pulled automatically for agenda topics when Databricks credentials are set. Scope defaults to city-wide. If Databricks is unavailable, constituent sections are omitted and noted in `briefing.json`.

Expected runtime: 2–5 minutes depending on agenda length and number of priority items.

### 3. Review the output

```bash
# Browse the structured briefing
cat "$OUTPUT/briefing.json" | python3 -m json.tool | head -80

# Count priority items and claims
python3 -c "
import json
b = json.load(open('$OUTPUT/briefing.json'))
c = json.load(open('$OUTPUT/claims.json'))
print(f'Priority items: {len(b[\"priorityIssues\"])}')
print(f'Claims: {len(c)}')
print(f'Constituent data available: {b[\"constituentData\"][\"available\"]}')
"
```

### 4. Render as Markdown (optional)

```bash
uv run python briefing_to_pdf.py --briefing "$OUTPUT/briefing.json"
# Writes: $OUTPUT/briefing.md
```

### 5. Run QA (optional — requires qa-spine branch)

If the `qa-spine` branch is merged, validate the briefing:

```bash
uv run python qa_validate.py --output-dir "$OUTPUT"
# Writes: $OUTPUT/qa_bundle.json
```

See `books/qa-spine.md` for full QA documentation.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `ERROR: PDF text extraction yielded fewer than 100 characters` | Scanned/image PDF — no machine-readable text | Obtain a text-based PDF or run OCR first |
| `ANTHROPIC_API_KEY not set` | Missing env var | Add `ANTHROPIC_API_KEY=sk-ant-...` to `~/Research/.env` |
| `Haystaq: Databricks credentials not set — skipping` | Missing scripts/.env vars | Add Databricks credentials to `scripts/.env`; briefing generates without constituent data |
| `zero_voters_matched — check city/state spelling` | City name in slug doesn't match L2 voter file | Verify exact city name in Databricks: `SELECT DISTINCT Residence_Addresses_City FROM ... WHERE Residence_Addresses_State = 'NC' LIMIT 20` |
| Pass 2 produces empty `whatDecision` for an item | Agenda text for that item has no explicit decision language | Expected — item may be informational only; the field is intentionally left blank |
| Constituent data available but 0% alignment on all issues | LLM matched wrong `hs_*` columns | Review `claims.json` — matched columns are logged; adjust by re-running with a more specific `--city` slug |
