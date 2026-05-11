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

### Gate 2: Inline verification (after generation, before post-hoc)

Gate 2 runs a separate verification agent against the generation output. This agent did not write the briefing and has no stake in it passing.

**Why a separate agent:** The generation agent has an inherent bias toward believing its own extracts are correct. An independent agent catching hallucinated or misattributed quotes before they reach Gate 3 is a fundamentally different check than self-verification.

**What the verification agent checks:** For every entry in `claims.json` that has a `source_extracts` array, the agent confirms the quoted text appears verbatim (or near-verbatim, allowing for OCR noise) in the cited source document at the cited `source_id`. It writes `verification_report.json` with a pass/fail/skip result per extract.

**How to run it:** Spawn an agent with `books/qa-spine-inline-verify.md` as its instruction and the generation output directory as its workspace.

**What happens on failures:** Return the failed claim IDs to the generation agent. The generation agent must find correct sources or remove those claims. Re-run verification until all extracts pass before proceeding to Gate 3.

**What the generation runbook must emit for Gate 2 to work:**

- `sources.json` — every source accessed, with a `source_id`
- `claims.json` — every factual claim, each with:
  - `claim_type` (see product spec for valid types)
  - `claim_weight` (`high`, `medium`, or `low`)
  - `citation_ids` — which `source_id`s support this claim
  - `source_extracts` — verbatim text from the source document
- `source_snapshots/{source_id}.txt` — plain-text snapshot of each source document

Without `source_snapshots/`, the verification agent cannot check extracts against local copies and must fall back to fetching live URLs, which may be slower or unavailable.

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

Each product type requires a product spec JSON that defines:

- Which claim types exist and their weights (`high`, `medium`, `low`)
- Which claim types are blockable (trigger Block if Phase 2 fails)
- Which deterministic checks run and their routing

Pass it to `qa_validate.py` at runtime:

```bash
uv run python qa_validate.py --output-dir output/<run>/ --product-spec path/to/your_spec.json
```

To add a new blockable claim type, change a routing rule, or add a prohibited phrase: **edit the product spec JSON only**. `qa_validate.py` reads it at runtime — no code changes required.

`scripts/python/meeting_briefing_product_spec.json` (on the `meeting-briefing` branch) is a reference implementation showing the full schema.

## Comparing QA and non-QA runs

Run the generation runbook twice into separate numbered output directories. Apply the full QA pipeline only to the second run.

```
output1_{city}_{date}/   ← generation only, no QA
output2_{city}_{date}/   ← generation + Gate 2 verification + Gate 3 validation
```

To diff the rendered briefings:

```bash
diff output1_{city}_{date}/briefing.md output2_{city}_{date}/briefing.md
```

Read `output2_{city}_{date}/qa_bundle.json` for the full adjudication trace — which claims were reviewed, how they were categorized, and what triggered any revisions.

## Design decisions

**Two-state routing only.** The final verdict is Block or OK. Routing logic lives in `qa_validate.py`'s `route()` function; rules live in the product spec JSON.

**Phase 1 runs on all claims. Phase 2 runs only on high-weight Phase-1-not-OK claims.** Phase 2 is expensive and sequential; limiting it to escalations keeps runtime reasonable.

**Prohibited phrases are annotated, not blocked.** Voice and register violations produce annotations in `qa_bundle.json` but do not trigger Block. The blocked set is limited to structural failures and unsupported high-weight factual claims.

**Gate 2 is the anti-hallucination layer.** Phase 1 and Phase 2 ask whether a claim follows from its extract. Gate 2 asks whether the extract itself is real. These are different questions and require different agents.

**The Gate 2 agent must be naive.** Spawn it fresh with no context from the generation session. An agent that helped write the claims will not reliably catch its own hallucinations. Naivety is a design requirement, not a convenience.

**The product spec is the single source of truth for QA rules.** Do not hardcode claim types, weights, or routing logic in Python — edit the JSON. This keeps `qa_validate.py` product-agnostic.

## Extending to a new product type

1. Create a new product spec JSON following the same schema as `meeting_briefing_product_spec.json` (see `meeting-briefing` branch for reference)
2. Pass it to `qa_validate.py` via `--product-spec path/to/new_spec.json`
3. Ensure the generation runbook emits the standard output contract: `briefing.json`, `claims.json`, `sources.json`, `source_snapshots/`

No changes to `qa_validate.py` or `qa-spine.md` are required unless you need new check logic.

## Known gaps and cleanup debt

These are DRY violations and hardcoded values to address before this is production-ready. Each represents a place where the same information is defined in more than one location, or where config that should live in the product spec is instead baked into Python.

**TODO: Centralize accuracy categories in the product spec**
The 8 accuracy category names are currently defined in four places: as a `Literal` type in `_AdjudicationOutput`, inline in `_TRIAGE_SYSTEM`, inline in `_ESCALATION_SYSTEM`, and as a hardcoded set in `phase1_triage()`. The product spec already has an `accuracy_categories.ok` field -- the Python should build its types and prompts from that at runtime rather than duplicating the list. Changing a category name currently requires four edits.

**TODO: Fix ok_cats inconsistency between Phase 1 and Phase 2**
`phase1_triage()` has its own hardcoded ok_cats set (`{"Accurate", "Directionally Consistent", "Extrapolating", "Modeled"}`). `phase2_escalate()` receives ok_cats from the product spec via `main()`. They are reading from different sources. Phase 1 should use the same spec-derived ok_cats as Phase 2.

**TODO: Move prohibited phrases to the product spec**
`_PROHIBITED_PATTERNS` is a hardcoded list in `qa_validate.py`. The design principle is that all QA rules live in the product spec -- prohibited phrases should move there so they can be changed without a Python edit.

**TODO: Remove hardcoded `briefing_type` from `write_bundle()`**
`"briefing_type": "meeting_briefing"` is a string literal in the output writer. It should come from the product spec so the QA spine is genuinely product-agnostic in its output.

**TODO: Make `--product-spec` required**
`load_product_spec()` defaults to `meeting_briefing_product_spec.json` in the script directory. That file does not exist on this branch. The default will silently error. Either require `--product-spec` explicitly or fail with a clear message when no spec is provided and no default is found.

**TODO: Drive deterministic check routing from the product spec**
Check severity and route values (`"block"`, `"annotate"`, `"pass"`) are hardcoded per check in `run_deterministic()`. The product spec should declare which checks are active, their severity, and their routing -- so adapting to a new product type requires only a spec change, not a Python edit.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Required files missing — cannot continue` | Generator did not produce `briefing.json`, `claims.json`, or `sources.json` | Check that the generation runbook ran to completion |
| `ANTHROPIC_API_KEY not set` | Missing env var | Add to `~/Research/.env` |
| `GEMINI_API_KEY not set` | Missing env var | Add `GEMINI_API_KEY=AIza...` to `~/Research/.env` |
| Phase 2 skipped but high-weight claims need escalation | Gemini key missing | Set `GEMINI_API_KEY` or accept Phase 1-only adjudication |
| All claims classified Unverifiable | Source extracts are empty in `claims.json` | Generator did not capture verbatim extracts; check generation runbook |
| Block on `prohibited_phrases` | Directive voice in briefing text (e.g. "Push for", "Ensure that") | This is an annotation, not a Block — check `route_if_fail` in product spec |
