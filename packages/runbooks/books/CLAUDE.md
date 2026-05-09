# QA Spine — Context for Agents and Contributors

This file provides context for working on the QA spine feature. It supplements the root `CLAUDE.md`, which governs all repo-wide conventions.

## What the QA spine is

`books/qa-spine.md` is a runbook-agnostic QA companion. Any runbook that generates an intelligence product (briefing, memo, report) can invoke it to get a structured audit trail and a Block/OK delivery verdict.

It is NOT specific to the meeting briefing. It is designed to work with any product type that emits the standard output contract: `briefing.json`, `claims.json`, `sources.json`, `source_snapshots/`.

## Key design decisions

**Two-state routing only.** The final verdict is Block or OK. A four-state model (pass / regenerate / human_review / block_release) was considered and explicitly deferred. If you extend this later, the routing logic lives in `qa_validate.py`'s `route()` function and the rules in `meeting_briefing_product_spec.json`.

**Product spec is the single source of truth.** `scripts/python/meeting_briefing_product_spec.json` defines claim types, weights, blockable set, and deterministic check routing. `qa_validate.py` reads it at runtime. Do not hardcode QA rules in Python — edit the JSON.

**Phase 1 (Anthropic) runs on all claims. Phase 2 (Gemini) runs only on high-weight Phase-1-not-OK claims.** This is intentional. Phase 2 is expensive and sequential; limiting it to escalations keeps runtime reasonable.

**Prohibited phrases are not blockable.** Voice/register violations (imperative language, directive phrasing) produce annotations in `qa_bundle.json` but do not trigger Block. The blocked set is restricted to structural failures and unsupported high-weight factual claims.

## How to extend to a new product type

1. Create a new product spec JSON following the same schema as `meeting_briefing_product_spec.json`
2. Pass it to `qa_validate.py` via `--product-spec path/to/new_spec.json`
3. Ensure the generation runbook for the new product emits the standard output contract

No changes to `qa_validate.py` or `qa-spine.md` are required for a new product type unless you need new check logic.

## What's not yet built

- **Inline extract verification (Gate 2)** — the deliverable_2 spec describes a retry loop where the generation agent re-extracts on failure, verified by a second agent before the claim enters the output. Currently all QA happens post-hoc. Implementing Gate 2 requires integrating `qa_validate.py` into the generation script.
- **Source bibliography credibility check** — assessing whether cited sources are reputable primary sources. Designed in the spec but not implemented.
- **Quality rubric scoring** — 7-dimension scoring (Relevance, Accuracy, Grounding, Actionability, Specificity, Risk Control, Product Fit). The prior experiment QA book (`generation-integrity-protocol.md` on the `runbook_qa` branch) has a rubric design. Not yet wired into `qa_validate.py`.
- **Targeted repair instructions** — when Block is triggered, `qa_bundle.json` explains why but does not produce a machine-actionable repair prompt for the generation agent. The spec describes this pattern; it's a natural next step after inline verification is working.

## Scripts

| Script | What it does |
|--------|-------------|
| `scripts/python/qa_init.py` | Scaffolds output/ with stubs before a generation run |
| `scripts/python/qa_validate.py` | Full post-hoc validation: schema → deterministic → Phase 1 → Phase 2 → route → qa_bundle.json |
| `scripts/python/meeting_briefing_product_spec.json` | All QA rules for the meeting briefing product type |

## Prior art to read before changing anything

- `books/qa_context/runbook-qa-spec.md` (on the `runbook_qa` branch) — the most complete schema spec for the QA system; all major design decisions trace back here
- `/Users/melecia/Research/meeting_briefings_qa/` — a fully implemented QA project for the old pipeline; the claim taxonomy, accuracy categories, and two-phase adjudication model were carried forward from here
- ClickUp doc `2ky4jq2q-74653` (QA-by-Design Spec v2) — source allowlist table, conditional rendering rules, MVS guidance
