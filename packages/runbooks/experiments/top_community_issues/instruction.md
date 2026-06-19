<!-- The schemas in manifest.json are the stable contract. This prose encodes the method; the JSON Schema is what the validator enforces. -->

# Top Community Issues

Given an elected official's jurisdiction, produce a ranked list of up to 10 community issues that matter most to constituents — **each one a specific, currently-live, office-actionable problem**, not a policy category. Two signals are combined. Haystaq priority scores from Databricks (`int__l2_nationwide_uniform_w_haystaq`) reveal what residents privately weight across issue domains — the salience anchor. Current local discourse (council legislation/agendas, city government releases, local news) names the specific live instance inside each salient domain and proves it is alive right now. Haystaq tells you *which domains* are hot; the web tells you *the named thing* that is happening in that domain and whether the office can act on it. Begin by reading the current issue feed via the MCP tool so carried issues keep their existing IDs.

## What counts as an issue (this drives everything)

**An issue is a problem the office in `PARAMS.office` could conceivably act on.** For a city council member, a city councilor; for a mayor, the mayor; for a school board, the board. This rules out most federal/state policy lean (abortion, guns, national immigration, Medicare-for-all) — treat those as context only, never as a row. Office-actionable issues are operational and hyperlocal: a specific rezoning or development, a sewer/water rate change, a budget line, blight/demolition, a transit or street project, local public-safety operations and oversight, parks, permitting, local taxes and fees.

**Every output row MUST be a specific named issue, not a taxonomy category.** "Housing" is not an issue; "the Innerbelt rezoning and at-risk $10M DOT grant" or "the 2026 sewer rate increase plus new fixed monthly charge" is. The `category` field is only a tag; the `title` must name the concrete instance — the actual ordinance, project, vote, dollar figure, or location.

**Lead with what is live now.** Haystaq is a durable salience prior; on its own it just reweights the same generic domains every time. The deliverable must lead with what is currently in front of the office — which requires current sources (local news, live council agendas/legislation, city government releases). Pulling these is required, not optional.

**Re-verify every fact against a current source before you publish it.** Do not assert a measure, vote, or project from memory or from a search snippet alone. Confirm the office actually holds the lever (e.g. many states preempt local rent control — don't list it as a council issue where it's preempted). Name dollars, dates, votes, and locations, and attach a source to each. A confident-but-wrong issue is worse than a thinner true one.

## Source order

Quantitative anchor first, then the current-discourse sources that name and date the live instance. The council/government record is the most on-definition signal for actionability; news confirms it is live; Haystaq weights it by private salience.

1. **Haystaq priority scores (Databricks, always available).** The private-salience anchor across issue domains. One batched aggregation (below). Not actionable on its own and not a report row — it ranks the *domains*, you find the named instance.
2. **Live council/government record** — agendas, minutes, ordinances, legislation, city government releases — via `WebSearch`. The current continuation of what the office actually deliberates; this is where the named, dated, office-actionable instance lives.
3. **Local civic news**, via `WebSearch`. Confirms the issue is live now and supplies dollars/dates/votes.
4. **311 / service requests, resident surveys, neighborhood / capital / participatory-budget plans** — via `WebSearch`, when discoverable. Resident-demand and actionable, geo-specific. Use if found; flag as missing if not.

LocalView meeting-transcript parquet and any other local files are **not available in this environment** — the container is network-quarantined with no local corpus. The council-deliberation signal therefore comes from sources 2–3 (live web), not a transcript pull.

## BEFORE YOU START

1. Read this entire instruction end-to-end before executing anything.
2. Maintain a TodoWrite list mirroring the TODO CHECKLIST below.
3. Your params are in the `PARAMS_JSON` env var. Read them once at the top.
4. Write the final artifact to `/workspace/output/top_community_issues.json` and nowhere else.
5. Run `python3 /workspace/validate_output.py` before declaring success.
6. Perform the spot-check at the bottom — validator-passing data can still be garbage.

## TODO CHECKLIST

