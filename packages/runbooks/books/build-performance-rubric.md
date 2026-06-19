Autonomously derive a per-experiment **performance rubric** (the objective head of the eval) from an experiment's deployed runs, validate it, and measure it in real time against what is deployed in dev. Performance is objective — did the run produce an artifact, at what turns/cost/errors — so unlike the quality rubric this needs no cold judges, no human calibration, and no validity caveat. It is measurement, so it can run fully hands-off per experiment.

## What you get
- `experiment-evals/<exp>/perf.json` — the per-experiment performance config (status field, fail statuses, p95 cost/turns/error ceilings, no-artifact baseline). This is the "rubric."
- A real-time **PASS / FLAG / FAIL** gate over deployed dev runs via `scripts/python/perf_gate.py`.

## The one principle that shapes everything
There is **no universal status field**. meeting_briefing uses `briefing_status`, meeting_schedule uses `status`, opposition_research and opportunities_and_challenges have none. So:
- The only **universal** hard FAIL is **no artifact produced**. That signal is field-independent and applies to every experiment.
- Everything else is **per-experiment**: which status values mean failure (`fail_values`), and the cost/turns/error ceilings — a meeting_briefing run costs ~$3-10 while opportunities_and_challenges costs ~$0.20, so a single global threshold is meaningless. Derive them from each experiment's own distribution.

Performance ceilings can be **absolute today** (turns/cost/errors are facts); the quality rubric cannot, since quality validity needs a human referent. That asymmetry is why this gate can block now.

## Onboarding a new experiment
The tooling is generic: `derive_perf_thresholds.py` and `perf_gate.py` take the experiment name and its config as arguments, with no per-experiment code or hardcoded roster, so a new experiment needs zero new code. What it needs is data, and that splits onboarding into two phases.

**Phase 1: from run one, the universal gate already applies.** The `NO_ARTIFACT` hard FAIL is field-independent and valid for any experiment with zero config, so a brand-new experiment is protected against its worst failure (producing nothing) immediately. Run the gate with just `--exp` and no `--config` to apply it plus the loose `DEFAULT_THRESHOLDS` guardrails (cost $6 / 80 turns / 2 tool errors):
```bash
uv run scripts/python/perf_gate.py <traces_dir> --exp <new_exp> --bucket $ARTIFACTS_BUCKET-dev
```
What Phase 1 does NOT give you: status-based FAILs (e.g. an artifact whose status is `error`) and ceilings fit to this experiment's real cost profile. Both need data.

**Phase 2: tune once it has ~50-60 dev runs.** Run Steps 1-3 below. `derive` discovers the status field, computes p95 cost/turns/error ceilings from the experiment's own distribution, infers `fail_values`, and records the no-artifact baseline; adopt the result to `experiment-evals/<new_exp>/perf.json`, after which `--config` replaces the day-one defaults. The only per-experiment judgment is confirming the auto-discovered status field is the right one. Treat ceilings from a thin sample as provisional (a p95 from 10 runs is noise), but trust the no-artifact rate from run one.

## Prerequisites
**books/.env variables**: `$AWS_PROFILE`, `$AWS_REGION`, `$ARTIFACTS_BUCKET` (resolved per env as `$ARTIFACTS_BUCKET-<env>`).
**Tools**: AWS CLI, `uv`. No agent/judge runtime needed — this is pure measurement.

## Step 1 — Derive the config from deployed dev runs
```bash
cd /path/to/runbooks
AWS_PROFILE=... AWS_REGION=... uv run scripts/python/derive_perf_thresholds.py <exp> --env dev -n 60
```
It samples ~`-n` deployed runs, pulls each trace + `artifact.json`, then:
- **discovers the status field** (scans artifacts for a `*status*` key; records it, or `None`),
- computes the cost/turns/error distribution over artifact-producing runs and sets **FLAG ceilings at p95**,
- sets `fail_values` to any observed status containing error/failed/failure, plus `"error"` by default whenever a status field exists (failures are rare, so a 60-run sample usually misses them),
- records the **no-artifact rate** as the failure baseline — the fraction of ALL sampled runs (traceless ones included) whose artifact is absent or unparseable, the same definition `perf_monitor.py` measures live.

Output (evidence) lands in `outputs/perf-eval/<exp>/` (gitignored); the config is `outputs/perf-eval/<exp>/<exp>.<env>.perf.json` (env-scoped, so a re-derive for another env lands beside this one instead of overwriting it). Prefer `dev` so the rubric matches what you measure in real time; re-derive per env (a rubric from one env's runs is not guaranteed to fit another's cost profile).

## Step 2 — Validate the config (cheap, no humans)
```bash
uv run scripts/python/perf_gate.py outputs/perf-eval/<exp>/derive-dev/traces \
  --config outputs/perf-eval/<exp>/<exp>.dev.perf.json --bucket $ARTIFACTS_BUCKET-dev
```
Confirm: the **status column reads real values** (e.g. `found`, not `None`/`NULL_STATUS` — a `None` for a no-status experiment is correct, but `None` where you expected a status means the wrong field was discovered); the FAILs are the no-artifact runs; FLAGs are the genuine top-of-distribution outliers, not the median. Then re-derive on a **fresh sample** and confirm the thresholds are stable (not fit to one batch's noise). `-n` of 50-60 is thin for a tail estimate; bump it for a load-bearing ceiling.

## Step 3 — Adopt
Graduate the validated config to the experiment's eval home, committed alongside the quality rubric:
```bash
cp outputs/perf-eval/<exp>/<exp>.dev.perf.json experiment-evals/<exp>/perf.json
```

## Step 4 — Measure in real time against deployed dev
`perf_monitor.py` does it in one command: it pulls the **latest N** deployed dev runs (run ids are UUIDv7, so the tail is newest), gates each against the adopted config, and **alarms on drift**.
```bash
AWS_PROFILE=... AWS_REGION=... uv run scripts/python/perf_monitor.py \
  --config experiment-evals/<exp>/perf.json --env dev -n 30
```
It prints PASS/FLAG/FAIL counts and the live no-artifact + FLAG rates, and **exits non-zero with `ALARM`** when the no-artifact rate drifts above the config's baseline (+10pts) or the FLAG rate exceeds 20%. Schedule it (a `/loop`, cron, or launchd job) and wire the non-zero exit to your alert. A no-artifact-rate climb is a real execution regression, independent of output quality; a FLAG-rate spike on a small `-n` is noisier (treat as advisory and re-check with a larger window).

## Step 5 — Gate prompt promotions on it
Before promoting an `instruction.md` change, run the gate on both arms per `books/evaluate-experiment-runs.md` Step 5: the treatment must add no new no-artifact FAILs and must not push runs over the ceilings the control stayed under.

## Troubleshooting
| Symptom | Cause -> fix |
|---|---|
| every run shows `status=None` | the experiment has no status field (fine — it's judged on artifact-presence + ceilings), OR the discovered field was wrong; check `status_counts` in the config |
| `n` far below `-n` | many sampled runs lack a trace/artifact (failed early); raise `-n`, or note the high no-artifact rate (it's a real signal) |
| ceilings look absurd (0 or huge) | too few artifact-producing runs in the sample; raise `-n` |
| derive finds 0 runs while scripting a loop | zsh does not word-split unquoted vars; call the script with explicit args, not a split loop variable |
