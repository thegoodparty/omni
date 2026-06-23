# Experiment eval rubrics

Output-quality rubrics and their evidence, one subdirectory per PMF experiment.

**This tree is deliberately separate from `experiments/`.** `experiments/<id>/` is
operational — `publish_experiments.py` walks it and ships `manifest.json` +
`instruction.md` + `attachments/` to S3, and the runtime agent reads only that.
`experiment-evals/` is **never published and never read at runtime**; it holds how
we *evaluate* an experiment's output, kept out of the operational path so eval
artifacts can't leak into a run or be mistaken for the experiment contract.

Each `experiment-evals/<id>/` holds:
- `quality_rubric.md` — the adopted output-quality rubric (the eval contract): gates
  first (eligibility, then faithfulness), a spine dimension, anchored 1-5 dimensions.
  Applied by cold-judge subagents; **not** a fact-check (faithfulness gates are
  internal-grounding — see the rubric's own Gate-B note). A top-of-file comment stamps
  the **environment** (dev/qa/prod) whose artifacts the rubric was validated against —
  reliability is established for that env only and does not automatically carry to another
  (prompt/data/contract differ across envs); re-validate on a target-env held-out batch
  before applying cross-env.
- `validation_log.md` — the build/tuning evidence trail for that rubric.
- `rubric_scores.tsv` — example held-out cold-judge scores; feed it to
  `scripts/python/rubric_verdict.py` for the GO/NO-GO reliability verdict.
- `perf.json` — the adopted **performance** config (the objective head): status field,
  fail statuses, p95 cost/turns/error ceilings, and the no-artifact baseline. Derived by
  `scripts/python/derive_perf_thresholds.py`, applied live by `perf_gate.py` / `perf_monitor.py`.
  Env-stamped — derive it on the env you monitor (prod and dev distributions differ materially,
  e.g. meeting_briefing no-artifact 13% prod vs 33% dev). See `books/build-performance-rubric.md`.

How a rubric gets here: build + validate it per `books/build-output-quality-rubric.md`
(run evidence accumulates in gitignored `outputs/rubric-runs/`), then an *adopted*
rubric graduates into `experiment-evals/<id>/`. A cold rebuild must never read the
adopted rubric here — it is an answer key (the build loop bars it).
