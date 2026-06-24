Convert an output-quality rubric into a `qa/eval.md` evaluator for an experiment's in-run QA gate.

This is a **translation procedure**, not a rubric-authoring guide. You are given a rubric (what "good" means) and you produce one markdown file the QA gate runs as a single LLM judge. There is one valid output shape. Building or validating the rubric's *content* is a different job — see `books/build-output-quality-rubric.md`.

## Prerequisites

**books/.env variables**: `$AWS_PROFILE`, `$AWS_REGION`, `$ARTIFACTS_BUCKET` (resolved per env as `$ARTIFACTS_BUCKET-<env>`; GoodParty default `gp-agent-artifacts`), `$METADATA_BUCKET` (default `agent-experiment-metadata`)
**scripts/.env variables**: none
**Tools**: `aws` CLI authenticated to the account that owns the buckets, `uv`, `jq`, `uuidgen`. WireGuard VPN for live dispatch + log tailing.
**Concept**: an experiment's `qa/` folder is an OPTIONAL gate that runs *after* the artifact is produced and *before* publish. It has two auto-detected entrypoints — `qa/main.py` (deterministic checks) and `qa/eval.md` (a single LLM judge) — and a required `qa/manifest.json`. **v1 is observe-only: the verdict never blocks; it rides the publish path and lands in S3.** You are authoring the `eval.md` half (and its manifest). The judge runs blind: it sees only its system prompt, the eval.md body, and the artifact — so every rule must be explicit.

## Input contract

