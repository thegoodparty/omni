# Project: Meeting Briefing + QA Spine

## What this is

This document is a session handoff for future agents and human collaborators. It captures what was built, where things are, what's left to do, and what prior art exists.

The `project_files/` directory is context only — it is never committed to either branch.

---

## What was built

Two independent git branches, both forked from `dev` in the `runbooks` repo:

### Branch: `meeting-briefing`

A standalone meeting briefing generator — takes an agenda PDF and produces a structured briefing JSON.

| File | Purpose |
|------|---------|
| `commands/meeting-briefing.md` | Slash-command runbook procedure |
| `scripts/python/generate_meeting_briefing.py` | Two-pass Anthropic generator |
| `scripts/python/briefing_to_pdf.py` | JSON → Markdown renderer |

**How it works:**
1. Extract text from agenda PDF via `pdfplumber`
2. Pass 1 (Anthropic): extract and categorize all agenda items; identify which require votes or major decisions
3. Query Databricks for Haystaq constituent data — agenda-driven (matches hs_* columns to agenda topics, not a fixed list)
4. Pass 2 (Anthropic): generate card content for each priority item, source-grounded
5. Assemble `briefing.json` + `claims.json` + `sources.json`

**Output per run:**
- `briefing.json` — the product (meeting meta, priority issues with detail cards, constituent data)
- `claims.json` — per-claim source extracts (input for qa_validate.py)
- `sources.json` — source registry
- `source_snapshots/agenda_text.txt` — raw extracted PDF text

---

### Branch: `qa-spine`

A runbook-agnostic QA companion. Works with any runbook that produces `briefing.json`, `claims.json`, and `sources.json`.

| File | Purpose |
|------|---------|
| `books/qa-spine.md` | Three-gate companion book |
| `scripts/python/meeting_briefing_product_spec.json` | Single source of truth for all QA rules |
| `scripts/python/qa_init.py` | Pre-hoc output folder scaffolder |
| `scripts/python/qa_validate.py` | Full post-hoc validator |

**How the validator works:**
1. Schema check — required files exist and are valid JSON
2. Deterministic checks — no LLM required; hard blocks and annotations
3. Phase 1 (Anthropic, all claims, parallel) — triage each claim against its source extract using 8 accuracy categories
4. Phase 2 (Gemini, high-weight Phase-1-not-OK claims only, sequential) — independent escalation review
5. Route to Block / OK
6. Write `qa_bundle.json` — consolidated: sources, claims with full adjudication trace, check results, verdict

---

## The two bash commands

After both branches are merged to dev or main:

```bash
cd /path/to/runbooks/scripts/python
uv sync  # install dependencies first time

# Run 1 — no QA
uv run python generate_meeting_briefing.py \
  --pdf ../../project_files/2026-04-16_agenda.pdf \
  --city chapel-hill-NC --date 2026-04-16 \
  --output output/run-no-qa/

# Run 2 — generate then validate
uv run python generate_meeting_briefing.py \
  --pdf ../../project_files/2026-04-16_agenda.pdf \
  --city chapel-hill-NC --date 2026-04-16 \
  --output output/run-with-qa/ && \
uv run python qa_validate.py --output-dir output/run-with-qa/
```

Compare `output/run-no-qa/briefing.json` vs `output/run-with-qa/briefing.json` for content differences. Read `output/run-with-qa/qa_bundle.json` for the full QA trace.

---

## Credentials required

| Key | Location | Used by |
|-----|----------|---------|
| `ANTHROPIC_API_KEY` | `~/Research/.env` | Generation (Pass 1, Pass 2) + Phase 1 adjudication |
| `GEMINI_API_KEY` | `~/Research/.env` | Phase 2 escalation (key label: `gemini-qa-agent`) |
| `DATABRICKS_SERVER_HOSTNAME` | `scripts/.env` | Haystaq constituent data |
| `DATABRICKS_HTTP_PATH` | `scripts/.env` | Haystaq constituent data |
| `DATABRICKS_API_KEY` | `scripts/.env` | Haystaq constituent data |

The generation script loads from both env files automatically. The QA validator only needs the `~/Research/.env` keys.

---

## Prior art — what exists and where

