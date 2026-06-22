Assess a PMF experiment's runs on two axes — **performance** (how the agent worked: did it produce an artifact, at what turns, cost, errors, planning overhead, redundancy) and **quality** (how good the artifact is) — and A/B two prompt versions to check a change helps without regressing either axis.

Two evals, one harness. Both read what the runner already uploaded to S3, so assessing historical runs is free.

| Eval | Scores | Answers | Tool |
|------|--------|---------|------|
| **Performance — metrics** | the run's `conversation.jsonl` | *how did it work?* (turns, $, errors, repeats, planning %) | `scripts/python/eval_trajectory.py` |
| **Performance — gate** | the trace + true artifact status | *did it run acceptably?* (PASS / FLAG / FAIL; no artifact = hard fail) | `scripts/python/perf_gate.py` |
| **Quality** | the artifact JSON | *is the output good?* | cold-judge **subagents** apply the experiment's adopted rubric (`experiment-evals/<exp>/quality_rubric.md`), tallied by `scripts/python/rubric_verdict.py` |

The performance gate is the **objective head**: its FAIL line (a run that produced no artifact) is unambiguous, so it can gate now. The quality gate is reliable enough for *relative* (A/B) comparison but not yet validated against human truth, so use it to check parity, not as an absolute bar.

## Prerequisites

