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

**Gate 2 agent must be naive.** The verification agent is spawned fresh with no context from the generation session. An agent that helped write the claims will not reliably catch its own hallucinations. Naivety is not a convenience — it is a design requirement.

## Experiment results (as of 2026-05-10)

Two experiments run against the Alvin TX April 16 2026 agenda:

- **exp2_qa** (generation + QA, with meeting-briefing merged): 5 priority items, 23 claims. Gate 2: 25 passed / 1 failed (colon inserted in section heading — OCR formatting artifact, not fabrication). Gate 3: **OK**, 0 blocked, 1 annotated. Haystaq not used — credentials not resolving at run time (now fixed).
- **exp1_qa** (earlier run, old architecture): BLOCK verdict — this was the Python-scripted LLM pipeline, now replaced.

## How to extend to a new product type

1. Create a new product spec JSON following the same schema as `meeting_briefing_product_spec.json`
2. Pass it to `qa_validate.py` via `--product-spec path/to/new_spec.json`
3. Ensure the generation runbook emits the standard output contract

No changes to `qa_validate.py` or `qa-spine.md` are required unless you need new check logic.

## Scripts

| Script | What it does |
|--------|-------------|
| `scripts/python/qa_init.py` | Scaffolds output/ with stub artifact files before a generation run |
| `scripts/python/qa_validate.py` | Post-hoc validation: schema → deterministic → Phase 1 → Phase 2 → Block/OK → qa_bundle.json |
| `scripts/python/meeting_briefing_product_spec.json` | QA rules for the meeting briefing product type |

## How the QA spine maps to production (PMF experiments)

The three-gate model does not map directly to the PMF engine's single-agent-per-dispatch model. Here is how each option scales from simplest to most complete.

**Option 1 — In-instruction self-check (supported today, no PMF changes needed)**

The generation agent verifies its own source extracts before writing the artifact — checks each `source_extracts[].text` against the raw text it pulled from the PDF. This is Gate 2 lite. The tradeoff: the same agent that wrote the claim checks the claim. Bias exists. It catches obvious errors but not subtle hallucinations.

Combined with a tight `output_schema` in `manifest.json` and the runner-injected `validate_output.py`, this gives deterministic structural QA (Gate 3 equivalent) plus light self-verification (Gate 2 lite). It is the right starting point.

**Option 2 — Two-experiment chain (Gate 2 + Phase 1 adjudication, no new PMF infrastructure)**

A second experiment — `meeting_briefing_qa` — takes the generation artifact's S3 key as an input param and runs independently:

```
Dispatch: meeting_briefing  →  artifact.json lands in S3
         ↓  gp-api passes artifact S3 key as param
Dispatch: meeting_briefing_qa  →  qa_verdict.json lands in S3
         ↓  dashboard only renders if verdict = OK
```

The QA agent fetches the briefing artifact, fetches the source document (agenda PDF URL is embedded in the artifact's sources), checks each verbatim extract against the source text, runs LLM adjudication on flagged claims, and writes a Block/OK verdict artifact. This is genuine Gate 2 + Phase 1, with a truly separate naive agent. Phase 2 (Gemini escalation) can be a third experiment in the chain, dispatched only when Phase 1 flags high-weight failures.

The missing piece: gp-api needs to chain dispatches — dispatch meeting_briefing, wait for artifact, dispatch meeting_briefing_qa with the artifact key. That is a gp-api feature, not a PMF engine change.

**Option 3 — Native `validates` relationship in PMF manifest (ideal, requires PMF engine work)**

The manifest declares a validation dependency:

```json
{
  "id": "meeting_briefing_qa",
  "validates": "meeting_briefing",
  "trigger": "on_artifact"
}
```

The dispatch Lambda auto-chains: when `meeting_briefing` writes its artifact, Lambda dispatches `meeting_briefing_qa` automatically. The dashboard renderer checks the QA verdict before showing the briefing tab — Block hides the tab or shows a "briefing unavailable" state. This is the cleanest architecture and requires no gp-api orchestration logic, but it needs PMF engine support that does not currently exist.

**Practical recommendation**

Ship generation first. Prove the output is reliable and the anatomy is correct. Then add Option 2 (two-experiment chain) — it preserves the separate-agent principle, requires no PMF engine changes, and only needs a modest gp-api addition. Option 3 is the right long-term target once the chain is proven.

The QA spine as built locally is the reference design for the `meeting_briefing_qa` experiment instruction. It is not wasted work — it is the spec.

## What's not yet built

- `# TODO:` Fix `briefing_to_pdf.py` to render talking points and action items — these are in the JSON but not rendered (meeting-briefing branch concern, but blocks exp3 output quality)
- `# TODO:` Targeted repair instructions — when Block is triggered, `qa_bundle.json` explains why but does not produce a machine-actionable repair prompt
- `# TODO:` Source bibliography credibility check — assessing whether cited sources are reputable. Designed but not implemented.
- `# TODO:` Quality rubric scoring — multi-dimension quality scoring beyond Block/OK. Not yet wired into `qa_validate.py`.
- `# TODO:` Second product spec — `meeting_briefing_product_spec.json` is the only spec so far. The architecture supports additional product types via `--product-spec`.
- `# TODO:` `meeting_briefing_qa` PMF experiment — translate the QA spine into an experiment manifest + instruction for production use.