1. Read PARAMS_JSON. Capture `organization_slug`, `state`, `office`, `district_descriptor`.
2. Call `GET_v1_community-issue-feed` with `organization_slug` to retrieve the current issue list. Record existing issue IDs, titles, categories.
3. Discover candidate `hs_*` issue columns via `information_schema.columns`.
4. Run a distribution check on 3 sample `hs_*` columns to confirm they are 0-100 continuous scores.
5. Run ONE batched aggregation returning per-domain `SUM(CASE WHEN >= 50 THEN 1 ELSE 0 END)` counts for ~12-15 community-relevant candidate columns. Drop any column returning 0 (no coverage in this state).
6. Rank the surviving domains by share of active voters. This is the salience prior — a ranked list of *domains*, not the report.
7. For each high-salience, office-actionable domain (top ~10), `WebSearch` the **live council/government record and local news** to find the specific named issue currently in front of the office. Lead with what is live now. Drop domains that are pure federal/state lean (context only, not office-actionable).
8. Re-verify each issue against a current source: confirm the office holds the lever; capture dollars, dates, votes, locations; verify the source URL is live with `pmf_runtime.http.head`. Drop or downgrade anything you cannot confirm.
9. Match each output issue against the existing feed: carry `existing_issue_id` when the issue maps to an existing record. Prefer carrying the ID over creating a duplicate.
10. Classify each issue into exactly one `category` from the allowed enum (the category is a tag; the title is the named instance).
11. Assign `priority` (`low|medium|high`) and `rank` (1 = most important). Blend private salience (Haystaq share) with how live and how office-actionable the issue is. High resident salience + low current official activity is the opportunity signal — note it.
12. Deduplicate `detail.sources[]` by URL. Verify every `source_id` referenced in `source_ids` / `source_id` fields resolves to an entry in `detail.sources[]`.
13. Set `sources_used`, `data_quality`, `data_quality_reason`, `notes` honestly — name any missing source layer (no 311 feed, no resident survey, Haystaq domains dropped for zero coverage).
14. Assemble artifact and write to `/workspace/output/top_community_issues.json`.
15. Run `python3 /workspace/validate_output.py`.
16. Perform the spot-check.

## CRITICAL RULES

**Existing issue feed**:

- Call `GET_v1_community-issue-feed` FIRST, before any research. The API returns the complete current issue list for the organization.
- When an output issue corresponds to an issue already in the feed, set `existing_issue_id` to that issue's ID. Never drop a prioritized existing issue unless it is clearly resolved.
- Prefer carrying an existing ID over creating a net-new issue for the same underlying concern.

**Databricks (`pmf_runtime.databricks`)**:

- Connect via the `pmf_runtime.databricks` module — verbatim:

  ```python
  from pmf_runtime import databricks as sql
  conn = sql.connect()
  cur = conn.cursor()
  cur.execute("SELECT ... WHERE col = :foo", {"foo": value})
  rows = cur.fetchall()
  ```

  The module exports `connect()`, `Connection`, `Cursor`, `ScopeViolation`, `UpstreamError`. There is no `databricks.query()` shortcut — you must `connect() → cursor() → execute() → fetchall()`. Skipping this snippet costs 3+ turns to discover via `dir()`.

- The broker auto-injects `WHERE Residence_Addresses_State = '<state>'` AND `Residence_Addresses_City IN (<cities>)` into every query. **DO NOT add these clauses yourself.** Adding them returns HTTP 422 `ScopeViolation: scope_predicate_override`. The only WHERE clause your query needs is `Voters_Active = 'A'`.
- **`Voters_Active` is a STRING.** Use `Voters_Active = 'A'`. `Voters_Active = 1` matches zero rows.
- **All `hs_*` columns are CONTINUOUS 0-100 SCORES** regardless of suffix (`_yes`, `_no`, `_treat`, `_oppose`, `_support`, `_fund_more`, `_pro_choice`, `_believer`, `_worried`, `_increase`, etc.). Threshold with `>= 50` (moderate) or `>= 70` (strong). Using `= 1` because the name "looks binary" inverts your rankings — you will get all top issues at <5%.
- **Conditional counts use `SUM(CASE WHEN ... THEN 1 ELSE 0 END)`.** Postgres `COUNT(*) FILTER (WHERE ...)` is a syntax error in Databricks.
- **Use named placeholders** when parameterizing: `cursor.execute("... WHERE col = :foo", {"foo": value})`. Positional `?` raises a SQL error.
- **Named placeholders bind VALUES, not IDENTIFIERS.** Column names must be string-interpolated (f-string). Whitelist-validate any identifier before interpolating: `assert col in ALLOWED_COLS`.
- **Every query must reference an allowed table.** Bare `SELECT 1` (no FROM) is rejected. `information_schema.columns` discovery is allowed as long as the query references the allowlisted table in its WHERE clause.

**Web (`WebSearch` + `pmf_runtime.http`)**:

- **Use `WebSearch` for URL discovery.** Do NOT use `WebFetch` — the quarantined network can't reach claude.ai's domain-safety check, so it always fails.
- **Web-access escalation ladder — use the cheapest rung that answers the question, in this order. Do NOT jump to the browser:**
  1. `WebSearch` (free, fast) — snippets often answer the question outright.
  2. `pmf_runtime.http.head(url)` — verify a URL is live (the default for citation checks). Returns `{"status": int, "final_url": str}`; drop the source if not 200, cite `final_url` on redirect.
  3. `pmf_runtime.http.get(url)` — browser render (Chromium), LAST RESORT. Returns `{"status", "headers", "body", "source_url"}` (plain dict — `r["status"]`/`r["body"]`, never `.status_code`/`.text`). Use ONLY when head returned 403/405 or you must read the body to confirm a fact.

  ```python
  from pmf_runtime import http
  r = http.head("https://example.com/article")
  if r["status"] in (403, 405):
      r = http.get("https://example.com/article")
  ```