A rubric describing how to grade this experiment's output. Any shape is accepted — a human-written doc, or an adopted `experiment-evals/<exp>/quality_rubric.md` from `books/build-output-quality-rubric.md`. It typically contains:
- an **eligibility** notion (when an output is a correct placeholder / shouldn't be scored), and
- a set of **quality dimensions**, ideally with 1-5 anchors.

A human rubric is fine. It is almost always **broader than `eval.md` should be** — it will contain accuracy / faithfulness / citation criteria. Those do NOT belong to the judge (see Step 1). The conversion's value is filtering and reshaping, not copying.

## Output contract

Two files in the experiment dir:

```
experiments/<exp>/qa/eval.md         ← the judge instruction (this procedure)
experiments/<exp>/qa/manifest.json   ← gate config: {"blocking": false} + optional budgets
```

Such that:
1. `qa/manifest.json` passes `experiments/_schema/qa.schema.json` (only `blocking` is required; `additionalProperties:false`).
2. `eval.md` instructs the judge to write a **JSON array of fragments** (contract C) to the result-file path the harness injects — and nothing else to that file.
3. The judge can finish in one read of the artifact, within the turn budget. **Editorial-only** — no source re-fetch, no web search, no per-claim grounding.
4. `eval.md` carries a provenance stamp (rubric source, date, validated-or-not).

**The canonical template is `experiments/meeting_briefing/qa/eval.md`.** It is the shipped, slimmed, editorial-only reference — copy its structure, especially the "Output — write a contract-C fragment array" section. (One stale line to NOT copy: its "8 KB cap" note — the verdict is now emitted full-fidelity.)

## How the gate consumes eval.md (the model to hold while converting)

Verified against the runner-image QA gate engine. The author can rely on all of this:

- The engine spawns **one Claude agent**. Its system prompt is fixed by the engine (you do not write it). The **eval.md body is the agent's user prompt**.
- The engine **appends** a line after your eval.md body: *"...write your fragment array as a JSON array to this exact path: `<path>`"*, plus a self-pacing line: *"by turn `max_turns-2`, stop investigating and write even if incomplete."* So **do not hardcode a result path** — tell the judge to write to "the result file named in the appended instructions."
- **Tools = `Bash` only.** No Write/Edit/Glob/Grep, no WebSearch, no subagents, no MCP, no broker. The judge genuinely cannot reach the web — write the rubric so it never needs to.
- The agent's cwd is a private gate dir; the artifact is under `<workspace>/output/` (the absolute workspace path is given in the prompt). "Workspace is read-only" is **advisory** (prompt + no write tools) — not OS-enforced.
- The **engine** (not the judge) reads the fragment file back, normalizes it, and aggregates. `pass` = every fragment passed. A missing / unparseable / non-array file, a judge timeout, or a crash → `status:"error"` (still publishes; observe-only).
- Sinks: `s3://$ARTIFACTS_BUCKET-<env>/<exp>/<run_id>/qa/{verdict.json,eval_transcript.jsonl}` + the run's Braintrust span. **gp-api consumes nothing.**

## Conversion steps

### 1. Route every rubric criterion into one of four buckets

This is the heart of the conversion. Go through the rubric line by line:

| Rubric criterion | Where it goes |
|---|---|
| "Don't grade this output" / precondition-unmet / placeholder is the *correct* output | **Gate A (eligibility)** — a pass/fail `gate_a_*` fragment, checked FIRST. If it disqualifies, emit only that fragment and stop. |
| Editorial judgment of the artifact's OWN content — depth, actionability, tiering, concision, structure, honesty-as-written | **A judge check** in eval.md — either a scored dimension (`d1..dN`, 1-5) or a pass/fail check; pick the model in Step 3. This is what the judge is for. |
| Faithfulness / claim-grounding / "figure matches its source" / schema validity / cross-reference integrity / disclosure presence | **NOT eval.md.** These belong to `qa/main.py` (deterministic). Collect them into a **"deferred to main.py" list** you hand back with the eval.md. |
| Fact-checking against reality / "is this claim true" / re-fetch the source / web-verify | **Dropped from the gate.** The judge cannot do this (no web), and it would be gameable and bust the budget. Note it as out-of-scope. |

**Why bucket 3/4 matter:** a human rubric will smuggle accuracy criteria into the judge. If you keep them, the judge tries to re-investigate, burns its turn budget, and produces an internal check the generating agent could game. The judge reads ONCE and scores what is written. Grounding is the deterministic stage's job.

**Route by substance, not phrasing.** A rubric may dress a grounding/faithfulness check as "compare only against the embedded sources, no fetch" — that *reads* editorial, but per-claim grounding is still `main.py`'s job: it's the gameable, budget-eating work, and `qa_checks.py` already substring-checks each `source_extract` against its cited source. The judge's lane is *is this well-written / well-prioritized / honest-as-presented*, never *does the cited source actually support this claim*. Route a check by what it does, not how the rubric worded it — and when you defer one, add it to the deferred-to-`main.py` list and confirm `main.py` already covers it (if not, that's a deterministic-stage gap to fill separately).

Output of this step: the kept gate + dimensions, plus the explicit deferred-to-`main.py` list (so whoever owns the deterministic stage knows what it still owes).

### 2. Write Gate A — eligibility (pass/fail, checked first)

Name the artifact field that signals an ungradeable / placeholder state (e.g. a `*_status` enum). Spell out which values disqualify. On disqualification: emit ONLY `gate_a_eligibility` with `passed:false`, **no dimension fragments**, and stop. A disqualification is the EXPECTED outcome for a placeholder — not a quality failure. (Reference: meeting_briefing eval.md "GATE A" section.)

### 3. Pick the grading model and write the checks

A rubric grades in one of two models. Use whichever the rubric uses — do not force one onto the other:

