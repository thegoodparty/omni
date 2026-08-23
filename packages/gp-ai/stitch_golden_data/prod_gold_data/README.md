# L2-to-BallotReady district matcher

Matches BallotReady offices to L2 districts. Reads its worklist
(`int__l2_br_match_pending_offices`) and its menu source
(`int__l2_district_universe`) from Databricks, holds embeddings in memory for
the run, and returns terminal results. Writes nothing -- the Databricks write
path lands in a later PR.

## Directory structure

```
prod_gold_data/
├── l2_br_matcher.py           # The matcher: class L2BrMatcher
└── vector_store_generator.py  # Unrelated laptop tool, out of scope here --
                                # still feeds bronze_data's pickle-based path
```

## Running

```bash
uv run stitch_golden_data/prod_gold_data/l2_br_matcher.py --states DE --limit 100
```

`--states` limits to specific state codes; omit it to process every state
present in the pending worklist. `--limit` caps how many pending offices are
read. `--batch-size` controls how many offices are matched concurrently per
group (default 100).

## Terminal-status contract

A run persists only `MATCHED` or `ABSTAINED`. A technical error (an LLM or
embedding call raising, or a malformed LLM response) fails the run instead of
being recorded as a match or coerced into an abstention.

## What is frozen

The matcher core -- the district and query embedding text, the menu
construction (top 13 by cosine, plus the bare "state" query inserted at
index 10), the LLM prompt, its response schema, and the Braintrust project
and prompt identifiers -- is an owner-decided constraint and is not touched
here.
