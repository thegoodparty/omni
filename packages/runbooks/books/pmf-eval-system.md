Start here for evaluating PMF experiments: how we judge whether an experiment run is good and decide whether to ship a change. This is the front door. It explains the whole system, then points you to the step-by-step runbook for your job.

## What this is

PMF experiments are agents that run on their own and drop two files into S3 per run: `artifact.json` (the work product) and `logs/.../conversation.jsonl` (the execution trace). This eval system reads those files from the outside, after the run, and answers two questions, then turns the answer into a decision. It never runs inside the agent, which is why the agent cannot inflate its own grade.

```
experiment ─▶ run (SQS▶Lambda▶Fargate▶broker) ─▶ S3: artifact.json + trace
                                                      │ read externally
   GIT = the bar (experiment-evals/<exp>/)            ▼
     perf.json, quality_rubric.md ───────▶  EVAL ENGINE
                                              ├─ performance ⇒ PASS/FLAG/FAIL   objective ▸ BLOCKS
                                              └─ quality     ⇒ score + gates    judgment  ▸ ADVISES
                                                      │
                                                      ▼  a DECISION (adopt / revert / intervene)
```

## The two axes

- **Performance (objective, can BLOCK).** Did it produce an artifact, at what turns/cost/errors. These are facts, so this axis can flatly block a bad change. See `books/build-performance-rubric.md`.
- **Quality (judgment, ADVISES only).** Is the output good and faithful to its sources. We can make judges agree (reliable) but have not proven their scores match humans (not yet valid), so quality advises rather than blocks. See `books/build-output-quality-rubric.md`.

The asymmetry is the whole point: performance has validity by construction; quality does not yet, so it never silently blocks on taste.

## Pick your job

| You want to... | Entry runbook | What you get |
|---|---|---|
| Give a new experiment a gate | `books/build-performance-rubric.md` (+ `books/build-output-quality-rubric.md`) | a tuned `perf.json` and a validated rubric; protected by the universal no-artifact FAIL from run one |
| Decide if a prompt change ships | `books/evaluate-experiment-runs.md` | an A/B of old vs new, gated on outcome + quality parity (the everyday loop below) |
| Watch deployed health | `books/build-performance-rubric.md` (Step 4, `perf_monitor.py`) | a scheduled gate over the latest dev runs that alarms on drift |

## The everyday loop: decide whether to ship a change

1. Edit the experiment's `instruction.md` (the new version, v2).
2. Deploy to dev: `scripts/python/publish_experiments.py --env=dev`. Note it publishes the repo's full experiment set for the env, so coordinate on shared dev (see the publisher's docstring for any dev-only single-experiment mode it offers).
3. Dispatch a fixed eval set to BOTH the old and new prompt (SQS), spanning every meaningful path the experiment has.
4. Pull traces + artifacts from S3.
5. Performance: `scripts/python/eval_trajectory.py --ab old new`, then `scripts/python/perf_gate.py` on each arm. Require no new no-artifact FAILs and nothing pushed over a ceiling the control stayed under.
6. Quality (deeper, optional): cold-judge the rubric on both arms. Require no dimension regressed.
7. Read the result as a decision brief and make the call:

```
DECISION BRIEF — <experiment>  (dev)
Decision:  ship v2, or keep v1?
Basis:     N runs/arm, all paths, <date>

  PERFORMANCE  (objective, can BLOCK)
    produced an artifact   v1 ..   v2 ..    better/worse
    median turns           v1 ..   v2 ..    Δ
    median cost            v1 ..   v2 ..    Δ
    over the cost/turn bar v1 0    v2 0     none      => PASS / FAIL

  QUALITY  (judgment, ADVISES)
    faithfulness gate      v1 ..   v2 ..    held/broke
    <spine dimension>      v1 ..   v2 ..    Δ          => PARITY / REGRESSED

  RECOMMENDATION:  ADOPT v2 / KEEP v1
    one line of why, plus the watch-outs (quality is advisory; small n)
```

Adopt only on a performance PASS with outcome and quality parity. Otherwise revert. This is also exactly what the autonomous prompt-improvement loop runs, with an engineer reviewing what it adopts.

## Where things live

- **git** holds the bar: `experiment-evals/<exp>/perf.json` and `quality_rubric.md`, versioned and reviewed in PRs. Changing a threshold is a reviewable commit.
- **S3** holds the runs (artifacts + traces), produced upstream.
- **`outputs/`** holds per-run evidence and is gitignored. Per-run metrics are computed on demand, not stored in git.
- **Trends over time** are not tracked yet. Git is the wrong place for per-run telemetry; the natural home is Braintrust (already logging PMF runs), and the gates do not emit there yet.

## The engine (scripts), bottom layer up

| Script | Role |
|---|---|
| `eval_trajectory.py` | the measurement primitive: turns/cost/errors from a trace; also the `--ab` diff |
| `perf_gate.py` | one run + its config ⇒ PASS / FLAG / FAIL (the check) |
| `derive_perf_thresholds.py` | many runs ⇒ a tuned `perf.json` |
| `perf_monitor.py` | latest N dev runs ⇒ gate each ⇒ drift alarm |
| `faithfulness_check.py` | quality: identity figures in a claim vs its cited source (mechanical) |
| `rubric_verdict.py` | quality: cold-judge scores ⇒ reliability GO/NO-GO |

Nothing duplicates logic: `perf_gate`, `derive`, and `monitor` all reuse `eval_trajectory`. Full inventory: `scripts/INDEX.md`.

## Key principles

- **Objective blocks, judgment advises.** Never let an unvalidated quality score silently block.
- **Measurement stays mechanical.** No AI sets the thresholds, so the gate cannot be gamed. AI helps with diagnosis (reading a failed trace to explain why), not with grading itself.
- **The standard lives in git, per experiment.** There is no universal threshold: cost runs from cents to dollars and the status field differs per experiment, so each carries its own `perf.json`.
- **Name the decision the score feeds.** A score that does not change a decision is not worth computing. Every run of this system should end in adopt, revert, or intervene.
