# L2-to-BallotReady district matcher

Matches BallotReady offices to L2 districts. Reads its worklist
(`int__l2_br_match_pending_offices`) and its menu source
(`int__l2_district_universe`) from Databricks, holds embeddings in memory for
the run, and returns terminal results. The matcher itself writes nothing --
`l2_br_match_writer.py` holds the Databricks write path and run lifecycle.

## Directory structure

```
prod_gold_data/
├── l2_br_matcher.py           # The matcher: class L2BrMatcher
├── l2_br_match_schema.py      # Schema of record for llm_l2_br_match_results
├── l2_br_match_writer.py      # The write path and run lifecycle: class MatchRunWriter
└── vector_store_generator.py  # Unrelated laptop tool, out of scope here --
                                # still feeds bronze_data's pickle-based path
```

## Running

```bash
uv run stitch_golden_data/prod_gold_data/l2_br_matcher.py --states DE --limit 100
```

`--states` limits to specific state codes; omit it to process every state
present in the pending worklist. `--limit` caps how many pending offices are
read (must be positive). `--batch-size` controls how many offices are matched
concurrently per group (default 100); `--embedding-batch-size` controls how
many district texts go into one `create_embeddings` call when building the
universe (default 100) -- the two are unrelated knobs for unrelated
workloads, not one shared setting.

## Terminal-outcome contract

A run produces two outcomes and no third -- this module writes nothing, so
"persists" belongs to the write path. A `MatchResult` whose
`l2_state` / `l2_district_type` / `l2_district_name` are populated is a match;
one where all three are `None` is an attempt that found nothing. There is no
status column on the result or in `llm_l2_br_match_results`, so a populated
district name is the whole signal. A technical error (an LLM or embedding call
raising, or a malformed LLM response) fails the run instead of being recorded
as a match or coerced into an abstention.

## The write path and run lifecycle

`MatchRunWriter` (`l2_br_match_writer.py`) is the only writer of
`model_predictions.llm_l2_br_match_runs` / `llm_l2_br_match_results`. Four
small operations, driven by hand during the supervised cutover: create a
run, append its (validated) results, complete it, or revoke it plus every
run sequenced after it. Per-row validation runs over the whole batch before
the first insert; `append_results` is single-shot per run (refuses a run
that already has rows, since the connector has no transactions to make a
retry after a partial failure safe). Four set-level invariants run after
the rows land -- `complete_run` runs them itself before publishing (`force`
skips this for a human overriding a known-benign failure), since neither
`status` nor `match_status` carries a database CHECK constraint and an
operator forgetting a separate verification step is not enforcement.

## What is frozen

The matcher core -- the district and query embedding text, the menu
construction (top 13 by cosine, plus the bare "state" query inserted at
index 10), the LLM prompt, its response schema, and the Braintrust project
and prompt identifiers -- is an owner-decided constraint and is not touched
here.
