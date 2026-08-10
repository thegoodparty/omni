---
name: build-cap-agent
description: Build/author a CAP agent experiment (manifest + instruction) from a runbook and test it in the cloud. Use when turning a locally-validated runbook into a deployed PMF experiment (experiments/<slug>/manifest.json + instruction.md), authoring the broker-quirk CRITICAL RULES, sizing scope/output_schema, or publishing and dispatching it in dev to verify the artifact.
---

# Build a CAP agent experiment

Turn a locally-validated runbook into a cloud-deployed CAP agent experiment, then
verify it in dev. A CAP experiment is two files published to S3 —
`experiments/<slug>/manifest.json` (the data contract) and
`experiments/<slug>/instruction.md` (the agent's system prompt) — that the Fargate
runner reads at dispatch time. **Zero code deploys** are required for a new
experiment, but the agent runs the instruction blindly, so every broker quirk must
be encoded explicitly. This is a translation procedure: a validated runbook in,
one valid manifest + instruction out.

This skill supersedes the former runbook → experiment converter book.

## Pointer table

| You're doing                                                  | Read                                                              |
| ------------------------------------------------------------- | ----------------------------------------------------------------- |
| The runbook -> experiment lifecycle and pairing               | "Lifecycle" below; `packages/runbooks/experiments/AGENTS.md`      |
| The dispatch chain (SQS -> Lambda -> Fargate -> broker -> S3) | "Lifecycle" below; `packages/runbooks/books/platform-overview.md` |
| Writing `instruction.md`                                      | "Instruction skeleton" below                                      |
| Sizing scope, schema, resources, the manifest                 | "Manifest and schema discipline" below                            |
| The broker quirks to paste verbatim                           | "CRITICAL RULES / broker quirks" below                            |
| Querying Databricks from a deployed agent                     | "Databricks querying for cloud experiments" below                 |
| Voter table/column knowledge (reference only)                 | `packages/runbooks/books/query-voter-data.md`                     |
| Publishing + dispatching in dev                               | "Testing in dev" below                                            |
| Cohort-scale dev testing                                      | the `create-representative-test-cohort` skill                     |
| Catching validator-passing garbage                            | "Spot-check and common failures" below                            |

## Prerequisites

- `aws` CLI authenticated as the `work` profile, plus `uv`, `jq`, `uuidgen`.
- WireGuard VPN connected (live dispatch + monitor reach private subnets).
- A runbook at `packages/runbooks/books/find-<slug>.md` that already runs locally
  (uses `scripts/python/databricks_query.py`, `curl`, `psql`, web search) and has
  been validated end-to-end on real data, describing its params, tools, and output
  shape. Don't translate a workflow that hasn't proven itself.

## Lifecycle (runbook -> experiment)

Every experiment starts as a runbook. The path from idea to dashboard has two phases:

```
Phase 1: prove the workflow as a runbook (human-runnable)
   books/find-<thing>.md   -- iterate on real data via shell + databricks_query.py
                              until the workflow produces good output reliably
Phase 2: port to a self-service CAP experiment (agent-runnable)
   experiments/<thing>/
       manifest.json    <- contract schema, scope, routing
       instruction.md   <- the runbook's steps, written for the agent (blindly)
```

Build it twice on purpose. Runbooks are forgiving (a human spot-fixes SQL, swaps a
column, retries). Experiments are autonomous (the agent follows the instruction
blindly; iteration costs ~$0.30+ per Fargate run). The runbook stays as both
documentation and a debugging tool when the experiment breaks.

**At dispatch a CAP experiment runs entirely in the cloud, not locally:**

```
you ──SQS──► agent-dispatch-<env>.fifo
                  ▼
        Lambda pmf-engine-dispatch-<env>   validates params against manifest input_schema;
                  ▼                          bad params rejected HERE (no Fargate task)
        ECS Fargate task pmf-engine-<env>  fresh task per dispatch (no warm pool)
                  ▼
        broker-<env>  (the ONLY egress)    Anthropic (LLM), web fetch/head, Databricks, S3.
                  ▼                          The task is network-quarantined; all egress is brokered.
        s3://gp-agent-artifacts-<env>/<experiment_id>/<run_id>/artifact.json  (+ logs/session.jsonl)
```

In prod the trigger is `POST /v1/agent-experiments/request` on gp-api, which
hydrates params and sends the same SQS message. Direct SQS is for headless testing.

### Naming and slug derivation

Pair the runbook and experiment so lineage is obvious. Drop the action verb, convert
kebab-case to snake_case:

| Runbook prefix        | Example                                                  |
| --------------------- | -------------------------------------------------------- |
| `find-<thing>.md`     | `find-district-issue-pulse.md` -> `district_issue_pulse` |
| `research-<thing>.md` | `research-district-intel.md` -> `district_intel`         |
| `analyze-<thing>.md`  | `analyze-peer-cities.md` -> `peer_city_benchmarking`     |

This `<slug>` is **load-bearing across many systems**: the directory name, the
manifest `id`, the `EXPERIMENT_ID` env var, the S3 key prefix, the `experiment_id`
foreign key on `ExperimentRun`, and the gp-api `EXPERIMENT_IDS`. **Never rename
later** — downstream systems pin to it. Pick it carefully up front.

### Author with a clean-context subagent

Translate the runbook with a **clean-context subagent**, not in your own session.
You carry context the subagent lacks (other experiments, prior debugging, what you
"meant") and will silently fill gaps in this skill — you'll never see them. Spawn a
fresh subagent with EXACTLY three inputs: the source runbook, this skill, and
`experiments/_schema/manifest.schema.json`. Forbid it from reading other
experiments or any reference stash. Have it write the two files, run the manifest
test, and report a tight table of every field it chose with the line that drove
each choice. Every "I had to guess" is a gap in this skill — patch the skill,
re-spawn a fresh subagent (never continue the contaminated one), repeat until every
field traces to a quoted line.

## Output contract

Two files:

```
experiments/<slug>/manifest.json
experiments/<slug>/instruction.md
```

such that:

1. `manifest.json` passes the meta-schema (`experiments/_schema/manifest.schema.json`),
   verified by `uv run pytest test_experiment_manifests.py`.
2. `manifest` is a pure data contract — no UI fields. Presentation lives downstream.
3. `manifest.scope.max_rows` is sized per "Scope sizing" below.
4. `manifest.output_schema` is JSON Schema Draft-07 with `additionalProperties: false`
   on every object.
5. `instruction.md` includes the **CRITICAL RULES** block below verbatim (trimmed to
   the tools you actually use).
6. `instruction.md` ends with spot-check rules that catch validator-passing garbage.

## Instruction skeleton

`instruction.md` is the agent's whole world: it sees only its tools, your
`output_schema`, this instruction, and the params. **The shorter the instruction,
the more the agent has to invent — and the more likely it invents something wrong.
Long, opinionated instructions with copy-paste code blocks finish in fewer turns.**

Use this skeleton. Every section is mandatory and in this order:

````markdown
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

Each Step MUST open by marking its milestone, so cost analysis can attribute
per-turn spend to named phases. Paste this line verbatim as the FIRST action of
every Step (substitute only the step name), because the agent only does what is
literally in the instruction:

```python
from pmf_runtime import milestone; milestone("<step name>")
```

Use the same `<step name>` as the `### Step N — <name>` header. It is fine for a
run to skip milestones (resumable state machines that re-enter mid-sequence) or to
stop early (gated sequences that exit before later steps) — analysis joins on
whatever markers exist and tolerates gaps.

### Step 1 — <name>

```python
from pmf_runtime import milestone; milestone("<name>")
```

<copy-paste-ready code block the agent can run with minimal substitution>

### Step N — Validate

```python
from pmf_runtime import milestone; milestone("validate")
```

```bash
python3 /workspace/validate_output.py
```

## Spot-check

<sanity rules that catch garbage the validator misses — see "Spot-check" below>

## Failure modes

| Symptom | Cause | Fix |
| ------- | ----- | --- |
| ...     | ...   | ... |
````

The six `## BEFORE YOU START` items are fixed — keep them as written, substituting
only your `<slug>`. Keep `## TODO CHECKLIST`, `## CRITICAL RULES`, `## Steps` (as
`### Step N — name`), `## Spot-check`, and `## Failure modes`.

> Milestones: the `pmf_runtime.milestone()` primitive is live on Fargate. Every
> Step must open with `from pmf_runtime import milestone; milestone("<step name>")`
> (verbatim) so the `analyze-cap-agent-costs` skill can attribute cost per phase.
> Skipped or early-exit milestones are fine — the analyzer joins on whatever markers
> a run emits. Keep the named-step / `## TODO CHECKLIST` structure exactly as above.

## Manifest and schema discipline

### What goes in the manifest (and what does not)

The manifest is a **pure data contract**: routing config, scope, and the I/O
schemas. It carries NO UI, audience, param-builder, or presentation fields — those
live downstream:

- **Audience routing** (`win` candidates vs `serve` elected officials) is a gp-api
  concern; gp-api decides which experiments show on which dashboard. No `mode` field.
- **Param builder**: gp-api builds dispatch params from org context before sending
  the SQS message. The manifest's `input_schema` is the contract gp-api must satisfy;
  it does not tell gp-api how to build params.
- **Presentation**: gp-webapp owns label / description / tab order / results-component
  in its own code. You can ship the manifest BEFORE the React component exists — the
  artifact still lands in S3; the dashboard renders the tab once a gp-webapp PR adds
  the component. Iterate the agent's output first, ship the UI second.

election-api RDS lookups are not available to the agent — bake the resolved district
into PARAMS instead (gp-api looks it up before dispatch). Local files / Python scripts
are not available either — translate their LOGIC into the instruction.

### `$schema` and `$ref`

- Put `"$schema": "../_schema/manifest.schema.json"` at the top of every manifest.
  Editors use it for hover-docs and autocomplete; the runtime ignores it (the
  publisher strips it before upload).
- **Inline `input_schema` and `output_schema`; do NOT `$ref` the meta-schema's
  `$defs`.** Published manifests are self-contained at runtime. The publisher does
  dereference `$ref`, so source manifests _can_ `$ref` for DRY-ness, but for a
  one-off experiment, inline. When in doubt, inline.
- For standard district-targeting params (state/city/l2DistrictType/l2DistrictName)
  copy the meta-schema's `$defs.districtInputs` shape inline into `input_schema`.

### `scope.allowed_tables` and `scope.max_rows`

List every Databricks table the agent queries in `scope.allowed_tables`. Pick
`max_rows` from the LARGEST single query:

| Largest query type                                                             | `max_rows`                                                  |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Aggregation over voter rows (`SUM(CASE WHEN ...)`, `COUNT(*)`) — returns 1 row | `1000` (also covers `information_schema.columns` discovery) |
| Returns voter-level rows (e.g. top-N candidates with attributes)               | `50000`                                                     |
| Returns a full district roll                                                   | don't — paginate or aggregate instead                       |

If unsure, start at `50000`, drop later once every query is confirmed small.
`information_schema.columns` discovery does NOT need to be in `allowed_tables` — the
broker recognizes it as metadata when the query references an allowlisted table in
its WHERE clause. Only data tables go in `allowed_tables`.

### Resource sizing

| Field             | Default         | When to deviate                                                                                           |
| ----------------- | --------------- | --------------------------------------------------------------------------------------------------------- |
| `model`           | `sonnet`        | `opus` only if reasoning quality is the bottleneck (rare); `haiku` for trivial transforms                 |
| `max_turns`       | `60`            | `15` one-query-one-output; `35` small batched query + assembly; `100` multi-step reasoning + web research |
| `timeout_seconds` | `1200` (20 min) | `600` trivial; `3000` (50 min) multi-step web + databricks                                                |

If unsure: `sonnet` / `60` / `1200`. There is no `cpu`/`memory` field — Fargate task
size is fixed in terraform (`2048`/`4096`); changing it is a terraform change, not a
manifest knob. There is no per-experiment env gate — the publish CLI always pushes
the FULL set under `experiments/<id>/` to the target env's bucket; promote by merging
branches (`dev` -> `qa` -> `main`), not by selecting experiments at publish time.

### Runtime knobs and fan-out

- **`runtime.max_parallel_subagents`** (0 = off, **cap 20**) — if the runbook has N
  independent research units (one per opponent / district / agenda item), set this.
  The harness wires a `researcher` subagent the parent dispatches concurrently via
  the `Agent` tool, each inheriting the parent's tools, model, permission mode, and
  broker scope (no extra egress; can't recursively fan out). Structure that step as
  "one independent unit per item," with a sequential loop as the documented fallback.
  The subagent count is bounded by your item count AND this cap; the join is gated by
  the slowest unit. **The researcher's base prompt does NOT know your output
  contract** — it knows only generic "research + verify URLs with `http.head`." Your
  instruction must hand each subagent the experiment-specific contract (templated
  dispatch below).
- **`runtime.max_thinking_tokens`** (e.g. `0`) — set to `0` to DISABLE extended
  thinking for procedural experiments (most are). Extended thinking can eat the whole
  turn budget on reasoning before any output; disabling it was one of the biggest
  single speedups measured.
- **`scope.data_required_unless`** — declare placeholder / early-exit branches where
  a run legitimately produces no data query (e.g. an "awaiting agenda" placeholder
  artifact). Lets the scope check tolerate a run that skips the data step.

**Fan-out speed patterns (proven on `opposition_research`, ~18min -> ~5min):**

1. **Templated dispatch** — write the researcher brief ONCE, dispatch SHORT pointers.
   Don't hand-author a full prompt per item (authoring time grows linearly with N).
   Have the orchestrator write the full per-unit brief (rules + the exact output
   contract, with `<ITEM>` placeholders) once to
   `/workspace/scratch/researcher_brief.md`, then dispatch each researcher with a tiny
   prompt: "Read `/workspace/scratch/researcher_brief.md`; your item is `<X>`; write
   your result to `/workspace/scratch/item_NN.json`." Emit all N `Agent` calls in ONE
   assistant turn.
2. **Write-direct** — subagents write fragments, don't return them inline. Each unit
   writes its complete result JSON to `/workspace/scratch/item_NN.json` and returns
   one line. Keeps the parent's context lean; assembly is a file merge, not a
   per-item compose loop. Each unit should also emit its OWN publish-ready
   `markdown_block` (push per-item formatting into the parallel units).
3. **Canned merge** — ship `assemble.py` as an ATTACHMENT, don't make the agent write
   it. Put deterministic helpers (e.g. `assemble.py` that reads the fragments +
   `PARAMS_JSON` and emits the artifact + runs spot-checks) in
   `experiments/<slug>/attachments/`; the runner writes every attachment to
   `/workspace/<basename>`. The assembly step becomes `python3 /workspace/assemble.py`
   - `validate_output.py` — no build-a-script-then-edit loop. (Static briefs can ship
     this way too.)
4. **Verify-once / fast-bail** — verify each unique URL at most once; if a unit can't
   confirm its item in 1-2 searches, bail to `no_info` immediately rather than
   escalating to the browser and gating the whole join.

### `output_schema` (JSON Schema Draft-07)

The runbook usually outputs Markdown for humans; the experiment outputs JSON for the
dashboard. Translate:

- `$schema: "http://json-schema.org/draft-07/schema#"` at the top.
- `title`, `type: "object"`, `additionalProperties: false` (always, on every object).
- `required: [...]` on every object listing every guaranteed field.
- `minLength`/`maxLength` on strings; `minimum`/`maximum` on numbers;
  `minItems`/`maxItems` on arrays.
- `pattern` to constrain strings (e.g. `^hs_[a-z0-9_]+$`, `^https?://`).
- For dates use `format: "date"` / `format: "date-time"` over hand-rolled regex.
- Always a root `generated_at` timestamp (`format: "date-time"`).
- "Exactly 5 entries" -> `minItems: 5, maxItems: 5`. This is a contract, not a hint.
- **Nullable fields**: when an upstream step may not produce a value, encode it as
  `"type": ["integer", "null"]` and KEEP the field in `required` — the contract is
  "this field is always emitted; sometimes its value is null." Don't drop it from
  `required` and let it be absent; that lets the agent silently skip it.

**Tighter is better.** Loose schemas let the agent ship malformed artifacts the
runner rejects post-hoc; tight schemas surface the violation in-loop where the agent
can fix it cheaply. The artifact S3 key is fixed by runtime convention to
`<experiment_id>/<run_id>/artifact.json` — not configurable. The agent writes its
working file to `/workspace/output/<slug>.json`; the runner publishes it to that key.

### Validate the manifest

```bash
cd packages/runbooks/scripts/python
uv run pytest test_experiment_manifests.py -v
```

This runs the meta-schema validator, checks directory/id alignment, JSON Schema
Draft-07 conformance of `input_schema`/`output_schema`, and required `instruction.md`
presence. CI runs the same tests on PR.

## CRITICAL RULES / broker quirks

Paste the relevant subset of this block VERBATIM into the instruction's
`## CRITICAL RULES`. The agent cannot discover any of it on its own. This block is
the single highest-value artifact in this skill.

**Databricks (`/databricks/query`)** — include if your scope has any `allowed_tables`:

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
- The broker enforces an SSRF guard + URL allowlist on every rung. Private IPs and internal hostnames are blocked; on `http.get`, a blocked third-party _sub-resource_ (tracker) no longer fails the host page.
- **The container is network-quarantined — there is NO direct egress.** `urllib`/`requests`/`httpx`/`curl`/`wget`/`socket` cannot reach the internet; a runtime guard now fails them in <1s with an instructive message (before the guard, they hung ~30s+ and torched runs). **The agent reaches for `urllib` reflexively no matter how many times the prompt says not to** — this is a probabilistic prior, not a comprehension gap, so do NOT rely on "never use urllib" prose to prevent it. Two things actually work: (a) the runtime guard (already deployed), and (b) handing the agent the EXACT ready-to-run call. Whenever your instruction tells the agent to verify/fetch a URL, give it the literal line `from pmf_runtime import http; r = http.head(url)` — a "verify URLs" instruction WITHOUT the exact call is what the urllib reflex fills.

**Output (always include):**

- Write **only** to `/workspace/output/<slug>.json`. The runner publishes nothing else.
- Run `python3 /workspace/validate_output.py` before declaring success. The
  runner-level validator rejects the artifact post-hoc if you skip this; in-loop
  validation lets you fix violations cheaply.

## Databricks querying for cloud experiments

**This targets CLOUD-DEPLOYED experiments, not local runbooks.** The two paths
differ in both access mechanism and table:

|              | Local runbook                                       | Deployed CAP experiment                                                             |
| ------------ | --------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Access       | `scripts/python/databricks_query.py` (direct creds) | `from pmf_runtime import databricks as sql` (brokered)                              |
| Tables       | per-state `stg_dbt_source__l2_s3_{state}_*`         | single nationwide `goodparty_data_catalog.dbt.int__l2_nationwide_uniform_w_haystaq` |
| Scope filter | you write state/city WHERE clauses                  | broker AUTO-INJECTS state (and any city) — do NOT add them                          |

A deployed agent ALWAYS uses the brokered path against the single nationwide table:

```python
from pmf_runtime import databricks as sql
conn = sql.connect()
cur = conn.cursor()
cur.execute("SELECT ... FROM goodparty_data_catalog.dbt.int__l2_nationwide_uniform_w_haystaq WHERE ... ", {...})
rows = cur.fetchall()
```

Use `packages/runbooks/books/query-voter-data.md` for column knowledge ONLY — its
access pattern and tables are the local path and do NOT apply to a cloud agent.

### Worked example A — L2 district-value discovery

PARAMS may pass `l2DistrictName='25'` while the real value in L2 is
`'NEW YORK CITY CNCL DIST 25 (EST.)'`. When `l2DistrictType` is set, run one
discovery query, then match against `PARAMS.l2DistrictName` (exact, else
case-insensitive substring). Skip this entirely when `l2DistrictType` is absent.

```python
import re
assert re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", l2_type)  # ASCII-only identifier
cur.execute(f"""
  SELECT DISTINCT `{l2_type}` AS district_value, COUNT(*) AS n
  FROM goodparty_data_catalog.dbt.int__l2_nationwide_uniform_w_haystaq
  WHERE Voters_Active = 'A'
  GROUP BY `{l2_type}`
  ORDER BY n DESC
  LIMIT 200
""", {})
rows = cur.fetchall()
district_value = next((r[0] for r in rows if r[0] == L2_NAME), None) or next(
    (r[0] for r in rows if L2_NAME and L2_NAME.lower() in str(r[0]).lower()), None
)
```

If no match, record `haystaq_status: "no_match"` and fall back to state scope.

### Worked example B — batched AVG with district-vs-state scope

Collect the picked `hs_*` columns and issue ONE batched query. Scope is district
when `l2DistrictType` is set AND confirmed (example A), otherwise state (the broker
auto-injects state). The agent does NOT scope by city — there is no city clause to
add, and adding `Residence_Addresses_City` returns `ScopeViolation`.

```sql
-- Whitelist-validate each picked column first: re.fullmatch(r"hs_[a-z0-9_]{1,60}", col)
-- District scope (l2DistrictType set + confirmed):
SELECT
  ROUND(AVG(CAST(`{col1}` AS DOUBLE)), 1) AS {col1},
  ROUND(AVG(CAST(`{col2}` AS DOUBLE)), 1) AS {col2},
  COUNT(*) AS voter_count
FROM goodparty_data_catalog.dbt.int__l2_nationwide_uniform_w_haystaq
WHERE `{l2_type}` = :l2_name AND Voters_Active = 'A';

-- State scope (drop the district clause; broker auto-injects state):
SELECT
  ROUND(AVG(CAST(`{col1}` AS DOUBLE)), 1) AS {col1},
  COUNT(*) AS voter_count
FROM goodparty_data_catalog.dbt.int__l2_nationwide_uniform_w_haystaq
WHERE Voters_Active = 'A';
```

`:l2_name` binds the value confirmed in example A. If no priority item picked a
column, skip the query entirely — no zero-column queries.

### Worked example C — coverage / lean variant

For a per-issue lean annotation, batch a per-column AVG plus a coverage COUNT, drop
any column below ~80% coverage, and compute lean as `AVG - 50` (the `hs_*` scores are
within-state percentile ranks centered on 50, so the lean is "distance from the
average voter in this state," NOT absolute support). District scope makes the lean
meaningful — averaged over the whole state every lean collapses to ~0.

```python
sums_sql = ", ".join(
    f"ROUND(AVG(`{c}`),1) AS `avg_{c}`, COUNT(`{c}`) AS `cov_{c}`" for c in candidate_cols
)
where = "Voters_Active = 'A'"
params = {}
if district_value is not None:
    where = f"`{l2_type}` = :l2_name AND " + where
    params = {"l2_name": district_value}
cur.execute(f"""
  SELECT COUNT(*) AS n, {sums_sql}
  FROM goodparty_data_catalog.dbt.int__l2_nationwide_uniform_w_haystaq
  WHERE {where}
""", params)
row = cur.fetchone()
```

If `l2_type` was set but `n` is in the millions, the district clause didn't apply —
record a `state_fallback` note and treat the lean as low-confidence. Use `AVG`, never
a thresholded count, for the lean.

## Testing in dev

Schema-valid does NOT mean working. The only way to know is to run it on Fargate.

### Deploy-before-run matrix

The dispatch always runs whatever is currently deployed — it does NOT pick up your
working tree. What you changed determines what you must deploy first:

| You changed                                          | How to make it live                                                                                      | Wait for?                                                                     |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `instruction.md` / `manifest.json` / `attachments/*` | `cd packages/runbooks/scripts/python && AWS_PROFILE=work uv run python publish_experiments.py --env=dev` | ~60s (Lambda caches `index.json`)                                             |
| runner / harness code (`pmf_engine/`)                | `gh workflow run build-pmf-engine.yml --ref <branch> -f environment=dev`                                 | build (~7 min). Fresh task per dispatch -> next dispatch uses it, no rollover |
| broker code (`broker/`)                              | `gh workflow run build-broker.yml --ref <branch> -f environment=dev`                                     | build AND ECS rollover — broker-dev is a long-running service                 |

Broker rollover check (only when you rebuilt the broker):

```bash
AWS_PROFILE=work aws ecs describe-services --cluster broker-dev --services broker-dev \
  --query 'services[0].[deployments[?status==`PRIMARY`].rolloutState | [0], length(deployments)]' --output text
# Ready when it prints:  COMPLETED   1   (IN_PROGRESS / 2 means still draining the old task)
```

Dispatching mid-rollover can hit the old task behind the ALB and contaminate the run.

### 1. Publish

```bash
cd packages/runbooks/scripts/python
AWS_PROFILE=work uv run python publish_experiments.py --env=dev
```

The script validates every manifest, uploads per-experiment files, then writes
`index.json` LAST (atomic switch). If validation fails, S3 is untouched. New
dispatches see the new bytes within ~60s (Lambda's `index.json` TTL cache).

> **`main` CI clobbers dev.** The dev `index.json` and broker-dev track the
> `main` branch. If a `main` build runs after your manual publish, it
> re-publishes and reverts your eng-branch changes. After dispatching from an eng
> branch, re-check your entry is present
> (`AWS_PROFILE=work aws s3 cp s3://agent-experiment-metadata-dev/index.json -`) and
> re-run `publish_experiments.py` if needed.

### 2. Dispatch via raw SQS

Params **must satisfy the manifest's `input_schema`** — the Lambda validates before
launching. The wire field is **`experiment_type`** (NOT `experiment_id`).

```bash
EXP=<your_slug>
RUN_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
ORG="smoke-$(whoami)-$(date +%s)"          # throwaway org slug

BODY=$(cat <<EOF
{
  "experiment_type": "$EXP",
  "run_id": "$RUN_ID",
  "organization_slug": "$ORG",
  "params": { "...": "match the manifest input_schema" }
}
EOF
)

AWS_PROFILE=work aws sqs send-message \
  --queue-url https://sqs.us-west-2.amazonaws.com/333022194791/agent-dispatch-dev.fifo \
  --message-body "$BODY" \
  --message-group-id "agent-dispatch-$ORG" \
  --message-deduplication-id "$RUN_ID"

echo "artifact -> s3://gp-agent-artifacts-dev/$EXP/$RUN_ID/artifact.json"
```

FIFO dedup is keyed on `RUN_ID` — use a fresh `RUN_ID` per dispatch. Get the
`input_schema` shape from the published manifest:
`AWS_PROFILE=work aws s3 cp s3://agent-experiment-metadata-dev/$EXP/manifest.json - | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["input_schema"], indent=2))'`.

For **cohort-scale dev testing** — many real dev users bound to real ICP offices so
ICP-gated dispatch fires — use the `create-representative-test-cohort` skill to mint
the cohort and emit an org-slug manifest, then dispatch each slug.

### 3. Monitor

```bash
# Lambda: confirm it accepted the params and launched a task
AWS_PROFILE=work aws logs tail /aws/lambda/pmf-engine-dispatch-dev --since 5m --format short \
  | grep -iE "$RUN_ID|Dispatching|Started Fargate task|reject|error"
# No "Started Fargate task" line => params were rejected; the validation error is here.

# Runner: the agent turn-by-turn (tool calls, completion, cost, errors)
AWS_PROFILE=work aws logs tail /ecs/pmf-engine-dev --since 10m --follow --format short \
  | grep -iE "Experiment:|run_agent.*\[|Agent completed|Cost:|ERROR"

# Broker (only when debugging egress/SSRF/scope): drop health + anthropic noise
AWS_PROFILE=work aws logs tail /ecs/broker-dev --since 10m --format short | grep -vE "health|anthropic"
```

A clean finish logs `Agent completed: N turns, M messages. Cost: $X` then
`Published artifact via broker for run <RUN_ID>`.

### 4. Fetch and validate the artifact

```bash
AWS_PROFILE=work aws s3 cp s3://gp-agent-artifacts-dev/$EXP/$RUN_ID/artifact.json - | python3 -m json.tool
# The full per-turn session log is alongside it:
AWS_PROFILE=work aws s3 cp s3://gp-agent-artifacts-dev/$EXP/$RUN_ID/logs/session.jsonl /tmp/session.jsonl
```

Schema-valid is not functional — eyeball the content. The first dispatch is where
instruction gaps surface as wasted turns: watch the runner log for the agent
introspecting an API (`dir()`/`help()`), recovering from a broker `ScopeViolation` /
`422`, re-validating repeatedly, or reaching for `urllib`. Each wasted turn is a gap
to patch in YOUR instruction (or this skill), then republish and re-dispatch.

### Iterating on a published experiment

No redeploy needed: edit `instruction.md` / `manifest.json`, bump `version`, re-run
`publish_experiments.py --env=dev`, dispatch a new SQS message — the next run picks up
the new bytes within ~60s. Each Fargate run captures the manifest + instruction
`VersionId` at dispatch, so an in-flight run is unaffected by your edit.

### Promoting to qa / prod

The git branch is the curation surface: `dev` -> `agent-experiment-metadata-dev`,
`qa` -> `...-qa`, `main` -> `...-prod`. GH Actions auto-publishes the FULL set on
every push to `dev`/`qa`/`main`. Promote by opening a PR `dev -> qa` (or `qa -> main`)
carrying the verified experiment dirs; CODEOWNERS gates the `main` PR. Don't promote
until you've verified the experiment end-to-end in dev, including a sanity-check on
the actual artifact data.

## Spot-check and common failures

Validator-passing JSON can still be garbage. End your instruction's `## Spot-check`
with the relevant subset of these:

- **`total_active_voters` matches the whole city, not the district** -> your L2
  district WHERE clause matched zero rows; the broker's auto-injected city scope was
  the only filter that hit. Re-confirm `l2DistrictType` / `l2DistrictName` came
  verbatim from PARAMS_JSON.
- **All top-N percentages <5%** -> you used `= 1` instead of `>= 50` (binary inference
  from suffix). Re-do the distribution check.
- **Multiple top-N entries from the same policy area** -> candidate selection too narrow.
- **News URL doesn't load or doesn't mention the issue** -> don't trust search
  snippets blindly; `pmf_runtime.http.get(url)` the page and confirm.

### Common failures (system-level, not instruction-level)

| Symptom                                                  | Cause                                                                             | Fix                                                                                          |
| -------------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Lambda log: `Missing required field: experiment_type`    | Sent `experiment_id` instead of `experiment_type`                                 | Use `experiment_type` in the SQS body                                                        |
| Broker 500 on `/experiment/manifest` with `AccessDenied` | IAM role missing `s3:GetObjectVersion`                                            | Add to terraform module `agent-experiment-metadata`                                          |
| Lambda log: `Unknown experiment '<id>'`                  | Manifest not in `index.json` for the target env (dir not on the env's branch yet) | Merge the dir into the env's branch; auto-publish updates `index.json` within ~60s           |
| Broker logs `ScopeViolation: scope_predicate_override`   | Agent added `WHERE Residence_Addresses_State/City`                                | Update CRITICAL RULES; broker auto-injects state/city                                        |
| Broker 422 on `/databricks/query` repeatedly             | Positional `?`, Postgres `FILTER`, `Voters_Active = 1`, or unauthorized table     | Restate the rules; consider a tiny "test query" the agent runs first                         |
| Top issues all 0-5% support                              | `= 1` instead of `>= 50`                                                          | Add a "distribution check" step + restate "all `hs_*` are 0-100 scores regardless of suffix" |
| `total_active_voters` looks like the whole city          | District name doesn't exist; broker's city scope is the only filter that matched  | Bake the verified district into PARAMS before dispatch                                       |
| Run hangs ~30s+ on a URL / agent uses `urllib`/`curl`    | Quarantined network; direct egress fails                                          | Hand the agent the literal `pmf_runtime.http.head/get/download` call                         |
| Runner: `No artifact files found in /workspace/output`   | Agent ran out of turns or never wrote the file                                    | Increase `max_turns`; tighten the instruction; remove discovery steps                        |
| `contract_violation` after the agent claimed success     | Validator caught a missing/wrong-typed field                                      | Add an explicit `python3 /workspace/validate_output.py` step BEFORE declaring success        |
| Your instruction/manifest change had no effect           | Didn't republish, or a `main` build clobbered it                               | Re-run `publish_experiments.py --env=dev`; confirm the entry in `index.json`                 |

## See also

- `packages/runbooks/experiments/AGENTS.md` — runbook -> experiment lifecycle, naming, the clean-context author loop, the `qa/` gate
- `packages/runbooks/books/run-pmf-experiment-cloud.md` — the operational run/dispatch companion
- `packages/runbooks/books/query-voter-data.md` — voter table/column knowledge (local path; reference only)
- `packages/runbooks/experiments/_schema/manifest.schema.json` — the meta-schema (source of truth)
- `packages/runbooks/scripts/python/publish_experiments.py` — the publish CLI