**books/.env variables**: `$AWS_PROFILE`, `$AWS_REGION` (your org's profile/region — do not assume a name; export both before any block below)
**Tools**: AWS CLI, `uv`, and an agent runtime that can spawn subagents (the quality judges). No API key needed — the judges are cold subagents, not a script calling an LLM API.
**Where runs live**: `s3://gp-agent-artifacts-<env>/<experiment>/<run_id>/` →
  `logs/workspace/conversation.jsonl` (the trace) and the top-level `artifact.json` (the artifact — the canonical copy; `logs/workspace/output/<experiment>.json` holds the same bytes but its name does not survive experiment cloning, see the naming gotchas below).

## Step 1 — Pull traces + artifacts for the runs you want to assess

```bash
export AWS_PROFILE=... AWS_REGION=...   # from books/.env — do not assume a profile name
EXP=meeting_briefing ENV=prod
rm -rf /tmp/eval/traces /tmp/eval/artifacts && mkdir -p /tmp/eval/traces /tmp/eval/artifacts
aws sts get-caller-identity > /dev/null || { echo "AWS auth failed — fix credentials before pulling"; }

# A specific run, or a sample of recent runs (UUIDv7 prefixes are time-ordered):
RUN_IDS=$(aws s3api list-objects-v2 --bucket gp-agent-artifacts-$ENV \
  --prefix "$EXP/" --delimiter "/" --query 'CommonPrefixes[].Prefix' --output text \
  | tr '\t' '\n' | sed "s#$EXP/##;s#/##" | grep -E '^[0-9a-f]{8}-[0-9a-f]{4}-' | sort | tail -20)

for rid in $RUN_IDS; do
  aws s3 cp "s3://gp-agent-artifacts-$ENV/$EXP/$rid/logs/workspace/conversation.jsonl" \
    "/tmp/eval/traces/$rid.jsonl" --quiet 2>/dev/null
  aws s3 cp "s3://gp-agent-artifacts-$ENV/$EXP/$rid/artifact.json" \
    "/tmp/eval/artifacts/$rid.json" --quiet 2>/dev/null
done
```

Start clean, auth first: stale traces from a previous eval would be gated against the wrong experiment/env, and the pulls are `--quiet 2>/dev/null` — a silent empty pull dir usually means auth, not missing runs.

Traces carry no secrets in prod (the agent is broker-mediated, never holds keys); local-run traces can — don't vendor those.

> **Two naming gotchas that produce silent, wrong results — read before an A/B:**
>
> 1. **A cloned experiment still writes the *original* filename — never pull `output/$EXP.json`.** If you clone `meeting_briefing` → `meeting_briefing_v2`, the instruction's hardcoded `Write the artifact to /workspace/output/meeting_briefing.json` carries over — so the treatment artifact lands at `…/meeting_briefing_v2/<rid>/logs/workspace/output/**meeting_briefing**.json`, NOT `output/meeting_briefing_v2.json`. An `output/$EXP.json` pull returns **nothing** for the cloned arm and you'd wrongly conclude it produced no artifacts. That is why the Step-1 block above pulls the experiment-agnostic top-level `artifact.json` — the runner writes it for every run regardless of the internal filename, and it's what `perf_gate.py` reads.
> 2. **Name trace files `<run_id>.jsonl`.** `perf_gate.py` derives the run_id from the trace *filename* to look up its artifact in S3. Name a trace anything else (e.g. by input label, for readability) and every lookup misses → a **false 100% NO_ARTIFACT FAIL** for the whole arm. `perf_gate.py` now prints a `WARNING` listing any non-run_id-named traces; don't ignore it.

## Step 2 — Trajectory eval

```bash
cd scripts/python
uv run python eval_trajectory.py /tmp/eval/traces \
  --status-regex 'awaiting_agenda|agenda_provided_by_user|briefing_ready|no_meeting_found|error' \
  --rules meeting_briefing_eval_rules.json
```

Per-run + aggregate: `turns`, `steps`, `cost`, `tool_errors`, `exact_dups` (verbatim-repeated calls), `planning_pct` (share of turns spent on `TaskCreate`/`TaskUpdate`/`TodoWrite` bookkeeping). The `--rules` file (a JSON list of `{pattern,label}` command-regexes) adds an experiment-specific category breakdown; omit it for tool-name-level metrics only. Reading: high `planning_pct`, `exact_dups`, or `tool_errors` are wasted-turn signals; trace each back to the instruction line that causes it.

**Caveat on `--status-regex`:** it matches the last occurrence of those words *anywhere in the trace text*, so a bare word like `error` matches prose (a tool result that mentions an error) and badly overstates failures. It is a rough convenience only. For the **true** outcome, read the artifact's status field — which is what the gate below does.

### Step 2b — Performance gate (turn the metrics into PASS / FLAG / FAIL)

`eval_trajectory.py` reports raw metrics; `perf_gate.py` turns them into a verdict and adds the one signal the trace alone misses — whether the run produced an artifact at all (it joins the artifact's `briefing_status` from S3).

```bash
cd scripts/python
uv run python perf_gate.py /tmp/eval/traces \
  --exp meeting_briefing --bucket gp-agent-artifacts-$ENV   # bucket must match the env you pulled in Step 1
```

- **FAIL** — no valid artifact (status `NO_ARTIFACT` / `BAD_JSON` / `error`). The firm, objective gate. In a sampled meeting_briefing population ~20% hit this — a failure the artifact-only "~1% error" rate hides, because that rate only counts runs that *did* produce an artifact.
- **FLAG** — artifact produced but over a cost / turns / tool-error ceiling. For review, not an auto-block (a legitimately complex run may cost more).
- **PASS** — artifact produced, within ceilings.

Thresholds (`--cost-max`, `--turns-max`, `--tool-errors-max`) are **provisional**, set near p90 of a 30-run sample; re-derive per experiment on a larger sample, and prefer **status-conditional** ceilings — a placeholder early-exit should cost far less than a full briefing, and placeholders burning ~$4 and ~50 turns to conclude "no agenda yet" are the real cost sink, not the rare expensive briefing. The no-artifact FAIL needs no tuning.

## Step 3 — Quality eval (rubric, applied by cold-judge subagents)

Score each artifact against the experiment's adopted rubric (`experiment-evals/<exp>/quality_rubric.md`; build one per `books/build-output-quality-rubric.md` if the experiment has none) using **cold-judge subagents**, not a script and not `qa_validate.py`. (`qa_validate.py` is a separate release-gate tool on a different axis — deterministic + `product_spec` triage — and is not the quality rubric.)

The rubric is graded by an LLM that never saw it being tuned (a *cold* judge), and you spawn **2+ judges per artifact** so the gap between them is your reliability signal. The judge does what a script can't reliably do here: read whether a packet carries real decision content (the eligibility/grounding gates) vs only titles.

1. **Spawn N cold judges per artifact** (2 is enough for a spread signal). Each subagent gets exactly two files and nothing else — the rubric and one artifact — with this directive:

   > Read ONLY these two files: the rubric `…/quality_rubric.md` and the briefing `…/<run_id>.json`. Apply the rubric exactly as written; you have never seen it before. Do not read any other file and do not show your work. Apply the rubric's Step-1 gates in order: if a gate disqualifies, output that gate's DQ verdict and stop; otherwise score every dimension 1-5 and produce **exactly the rubric's own output-format block** (the gate lines, each dimension's score with a one-line justification, and the total).

   Cold = a fresh subagent with no conversation history. Never let the judge read the validation log or other briefings (that contaminates it).

2. **Collect the blocks into a TSV** (`uuid	batch	judgeA	judgeB`; write `DQ` where a judge disqualified).

3. **Verdict:**
   ```bash
   # from repo root:
   uv run scripts/python/rubric_verdict.py experiment-evals/<exp>/rubric_scores.tsv
   ```
   Prints a GO / NO-GO **reliability** verdict: graded inter-judge spread (must be ≤2), gate decisions reproducible (no 1-of-2 split), zero blowouts (spread ≥5). GO = reliable enough to gate prompt changes. It does **not** establish validity vs human truth — that needs an external referent (see the validation log's standing caveat).

## Step 4 — A/B two prompt versions (the optimization loop)

Treat the prompt as the **only** variable: clone the experiment to `<exp>_v2`, change only `instruction.md`, publish, run the **same inputs** through both arms, and diff.

1. **Clone + edit + publish** (see `books/convert-runbook-to-experiment.md` for the dir layout):
   ```bash
   cd experiments && cp -r <exp> <exp>_v2
   # set "id":"<exp>_v2" in <exp>_v2/manifest.json; edit ONLY <exp>_v2/instruction.md
   cd ../scripts/python && uv run pytest test_experiment_manifests.py -q
   uv run python publish_experiments.py --env=dev   # publishes the repo's FULL experiment set — coordinate on shared dev
   ```
2. **Pick your control source.** The control is whatever the *current* `instruction.md` produces; if a clean batch of recent runs on the inputs you want already exists in S3, you can **reuse those historical runs as the control** and only spawn the treatment — same inputs on both arms, half the dispatch cost. But treat an existing-data control as a **cheap screen, not the adopt-grade number**; two confounds ride along:
   - **Time.** The control ran days or weeks earlier: a different "today" (any days-until-X math shifts), a world that may have moved under the input (results published, runoffs scheduled), and possibly a different runner/broker build or model alias. If the artifacts embed dates, read them — they tell you exactly when each arm ran.
   - **Regression to the mean.** If you picked inputs *because* their historical runs were expensive, those runs were partly expensive by chance and will look cheaper on re-run **even with no prompt change**. Direction can still be trusted when the mechanism is visible in the traces (Step 4.5); the magnitude cannot, and it overstates the fleet-wide saving because the sample over-weights the tail.

   **Before adopting on a large delta, re-dispatch a small fresh control batch (same inputs, same day) and quote that delta in the decision brief.** Skip the fresh control only for screens and small, mechanism-obvious changes.

   **Sourcing realistic inputs (and recovering the authoritative params).** Lift a balanced, real input set from recent runs — but the artifact echoes back less than was dispatched (e.g. it stores `official_name`/`meeting_date`, not the full input). Recover the authoritative input from the run's record: depending on the experiment it appears either as a `tool_result` of the form `PARAMS_JSON: {…}` in `conversation.jsonl`, or inside the `<untrusted_data>{…}</untrusted_data>` block of the first message in `logs/session.jsonl` (note: that preamble *also* names the literal string `<untrusted_data>`, so match the **last** opening tag, not the first). Sample a few per path so every outcome/status is represented.

   > **Schema-drift trap — historical params can be rejected by the current manifest (costs nothing, but blocks the run).** Inputs lifted from older runs may carry fields the *current* `input_schema` has since renamed or dropped; with `additionalProperties: false` the dispatch Lambda **rejects them before launching any Fargate task** (you'll see `input_schema validation failed … Additional properties are not allowed` in `/aws/lambda/pmf-engine-dispatch-<env>`). No cost is incurred, but nothing runs. Fix: prune each lifted input to exactly the keys the live manifest allows (fetch `s3://agent-experiment-metadata-<env>/<exp>/manifest.json`, recursively drop any key not in `properties` at each `additionalProperties:false` level). Renamed fields are usually pure duplicates of the new canonical field (e.g. old `projected_voter_turnout` == new `projected_turnout`), so pruning loses no information — confirm the new field carries the value before dropping the old one.

   **Stale-date trap.** For date-bound experiments, filter to inputs whose outcome is still stable at *dispatch* time — e.g. for meeting_briefing keep only runs whose `meeting_date` is in the future, or a `briefing_ready` input re-runs as `awaiting_agenda` and silently confounds the A/B. If you reused historical runs as the control, the same shift can make the *control's* outcome no longer reproducible — another reason to confirm outcome parity (Step 4.4) before trusting the delta.
3. **Collect both arms into two dirs** (`/tmp/eval/ctrl`, `/tmp/eval/treat`), filenames ending `__<input-label>.jsonl` so they match. Start them clean (`rm -rf /tmp/eval/ctrl /tmp/eval/treat && mkdir -p /tmp/eval/ctrl /tmp/eval/treat`) — stale traces from a previous eval would silently join the diff (same risk as Step 1).
4. **Diff:**
   ```bash
   cd scripts/python
   uv run python eval_trajectory.py --ab /tmp/eval/ctrl /tmp/eval/treat \
     --rules meeting_briefing_eval_rules.json \
     --status-regex 'awaiting_agenda|agenda_provided_by_user|briefing_ready|no_meeting_found|error'
   ```
   It prints control-vs-treatment turns/cost/planning per input and an **outcome-parity check** — if any input lands a different `status` across arms, the comparison is confounded (the prompt changed *what* was produced, not just *how*), and the delta is meaningless until you fix it.

   `eval_trajectory.py --ab` infers the outcome from a status *regex* over the trace text (rough — see the caveat in Step 2). For a `$`-framed table whose parity check uses the **true** artifact status, run `ab_savings.py` over your runs-map TSV (`exp, arm, path, label, run_id`) instead — it pulls each run's `artifact.json` from S3, prints per-input cost/turn savings, and **excludes outcome-mismatched pairs from the clean-pairs aggregate** so a confounded pair can't skew the headline number. The runs-map is where the **existing-data control** lands: put each historical control run on a `ctrl` row and each freshly-spawned treatment run on a `treat` row (same `label` pairs them). For an experiment with no status field, pass `--status-field ""`.
   ```bash
   uv run python ab_savings.py /tmp/eval/ab_runs.tsv --bucket gp-agent-artifacts-dev \
     --status-field briefing_status \
     --verbatim /tmp/eval/verbatim_v1_vs_v2.md     # also dump full artifacts for a human quality read
   ```
   `--verbatim` writes each input's **complete, untruncated** control-vs-treatment artifact side by side. Read it — a turn/cost win that quietly drops or degrades content is not a win, and the metric table alone won't show it. (In practice this read is where you catch things like a control bullet that was *factually wrong* — e.g. citing the wrong race — that the treatment correctly dropped.)

   > **Status-less experiments: the parity check is vacuous.** With `--status-field ""` every run reads "ok", so **no pair is ever excluded** — the clean-pairs guarantee silently stops guarding. For these experiments apply a manual stability screen instead: drop any input whose anchor facts moved between the arms' run dates (an election that happened, a runoff that got scheduled, a result that got published), or your "clean" aggregate includes world-shift deltas the prompt didn't cause.
5. **Gate on performance AND quality before promoting.** A turn/cost win is only real if the change introduces no new failures and quality holds. Run the **performance gate** (Step 2b) on both arms: the treatment must add no `NO_ARTIFACT` FAILs the control didn't have, and must not push runs over ceilings the control stayed under. Then run the **quality eval** (Step 3) on both arms and confirm parity. Promote the v2 edits only if both gates hold; treat the quality check as relative parity (it is reliable, not yet validated against human truth), and the performance no-artifact FAIL as a hard block.

   **Audit the mechanism in the traces — a cheaper run that skipped required work is a regression, not a win.** Count the tool calls your change targets, per arm, per run (e.g. `WebSearch` calls vs the new budget, banned calls = 0), AND confirm the compliance steps the instruction still requires didn't silently drop (e.g. one `http.head` per distinct external URL cited, validator ran). This proves the saving comes from the intended behavior change rather than from the agent abandoning checks — and it's what lets you trust *direction* even when an existing-data control muddies magnitude.

   **The change's author should not be the only quality judge.** The runbook author who wrote v2 knows what it's "supposed" to show and reads the verbatim with that bias. For an adopt decision, spawn blinded cold judges: give each judge one input's two artifacts with arm labels stripped and order randomized, ask which is better and why, and require the verdict to survive judges who don't know which arm is the treatment. Spot-verify any *new* factual claims the treatment introduced (head-check its cited URLs; the claims didn't exist in the control, so the old runs prove nothing about them).

   > **Cloned-arm gate trap — point `perf_gate.py` at the clone's S3 prefix.** The gate looks up each run's artifact under `s3://<bucket>/<exp>/<run_id>/artifact.json`, deriving `<exp>` from the `--config` (the control's `perf.json`). Run it unchanged on the treatment traces and it looks under the **control** prefix, finds nothing, and reports a false **100% `NO_ARTIFACT` FAIL**. Keep the control's thresholds but override the prefix with `--exp`:
   > ```bash
   > # treatment arm: control thresholds, clone prefix
   > uv run python perf_gate.py /tmp/eval/treat --config experiment-evals/<exp>/perf.json \
   >   --exp <exp>_v2 --bucket gp-agent-artifacts-dev
   > ```

   **Tear down the clone — whichever way the decision went.** Port any adopted edits into `<exp>/instruction.md`, delete `experiments/<exp>_v2/`, and republish so the clone leaves the dev index. The publisher ships the repo's FULL experiments tree, so an orphaned clone is re-published to dev by every future publish and stays dispatchable forever.

## Step 5 (optional, not required) — Fleet-wide waste discovery via embeddings

Steps 1–4 are the standard loop and need no embeddings. This step is a **possible extension**, not a dependency — skip it unless you're auditing hundreds of runs and want to find waste you didn't anticipate.

Deterministic `--rules` only catch categories you already know to look for. Embedding each step (`tool + normalized command`), clustering, and reading cluster **tightness** (mean intra-cluster cosine — high ≈ mechanically repeated, a cut candidate) plus within-run near-duplicate fraction surfaces *unanticipated* waste and semantic (not byte-identical) redundancy — which then feeds new `--rules` and prompt hypotheses back into Steps 2–4.

This is not wired into a script yet (it's a direction, not a turnkey command). If you build it, use only tooling this repo already ships — **no external/personal endpoints**:
- **`sentence-transformers`** (already in `scripts/python/pyproject.toml`) — runs a local model on CPU, no API key, works for everyone. Default choice.
- **Gemini embeddings** via `google-generativeai` + `GEMINI_API_KEY` (`scripts/.env`) — if you'd rather not download a local model.

Everything in Steps 1–4 works with zero embedding access.

## Troubleshooting

| Symptom | Cause → fix |
|---|---|
| `eval_trajectory.py` shows `turns: None` | trace has no `result` record (run was killed/truncated) — re-pull or treat steps as the turn proxy |
| A/B "OUTCOME MISMATCH" | the input's outcome isn't stable across arms — pick inputs whose result is deterministic, or the prompt change altered behavior (a quality question, not efficiency) |
| Quality judges disagree a lot (spread ≥5) | almost always a borderline empty-packet artifact straddling the eligibility gate — make empty-packet a gate (disqualify), not a scored cliff; confirm judges are reading the current rubric |
| A judge "shows its work" / verbose output | restate "do not show your work, output only the block"; cosmetic, doesn't affect the score |
| `briefing_ready` input fell back to `awaiting_agenda` on re-run | its meeting passed / agenda pulled — pick an input with a meeting still in the future |