**Scored (1-5).** Each check is a dimension scored 1-5 against concrete, falsifiable anchors ("every featured item cites a packet-derived figure", not "is it specific"). Set a `min_score` (meeting_briefing's convention is `3`) and `passed = (score >= min_score)`; report the full 1-5 so the verdict captures the gradient. Fragment ids `d1_...`..`dN_...`.

**Pass/Fail (optionally with N/A).** Each check is just pass or fail — no score. Use this when the rubric defines binary criteria ("Fail if any section uses imperative voice"). The fragment is gate-shaped: `{name, type, passed, detail}` with **no `score`/`min_score`**. A Pass carries no `detail` (a pass means "assume correct"); a Fail carries a terse one-line note (defect | locator | evidence). If a check can be **inapplicable** to some artifacts (e.g. "only when the briefing has constituent data"), that is **N/A → omit the fragment entirely** (do not emit `passed:true`). Give Pass/Fail checks semantic ids from the rubric's own labels (`voice_tone`, `coverage`), not `d1..dN`.

Both models share: judge **against the artifact's own embedded content** (extracts/snapshots it carries) in a single read; keep `detail` to one concise line citing specific content (an item id, a figure, a bullet).

**Order:** eligibility gate first. If the rubric has a clear spine (the one thing the user pays for), put it next, then the rest. A flat checklist with no priority — common for Pass/Fail rubrics — just follows the rubric's own order; order does not affect aggregation (`pass` = all passed).

### 4. Append the fixed output-contract section

Every eval.md ends with this. Adapt the fragment shape to your grading model (Step 3); everything else is boilerplate.

````markdown
## Output — write a contract-C fragment array to the result file

The harness appends a result-file path to this instruction (look for "write your
fragment array ... to this exact path"). Write your verdict there as a single JSON
array of fragments — nothing else in that file, no prose, no markdown fences. The
engine reads the fragments back from that exact path; a missing, non-array, or
unparseable file makes the stage error.

Each fragment is an object. Only `name` (string) and `passed` (bool) are required;
`score`/`min_score`/`detail` are optional and depend on the grading model:

SCORED (1-5) dimension:
```json
{"name": "d1_<id>", "type": "agent", "passed": <bool>,
 "score": <1-5>, "min_score": <int>, "detail": "<one-line>"}
```
PASS/FAIL check (gate-shaped — OMIT score/min_score):
```json
{"name": "<id>", "type": "agent", "passed": <bool>, "detail": "<one-line, only on a fail>"}
```

- Gate fragment (`gate_a_eligibility`): always gate-shaped (no score). `passed:false`
  when it DISQUALIFIES (carry a short `detail` naming why), `true` when it passes.
- Pass/Fail check: `passed:true` carries NO `detail`; `passed:false` MUST carry the
  terse note. **N/A → omit the fragment entirely.**

Which fragments to emit:
- Gate A disqualifies → emit ONLY `gate_a_eligibility` (`passed:false`). Stop.
- Gate A passes → emit `gate_a_eligibility` (`passed:true`) PLUS every applicable check
  (omit any N/A check). Emit at least one check — an all-omitted set makes the engine
  score `pass:null` (empty checks are not a pass).

Constraints:
- Keep every `detail` to one concise line. (Do NOT copy any "verdict capped at N KB /
  detail is truncated" line from an older rubric — the verdict is now emitted
  full-fidelity; terseness is for the downstream reader, not a size cap.)
- Never write `BROKER_TOKEN`, any token-shaped string, or raw auth headers anywhere.
- The result file must contain EXACTLY the JSON array and nothing else.
````

(Include a worked example array at the bottom — one for the gate-passes path and one for the gate-disqualifies path — as meeting_briefing eval.md does. It measurably reduces format mistakes.)

### 5. Write qa/manifest.json

```json
{"blocking": false, "agent": {"model": "sonnet", "max_turns": 20, "timeout_seconds": 300}}
```

- **`blocking` MUST be `false`.** v1 honors only observe; `true` is coerced to false with a warning. (And a freshly-converted rubric is unvalidated — see Caveats.)
- Budget sizing: the judge reads the artifact once and emits ~`1 + N` fragments. Default 20 turns / 300s is enough for a handful of dimensions over a normal artifact. If the artifact is large or has many items × many dimensions, raise `max_turns` (engine ceiling 50) and `timeout_seconds` so the judge finishes before the self-pacing cutoff. If it routinely hits the cutoff, the rubric is too heavy — trim dimensions, don't just raise the budget.
- `model` enum is `sonnet`/`opus`/`haiku`; `sonnet` is the default and almost always right for editorial scoring.

### 6. Stamp provenance + the constraints block

At the top of eval.md, one line: rubric source + date + whether it was reliability-validated (e.g. `Converted from a human-authored rubric, <date>; not reliability-validated — observe-only`).

Include this constraints paragraph near the top (lift from meeting_briefing eval.md lines 8-15, 34-36), adapted:
- "Keep this lightweight. You are EDITORIAL, not investigative. Score the artifact's OWN embedded content as written, in a single read. Do NOT re-fetch sources, web-search, or fact-check against reality — the deterministic stage (`qa/main.py`) owns schema validity, grounding, and integrity."
- "You have ONLY `Bash`, and only to read the artifact under `<workspace>`. You cannot write to the workspace, fan out subagents, web-search, or use MCP."

## Run the conversion with a clean-context subagent

Per `experiments/CLAUDE.md`, do the translation in a **clean-context subagent**, not your working session — your context silently fills doc gaps you'll never notice. Hand the subagent EXACTLY:
- the rubric,
- this procedure,
- `experiments/_schema/qa.schema.json`,
- the template `experiments/meeting_briefing/qa/eval.md`.

Forbid it from reading other experiments. Have it report a tight table of every choice it made with the source line that drove it. Every "I had to guess" is a gap in this doc — patch the doc, re-spawn a fresh subagent (don't continue the contaminated one). Converge when every fragment id and routing decision traces to the rubric or this doc.

## Validate the manifest (shape)

```bash
# from the runbooks package root
cd scripts/python && uv run pytest test_experiment_manifests.py -v
```

This validates `qa/manifest.json` against `qa.schema.json` along with the rest. There is **no content schema for eval.md** — its correctness is proven only by the dev smoke below.

## Validate the gate works — dev smoke (required)

Schema-valid ≠ working. The only way to exercise the real judge is a dev Fargate run. Run the experiment across its meaningful input paths and inspect the verdict.

### 1. Publish to dev

```bash
cd scripts/python && AWS_PROFILE=$AWS_PROFILE uv run python publish_experiments.py --env=dev
```

The publisher ships the whole `qa/` folder (validating `qa/manifest.json`); `index.json` is written last as an atomic switch.

### 2. Dispatch two runs — one per gate path

Dispatch via SQS (see `books/run-pmf-experiment-cloud.md` for the full loop). Pick inputs that exercise BOTH eligibility outcomes:
- **a placeholder/precondition-unmet input** → expect Gate A to FAIL (disqualify), no dimension fragments;
- **a real/scoreable input** → expect Gate A to PASS plus every dimension fragment scored.

```bash
RUN_ID=$(uuidgen | tr '[:upper:]' '[:lower:]'); ORG=demo-$(whoami)-$(date +%s); EXP=<your_exp>
BODY='{"experiment_type":"'$EXP'","run_id":"'$RUN_ID'","organization_slug":"'$ORG'","params":{ ...match input_schema... }}'
AWS_PROFILE=$AWS_PROFILE aws sqs send-message \
  --queue-url "https://sqs.$AWS_REGION.amazonaws.com/$(AWS_PROFILE=$AWS_PROFILE aws sts get-caller-identity --query Account --output text)/agent-dispatch-dev.fifo" \
  --message-body "$BODY" --message-group-id "agent-dispatch-$ORG" --message-deduplication-id "$RUN_ID"
echo "verdict -> s3://$ARTIFACTS_BUCKET-dev/$EXP/$RUN_ID/qa/verdict.json"
```

The wire field is `experiment_type` (NOT `experiment_id`).

### 3. Confirm the verdict — CloudWatch first, then S3

Quick check (no S3 round-trip) — the engine logs one line per run in log group `/ecs/pmf-engine-dev`:

```
qa_gate_verdict status=evaluated pass=true checks=7 run_id=<id>
```

Then pull and inspect the fragments:

```bash
aws s3 cp "s3://$ARTIFACTS_BUCKET-dev/$EXP/$RUN_ID/qa/verdict.json" - | jq .
# the judge's per-turn transcript (to confirm it stayed in budget / Bash-only):
aws s3 cp "s3://$ARTIFACTS_BUCKET-dev/$EXP/$RUN_ID/qa/eval_transcript.jsonl" - | tail
```

### 4. Pass criteria for a converted eval.md

- `status == "evaluated"` (NOT `"error"`) and `pass != null` on the scoreable run.
- Placeholder run: exactly the `gate_a_*` fragment, `passed:false`, no dimension fragments.
- Scoreable run: `gate_a_*` `passed:true` + every dimension fragment present with a 1-5 `score`.
- The transcript shows the judge read the artifact once and wrote fragments — **no WebSearch, no finalize re-prompt** (a finalize record means it busted the turn budget → trim the rubric or raise `max_turns`).
- `cost_usd` is a few cents, not dollars.

If any fail, edit eval.md / manifest, bump nothing (qa files are versioned by S3 VersionId), republish, re-dispatch.

## Caveats

- **Observe-only is load-bearing.** A converted rubric is unvalidated for reliability. Keep `blocking:false`. Before anyone ever sets blocking, the rubric must earn a GO from the cold-judge reliability loop (`books/build-output-quality-rubric.md` + `rubric_verdict.py`). The in-run gate has no reliability check of its own.
- **The verdict wire field is `"pass"`** (the engine's Python attribute is `pass_`). Quote `"pass"` when reading `verdict.json`.
- **Empty checks → `pass:null`, not true.** A judge that emits zero fragments verified nothing; that is not a clean pass. Make sure the rubric always emits at least the gate fragment.
- **A salvaged verdict is not machine-distinguishable** from a clean one in `verdict.json` (the `evaluator.finalized` field is planned, not built). A finalize shows only in CloudWatch + `eval_transcript.jsonl` — check the transcript if a verdict looks thin.
- **Doc drift:** the QA-gate contracts doc lists evaluator tools as `Bash + WebSearch`; the shipped engine is **Bash only**. Trust the code / the meeting_briefing template.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `status:"error"`, no fragments | judge didn't write the result file, wrote non-array, or wrapped it in fences | eval.md must say "JSON array, nothing else, no fences"; copy the output section verbatim |
| `pass:null` on a real run | zero fragments emitted, or a stage error | confirm the rubric always emits the gate fragment; check the transcript for a crash/timeout |
| transcript shows WebSearch / urllib attempts | rubric kept a faithfulness/fact-check criterion | re-run Step 1 — route grounding to `main.py`, drop fact-checking |
| finalize re-prompt in the transcript | rubric too heavy for the budget | trim dimensions or raise `max_turns`/`timeout_seconds` in qa/manifest.json |
| Gate A never disqualifies a placeholder | wrong status field / values in Gate A | re-read the artifact's actual status enum; list the disqualifying values explicitly |
| `qa/manifest.json` rejected by pytest | extra field or missing `blocking` | only `blocking` is required; `additionalProperties:false` — remove stray keys |
| no `verdict.json` in S3 but run succeeded | verdict over the 1 MiB cap (fail-open skip) or no qa folder published | check the CloudWatch line; shrink `detail` text; confirm publish included `qa/` |

## See also

- `experiments/meeting_briefing/qa/eval.md` — the canonical editorial-only template
- `experiments/_schema/qa.schema.json` — the `qa/manifest.json` schema
- `experiments/CLAUDE.md` — "The QA folder" (two-entrypoint lane split) + the clean-context-subagent loop
- `books/build-output-quality-rubric.md` — build + reliability-validate a rubric (the upstream / prerequisite-for-blocking step)
- `books/convert-runbook-to-experiment.md` — the sibling converter (runbook → experiment); dispatch + monitor patterns
- `books/run-pmf-experiment-cloud.md` — full dev dispatch + log-tail + artifact-pull loop
