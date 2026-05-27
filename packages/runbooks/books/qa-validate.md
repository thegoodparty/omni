Validate a qa-spine-compliant artifact JSON against the QA protocol and write `qa_bundle.json` with a `release_verdict`.

## Prerequisites

**scripts/.env variables** (only required when running with LLM stages enabled):
- `ANTHROPIC_API_KEY` — Phase 1 triage judge
- `QA_JUDGES` — judge registry, e.g. `claude:anthropic:claude-sonnet-4-6,opus:anthropic:claude-opus-4-7`. Names must match the spec's `judges.phase1` / `judges.phase2`.
- Provider-specific keys referenced by `QA_JUDGES` (e.g. `gemini-qa-agent` for the Google provider — note the lowercase-hyphenated literal env var name).

**Tools**: `uv` (Python dependency manager). All deps are declared in `scripts/python/pyproject.toml`.

**Input contract**: a single artifact JSON with a top-level `claims[]` array (each carrying `claim_id`, `claim_text`, `claim_type`, `claim_weight`, `source_ids`, `source_extracts`) and a top-level `sources[]` array (each with `id`, `source_type`, `retrieved_text_or_snapshot`). Product-specific rules — identity fields, priority filters, prohibited phrases, claim types, completeness thresholds, polish patterns, judge names → providers/models — live in a `<product>_product_spec.json`, not in the script.

## Steps

1. From `scripts/python/`, run the validator against an artifact:

   ```
   uv run python qa_validate.py path/to/artifact.json
   ```

2. The script runs in four stages:
   - Load artifact (file present and valid JSON).
   - Deterministic checks (rule-based, no LLM).
   - Phase 1 LLM triage of every claim (uses `judges.phase1` from the product spec).
   - Phase 2 LLM escalation of high-weight Phase-1-not-OK claims only (uses `judges.phase2`).

3. Read the result from `qa_bundle.json` written next to the artifact (or wherever `--bundle-out` points). Top-level field `release_verdict` is one of `ok`, `warn`, `block`. Per-check detail is in `deterministic_checks[]`; per-claim verdicts are in `claims[]`.

## Common invocations

Deterministic only (skip LLM stages — cheap and offline):

```
uv run python qa_validate.py path/to/artifact.json --no-llm
```

Different product spec (default is `meeting_briefing_product_spec.json` in the same directory as the script):

```
uv run python qa_validate.py path/to/artifact.json --product-spec path/to/other_product_spec.json
```

Custom bundle output path:

```
uv run python qa_validate.py path/to/artifact.json --bundle-out /tmp/qa_bundle.json
```

Enforce verdict — exit non-zero when not `ok`:

```
uv run python qa_validate.py path/to/artifact.json --enforce-verdict
```

## Exit codes

By default the script always exits `0` so callers can read the verdict from `qa_bundle.json` and decide policy themselves. With `--enforce-verdict`:

| release_verdict | exit code |
|---|---|
| `ok` | 0 |
| `warn` | 1 |
| `block` | 2 |

## Adding a new product

Write a new `<product>_product_spec.json` next to the existing one. The spec declares: identity fields, priority filter, prohibited phrases + JSONPath paths, claim types + blockable routing, accuracy categories, completeness thresholds, polish patterns, and `judges.phase1` / `judges.phase2` names that resolve through `QA_JUDGES`. No Python changes are required.

## Troubleshooting

`Phase 1 skipped — judge '<name>' unavailable` → either the judge name in the product spec is not present in `QA_JUDGES`, or the provider's API key env var is not set in `scripts/.env`.

`HALT: Artifact not loadable` → file path is wrong or the JSON is malformed; the bundle is still written with `release_verdict: block` and the offending check populated.

Deterministic warning on `completeness_floor` with a thin artifact → expected on placeholder artifacts (`awaiting_agenda` / `no_meeting_found` / `error` paths) that legitimately have no priority items.
