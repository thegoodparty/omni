# QA Spine — Context for Agents and Contributors

This file provides context for working on the QA spine. It supplements the root `CLAUDE.md`, which governs all repo-wide conventions.

## What the QA spine is

`books/qa-spine.md` is a runbook-agnostic QA companion. Any runbook that generates an intelligence product (briefing, memo, report) can invoke it to get a structured audit trail and a Block/OK delivery verdict.

It is not specific to any one product type. It works with any runbook that emits the standard output contract: `briefing.json`, `claims.json`, `sources.json`, `source_snapshots/`.

## Architecture

The QA spine has three gates:

**Gate 1 — Pre-hoc (`qa_init.py`):** Scaffolds the output directory with stub files before the generation run begins. Ensures the folder structure is correct before anything is written.

**Gate 2 — Inline (verification agent):** A separate agent — not the generation agent — independently confirms that every source extract in `claims.json` actually appears verbatim in the cited source document. This runs after generation and before post-hoc validation. If a quote is hallucinated or misattributed, it is caught here.

**Gate 3 — Post-hoc (`qa_validate.py`):** Full validation after generation and inline verification are complete. Runs in four stages: schema check → deterministic rules → Phase 1 LLM adjudication (all claims) → Phase 2 LLM escalation (high-weight failures only). Produces a Block/OK verdict and writes `qa_bundle.json`.

## Key design decisions

**Two-state routing only.** The final verdict is Block or OK. A four-state model was considered and explicitly deferred. Routing logic lives in `qa_validate.py`'s `route()` function; rules live in the product spec JSON.

**Product spec is the single source of truth.** The product spec JSON defines claim types, weights, the blockable set, and deterministic check routing. `qa_validate.py` reads it at runtime via `--product-spec`. Do not hardcode QA rules in Python — edit the JSON.

**Phase 1 runs on all claims. Phase 2 runs only on high-weight Phase-1-not-OK claims.** Phase 2 is expensive and sequential; limiting it to escalations keeps runtime reasonable.

**Prohibited phrases are annotated, not blocked.** Voice/register violations produce annotations in `qa_bundle.json` but do not trigger Block. The blocked set is limited to structural failures and unsupported high-weight factual claims.

**Gate 2 (inline verification) is the anti-hallucination layer.** Phase 1 and Phase 2 ask whether a claim follows from its extract. Gate 2 asks whether the extract itself is real. These are different questions and require different agents.

## How to extend to a new product type

1. Create a new product spec JSON following the same schema as an existing spec
2. Pass it to `qa_validate.py` via `--product-spec path/to/new_spec.json`
3. Ensure the generation runbook emits the standard output contract

No changes to `qa_validate.py` or `qa-spine.md` are required unless you need new check logic.

## Scripts

| Script | What it does |
|--------|-------------|
| `scripts/python/qa_init.py` | Scaffolds output/ with stub artifact files before a generation run |
| `scripts/python/qa_validate.py` | Post-hoc validation: schema → deterministic → Phase 1 → Phase 2 → Block/OK → qa_bundle.json |
| `scripts/python/meeting_briefing_product_spec.json` | QA rules for the meeting briefing product type |

## What's not yet built

- **Targeted repair instructions** — when Block is triggered, `qa_bundle.json` explains why but does not produce a machine-actionable repair prompt. A natural next step once the full QA loop is stable.
- **Source bibliography credibility check** — assessing whether cited sources are reputable. Designed but not implemented.
- **Quality rubric scoring** — multi-dimension quality scoring beyond Block/OK. Not yet wired into `qa_validate.py`.
- **Second product spec** — `meeting_briefing_product_spec.json` is the only spec so far. The architecture supports additional product types via `--product-spec`.
