# Meeting Briefing — Context for Agents and Contributors

This file provides context for working on the meeting briefing feature. It supplements the root `CLAUDE.md`, which governs all repo-wide conventions.

## What the meeting briefing command does

`commands/meeting-briefing.md` is a slash-command runbook procedure that produces a structured meeting briefing from a city council or municipal agenda PDF. It is a GoodParty product — the output is intended for elected officials preparing for a meeting.

The runbook drives `scripts/python/generate_meeting_briefing.py`, which is a standalone Python script. The runbook is what an agent reads and follows; the script is what actually runs.

## Generation flow

```
agenda PDF
    ↓ pdfplumber text extraction
source_snapshots/agenda_text.txt
    ↓ Pass 1 — Anthropic
categorized agenda items (all items, priority flagged)
    ↓ Databricks — Haystaq
constituent alignment scores for relevant topics
    ↓ Pass 2 — Anthropic (per priority item)
card content with source citations
    ↓ assembly
briefing.json + claims.json + sources.json
```

## Key design decisions

**Agenda-driven Haystaq queries.** The script does not use a fixed list of Haystaq columns. It discovers which `hs_*` columns are semantically relevant to each agenda topic by asking the LLM to match. This means the constituent data is always scoped to what's actually on the agenda — but it also means the LLM can make poor matches. See TODOs below.

**City-wide constituent scope by default.** Haystaq data is queried at the city level (`Residence_Addresses_City` + `Residence_Addresses_State`). District-level data is not yet implemented but the architecture supports it — add a `--district-type` and `--district-name` flag and add those fields to the WHERE clause in `query_haystaq()`.

**The generation prompts are intentionally permissive.** `_PASS2_SYSTEM` in `generate_meeting_briefing.py` does not enforce voice/register rules (no imperative voice, no prohibited phrases). That enforcement is the job of the QA spine (`books/qa-spine.md`). This is by design: running without QA lets you see what the model produces naturally; running with QA shows what gets flagged. Do not add voice rules to the generation prompts unless you want to collapse that distinction.

**Source discipline is enforced.** Despite the above, `_PASS2_SYSTEM` does enforce source discipline — every claim must trace to the agenda text, identity fields must be copied exactly, inference must be labeled. If you loosen these rules, the QA claim coverage will drop and `claims.json` will be less useful for adjudication.

## Output schema

`briefing.json` follows the schema defined in `meeting_briefing_spec.py` in the `meeting_briefings_qa` prior project (`/Users/melecia/Research/meeting_briefings_qa/qa/inputs/meeting_briefing_spec.py`). Key fields:

```
meeting.title, meeting.date, meeting.citySlug, meeting.body, meeting.time
executiveSummary.totalAgendaItems, executiveSummary.priorityItemCount
priorityIssues[].agendaItemTitle, .detail.{whatIsHappening, whatDecision, whyItMatters, budgetImpact, whoIsPresenting}
priorityIssues[].sourceCitations[].{field, quote}
priorityIssues[].constituentSentiment.{available, issue_label, aligned_voter_percentage, provenance_note}
constituentData.{available, voter_count, top_issues[]}
sources[]
```

`claims.json` and `sources.json` are the intermediate files consumed by `qa_validate.py` when the QA spine is invoked. The generation script always produces them so that QA can be run at any time after generation.

## What's not yet built

- `# TODO:` Legistar API integration. PDF must currently be provided as a local file (`--pdf` flag). To add URL-based fetching: add a `--url` flag, download the PDF with `requests`, and pass the local path to `extract_pdf_text()`.
- `# TODO:` OCR fallback for scanned PDFs. `pdfplumber` returns empty text for image-only PDFs; the script halts. Adding `pytesseract` as a fallback would handle scanned agendas.
- `# TODO:` The Haystaq city name parsing (`city.split("-")[0]`) is heuristic and will break for multi-word city names like `chapel-hill-NC`. Validate against the L2 voter file before querying: `SELECT DISTINCT Residence_Addresses_City FROM ... WHERE Residence_Addresses_State = 'NC'`.
- `# TODO:` No VPN check before Databricks queries. A cryptic connection error is the current failure mode when WireGuard is down.
- `# TODO:` No tests. Priority areas to test: PDF extraction halt behavior, Haystaq fallback when credentials are absent, Pass 1 structured output parsing.
- `# TODO:` The constituent sentiment block in `priorityIssues[]` matches Haystaq issues to agenda items by keyword overlap — a heuristic that can miss matches or produce false ones. A more robust approach would pass the full Haystaq match results forward from `query_haystaq()` instead of re-matching per item at assembly time.

## Prior art

- `project_files/deliverable_1_meeting_briefing.md` — generation rules spec; all non-negotiable constraints
- `project_files/city-council-member-briefing-copy.md` — legacy UI output example; shows what generation WITHOUT QA might produce (imperative voice, etc.)
- `/Users/melecia/Research/meeting_briefings_qa/scripts/generate_briefing.py` — prior three-pass generation script (depends on old pipeline, not usable standalone); useful for reference on how Pass 1/2/3 were structured
- `books/find-district-issue-pulse.md` and `books/find-district-issue-snapshot.md` — patterns for Haystaq queries reused in `generate_meeting_briefing.py`
