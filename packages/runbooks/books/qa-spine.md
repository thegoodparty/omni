Runbook-agnostic QA companion. Invoke alongside any runbook that generates an intelligence product to get a structured audit trail and a Block/OK delivery verdict.

## When to invoke

Invoke this book in addition to the primary task runbook whenever a run:

- generates a briefing, memo, report, or structured output intended for delivery
- synthesizes intelligence from multiple sources
- produces factual claims that may be acted on by a person

Do not invoke for one-off queries, dashboards, or operational tasks that produce no durable artifact.

## What this produces

Running the QA scripts against a generation output produces:

| File | Description |
|------|-------------|
| `qa_bundle.json` | Full audit trace: sources, claims with per-claim adjudication, deterministic check results, final Block/OK verdict |

## Prerequisites

**~/Research/.env variables**: `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`
**Tools**: `uv`
**Input**: An `output/` directory produced by a QA-enabled runbook (must contain `briefing.json`, `claims.json`, `sources.json`, `source_snapshots/`)

## How it works — three gates

```
pre-hoc → [generation] → post-hoc
                ↑
           inline checks
           (during generation)
```

### Gate 1: Pre-hoc (before generation)

Run `qa_init.py` to scaffold the output folder before the generation run begins. This creates stub files that the generator populates during the run.

```bash
cd "$RUNBOOKS_DIR/scripts/python"
uv run python qa_init.py \
  --product-id <city>_<date> \
  --briefing-type meeting_briefing \
  --output-dir output/<run>/
```

Pre-hoc intent: confirm the pipeline has what it needs before investing in generation. If required inputs are absent, stop here.

### Gate 2: Inline (during generation)

Inline QA is embedded in the generation runbook itself. The runbook is responsible for:

- Capturing every source accessed in `sources.json`
- Capturing every factual claim made in `claims.json`, each with:
  - `claim_type` (see product spec for valid types)
  - `claim_weight` (`high`, `medium`, or `low`)
  - `citation_ids` — which sources support this claim
  - `source_extracts` — verbatim text from the source

Without these intermediate artifacts, post-hoc QA cannot adjudicate. The generation runbook must emit them.

### Gate 3: Post-hoc (after generation)

Run `qa_validate.py` against the completed output directory:

```bash
cd "$RUNBOOKS_DIR/scripts/python"
uv run python qa_validate.py --output-dir output/<run>/
```

This runs four ordered stages:

1. **Schema** — required files exist and are valid JSON
2. **Deterministic** — rule-based checks with no LLM required
3. **Phase 1** (Anthropic) — triage all claims; classify accuracy using 8 categories
4. **Phase 2** (Gemini) — escalate high-weight Phase-1-not-OK claims only; independent second opinion

Final verdict written to `qa_bundle.json`:

| Status | Meaning |
|--------|---------|
| `OK` | All deterministic checks passed; no high-weight claim failed Phase 2 |
| `Block` | A hard deterministic check failed, or a high-weight claim was not supported after Phase 2 |

To run deterministic checks only (no LLM calls):

```bash
uv run python qa_validate.py --output-dir output/<run>/ --no-llm
```

## Accuracy categories

Eight categories apply across both Phase 1 and Phase 2:

| Category | OK for delivery? |
|----------|-----------------|
| Accurate | yes |
| Directionally Consistent | yes |
| Extrapolating | yes |
| Modeled | yes |
| Not in Source — Verified Elsewhere | no |
| Not in Source — Unresolved | no |
| Incorrect | no |
| Unverifiable | no |

A claim classified not-OK by Phase 1 only → annotation (does not block delivery).
A high-weight claim classified not-OK by Phase 2 → Block.

## Product spec — the single source of truth

QA rules live in `scripts/python/meeting_briefing_product_spec.json`. This file defines:

- Which claim types exist and their weights
- Which claim types are blockable (trigger Block if Phase 2 fails)
- Which deterministic checks run and their routing

To add a new blockable claim type, change a routing rule, or add a prohibited phrase:
**edit `meeting_briefing_product_spec.json` only**. `qa_validate.py` reads it at runtime.

To apply this QA spine to a different product type: create a new product spec JSON and pass it via `--product-spec`.

## Comparing QA and non-QA runs

To see how QA changes a briefing, run the generator twice into separate output directories, then run QA only on the second:

```bash
# Run 1 — no QA
uv run python generate_meeting_briefing.py --pdf agenda.pdf \
  --city chapel-hill-NC --date 2026-04-16 \
  --output output/run-no-qa/

# Run 2 — generate independently, then validate
uv run python generate_meeting_briefing.py --pdf agenda.pdf \
  --city chapel-hill-NC --date 2026-04-16 \
  --output output/run-with-qa/ && \
uv run python qa_validate.py --output-dir output/run-with-qa/
```

Compare `output/run-no-qa/briefing.json` and `output/run-with-qa/briefing.json` to see content differences. Read `output/run-with-qa/qa_bundle.json` to understand what QA found, flagged, or would have blocked.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Required files missing — cannot continue` | Generator did not produce `briefing.json`, `claims.json`, or `sources.json` | Check that the generation runbook ran to completion |
| `ANTHROPIC_API_KEY not set` | Missing env var | Add to `~/Research/.env` |
| `GEMINI_API_KEY not set` | Missing env var | Add `GEMINI_API_KEY=AIza...` to `~/Research/.env` |
| Phase 2 skipped but high-weight claims need escalation | Gemini key missing | Set `GEMINI_API_KEY` or accept Phase 1-only adjudication |
| All claims classified Unverifiable | Source extracts are empty in `claims.json` | Generator did not capture verbatim extracts; check generation runbook |
| Block on `prohibited_phrases` | Directive voice in briefing text (e.g. "Push for", "Ensure that") | This is an annotation, not a Block — check `route_if_fail` in product spec |
