Build and validate an output-quality rubric for ANY PMF experiment: collect sample artifacts (generate them if none exist), discover the scoring dimensions from real outputs, draft a gated rubric, and tune it with cold-judge subagents until independent judges agree on unseen data. Produces a reliability-checked rubric (reliability, not validity) you can use as the quality gate in `books/evaluate-experiment-runs.md`.

## What you get

- `quality_rubric.md` — the rubric, applied by cold-judge subagents (not a script, not `qa_validate.py`).
- `validation_log.md` — the evidence trail: every tuning iteration, its scores, diagnosis, and the one change it drove.
- A **GO / NO-GO reliability verdict** from `scripts/python/rubric_verdict.py`.

## Prerequisites

**books/.env variables**: `$AWS_PROFILE`, `$AWS_REGION` (your org's profile + region for the account that owns the buckets — do not assume a name), `$ARTIFACTS_BUCKET` (PMF artifacts bucket prefix, resolved per env as `$ARTIFACTS_BUCKET-<env>`; GoodParty default `gp-agent-artifacts`), `$METADATA_BUCKET` (experiment-metadata bucket prefix; GoodParty default `agent-experiment-metadata`).
**Tools**: AWS CLI authenticated to that account (export `AWS_PROFILE`/`AWS_REGION`, or set them in `books/.env` — don't hardcode a profile name in commands), `uv`, and an agent runtime that can spawn subagents (the readers and judges are subagents — no LLM API key needed).
**Access**: read on the artifacts + metadata buckets. Find your experiment's bucket first rather than assuming the name (`aws s3 ls | grep -i agent-artifacts`). For data-derived experiments (voter/district/election), also the source of truth used to anchor faithfulness and seed realistic runs — gp-api M2M calls or Databricks (`books/query-voter-data.md`).

## Three principles this whole procedure rests on

1. **Name the decision the score feeds before improving it.** A rubric used only as an offline A/B *regression gate* (does prompt v2 score lower than v1 on the same inputs) needs reliability plus gaming-resistance — not validity-vs-human-truth, which only matters once a score gates a release or is shown to a human. Trace where the score is actually consumed (the result contract, any dashboard) before doing validity work; most of it is gold-plating for a decision that doesn't exist yet. Park what the real decision doesn't need.
2. **Reliability is not validity.** Cold judges agreeing on a number proves the rubric is *consistent*, not that the number is *correct*. Reliability is tunable now, with no humans. Validity (does the score track true quality) needs a referent outside the judging model — see "how to close it" below for the parts you can close offline.
3. **Gate fatal and population-defining things; score the rest.** A fatal flaw (fabrication) or a "shouldn't be graded at all" condition (empty input) must be a pass/fail GATE up front. If you express it as a low score on a summed scale it averages away, and if you express it as a scoring cliff it blows up inter-judge agreement on borderline cases. (This is the single hardest lesson — see the worked example.)

## Who runs it (roles)

Three roles; the separation between them is what makes the result trustworthy.

- **Lead / rubric author** — owns the rubric file and the tuning loop, makes the gate-vs-score and stop calls. Either an interactive agent session, or a **headless Claude Code session** launched in print mode: `claude -p "build a quality rubric for <exp> following books/build-output-quality-rubric.md" --dangerously-skip-permissions`, with credentials/profile supplied via the environment (e.g. `CLAUDE_CONFIG_DIR`, `AWS_PROFILE`, `AWS_REGION`). A headless `-p` session is **top-level**, so it can spawn its own worker subagents; a *nested* subagent generally cannot, so do not try to run the whole loop from inside one subagent.
- **rubric-reader** (Step 2) and **rubric-cold-judge** (Steps 4-6) — disposable worker subagents the lead spawns. Each sees only the files the lead hands it and none of the lead's context. That isolation is the point: a judge that helped write the rubric would be grading its own work.

To **validate this runbook itself** (rather than just use it), have a context-free lead follow it — a fresh `claude -p` session pointed only at this file plus an experiment, with no other history. Where that cold lead gets stuck or has to guess is exactly where the runbook is underspecified.

## Keep all data (provenance)

Every run writes to a persistent, auditable directory — **never `/tmp`** — so any score can be reopened and proven later. Use `outputs/rubric-runs/<experiment>/<run>/` (the repo's `outputs/` is gitignored for exactly this: local artifacts, full transcripts, possible PII). Keep, and never delete:
- `inputs/` — every artifact you scored, by uuid.
- `judges/<uuid>.<judge>.md` — the FULL per-artifact block from every cold judge (gate decision + per-dimension scores + one-line justifications), not just the total. The scores TSV is a *summary* of these; this is the evidence. When you re-score the same artifact under a new rubric version, version the file (`judges/<uuid>.<judge>.vN.md`) so the prior version's block is not overwritten.
- `rubric.md` and each `rubric.vN.md`, plus `scores.tsv`, `validation_log.md`, `verdict.txt`.

The test: if you cannot point at the exact artifact and the exact judge reasoning behind a given score, that score is not auditable. (`scripts/shell/coldrun-build-rubric.sh` provisions this layout automatically.)

## Step 0 — Pin the contract

Read the experiment's spec so you know what "good" means before you read any output.

```bash
# config from books/.env or your shell — do NOT assume a profile name:
export AWS_PROFILE=... AWS_REGION=... METADATA_BUCKET=agent-experiment-metadata
EXP=<experiment> ENV=prod; export EXP ENV METADATA_BUCKET
aws s3 cp "s3://$METADATA_BUCKET-$ENV/$EXP/manifest.json" - | python3 -m json.tool   # output schema + scope
aws s3 cp "s3://$METADATA_BUCKET-$ENV/$EXP/instruction.md" -                          # what the agent is told to do
```

Write down four things:
- **The environment you are sampling** (`dev` / `qa` / `prod`). A rubric is only validated against the env whose outputs it was tuned and held-out on — prompt version, data, and contract can differ across envs, so reliability does not automatically carry over. Record this env in the rubric's provenance (see Step 7) and re-validate on one held-out batch from the target env before applying the rubric to a different env. Prefer `prod` when it has enough landed artifacts; fall back to `dev` only when prod is empty, and mark the rubric dev-validated.
- **Source of truth for faithfulness.** Where can a claim be checked? Many artifacts embed `source_extracts` (check claim-vs-extract inline). Data-derived experiments must be checked against gp-api / Databricks.
- **The precondition / "ungradeable" population.** Is there an input state where a correct output is empty or a placeholder (no agenda published, no race found, no data)? That becomes an eligibility gate, not a low score.
- **The spine.** The one thing the user is actually paying for. It will dominate the rubric.

## Step 1 — Get sample outputs (collect if none exist)

You need roughly **70**: ~40 to synthesize and tune on, and **three held-out batches of ~10**, all reserved up front (disjoint, never used in tuning — you spend one per structural fix and keep the rest clean). Split **now**, before you read anything, and follow three rules — they are the difference between honest validation and fooling yourself:

- **Random, not curated.** Held-out must be an unbiased draw from the same population. Your synthesis 40 may end up partly hand-picked (best/worst anchors); the held-out must not be, or you re-hide the failures it exists to catch.
- **Touch only at scoring.** Held-out must not enter dimension discovery, anchor wording, or even a "let me peek to understand this case." Reading a held-out artifact to decide a change converts it to training.
- **Consume-once.** The moment a held-out batch *informs a change*, it has taught the rubric and is spent. Re-testing the fix on the same batch measures memorization, not generalization. That is why you reserve multiple batches: spend one per structural change, and keep at least one untouched for the final verdict.

```bash
# config — from books/.env or your shell; do NOT assume a profile name:
export AWS_PROFILE=... AWS_REGION=... ARTIFACTS_BUCKET=gp-agent-artifacts   # your PMF artifacts bucket prefix
EXP=<experiment> ENV=prod N=60; export EXP ENV ARTIFACTS_BUCKET

# how many finished runs exist for this experiment?
aws s3 ls "s3://$ARTIFACTS_BUCKET-$ENV/$EXP/" | grep -c PRE
```

- **Enough exist** → random-sample and pull. Random, not cherry-picked — curated samples hide failure modes. The gradeable artifact is `<run_id>/artifact.json` (byte-identical to `<run_id>/logs/workspace/output/<exp>.json`; the trace, if you also want trajectory, is `<run_id>/logs/workspace/conversation.jsonl`). **Many run IDs carry no artifact** (failed runs, or precondition-not-met runs — often `eo-`prefixed), so oversample and check the landed count:
  ```bash
  RUN="outputs/rubric-runs/$EXP/$(date +%Y%m%d-%H%M%S)"; mkdir -p "$RUN/inputs" "$RUN/judges"
  aws s3 ls "s3://$ARTIFACTS_BUCKET-$ENV/$EXP/" | grep PRE | sed -E 's#.*PRE (.*)/#\1#' \
    | shuf | head -$((N*3)) \
    | xargs -P8 -I{} sh -c 'aws s3 cp "s3://$ARTIFACTS_BUCKET-$ENV/$EXP/$1/artifact.json" "'"$RUN"'/inputs/$1.json" --quiet 2>/dev/null || true' _ {}
  echo "landed: $(ls "$RUN"/inputs/*.json | wc -l)  (need >= $N; raise the 3x multiplier if short)"
  ```
  Inputs stay in `$RUN/inputs/` for the whole run — they are the evidence, never deleted (see Keep all data).
- **Not enough exist** (fewer than ~60 that actually carry an artifact) → **stop and ASK the user before generating any. Do not silently dispatch.** Generating data means firing PMF runs — each a Fargate job with real wall-clock time and cost — and because many runs fail or hit a precondition you dispatch **~1.5-2x the target** (so roughly **100 dispatches to net ~60 gradeable artifacts**). Put the tradeoff to the user explicitly (how many to generate, dev vs prod, rough time/cost) and proceed only on a clear yes. On approval: dispatch via `books/run-pmf-experiment-cloud.md`, seeding **realistic inputs** pulled from the experiment's data source (real campaign/district IDs from gp-api, places/districts from Databricks per `books/query-voter-data.md`) so the sample is representative; wait for artifacts to land, then pull as above. Reserve the held-out batches from the generated set the same way.

## Step 2 — Discover the dimensions (do not invent them)

**Hard fair-test rule: never read an existing rubric while building** — not the experiment's own previously-adopted `experiment-evals/<exp>/quality_rubric.md`, not another experiment's. An adopted rubric is an answer key; reading it turns discovery into copying and silently breaks the whole method. Rebuild from the outputs alone. (If you are re-deriving a rubric that already exists, move the existing one out of the tree first so it cannot leak in.)

Fan out **3-4 reader subagents in parallel** over the synthesis sample. Give them the artifacts and the contract from Step 0 — **not** a rubric. Each reads independently and answers: what separates a good output from a bad one here, and which specific artifacts are best/worst and why. The dimensions they **converge on without coordinating** are your candidate dimensions; the convergence itself is your first validation signal. Record their best/worst picks — those become your tuning anchors. **But verify the readers' specific best/worst artifact IDs against the raw files before trusting them as anchors:** reader subagents agree on *dimensions* reliably yet frequently misattribute individual artifact IDs across a large sample. Trust the converged dimensions; re-check the file citations.

## Step 3 — Draft v1 (gates first, anchored, falsifiable)

Assemble the rubric in this order:

1. **Gate A — eligibility** (pass/fail, **check this first**), if Step 0 found an ungradeable population. An empty/precondition-unmet artifact (a placeholder) → disqualified, not scored, and tracked as a *rate* separately. Eligibility comes first so you never faithfulness-judge a placeholder that has no content to check.
2. **Gate B — faithfulness** (pass/fail). Spot-check claims against the source of truth from Step 0. Any fabricated/altered/contradicted claim → disqualified, no score. Faithfulness also fails an *ungrounded* output — a full result built off a summary/index page instead of the real source body (detectable from its own cited source types/URLs), even when no single figure is provably fabricated.
3. **Spine dimension** — the thing the user pays for, scored first.
4. **3-6 supporting dimensions**, each scored **1-5 with concrete anchors**, phrased as falsifiable checks tied to the artifact ("every featured item cites a packet-derived figure"), not vibes ("is it specific").

Keep resolution coarse (1-5). A finer scale (/100) buys false precision — judges can't reliably tell 71 from 74. Use a points budget only to express unequal **weights** if some dimensions matter more; default to equal weight until you have a validity signal.

## Step 4 — Tune with cold-judge subagents (the loop)

A **cold judge** is a fresh subagent that reads ONLY two files — the rubric and one artifact — and never saw the rubric being built. That isolation is what makes a disagreement meaningful: it can only be a real rubric ambiguity, not leaked context. Spawn **2+ judges per artifact** so the gap between them is your reliability signal. Forbid reading the validation log or other artifacts.

Each iteration:
1. Cold judges score a known set (start with the reader best/worst anchors, then widen).
2. Measure **inter-judge spread** per artifact.
3. Find the **one** anchor the split judges read differently, tighten its wording, re-run.
4. Append to `validation_log.md`: the scores, the diagnosis, the single change.

Stop when the spread is small and stable. Watch for two traps, both of which happened in the worked example:
- **A dimension that inverts scores** (judges read it opposite to how you meant). Kill or recast it; don't patch it.
- **Cases where judges persistently disagree with your "worst" labels.** That is a *contested label* (a validity dispute), not a rubric bug. Stop chasing it and switch your goal from "match the labels" to "do independent judges agree with each other."

## Step 5 — Held-out validation (the real test)

Score one held-out batch (Step 1), 2 judges each. This is the test that matters, because everything in Step 4 was tuned on the synthesis set and will look good there. If a whole sub-population **blows out** (large spread on held-out), it is almost always a boundary you scored as a cliff that should be a **gate** instead — convert it (see the worked example's cap → eligibility-gate move).

**Gate-dominated populations need a stratified held-out.** If the gradeable class is a minority — a high-eligibility-DQ population, e.g. meeting_briefing is ~83% placeholders — a purely random held-out batch of 10 yields ~0-2 graded artifacts, far too few to measure scoring spread. Keep the random batches (they confirm the gate is reproducible on the real distribution), and *additionally* reserve a **stratified** held-out batch drawn at random within the gradeable class (still never tuned on) to get a real graded-spread signal.

**Then re-test on a *fresh* batch, not the one that broke.** The batch that exposed the failure just informed your fix, so it is now spent (consume-once, Step 1). Confirming the fix on it proves nothing. This is exactly the original hand-built meeting_briefing path (preserved in `outputs/`, not in this repo — the committed fair rebuild started from the already-correct gates and never hit this): the first held-out batch broke the rubric and drove the eligibility-gate fix; the fix's real validation was an untouched batch, where the spread dropped to ≤1. If you run out of fresh batches, pull more (Step 1) before claiming the fix generalizes.

## Step 6 — Verdict

Build the TSV from **unspent held-out batches only**: any batch that drove a rubric change is consumed (Step 5) and must be excluded — combine the remaining untouched batches. If every batch ended up driving a change, pull one more fresh batch so the verdict runs on data the final rubric never learned from.

Tally the judge blocks into a TSV (`uuid	batch	judgeA	judgeB`; write `DQ` where a judge disqualified at a gate):

```bash
# from repo root, against the run dir:
uv run scripts/python/rubric_verdict.py <run-dir>/rubric_scores.tsv
```

Prints GO / NO-GO on **reliability**: graded inter-judge spread (≤2), gate decisions reproducible (no 1-of-2 split), zero blowouts (spread ≥5). GO = reliable enough to gate prompt changes in `books/evaluate-experiment-runs.md`. It explicitly does **not** establish validity.

## Step 7 — Wire it in

Add the rubric as the Step-3 quality gate for this experiment in `books/evaluate-experiment-runs.md`, applied by cold-judge subagents (same shape as the meeting_briefing entry there).

When a rubric is **adopted**, it graduates out of the per-run `outputs/rubric-runs/` store (gitignored) into the experiment it grades: `experiment-evals/<exp>/` (`quality_rubric.md` + `validation_log.md` + an example `rubric_scores.tsv`), committed and versioned alongside the experiment's contract. It is not published to S3 and not read by the runtime agent (see `experiments/CLAUDE.md`). Adopt in a dedicated PR — eval artifacts are reviewed separately from the system that builds them.

**Stamp the env it was validated against.** The adopted `quality_rubric.md` must record, in a comment at the top, the environment whose artifacts it was tuned and held-out on (e.g. `Built and validated against: prod artifacts, <date>`) and the cross-env caveat: a rubric reliable on one env is not guaranteed reliable on another. Without this stamp a future reader can't tell whether the rubric is safe to apply to the runs in front of them. A dev-only experiment (prod still empty) graduates a dev-validated rubric — mark it so, and re-validate on a prod held-out batch once prod runs exist.

## What this does NOT give you, and how to close it

Reliability ≠ validity. To raise validity confidence without ongoing human grading:
- **Lean on verifiable dimensions.** Faithfulness, specificity, and data-honesty are checkable against the source of truth — AI validates those directly.
- **Run an ablation test.** Take a good artifact, deliberately corrupt it (strip figures, drop a caveat, mis-tier an item), and confirm the score drops the right way. You built the ground-truth ordering by hand, so it needs no humans, and a ruler that can't tell the corrupted copy from the original isn't measuring quality. Keep this as a standing test in the harness, not a clause in the rubric.
- **Check faithfulness offline against the agent-uncontrolled raw capture — not the artifact's own fields.** The big validity win you *can* take now: most identity figures (money, dates, legal cites) can be verified by code, no live fetch, against what the agent actually downloaded at generation time. `scripts/python/faithfulness_check.py` does this — it pulls identity tokens from each claim and string-matches them against the cited source text (reference implementation shaped to the meeting_briefing contract; adapt the field names per experiment). Validated at ~93% claim-level coverage on real briefings. **The catch that makes it real: an internal check is gameable.** Comparing a claim only to the artifact's own embedded extract/snapshot is the same loop the agent wrote both halves of — an optimizer fakes both and passes. Demonstrated: a fabrication faked consistently across claim, extract, and snapshot is MISSED by the internal check but CAUGHT when checked against the runner-persisted raw download in S3 (`logs/workspace/downloads/`), which the agent cannot rewrite. So: for gaming-resistance, point the check at the raw capture, not the artifact.
- **Use coverage as a comparative signal, not a hard per-artifact DQ — until normalization is tuned.** A strict "any missing token = DQ" over-fires on benign mismatches (a date phrased differently, "$22.5M" vs "$22,500,000"). For an A/B gate, the faithfulness-coverage *number* compared across prompt versions is the signal; reserve hard DQ for genuine misses once date/figure normalization is solid.
- **Move the cheap deterministic checks into a gate; reserve the LLM judge for the semantic dimensions.** If the runner already ships deterministic checks (cross-reference integrity, extract presence, required-field coverage — e.g. a `qa_checks.py`), run them as a hard gate so the judge isn't re-doing by-eye what code can decide. Cheaper, more reliable, less gameable.
- **Break self-preference with a cross-family judge.** If the generator and the judge are the same model family, inter-judge agreement can be shared bias, not validity, and an optimizer learns to exploit it. Re-score the gate set with a different-family judge (e.g. Gemini) reading the same rubric; agreement that survives a family swap is real signal.
- **Run an ablation/gaming suite as a standing test.** Corrupt a good artifact one dimension at a time (strip a figure, fake a figure consistently, pad with hedges, mis-tier, launder a source label) and require each variant to score below its clean parent or fire the right gate. Ground-truth ordering is yours by construction, no humans. This is the acceptance test for every rubric/prompt-version bump, not a clause in the rubric.
- **Calibrate the taste residue once.** The few "expert-taste" dimensions (is this genuinely useful) need one human-rated pass against a held-out set — a calibration, not a permanent dependency.

A note on building rubrics with multi-agent help: if you fan out personas to critique or design a rubric, every claim that drives a decision must cite a concrete source (file:line, S3 key, URL) and be independently re-verified before you act on it. A confident, well-grounded-sounding claim can still be a schema misread; the verification pass is what separates a real finding from a reproducible wrong answer.

## Worked example — meeting_briefing

The first rubric built with this method (meeting_briefing; its artifacts graduate to `experiment-evals/meeting_briefing/` when adopted) was a **fair rebuild**: a context-free `claude -p` follower built it from the briefings alone, with the prior rubric removed from the tree so nothing could leak in, and reached **GO** (12 graded, max spread 2, mean 0.83; 18 placeholders disqualified at the eligibility gate — the GO is reproducible from its `rubric_scores.tsv` via `rubric_verdict.py`). It independently reproduced the architecture this runbook prescribes — two gates (eligibility + faithfulness/grounding) then six 1-5 dimensions summed to /30 (the first, substance, is the spine) — which is the strongest evidence the method reproduces a rubric from the outputs, not from a leaked answer key.

The method itself was *discovered* earlier by hand-building a first version (preserved locally in `outputs/rubric-runs/meeting_briefing/handbuilt-v4-preserved/` (gitignored, not in this repo)). That arc is why each step above is shaped the way it is:
- Four readers independently converged on the dimensions over 40 briefings.
- First scoring pass scored everything 28-30 — judges too lenient → invented the cold-judge method.
- A "usefulness" dimension inverted the scores → replaced it with substance as the spine.
- Fresh judges kept disagreeing with the readers' "worst" calls → switched the goal from matching labels (validity) to inter-judge agreement (reliability).
- Held-out testing broke a substance *cap cliff* (10-12 point blowouts on borderline-empty packets, invisible on the curated set) → replaced the cap with an **eligibility gate**.

The fair rebuild then arrived at that same structure cold, and sharpened the faithfulness gate further — it catches a full briefing built off a summary/index page (a real grounding check), not just fabricated figures.

## Troubleshooting

| Symptom | Cause → fix |
|---|---|
| Every artifact scores near the top | Judge too lenient or anchors don't discriminate — sharpen anchors to falsifiable checks; confirm judges are cold. |
| One dimension makes scores go backwards | The dimension is read opposite to intent — recast or remove it, don't patch. |
| Judges persistently disagree with your best/worst labels | Contested label (validity), not a rubric bug — switch the goal to inter-judge agreement. |
| A sub-population blows out on held-out (spread ≥5) | A scoring cliff on a fuzzy boundary — make it a gate (disqualify), don't cap. |
| Not enough artifacts to sample | Dispatch runs (`books/run-pmf-experiment-cloud.md`), seeding realistic inputs pulled from gp-api / Databricks. |