- **Re-rendering every URL with `http.get` is the classic perf trap** — it makes runs time out. Verify with `head`; render only when forced.
- **The container is network-quarantined — there is NO direct egress.** `urllib`/`requests`/`httpx`/`curl`/`wget`/`socket` cannot reach the internet; they fail fast with an instructive message. Whenever you need to verify or fetch a URL, use the literal line `from pmf_runtime import http; r = http.head(url)` — do not reach for `urllib`.

**Source integrity**:

- Every `source_id` referenced in `detail.overview.source_ids`, `detail.history.source_ids`, `detail.research.source_ids`, `detail.legislation.source_ids`, and `detail.quotes[].items[].source_id` MUST resolve to an entry in `detail.sources[]` with a matching `id`.
- Deduplicate `detail.sources[]` by URL before assembling.
- `detail.overview` is always required — never omit it.
- Every factual claim in a subsection (a dollar figure, a vote, a date, a project) must trace to a source in `source_ids`. An unsourced claim is a re-verify failure — drop it or source it.

**Output**:

- Write **only** to `/workspace/output/top_community_issues.json`. The runner publishes nothing else.
- Set `list: "top_community"` and `schema_version: 1` in the artifact root.
- Set `organization_slug` from PARAMS and `generated_for_run_id` from the `RUN_ID` env var.
- Run `python3 /workspace/validate_output.py` before declaring success.

## Steps

### Step 1 — Read params

```python
import json, os
PARAMS = json.loads(os.environ["PARAMS_JSON"])
ORG_SLUG = PARAMS["organization_slug"]
STATE = PARAMS["state"]
OFFICE = PARAMS["office"]
DISTRICT = PARAMS["district_descriptor"]
RUN_ID = os.environ.get("RUN_ID", "unknown")
```

### Step 2 — Read current issue feed

Call `GET_v1_community-issue-feed` with `organization_slug=ORG_SLUG`. Record every existing issue: capture `id`, `title`, and `category`. You will use these IDs in Step 9 to carry issues forward. A 404 means no feed yet — treat as empty and proceed.

### Step 3 — Discover Haystaq issue columns

```python
from pmf_runtime import databricks as sql
conn = sql.connect()
cur = conn.cursor()
cur.execute("""
  SELECT column_name
  FROM information_schema.columns
  WHERE table_name = 'int__l2_nationwide_uniform_w_haystaq'
    AND column_name LIKE 'hs_%'
  ORDER BY column_name
""", {})
hs_cols = [row[0] for row in cur.fetchall()]
```

Select ~12-15 candidate columns that map to **community / locally-actionable** domains (housing, schools, transit, infrastructure, public safety / police trust, local economy, environment). Skip purely national/partisan columns (abortion, guns, foreign policy, presidential lean) — they are context, not office-actionable rows.

### Step 4 — Distribution check (3 sample columns)

Run a quick count of distinct score buckets on 3 candidate columns to confirm they are 0-100 continuous, not binary. If any column returns only `0` and `1`, treat it as binary and exclude it.

### Step 5 — Batched aggregation (the salience anchor)

```python
ALLOWED_COLS = set(hs_cols)
assert all(c in ALLOWED_COLS for c in candidate_cols)

sums_sql = ", ".join(
    f"SUM(CASE WHEN `{c}` >= 50 THEN 1 ELSE 0 END) AS `{c}`"
    for c in candidate_cols
)
cur.execute(f"""
  SELECT COUNT(*) AS total_active, {sums_sql}
  FROM goodparty_data_catalog.dbt.int__l2_nationwide_uniform_w_haystaq
  WHERE Voters_Active = 'A'
""", {})
row = cur.fetchone()
```

Compute each domain's share = count / total_active. **Drop any domain whose count is 0** — that issue model has no coverage in this state (e.g. some states return 0 on `min_wage`, `violent_crime`, `opioid`). Note the dropped domains for `data_quality_reason`. Rank the survivors by share descending — this is your salience prior over *domains*.

### Step 6 — Find the named live instance per domain

For each high-salience, office-actionable domain (work down the ranked list, aim for up to 10 output issues), search the **current** record — lead with what is live now:

```python
# Prefer queries that surface live legislation / government action / recent news:
#   f"{DISTRICT} city council {domain_phrase} 2026"
#   f"{DISTRICT} {domain_phrase} ordinance OR budget OR vote 2026"
#   f"{DISTRICT} {domain_phrase} {local news outlet}"
```

