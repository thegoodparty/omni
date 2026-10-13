# District Issue Pulse

Given a state + district, produce the top 5 issues voters there care about and pair each with one recent local news headline. Combines Haystaq priority scores from Databricks (`int__l2_nationwide_uniform_w_haystaq`) with current local discourse pulled from the web. Both signals are required: voter scores tell you what residents privately care about, news shows whether the issue is alive in local discourse right now.

## BEFORE YOU START
1. Read this entire instruction end-to-end before executing anything.
2. Maintain a TodoWrite list mirroring the TODO CHECKLIST below.
3. Your params are in the JSON file named by the `PARAMS_FILE` env var. Read them once at the top.
4. Write the final artifact to `/workspace/output/district_issue_pulse.json` and nowhere else.
5. Run `python3 /workspace/validate_output.py` before declaring success.
6. Perform the spot-check at the bottom — validator-passing data can still be garbage.

## TODO CHECKLIST
1. Read PARAMS_FILE. Capture `state`, `city`, `l2DistrictType`, `l2DistrictName`.
2. Discover candidate `hs_*` issue columns via `information_schema.columns`.
3. Run a distribution check on 3 sample `hs_*` columns to confirm they are 0-100 continuous scores (not binary).
4. Run ONE batched aggregation query that returns `total_active` plus per-candidate `SUM(CASE WHEN >= 50 THEN 1 ELSE 0 END)` for ~10-12 candidate columns.
5. Sort the per-issue counts descending. Take the top 5.
6. For each top-5 issue: `WebSearch` `<city> <state> <issue label> 2026`, then `pmf_runtime.http.get(url)` the most credible local result to extract source name, URL, published date, and a one-sentence summary.
7. Assemble the artifact and write to `/workspace/output/district_issue_pulse.json`.
8. Run `python3 /workspace/validate_output.py`.
9. Perform the spot-check.

## CRITICAL RULES

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

- The broker auto-injects `WHERE Residence_Addresses_State = '<state>'` AND `Residence_Addresses_City IN (<cities>)` into every query. **DO NOT add these clauses yourself.** Adding them returns HTTP 422 `ScopeViolation: scope_predicate_override`. The only WHERE clauses your query needs are the L2 district column and `Voters_Active = 'A'`.
- **`Voters_Active` is a STRING.** Use `Voters_Active = 'A'`. `Voters_Active = 1` matches zero rows.
- **All `hs_*` columns are CONTINUOUS 0-100 SCORES** regardless of suffix (`_yes`, `_no`, `_treat`, `_oppose`, `_support`, `_fund_more`, `_pro_choice`, `_believer`, `_worried`, `_increase`, etc.). Threshold with `>= 50` (moderate) or `>= 70` (strong). Using `= 1` because the name "looks binary" inverts your rankings — you will get all top issues at <5%.
- **Scores are within-state percentile ranks (mean ~50), so `>= 50` counts voters at or above the state median.** `voter_percentage` therefore means the share of active district voters at or above the state median on that issue — NOT absolute issue support, and ~50% means "typical for the state", not a 50/50 opinion split; the informative ranking signal is the deviation from 50%. A score is not a percentage, not an observed survey answer, and not a comparison across states; a low score is a lean away from the labeled stance, not evidence of the opposite stance. Never frame `voter_percentage` as "X% of voters support Y". Exception: `hs_new_home_buyer`/`hs_any_home_buyer` are ~60-baseline propensity models — the percentile read and thresholds do not apply; they are not stance columns and the Step 2 suffix filter deliberately excludes them (do not add them back). Second exception: ~51 `hs_*` columns exist only in the 12-state December 2025 delivery and are null elsewhere — an all-null column scores 0% with a correct query; that is no coverage, not opposition (a NULL `max` in Step 3 confirms it; exclude the column). Separately, even covered columns carry nulls: voters registered after the vendor's spring snapshot are unscored everywhere, and Texas (~72% scored) and Utah (~82%) trail every other state (90%+) on the nationwide columns (those outside the 12-state December 2025 set; vendor-side). Nulls are unscored voters, not errors; they stay in the `>= 50` denominator, so expect somewhat lower `voter_percentage` in Texas and Utah.
- **Conditional counts use `SUM(CASE WHEN ... THEN 1 ELSE 0 END)`.** Postgres `COUNT(*) FILTER (WHERE ...)` is a syntax error in Databricks.
- **Use named placeholders** when parameterizing: `cursor.execute("... WHERE col = :foo", {"foo": value})`. Positional `?` raises a SQL error.
- **Every query must reference an allowed table.** Bare `SELECT 1` (no FROM) is rejected.
- **The L2 district column name is the VALUE of `PARAMS.l2DistrictType`** (e.g. `City_Ward`). The value to match is `PARAMS.l2DistrictName`. Backtick-quote the column: `` `City_Ward` = 'FAYETTEVILLE CITY WARD 2' ``.

