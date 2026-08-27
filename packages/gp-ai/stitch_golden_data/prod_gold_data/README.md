# Vector-store generator

`vector_store_generator.py` builds the per-state embedding pickles under
`vector_store/` (gitignored); `bronze_data/batch_process` reads them by
relative path. A laptop tool, run by hand — the consumer side is documented
in `bronze_data/batch_process/README.md`.

The L2-to-BallotReady district matcher lives in the data platform:
[`gold-match/` in gp-data-platform](https://github.com/thegoodparty/gp-data-platform/tree/main/gold-match).
