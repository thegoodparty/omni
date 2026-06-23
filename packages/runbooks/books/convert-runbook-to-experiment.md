Convert a locally-runnable runbook into a self-service PMF agent experiment.

This is a **translation procedure**, not an authoring guide. You are given a runbook and you must produce two files. There is one valid output shape for each input.

## Prerequisites

**books/.env variables**: none
**scripts/.env variables**: `DATABRICKS_SERVER_HOSTNAME`, `DATABRICKS_HTTP_PATH`, `DATABRICKS_API_KEY` (only needed if you want to spot-check the agent's queries against the real table)
**Tools**: `aws` CLI authenticated as `work` profile, `uv`, `jq`, `uuidgen`. WireGuard VPN connected (for live dispatch + monitor).
**Concept**: a PMF experiment is a manifest (JSON) + an instruction (markdown) published to S3. The Fargate agent reads them at dispatch time. Zero code deploys required for new experiments — but the agent runs the instruction blindly, so every broker quirk must be encoded explicitly.

## Input contract

A runbook at `books/find-<slug>.md` that:
- runs locally (uses `scripts/python/databricks_query.py`, `curl`, `psql`, web search)
- has been validated end-to-end against real data
- describes inputs (params), tools used, and output shape

## Output contract

Two files:

```
experiments/<slug>/manifest.json
experiments/<slug>/instruction.md
```

Such that:
1. `manifest.json` passes the meta-schema (`experiments/_schema/manifest.schema.json`) — verified by `pytest test_experiment_manifests.py`.
2. `manifest` is pure data contract — no UI fields. Presentation (label, description, ordering) lives in the rendering layer (gp-webapp / mobile / etc.) so each surface can present the experiment its own way.
3. `manifest.scope.max_rows` is sized per "Scope sizing" below.
4. `manifest.output_schema` is JSON Schema Draft-07 with `additionalProperties: false` on every object.
5. `instruction.md` includes the **CRITICAL RULES** block from this document verbatim (or trimmed to the tools you actually use).
6. `instruction.md` ends with **spot-check rules** that catch validator-passing garbage.

**Conventions:**
- Include `"$schema": "../_schema/manifest.schema.json"` at the top of every manifest. Editors (VSCode, JetBrains) use it for hover-docs and field autocomplete; the runtime ignores it (the publisher strips it before upload).
- `input_schema` and `output_schema` are inlined per-manifest. **Do NOT `$ref` the meta-schema's `$defs`** — published manifests are self-contained at runtime (the publisher dereferences any `$ref` it finds, so source manifests *can* `$ref` for DRY-ness, but you shouldn't bother for one-off experiments). When in doubt, inline.
- Standard district-targeting params (state/city/l2DistrictType/l2DistrictName) — see the meta-schema's `$defs.districtInputs` for the canonical shape; copy it inline into your `input_schema`.

## Conversion steps

### 1. Derive `<slug>` from the runbook name

Drop the action verb and convert kebab → snake:

| Runbook prefix | Example |
|---|---|
| `find-<thing>.md` | `find-district-issue-pulse.md` → `district_issue_pulse` |
| `research-<thing>.md` | `research-district-intel.md` → `district_intel` |
| `analyze-<thing>.md` | `analyze-peer-cities.md` → `peer_city_benchmarking` |

This `<slug>` becomes the directory name, the manifest `id`, the `EXPERIMENT_ID` env var, the S3 key prefix, and the `experiment_id` foreign key on `ExperimentRun` rows. **Do not rename later** — many downstream systems pin to it.

### 2. Identify the runbook's tools → manifest fields

| Runbook uses | Manifest entry |
|---|---|
| Databricks (any `goodparty_data_catalog.dbt.*` table) | `scope.allowed_tables: [...]` listing every table queried |
| Web search / web fetch | nothing — broker handles SSRF + allowlist for `/http/fetch` |
| election-api RDS lookup | not available to the agent — bake the resolved district into PARAMS instead (gp-api looks it up before dispatch) |
| Local files / Python scripts | not available to the agent — translate the LOGIC into the instruction |