**Web (`WebSearch` + `pmf_runtime.http.get`)**:

- **Use `WebSearch` for URL discovery.** The Claude SDK built-in `WebSearch` works (returns search results with URLs and snippets). Do NOT use `WebFetch` — the runner is in a quarantined network and `WebFetch` returns "Unable to verify if domain X is safe to fetch" because claude.ai's domain-safety check can't reach it.
- **Use `pmf_runtime.http.get(url)` for page retrieval** (broker-proxied). Verbatim:

  ```python
  from pmf_runtime import http
  r = http.get("https://example.com/article")
  # r = {"status": 200, "headers": {...}, "body": "<html>…</html>"}
  print(r["body"][:2000])
  ```

  The response is a **plain dict** — `r["status"]` (int), `r["headers"]` (dict), `r["body"]` (str). It is NOT a `requests.Response`. Calling `r.status_code` or `r.text` raises `AttributeError`.

- The broker enforces an SSRF guard and URL allowlist on `http.get`. Private IPs and internal hostnames are blocked.

**Output**:

- Write **only** to `/workspace/output/district_issue_pulse.json`. The runner publishes nothing else.
- Run `python3 /workspace/validate_output.py` before declaring success. The runner-level validator will reject the artifact post-hoc if you skip this; in-loop validation lets you fix violations cheaply.

## Steps

### Step 1 — Read params

```python
import json, os
PARAMS = json.load(open(os.environ["PARAMS_FILE"]))
STATE = PARAMS["state"]
CITY = PARAMS["city"]
L2_TYPE = PARAMS["l2DistrictType"]
L2_NAME = PARAMS["l2DistrictName"]
```

### Step 2 — Discover candidate `hs_*` columns

The discovery query references the allowlisted table in the WHERE clause. The broker recognizes the `information_schema.columns` metadata pattern and allows it.

```sql
SELECT column_name FROM information_schema.columns
WHERE table_catalog = 'goodparty_data_catalog'
  AND table_schema = 'dbt'
  AND table_name = 'int__l2_nationwide_uniform_w_haystaq'
  AND column_name LIKE 'hs_%'
ORDER BY column_name
LIMIT 1000
```

Filter the returned column names to issue-stance columns by suffix: `_support`, `_oppose`, `_yes`, `_no`, `_treat`, `_fund_more`, `_pro_choice`, `_believer`, `_worried`, `_good`, `_bad`, `_too_harsh`, `_too_lax`, `_increase`, `_decrease`, `_has_role`, `_at_fault`, `_no_fault`. This filter also deliberately excludes `hs_new_home_buyer`/`hs_any_home_buyer` (~60-baseline propensity models, not stance columns — see the score rule in CRITICAL RULES); do not add them back. Pick 10-12 candidates that span distinct policy areas (don't pick three crime columns). The full set is large — never try to score all 300+ in one query.

### Step 3 — Distribution check (REQUIRED — do not skip)

Confirm `hs_*` are 0-100 continuous scores in this district. Pick 3 of your candidates; the broker auto-injects state+city, you only add the district + active filter:

```sql
SELECT
  AVG(`hs_<candidate_a>`) AS a_avg, MAX(`hs_<candidate_a>`) AS a_max,