For each domain, identify the **specific named issue** currently in front of the office (the ordinance, project, rate change, budget line, vote). That named instance — not the domain — is the output row's `title`. Drop any domain whose only live instances are federal/state matters the office can't act on.

### Step 7 — Re-verify and capture sources

For each candidate issue, confirm the facts against a current source and verify the URL is live:

```python
from pmf_runtime import http
r = http.head(url)                       # {"status": 200, "final_url": "https://..."}
if r["status"] in (403, 405):
    r = http.get(url)                    # browser render, only if head was blocked
# keep the source only if it resolves; cite r["final_url"] on redirect
```

Capture for each source: `name`, `source_type` (`news|government_website|research|poll`), `url`, `publisher`, `article_type`, `article_date`, `retrieved_at` (ISO-8601), and a `retrieved_text_or_snapshot` snippet. Confirm the office holds the lever; record dollars, dates, votes, locations. Drop anything you cannot confirm.

### Step 8 — Carry existing issue IDs

Compare each output issue against the existing feed from Step 2. When the issue clearly maps to an existing record, set `existing_issue_id`. Do not invent a mapping if it is ambiguous.

### Step 9 — Rank and assemble artifact

Rank by blending Haystaq private salience with how live and how office-actionable the named instance is. `rank` 1 = most important; `priority` in `{low, medium, high}`. Build each issue's `detail` with `sources[]`, a required `overview`, and `history` / `research` / `legislation` / `quotes` where you have sourced material. Every `source_id` must resolve.

```python
import json, datetime
artifact = {
    "schema_version": 1,
    "list": "top_community",
    "organization_slug": ORG_SLUG,
    "generated_for_run_id": RUN_ID,
    "issues": [...],            # up to 10 IssueOutput, each a specific named issue
    "sources_used": [...],      # the source layers actually used, e.g. ["haystaq", "local_news", "city_government", "council_legislation"]
    "data_quality": "ok",       # "partial" if some lookups failed; "insufficient_signal" if you couldn't ground the list
    "data_quality_reason": "...",  # name dropped Haystaq domains + any missing source layer (no 311, no survey)
    "notes": "...",
}
with open("/workspace/output/top_community_issues.json", "w") as f:
    json.dump(artifact, f, indent=2)
```

### Step 10 — Validate

```bash
python3 /workspace/validate_output.py
```

Fix any schema violations before declaring success.

## Spot-check

After validation passes, verify:

- **Every row is a specific named issue, not a category.** If a `title` reads like "Housing" or "Public safety," you stopped at the domain — go back to Step 6 and name the live instance.
- **The list leads with what is live now.** At least the top issues should reference a 2025-2026 ordinance, vote, project, or budget action — not an evergreen generic concern.
- **Every issue is office-actionable.** No federal/state-only matters (national abortion/guns/immigration) as rows. If one slipped in, drop it.
- **No unverified facts.** Every dollar figure, vote, and date traces to a source whose URL returned 200 via `head`. Re-confirm at least 3 issue URLs.
- **Top domains span at least 2 categories.** If every issue is one category, your column selection was too narrow.
- **Haystaq grounding is real.** If you used `= 1` instead of `>= 50`, top domains will all show <5% share — re-do Step 4/5.
- **`detail.overview` is present on every issue**, and `list` is `"top_community"`.
- **Coverage gaps are stated.** `data_quality_reason` names dropped zero-coverage Haystaq domains and any missing source layer (no 311 feed, no resident survey).

## Failure modes

| Symptom | Cause | Fix |
| --- | --- | --- |
| Rows are categories ("Housing", "Safety") not named issues | Stopped at the Haystaq domain; skipped Step 6 | Find the specific live ordinance/project/vote per domain; that is the title |
| List feels generic / stale | Didn't pull current sources; leaned on Haystaq alone | Search live council legislation + 2026 local news; lead with what's live |
| A listed issue isn't something the office can do | Skipped the office-actionability filter | Drop federal/state lean; confirm the office holds the lever |
| All domain shares < 5% | Used `= 1` instead of `>= 50` on `hs_*` | Re-run aggregation with `>= 50` |
| `ScopeViolation: scope_predicate_override` | Added `WHERE Residence_Addresses_State/City` manually | Remove those clauses; broker auto-injects them |
| Broker 422 on `/databricks/query` | Positional `?`, Postgres FILTER syntax, or unauthorized table | Use named placeholders; use `SUM(CASE WHEN ...)` |
| A Haystaq domain shows 0 | No coverage for that model in this state | Drop it; record in `data_quality_reason` |
| `source_id` not found in `detail.sources[]` | Referenced a source you never added | Add the matching entry to `detail.sources[]` |
| Validator: missing required field `overview` | `detail.overview` omitted | Always emit `overview`; it is required |
| `GET_v1_community-issue-feed` 404 | Organization has no feed yet | Treat as empty feed; proceed with empty existing_issue_ids |
