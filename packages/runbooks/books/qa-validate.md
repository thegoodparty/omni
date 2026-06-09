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
   - Deterministic checks (rule-based, no LLM) — Layer-1 schema validation first, then the claim/source family (see "Routing backbone" below).
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

## Routing backbone (config-driven)

The spine routes validation by artifact shape and runs a set of config-driven checks. All mechanisms are generic; a product opts in purely through its `<product>_product_spec.json`.

- `output_format.type` — declares the artifact shape (`structured_json`, `inline_cited_prose`). The spine maps the type to which validation families run. A missing or unrecognized type routes to the strictest known type and emits an `output_format_routing` warning (never a silent skip).
- `output_format.schema` (`manifest_path`, `schema_key`) — when present, **Layer-1 `schema_validation`** runs the artifact through the named manifest's `output_schema` (jsonschema draft-07) **before any other check** and warns on shape drift (staged; will be promoted to block once briefings are confirmed to conform). Absent schema, unreadable manifest, or missing `jsonschema` → skip-with-warning. Invalid JSON is caught at load and never reaches Layer 1, so there is no double-penalty.
- `output_format.inline_citation_pattern` — regex the generic inline-citation extractor uses to pull bracketed citation tokens out of prose.
- `structured_validators` — per-`claim_type` `{kind, rounding_tolerance}`. The `numeric_review_flag` check flags any high-weight claim whose `claim_text` contains a digit, so the judge must verify the figure against the cited extracts. Detection is high-recall and does NOT depend on these validators or on a correct `claim_type`: figures the precise extractors miss (`$.05`, a bare table value), and numeric claims misclassified into a non-numeric type, are still flagged. The validators' extractors run only to LABEL the flag — pulling the raw stated figures (`money`, `date`, `vote_count`, `legal_citation`, `percentage`; `name` is excluded as non-numeric) into the judge prompt so the judge confirms specific values rather than re-finding them. Detection only — it never matches values and never blocks (route `diagnostic`); a wrong figure blocks only via the judge verdict. `rounding_tolerance` is unused (kept for config compatibility).
- `source_hierarchy` — `claim_type → allowed source_types`. `source_hierarchy_policy` flags claims citing a disallowed source type (block when high-weight, annotate otherwise). A `claim_type` with **no** entry yields a non-blocking `diagnostic` surfacing the policy gap (not a block, not silent-allow).
- `embedding_rescue_blocklist` — deny-list of `claim_type`s for which the `summary_source_coherence` embedding rescue is refused (numbers, dates, names, vote counts, legal citations, allegations). A type absent from the list stays rescuable.
- `completeness.field_paths` — `completeness_floor` walks these spec-declared paths (`lead_in_path`, `exec_summary_overview_paths`, `priority_item_overview_field`, `total_prose_paths`) instead of hard-coded field names. No declared overview paths → skip-with-warning; declared paths that resolve empty while priority items exist → reported as a missing required field (no silent undercount).

The `diagnostic` route is recorded in `qa_bundle.json` but never drives `release_verdict`.

Fail-open guard: because `numeric_review_flag` (and high-weight routing generally) depends on the judge actually running, the `high_weight_claims_unadjudicated` check blocks when a judge was expected (no `--no-llm`, a `judges.phase1` is configured) but did not run — judge unavailable, missing key, provider outage — and a high-weight/blockable claim therefore has no Phase 1 verdict. It stays silent on an intentional `--no-llm` run or when no judge is configured.

## Adding a new product

Write a new `<product>_product_spec.json` next to the existing one. The spec declares: identity fields, priority filter, prohibited phrases + JSONPath paths, claim types + blockable routing, accuracy categories, completeness thresholds, polish patterns, and `judges.phase1` / `judges.phase2` names that resolve through `QA_JUDGES`. No Python changes are required.

## Troubleshooting

`Phase 1 skipped — judge '<name>' unavailable` → either the judge name in the product spec is not present in `QA_JUDGES`, or the provider's API key env var is not set in `scripts/.env`.

`HALT: Artifact not loadable` → file path is wrong or the JSON is malformed; the bundle is still written with `release_verdict: block` and the offending check populated.

Deterministic warning on `completeness_floor` with a thin artifact → expected on placeholder artifacts (`awaiting_agenda` / `no_meeting_found` / `error` paths) that legitimately have no priority items.