| Location | What it is | Relevance |
|----------|-----------|-----------|
| `remotes/origin/runbook_qa` | Earlier QA spine attempt — `books/qa-protocol.md`, `qa_init.py` (v1), `qa_validate.py` (5 checks only), `books/qa_context/` spec documents | Good reference; the `runbook-qa-spec.md` in `qa_context/` is the most complete prior schema spec |
| `/Users/melecia/Research/meeting_briefings_qa/` | Full working QA Python project for the OLD pipeline — grounding, extraction, adjudication, Block/OK routing, xlsx + md output | Reference only. Claim taxonomy, accuracy categories, and two-phase adjudication model carried forward. Do not import from it. |
| `project_files/deliverable_1_meeting_briefing.md` | Generation rules spec for the meeting briefing product | Non-negotiable generation rules, voice/register constraints, constituent data labeling requirements |
| `project_files/deliverable_2_qa_spine.md` | QA spine design spec — three-gate model, inline extract verification, retry loop, post-hoc audit | Design reference; retry loop and inline second-agent verification not yet implemented |
| `project_files/city-council-member-briefing-copy.md` | Example UI output (legacy) | Shows what output WITHOUT QA might look like; note it violates the voice/register rules intentionally |
| ClickUp doc `2ky4jq2q-70173` | QA-by-Design Spec v1 | Lightweight overview; partially superseded by v2 |
| ClickUp doc `2ky4jq2q-74653` | QA-by-Design Spec v2 | Source allowlist table, conditional rendering rules, MVS guidance |

---

## Known gaps and TODOs

### Meeting briefing
- `# TODO: verify` — Haystaq column discovery is done via LLM semantic matching; accuracy depends on column name clarity. Consider a curated topic→column mapping for the most common meeting topics.
- `# TODO: verify` — The `--city` slug parsing (split on `-`, take first part as city name, last as state) is heuristic. Verify against actual L2 city names before running on new cities.
- `# TODO: verify` — Legistar API integration not implemented. PDF must currently be provided as a local file. Future work: `--url` flag to fetch directly from Legistar.
- `# TODO:` PDF extraction uses `pdfplumber`. Scanned PDFs are halted with an error. OCR fallback (e.g., `pytesseract`) not implemented.
- `# TODO:` The generation prompts produce source-grounded content but do not enforce voice/register rules — that's intentional (QA catches them). If you want QA-constrained generation baked in, the prompts in `generate_meeting_briefing.py` need the voice rules added to `_PASS2_SYSTEM`.
- `# TODO:` No VPN-aware error handling for Databricks connection failures. If WireGuard is down, the script exits with a cryptic Databricks error.

### QA spine
- `# TODO:` Inline extract verification (Gate 2) is not yet implemented as a separate script step. Currently all QA happens post-hoc in `qa_validate.py`. The deliverable_2 spec describes a retry loop with the generation agent — that would require integrating qa_validate into the generation script.
- `# TODO:` The `--no-llm` deterministic-only mode is implemented but not documented with examples in `qa-spine.md`.
- `# TODO:` Source bibliography credibility check (from deliverable_2) not implemented — would assess whether cited sources are reputable.
- `# TODO:` Quality rubric scoring (from deliverable_2, 7 dimensions) not implemented. Currently only Block/OK routing exists.
- `# TODO:` The product spec supports passing a custom `--product-spec` path to `qa_validate.py`, enabling the QA spine to work with other product types. No second product spec exists yet. To add one: create a new JSON following the same schema and pass `--product-spec path/to/new_spec.json`.

### Both
- `# TODO:` `uv.lock` not updated after adding `anthropic`, `pdfplumber`, `pydantic`, `google-generativeai` to `pyproject.toml`. Run `uv sync` before first use.
- `# TODO:` No tests written for either branch.

---

## What a future agent should do first

1. Read `books/INDEX.md` to orient (as always)
2. Read this file
3. Check out the branch you're working on (`meeting-briefing` or `qa-spine`)
4. Run `uv sync` in `scripts/python/` to install dependencies
5. Run the two bash commands above against `project_files/2026-04-16_agenda.pdf` to see live output
6. Review the outputs and compare before making any changes

If continuing QA work: the highest-value next step is implementing inline extract verification (Gate 2) and wiring it into the generation script so the two runs truly differ at generation time, not just at validation time.

If continuing meeting-briefing work: the highest-value next step is verifying the Haystaq column matching against a real agenda PDF and testing with multiple city slugs.