### 3. What's NOT in the manifest

The PMF engine is generic — it knows nothing about experiment categories, audiences, or presentation. These all live downstream of the manifest:

**Audience routing (`win` candidates vs `serve` elected officials)**: a gp-api concern. gp-api decides which experiments to expose on which dashboard based on the user's role; the manifest doesn't carry a `mode` field. If you need a brand-new audience category, that's a gp-api change.

**Param builder**: gp-api builds the dispatch params from the user's organization context before sending the SQS message. The manifest's `input_schema` is the contract gp-api must satisfy — but the manifest doesn't tell gp-api how to build the params.

**Presentation**: gp-webapp owns dashboard label / description / tab_order / results-component-name in its own code. Adding a new experiment to the dashboard is a separate gp-webapp PR (renderer component + its UI metadata).

**You can ship the manifest BEFORE the React component exists** — the artifact still lands in S3, the dashboard just won't render the tab until a gp-webapp PR adds the component. This is intentional: iterate the agent's output first, ship the UI second.

### 4. Scope sizing (`scope.max_rows`)

Per-query row cap enforced by the broker. Pick based on the LARGEST single query in your instruction:

| Largest query type | `max_rows` |
|---|---|
| Aggregation over voter rows (`SUM(CASE WHEN ...)`, `COUNT(*)`) — returns 1 row | `1000` (covers `information_schema.columns` discovery too) |
| Returns voter-level rows (e.g. top-N candidates with attributes) | `50000` |
| Returns full district roll | (don't — paginate or aggregate instead) |

If unsure, start at `50000`. Drop later when you've confirmed every query is small.

**`information_schema.columns` discovery does NOT need to be in `allowed_tables`** — the broker recognizes it as a metadata pattern when the query references one of your allowlisted tables in the WHERE clause (e.g. `WHERE table_name = 'int__l2_nationwide_uniform_w_haystaq'`). Only data tables go in `allowed_tables`.

### 5. Resource sizing (model, max_turns, timeout)

Defaults observed across existing experiments:

| Field | Default | When to deviate |
|---|---|---|
| `model` | `sonnet` | `opus` only if reasoning quality is the bottleneck (rare); `haiku` for trivial transforms |
| `max_turns` | `60` | `15` for one-query-one-output; `35` for small batched query + assembly; `100` for multi-step reasoning with web research |
| `timeout_seconds` | `1200` (20 min) | `600` for trivial; `3000` (50 min) for multi-step web + databricks experiments |

If unsure: `sonnet` / `60` / `1200`. These are safe defaults that handle most batched-query + assembly experiments.

There's no `cpu` / `memory` field — Fargate task sizing is fixed in terraform (currently `2048`/`4096` across the board). If an experiment ever needs a different size, that's a terraform change to the task definition, not a manifest knob.

There is no per-experiment env gate. The publish CLI always pushes the FULL set under `experiments/<id>/` to the target env's bucket. Promote experiments by merging branches (`dev` → `qa` → `main`), not by selecting individual experiments at publish time — partial publishes would either silently unpublish other experiments (truncated `index.json`) or mix CI bytes with whatever was last pushed to the bucket, neither of which is safe.

### 6. Build `output_schema` (JSON Schema Draft-07)

The runbook usually outputs Markdown for humans. The experiment outputs JSON for the dashboard. Translate:

- `$schema: "http://json-schema.org/draft-07/schema#"` at the top
- `title`, `type: "object"`, `additionalProperties: false` (always)
- `required: [...]` on every object listing every field you want guaranteed
- `minLength` / `maxLength` on strings; `minimum` / `maximum` on numbers; `minItems` / `maxItems` on arrays
- Use `pattern` to constrain strings (e.g. `^hs_[a-z0-9_]+$`, `^https?://`)
- For date strings, use `format: "date"` (full-date) or `format: "date-time"` (full ISO 8601) — prefer `format` over hand-rolled regex patterns
- Always include a `generated_at` timestamp at the root (`format: "date-time"`)
- If the artifact has "exactly 5 entries", set `minItems: 5, maxItems: 5` — this is a contract, not a hint

**Tighter is better.** Loose schemas let the agent ship malformed artifacts that the runner rejects post-hoc. Tight schemas surface the violation in-loop where the agent can fix it.

**When an upstream step may not produce a value** (e.g. the runbook says "if no Haystaq column matches, set `aligned_voter_count: null`"), encode it as `"type": ["integer", "null"]` and keep the field in `required` — the contract is "this field is always emitted; sometimes its value is null." Don't drop the field from `required` and let it be absent; that allows the agent to silently skip it.

**Artifact S3 key**: fixed by runtime convention to `<experiment_id>/<run_id>/artifact.json` — not configurable from the manifest. The agent writes its working file as `/workspace/output/<slug>.json` (matches the instruction skeleton + readable in logs); the runner publishes it to that fixed S3 key.

### 7. Translate runbook steps → `instruction.md`

Use this skeleton — every section is mandatory:

```markdown
# <Title>

<one paragraph: what the artifact is + why both signals (e.g. data + web) are combined>

## BEFORE YOU START
1. Read this entire instruction end-to-end before executing anything.
2. Maintain a TodoWrite list mirroring the TODO CHECKLIST below.
3. Your params are in the `PARAMS_JSON` env var. Read them once at the top.
4. Write the final artifact to `/workspace/output/<slug>.json` and nowhere else.
5. Run `python3 /workspace/validate_output.py` before declaring success.
6. Perform the spot-check at the bottom — validator-passing data can still be garbage.

## TODO CHECKLIST
1. <step>
2. <step>
...

## CRITICAL RULES
<paste the relevant subset of "Broker quirks to encode" verbatim>

## Steps

### Step 1 — <name>
<copy-paste-ready code block the agent can run with minimal substitution>

### Step N — Validate
```bash
python3 /workspace/validate_output.py
```

## Spot-check
<sanity rules that catch garbage that the validator misses — see "Spot-check rules" below>

## Failure modes
| Symptom | Cause | Fix |
|---|---|---|
| ... | ... | ... |
```

The shorter the instruction, the more the agent has to invent — and the more likely it'll invent something wrong. Long, opinionated instructions with copy-paste code blocks finish in fewer turns.

### 8. Broker quirks to encode (paste verbatim into CRITICAL RULES)

The agent only sees its tools, your `output_schema`, your instruction, and the params. It cannot discover any of the following on its own — bake them into the instruction's CRITICAL RULES block:

**Databricks (`/databricks/query`)** — include if your scope has any allowed_tables:

- **Connection API** (don't introspect — paste this verbatim):
  ```python
  from pmf_runtime import databricks as sql
  conn = sql.connect()
  cur = conn.cursor()
  cur.execute("SELECT ... WHERE col = :foo", {"foo": value})
  rows = cur.fetchall()
  ```
  The module is `pmf_runtime.databricks`. It exports `connect()`, `Connection`, `Cursor`, `ScopeViolation`, `UpstreamError`. There is no `databricks.query()` shortcut — you must `connect() → cursor() → execute() → fetchall()`. Skipping this step costs the agent 3+ turns to discover via `dir()`.
- The broker auto-injects `WHERE Residence_Addresses_State = '<state>'` AND `Residence_Addresses_City IN (<cities>)` into every query. **DO NOT add these clauses yourself.** Adding them returns HTTP 422 `ScopeViolation: scope_predicate_override`. The only WHERE clauses your query needs are the L2 district column and `Voters_Active = 'A'`.
- **`Voters_Active` is a STRING.** Use `Voters_Active = 'A'`. `Voters_Active = 1` matches zero rows.
- **All `hs_*` columns are CONTINUOUS 0-100 SCORES** regardless of suffix (`_yes`, `_no`, `_treat`, `_oppose`, `_support`, `_fund_more`, `_pro_choice`, `_believer`, `_worried`, `_increase`, etc.). Threshold with `>= 50` (moderate) or `>= 70` (strong). Using `= 1` because the name "looks binary" inverts your rankings — you will get all top issues at <5%.
- **Conditional counts use `SUM(CASE WHEN ... THEN 1 ELSE 0 END)`.** Postgres `COUNT(*) FILTER (WHERE ...)` is a syntax error in Databricks.
- **`GROUP BY` queries are silently truncated at `scope.max_rows`.** The broker injects/clamps `LIMIT max_rows` on every query. If your `GROUP BY <high-cardinality-column>` produces more groups than the cap (e.g. `GROUP BY zip_code` over a state, `GROUP BY street_name` city-wide), the broker returns the first N groups in unspecified order — there is NO truncation signal in the response. **Always add `ORDER BY count DESC LIMIT N` to GROUP BY queries** so the truncation (a) becomes deterministic (you get the top N) and (b) gives you a chance to reason about whether N is correct before reading results. If your N exceeds the manifest's `scope.max_rows`, bump the manifest cap.
- **Use named placeholders** when parameterizing: `cursor.execute("... WHERE col = :foo", {"foo": value})`. Positional `?` raises a SQL error.
- **Named placeholders bind VALUES, not IDENTIFIERS.** Column names, table names, and the L2 district column all have to be string-interpolated into the SQL (e.g. f-string). Whitelist-validate any identifier before interpolating it (`assert col in ALLOWED_COLS`) — the broker scope check enforces table allowlisting but doesn't validate ad-hoc column names you f-string in.
- **Every query must reference an allowed table.** Bare `SELECT 1` (no FROM) is rejected.
- **The L2 district column name is the VALUE of `PARAMS.l2DistrictType`** (e.g. `City_Ward`). The value to match is `PARAMS.l2DistrictName`. Backtick-quote the column: `` `City_Ward` = 'FAYETTEVILLE CITY WARD 2' ``.

**Web (URL discovery + retrieval)** — include if your runbook calls the web:

**Web-access escalation ladder — instruct the agent to use the cheapest rung that answers the question, in this order. Do NOT jump to the browser.**

1. **`WebSearch`** (free, fast) — discovery. Snippets often answer the question outright; only fetch a page when you must confirm a claim against its body. Do NOT use `WebFetch` — the quarantined network can't reach claude.ai's domain-safety check, so it always fails.
2. **`pmf_runtime.http.head(url)`** — VERIFY a URL is live (the default for citation checks). Plain, non-browser status check, no Chromium render, ~100x cheaper than `get`, and immune to embedded-tracker SSRF. Returns `{"status": int, "final_url": str}`; drop if not 200, cite `final_url` on redirect.
3. **`pmf_runtime.http.get(url)`** — **browser render (Chromium), LAST RESORT.** Returns `{"status", "headers", "body", "source_url"}` (plain dict — `r["status"]`/`r["body"]`, never `.status_code`/`.text`). Use ONLY when (a) `head` returned 403/405 on a real site (Cloudflare bot-block the browser's stealth defeats), or (b) you must read the page body. It is slow, so reserve it.

```python
from pmf_runtime import http
r = http.head("https://example.com/article")   # {"status": 200, "final_url": "https://..."}
if r["status"] in (403, 405):                   # bot-blocked? escalate to the browser
    r = http.get("https://example.com/article") # {"status": 200, "body": "<html>…", ...}
```

- **Re-rendering every URL with `http.get` is the classic perf trap** — it makes URL-heavy experiments time out. Verify with `head`; render only when forced.
- **Use `pmf_runtime.pdf.download(url)` for PDFs** — returns raw bytes; `pdftotext -layout file.pdf -` extracts text.
- The broker enforces an SSRF guard + URL allowlist on every rung. Private IPs and internal hostnames are blocked; on `http.get`, a blocked third-party *sub-resource* (tracker) no longer fails the host page.
- **The container is network-quarantined — there is NO direct egress.** `urllib`/`requests`/`httpx`/`curl`/`wget`/`socket` cannot reach the internet; a runtime guard now fails them in <1s with an instructive message (before the guard, they hung ~30s+ and torched runs). **The agent reaches for `urllib` reflexively no matter how many times the prompt says not to** — this is a probabilistic prior, not a comprehension gap, so do NOT rely on "never use urllib" prose to prevent it. Two things actually work: (a) the runtime guard (already deployed), and (b) handing the agent the EXACT ready-to-run call. Whenever your instruction tells the agent to verify/fetch a URL, give it the literal line `from pmf_runtime import http; r = http.head(url)` — a "verify URLs" instruction WITHOUT the exact call is what the urllib reflex fills.

### Runtime knobs + speed patterns (`runtime.*` in the manifest)

- **`runtime.max_parallel_subagents`** (0 = off, **cap 20**) — if your runbook has N independent research units (one per opponent / district / agenda item), set this. The harness wires a `researcher` subagent the parent dispatches concurrently via the `Agent` tool, each inheriting the parent's tools, model, permission mode, and broker scope (no extra egress; can't recursively fan out). Structure that step as "one independent unit per item," and keep a sequential loop as the documented fallback. The subagent count is bounded by your item count *and* this cap; the join is gated by the slowest unit. **The researcher's base prompt does NOT know your output contract** — it only knows generic "research + verify URLs with `http.head`." So your instruction must hand each subagent the experiment-specific contract (see the templated-dispatch pattern below).
- **`runtime.max_thinking_tokens`** (e.g. `0`) — set to 0 to DISABLE extended thinking when the experiment is procedural (most are). Extended thinking can eat the whole turn budget on reasoning before any output; disabling it was one of the biggest single speedups measured.

**Fan-out speed patterns (proven on `opposition_research`, ~18min → ~5min):**

1. **Templated dispatch — write the researcher brief ONCE, dispatch SHORT pointers.** Don't hand-author a full prompt per item (that authoring time grows linearly with N). Have the orchestrator write the full per-unit brief (rules + the exact output contract, with `<ITEM>` placeholders) once to `/workspace/scratch/researcher_brief.md`, then dispatch each researcher with a tiny prompt: "Read `/workspace/scratch/researcher_brief.md`; your item is `<X>`; write your result to `/workspace/scratch/item_NN.json`." Emit all N `Agent` calls in ONE assistant turn.
2. **Write-direct — subagents write fragments, don't return them inline.** Each unit writes its complete result JSON to `/workspace/scratch/item_NN.json` and returns one line. Keeps the parent's context lean and makes assembly a file merge instead of a per-item compose loop. Each unit should also emit its OWN publish-ready `markdown_block` (push per-item formatting into the parallel units, off the serial assembly path).
3. **Canned merge — ship `assemble.py` as an ATTACHMENT, don't make the agent write it.** Put deterministic helpers (e.g. `assemble.py` that reads the fragments + `PARAMS_JSON` and emits the artifact + runs spot-checks) in `experiments/<slug>/attachments/`; the runner writes every attachment to `/workspace/<basename>`. Step 5 becomes `python3 /workspace/assemble.py` + `validate_output.py` — no build-a-script-then-edit loop. (Static briefs can be shipped this way too.)
4. **Verify-once / fast-bail** — verify each unique URL at most once; if a unit can't confirm its item in 1-2 searches, bail to `no_info` immediately rather than escalating to the browser and gating the whole join.

**Output (always include)**:

- Write **only** to `/workspace/output/<slug>.json`. The runner publishes nothing else.
- Run `python3 /workspace/validate_output.py` before declaring success. The runner-level validator will reject the artifact post-hoc if you skip this; in-loop validation lets you fix violations cheaply.

### 9. Spot-check rules to add to instruction.md

Validator-passing JSON can still be garbage. The most common failure modes:

- **`total_active_voters` matches the whole city, not the district** → your L2 district WHERE clause matched zero rows; broker's auto-injected city scope is the only filter that hit. Fix: re-confirm `L2_TYPE` and `L2_NAME` came verbatim from PARAMS_JSON.
- **All top-N percentages <5%** → you used `= 1` instead of `>= 50` (binary inference from suffix). Re-do the distribution check.
- **Multiple top-N entries from the same policy area** → candidate selection too narrow.
- **News URL doesn't load or doesn't mention the issue** → don't trust search snippets blindly; `pmf_runtime.http.get(url)` the page and confirm.

Translate the relevant rules into the spot-check section of YOUR instruction.

## Validate the manifest

Before publishing, always:

```bash
cd /Users/collinpark/work/runbooks/scripts/python
uv run pytest test_experiment_manifests.py -v
```

This runs the meta-schema validator + checks directory/id alignment + JSON Schema Draft-07 conformance of `input_schema`/`output_schema` + required `instruction.md` presence. CI runs the same tests on PR.

## Live dispatch + monitor (verify in dev)

Schema-valid does NOT mean working. The only way to know is to run it on Fargate.

### 1. Publish

```bash
cd scripts/python
# single experiment (dev-only) — recommended while iterating:
AWS_PROFILE=work uv run python publish_experiments.py --env=dev --only=<slug>
# or the full set:
AWS_PROFILE=work uv run python publish_experiments.py --env=dev
```

The script validates first, then uploads per-experiment files, then `index.json` LAST (atomic switch). If validation fails, S3 is untouched. `--only=<slug>` (dev-only) uploads just that experiment and merges its entry into the live `index.json`, preserving every other live entry — use it to stand up a new experiment or iterate on one without a full publish.

### 2. Resolve the test district from election-api RDS

Don't guess L2 district names — when the agent's WHERE filter matches zero rows, the broker's auto-injected city scope falls through and you measure the whole city.

```bash
DB_URL=$(AWS_PROFILE=work aws secretsmanager get-secret-value \
  --secret-id ELECTION_API_DEV --query SecretString --output text \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['DATABASE_URL'])")
DB_URL_CLEAN=$(echo "$DB_URL" | sed 's|?schema=[^&]*||')

psql "$DB_URL_CLEAN" -c '
SELECT id, l2_district_type, l2_district_name
FROM "District"
WHERE state = '"'"'NC'"'"'
  AND l2_district_name ILIKE '"'"'%fayetteville%'"'"'
ORDER BY l2_district_type, l2_district_name;
'
```

Use the exact `l2_district_type` and `l2_district_name` values returned. WireGuard VPN required (RDS is in a private subnet).

### 3. Dispatch, monitor, and read the artifact

This is the generic run loop — **see `books/run-pmf-experiment-cloud.md`** for the full procedure (dispatch SQS message, confirm the Lambda launched a task, tail runner/broker logs, fetch + validate the artifact, and the deploy-before-run matrix). The one-line dispatch, with your slug + manifest-valid params:

```bash
RUN_ID=$(uuidgen | tr '[:upper:]' '[:lower:]'); ORG=demo-$(whoami)-$(date +%s); EXP=<your_slug>
BODY='{"experiment_type":"'$EXP'","run_id":"'$RUN_ID'","organization_slug":"'$ORG'","params":{ ...match input_schema... }}'
AWS_PROFILE=work aws sqs send-message \
  --queue-url https://sqs.us-west-2.amazonaws.com/333022194791/agent-dispatch-dev.fifo \
  --message-body "$BODY" --message-group-id "agent-dispatch-$ORG" --message-deduplication-id "$RUN_ID"
echo "artifact -> s3://gp-agent-artifacts-dev/$EXP/$RUN_ID/artifact.json"
```

The wire field is `experiment_type` (NOT `experiment_id`). **Conversion-specific check:** the first dispatch is where instruction gaps surface as wasted turns — watch the runner log for the agent introspecting an API (`dir()`/`help()`), recovering from a broker `ScopeViolation`/`422`, re-validating repeatedly, or reaching for `urllib`. Each wasted turn is a gap to patch in YOUR instruction (or in this converter), then republish and re-dispatch.

## Iterating on a published experiment

If the manifest+instruction shipped but the agent's behavior is wrong, you do NOT need to redeploy anything:

1. Edit `experiments/<slug>/instruction.md` (or `manifest.json`)
2. Bump `version` in the manifest
3. Re-run `publish_experiments.py --env=dev --only=<slug>`
4. Dispatch a new SQS message — the next run picks up the new bytes within ~60s (Lambda's `index.json` TTL cache)

Each Fargate run captures the manifest + instruction `VersionId` at dispatch time, so an in-flight run is unaffected by your edit. New dispatches see the new bytes deterministically.

## Promoting to qa / prod

The git branch is the curation surface. Promote experiments by merging branches, not by per-experiment flags at publish time:

- **dev** branch → `agent-experiment-metadata-dev` S3 bucket
- **qa** branch  → `agent-experiment-metadata-qa` S3 bucket
- **main** branch → `agent-experiment-metadata-prod` S3 bucket

GH Actions (`.github/workflows/publish-experiments.yml`) auto-publishes the FULL set under `experiments/<id>/` on every push to `dev`/`qa`/`main`. To promote, open a PR `dev → qa` (or `qa → main`) carrying the verified experiment dirs. CODEOWNERS gates the `main` PR for prod.

`--only` and sandbox preservation are **dev-only** affordances for pre-merge testing — qa and prod always publish the full canonical set with no preservation, so a partial state or a `sandbox` experiment can never reach them. A full dev publish (including CI's) preserves live `index.json` entries whose id contains `sandbox`, so a `sandbox_*` scratch experiment is not clobbered by CI; canonical experiments still get reset to `develop`.

Manual local publish (drift recovery only):

```bash
AWS_PROFILE=work uv run python publish_experiments.py --env=dev
```

Don't promote until you've verified the experiment works end-to-end in dev, including a sanity-check on the artifact's actual data — not just that it validates.

## Common failures (system-level, not instruction-level)

| Symptom | Cause | Fix |
|---|---|---|
| Lambda log: `Missing required field: experiment_type` | Sent `experiment_id` instead of `experiment_type` | Use `experiment_type` in SQS body |
| Broker 500 on `/experiment/manifest` with `AccessDenied` | IAM role missing `s3:GetObjectVersion` | Add to terraform module `agent-experiment-metadata` |
| Lambda log: `Unknown experiment '<id>'` | Manifest not in `index.json` for the target env (the experiment dir isn't on the env's branch yet) | Merge the experiment dir into the env's branch (`dev`/`qa`/`main`); the auto-publish workflow updates `index.json` within ~60s |
| Broker logs `ScopeViolation: scope_predicate_override` | Agent added `WHERE Residence_Addresses_State = ?` | Update CRITICAL RULES; broker auto-injects state/city |
| Broker 422 on `/databricks/query` repeatedly | Positional `?`, Postgres `FILTER`, `Voters_Active = 1`, or unauthorized table | Restate the rules in the instruction; consider a tiny "test query" the agent runs first |
| Top issues all 0-5% support | `= 1` instead of `>= 50` (binary inference from suffix) | Add Step "distribution check" + restate "all hs_* are 0-100 scores regardless of suffix" |
| `total_active_voters` looks like the whole city | District name doesn't exist; broker's city scope is the only filter that matched | Verify the district via election-api RDS query above |
| Runner: `No artifact files found in /workspace/output` | Agent ran out of turns or never wrote the file | Increase `max_turns`; tighten the instruction; remove unnecessary discovery steps |
| `contract_violation` callback after agent claimed success | Validator caught a missing/wrong-typed field the agent didn't notice | Add explicit `python3 /workspace/validate_output.py` step BEFORE declaring success |

## See also

- `books/run-pmf-experiment-cloud.md` — how to RUN an existing experiment in the cloud (dispatch, monitor, deploy-before-run matrix, fetch artifact). The operational companion to this creation doc.
- `experiments/_schema/manifest.schema.json` — the meta-schema (source of truth for manifest validation)
- `experiments/CLAUDE.md` — runbook → experiment lifecycle and naming convention
- `books/find-district-issue-pulse.md` — example source runbook (paired with `experiments/district_issue_pulse/`)
- `scripts/python/publish_experiments.py` — the publish CLI
- `scripts/python/databricks_query.py` — local SQL scratchpad
