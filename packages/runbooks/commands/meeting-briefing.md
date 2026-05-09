<!-- v2 — 2026-05-09 -->

Generate a structured meeting briefing for an elected official from a city council agenda.

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
**Tools**: `uv` (Python runtime), WireGuard VPN connected (for Databricks access), `pdftotext` (for staff report extraction)
**Access**: Internet (for agenda platform discovery, news, fiscal data)

## What this produces

| File | Description |
|------|-------------|
| `briefing.json` | Structured meeting briefing — priority items with talking points, constituent sentiment, sources |
| `claims.json` | Per-claim source extracts — input for Gate 3 QA validation |
| `sources.json` | Source registry |
| `source_snapshots/` | Raw text from each source document (agenda, staff reports, Haystaq results) |
| `verification_report.json` | Gate 2 output — extract-by-extract verification results |
| `qa_bundle.json` | Gate 3 output — full QA trace, Block/OK verdict (produced when QA is enabled) |
| `briefing.md` | Human-readable Markdown render (produced when render step runs) |

## Run modes

**Run 1 — generation only (no QA):** Steps 1–4. Produces raw briefing with no verification or validation.

**Run 2 — full pipeline with QA loop:** Steps 1–7. Generation → Gate 2 verification → Gate 3 validation → revision loop if blocked → render.

---

## Steps

### 1. Set up the run directory

```bash
CITY=chapel-hill-NC            # lowercase city name + hyphen + 2-letter state code
DATE=2026-04-16                # meeting date YYYY-MM-DD
RUN_ID=output2                 # increment for each run: output1, output2, ...
RUN_DIR="$RUNBOOKS_DIR/scripts/python/output/${RUN_ID}_${CITY}_${DATE}"
mkdir -p "$RUN_DIR/source_snapshots"
```

Write `/workspace/params.json` (substitute your values):

```json
{
  "city": "Chapel Hill",
  "state": "NC",
  "officeName": "City Council",
  "citySlug": "chapel-hill-NC",
  "date": "2026-04-16",
  "pdf": "/optional/path/to/agenda.pdf"
}
```

The `pdf` field is optional. If omitted, the generation agent discovers the meeting platform and fetches the agenda directly.

### 2. Run the generation agent

Spawn an agent using `books/instructions/meeting_briefing.md` as its instruction. The agent's workspace is `$RUN_DIR`.

The agent will:
- Discover the council member and meeting platform
- Fetch the agenda and read staff report PDFs
- Query Haystaq for constituent sentiment (if Databricks credentials are set)
- Research local news, council dynamics, and fiscal data
- Generate the briefing in the voice and structure of `project_files/city-council-member-briefing-copy.md`
- Write `briefing.json`, `claims.json`, `sources.json`, and `source_snapshots/`
- Stop and report when done (before verification)

### 3. Gate 2 — Verify source extracts

Spawn a separate agent using `books/instructions/meeting_briefing_verify.md` as its instruction. Pass the same `$RUN_DIR` as its workspace.

This agent independently checks that every source extract in `claims.json` appears verbatim in the cited source document. It writes `verification_report.json`.

Review the report:

```bash
python3 -c "
import json
r = json.load(open('$RUN_DIR/verification_report.json'))
s = r['summary']
print(f'Passed: {s[\"passed\"]} / Failed: {s[\"failed\"]} / Skipped: {s[\"skipped\"]}')
for result in r['results']:
    if result['status'] == 'fail':
        print(f'  FAIL {result[\"claim_id\"]}: {result[\"note\"]}')
"
```

If any extracts failed: return to the generation agent with the list of failed claim IDs. The generation agent must find correct sources or remove those claims. Repeat Steps 2–3 until verification passes.

### 4. Render as Markdown (Run 1 endpoint)

```bash
cd "$RUNBOOKS_DIR/scripts/python"
uv run python briefing_to_pdf.py --briefing "$RUN_DIR/briefing.json" --output "$RUN_DIR/briefing.md"
```

For Run 1, stop here.

### 5. Gate 3 — Run QA validation

```bash
cd "$RUNBOOKS_DIR/scripts/python"
uv run python qa_validate.py --output-dir "$RUN_DIR"
# Writes: $RUN_DIR/qa_bundle.json
```

Review the verdict:

```bash
python3 -c "
import json
b = json.load(open('$RUN_DIR/qa_bundle.json'))
print(f'Verdict: {b[\"verdict\"]}')
print(f'Reason: {b.get(\"reason\", \"\")}')
"
```

### 6. Revision loop (if blocked)

If the verdict is **Block**:

1. Read `qa_bundle.json` — identify which claims failed and why
2. Return to the generation agent with the specific failures: which claim IDs, what check failed, what the source extract says vs. what the briefing says
3. The generation agent revises only the affected sections
4. Re-run Steps 3–5
5. Repeat up to 3 times. If still blocked after 3 iterations, surface the remaining failures for human review.

If the verdict is **OK**, proceed to Step 7.

### 7. Render final briefing (Run 2 endpoint)

```bash
uv run python briefing_to_pdf.py --briefing "$RUN_DIR/briefing.json" --output "$RUN_DIR/briefing.md"
```

---

## Comparing runs

To see the effect of QA on content, diff the two briefing files:

```bash
diff output/output1_${CITY}_${DATE}/briefing.md output/output2_${CITY}_${DATE}/briefing.md
```

`qa_bundle.json` in the Run 2 directory contains the full adjudication trace — which claims were reviewed, how they were categorized, and what triggered any revisions.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Agent cannot find the agenda | City uses an unsupported or unlisted platform | Provide `pdf` path in `params.json` as a fallback |
| Haystaq returns no results | VPN not connected or credentials not set | Connect WireGuard; add Databricks vars to `scripts/.env` |
| Verification fails for all extracts | Source snapshots not saved by generation agent | Ensure agent wrote to `source_snapshots/` before stopping |
| QA blocks on `high_weight_claims_have_extracts` | Generation agent left `source_extracts` empty for high-weight claims | Return to generation agent — all high-weight claims require verbatim extracts |
| Still blocked after 3 revision iterations | Underlying source doesn't support the claim | Surface the specific claims for human review; consider removing or downgrading them |
| `pdftotext` not found | Tool not installed | `brew install poppler` (macOS) |
