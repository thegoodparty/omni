# QA the top_community_issues runbook

How to quality-check a `top_community_issues` artifact, and the rubric the check enforces. This is the demand-side issue list produced by `experiments/top_community_issues/` — a candidate reads it as ground truth, so **correctness is weighted far above polish: a confident-but-wrong issue is worse than a thin true one.**

The check runs on the shared QA spine (`scripts/python/qa_validate.py`), driven entirely by `scripts/python/top_community_issues_product_spec.json`. No code changes are needed to tune it — edit the spec.

## Run it

From `scripts/python/`:

```bash
# Deterministic checks only — cheap, offline, no API key.
uv run python qa_validate.py path/to/top_community_issues.json \
  --no-llm --product-spec top_community_issues_product_spec.json

# Full run — adds the Claude judge (Phase 1 triage of every claim, Phase 2
# adversarial escalation of high-weight claims Phase 1 flagged).
uv run python qa_validate.py path/to/top_community_issues.json \
  --product-spec top_community_issues_product_spec.json
```

Read the result from `qa_bundle.json` (written next to the artifact, or use `--bundle-out`). The top-level `release_verdict` is `ok`, `warn`, or `block`; per-claim verdicts are in `claims[]`, per-check detail in `deterministic_checks[]`. Add `--enforce-verdict` to exit non-zero (1 on warn, 2 on block) for CI.

For the full-run judge, set in `scripts/.env`:
- `ANTHROPIC_API_KEY`
- `QA_JUDGES` — e.g. `claude:anthropic:claude-sonnet-4-6,opus:anthropic:claude-opus-4-7` (the names `claude`/`opus` must match `judges.phase1`/`judges.phase2` in the spec).

## What gets adjudicated

The spine adjudicates **discrete claims**, not whole issues. The runbook emits, alongside the human-facing `issues[]`, a top-level `claims[]` (each issue decomposed into individual facts) and a deduped top-level `sources[]`. See "The QA projection" in `experiments/top_community_issues/instruction.md` for how the artifact is shaped. If the artifact has no `claims[]`, it was produced by an older runbook and cannot be QA'd — re-run the current experiment.

## The rubric

### Issue verdict (the emphasis)

Each issue resolves to one verdict, derived from its claims:

| Verdict | Meaning | How the spine reaches it |
| --- | --- | --- |
| **Verified** | The named instance is real and current; every specific claim (dollar, date, vote, project, location) is supported by a live source whose body states it. | All the issue's claims land in the judge's `ok` set and no deterministic block fires → `ok`. |
| **Unverified** | Plausible but not confirmable: single-source, snippet-only, or a dead link on an otherwise believable claim. Not shippable as fact. | An unsupported specific claim (`Not in Source — Unresolved` / `Unverifiable`) at medium weight → `warn`. |
| **Incorrect** | A materially wrong fact, a fabrication, a mislocated or stale story, or a partisan claim presented as resident fact without corroboration. **One Incorrect issue is a serious defect.** | Any **contradicted** high-weight claim (`Incorrect`), or a high-weight claim citing a disallowed source type, or a fabricated extract → `block`. |

### Claim-level check (drives the verdict)

Every factual claim is labeled by the Claude judge and grouped by the spec's `accuracy_categories`:

- **Supported** (`Accurate`, `Directionally Consistent`, `Extrapolating`, `Modeled`) → ok.
- **Unsupported** (`Not in Source — Unresolved`, `Unverifiable`, `Not in Source — Verified Elsewhere`) → not ok. If the claim is high-weight it blocks; otherwise it warns. (If corroboration genuinely exists it should have been flattened into `sources[]`, where the judge would find it and score it Supported.)
- **Contradicted** (`Incorrect`) → not ok; blocks on any high-weight claim.

The high-weight, blockable claim types are the load-bearing facts: `figure_or_dollar`, `date_or_timeframe`, `vote_or_official_action`, `existence_or_event`, `location_or_geography`. Resident-demand attribution and background are medium; Haystaq lean and synthesis are low.

### Verification protocol (what the check actually does)

1. **Schema gate** — `schema_validation` (Layer 1) validates the whole artifact against the manifest `output_schema` before anything else.
2. **URL liveness** — `urls_resolve` head-checks every `sources[].url`. Advisory: a dead link warns (Unverified), never hard-blocks, matching the rubric's treatment of a dead cite whose fact is corroborated elsewhere.
3. **Source support** — `extracts_appear_in_cited_source` confirms each `source_extract` is a verbatim substring of its cited source. This catches snippet-misreads and hallucinated citations. High-weight failures block.
4. **Provenance** — `all_claims_have_provenance`, `citation_ids_resolve`, `high_weight_claims_have_extracts` ensure every claim is grounded and every `source_id` resolves.
5. **Nonpartisan / source fit** — `source_hierarchy_policy`: a high-weight figure/date/vote may not rest solely on an advocacy or poll source; resident-demand attribution must come from a resident-voice source. High-weight violations block.
6. **Claim adjudication** — the Phase 1 / Phase 2 Claude judge classifies each claim as above.

### Dimensions the judge applies (not yet mechanical)

Some rubric dimensions are per-issue, not per-claim, and are checked by reading the artifact against these criteria (a reviewer, or a follow-on issue-level judge pass):

- **Geography** — the issue is about this jurisdiction, not a mislocalized national story.
- **Time horizon** — sustained: resident attention over ~6 months, with at least one verified `article_date` within ~12 months. Stale-but-large issues and multi-year date-traps are Incorrect for this list. A one-week flare-up belongs in `trending_issues`.
- **Specificity** — every issue names a concrete instance (a project, rate, vote, location), never a bare category ("Housing" fails).
- **Category correctness** — the `category` tag matches the named instance.
- **Ranking validity** — issues are ranked by resident attention mass; the Haystaq lean annotates, it never drives the rank.
- **Coverage-gap honesty** — `data_quality_reason` names dropped Haystaq domains and missing layers (no 311, no survey, empty feed) and explains a short list. A tight 1-to-3-issue lead is the correct product, not a defect.

## Tuning

All rules live in `top_community_issues_product_spec.json` (claim types and weights, `accuracy_categories`, `source_hierarchy`, `judges`, completeness floors, deterministic-check routing). Edit there and re-run; no Python changes. See `books/qa-validate.md` for the spine's full routing backbone.
