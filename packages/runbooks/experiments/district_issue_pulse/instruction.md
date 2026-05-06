# District Issue Pulse

Given a state + district, produce the top 5 issues voters there care about and pair each with one recent local news headline. Combines Haystaq priority scores from Databricks (`int__l2_nationwide_uniform_w_haystaq`) with current local discourse pulled from the web. Both signals are required: voter scores tell you what residents privately care about, news shows whether the issue is alive in local discourse right now.

## BEFORE YOU START
1. Read this entire instruction end-to-end before executing anything.
2. Maintain a TodoWrite list mirroring the TODO CHECKLIST below.
3. Your params are in the `PARAMS_JSON` env var. Read them once at the top.
4. Write the final artifact to `/workspace/output/district_issue_pulse.json` and nowhere else.
5. Run `python3 /workspace/validate_output.py` before declaring success.
6. Perform the spot-check at the bottom — validator-passing data can still be garbage.

## TODO CHECKLIST
1. Read PARAMS_JSON. Capture `state`, `city`, `l2DistrictType`, `l2DistrictName`.
2. Discover candidate `hs_*` issue columns via `information_schema.columns`.
3. Run a distribution check on 3 sample `hs_*` columns to confirm they are 0-100 continuous scores (not binary).
4. Run ONE batched aggregation query that returns `total_active` plus per-candidate `SUM(CASE WHEN >= 50 THEN 1 ELSE 0 END)` for ~10-12 candidate columns.
5. Sort the per-issue counts descending. Take the top 5.
6. For each top-5 issue: web search `<city> <state> <issue label> 2026`, then WebFetch the most credible local result to extract source name, URL, published date, and a one-sentence summary.
7. Assemble the artifact and write to `/workspace/output/district_issue_pulse.json`.
8. Run `python3 /workspace/validate_output.py`.
9. Perform the spot-check.

## CRITICAL RULES

**Databricks (`/databricks/query`)**:

- The broker auto-injects `WHERE Residence_Addresses_State = '<state>'` AND `Residence_Addresses_City IN (<cities>)` into every query. **DO NOT add these clauses yourself.** Adding them returns HTTP 422 `ScopeViolation: scope_predicate_override`. The only WHERE clauses your query needs are the L2 district column and `Voters_Active = 'A'`.
- **`Voters_Active` is a STRING.** Use `Voters_Active = 'A'`. `Voters_Active = 1` matches zero rows.
- **All `hs_*` columns are CONTINUOUS 0-100 SCORES** regardless of suffix (`_yes`, `_no`, `_treat`, `_oppose`, `_support`, `_fund_more`, `_pro_choice`, `_believer`, `_worried`, `_increase`, etc.). Threshold with `>= 50` (moderate) or `>= 70` (strong). Using `= 1` because the name "looks binary" inverts your rankings — you will get all top issues at <5%.
- **Conditional counts use `SUM(CASE WHEN ... THEN 1 ELSE 0 END)`.** Postgres `COUNT(*) FILTER (WHERE ...)` is a syntax error in Databricks.
- **Use named placeholders** when parameterizing: `cursor.execute("... WHERE col = :foo", {"foo": value})`. Positional `?` raises a SQL error.
- **Every query must reference an allowed table.** Bare `SELECT 1` (no FROM) is rejected.
- **The L2 district column name is the VALUE of `PARAMS.l2DistrictType`** (e.g. `City_Ward`). The value to match is `PARAMS.l2DistrictName`. Backtick-quote the column: `` `City_Ward` = 'FAYETTEVILLE CITY WARD 2' ``.

**Web (WebSearch / WebFetch)**:

- WebSearch and WebFetch route through the broker. Standard semantics, but the broker enforces an SSRF guard and URL allowlist. Private IPs and internal hostnames are blocked.

**Output**:

- Write **only** to `/workspace/output/district_issue_pulse.json`. The runner publishes nothing else.
- Run `python3 /workspace/validate_output.py` before declaring success. The runner-level validator will reject the artifact post-hoc if you skip this; in-loop validation lets you fix violations cheaply.

## Steps

### Step 1 — Read params

```python
import json, os
PARAMS = json.loads(os.environ["PARAMS_JSON"])
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

Filter the returned column names to issue-stance columns by suffix: `_support`, `_oppose`, `_yes`, `_no`, `_treat`, `_fund_more`, `_pro_choice`, `_believer`, `_worried`, `_good`, `_bad`, `_too_harsh`, `_too_lax`, `_increase`, `_decrease`, `_has_role`, `_at_fault`, `_no_fault`. Pick 10-12 candidates that span distinct policy areas (don't pick three crime columns). The full set is large — never try to score all 300+ in one query.

### Step 3 — Distribution check (REQUIRED — do not skip)

Confirm `hs_*` are 0-100 continuous scores in this district. Pick 3 of your candidates; the broker auto-injects state+city, you only add the district + active filter:

```sql
SELECT
  AVG(`hs_<candidate_a>`) AS a_avg, MAX(`hs_<candidate_a>`) AS a_max,
  AVG(`hs_<candidate_b>`) AS b_avg, MAX(`hs_<candidate_b>`) AS b_max,
  AVG(`hs_<candidate_c>`) AS c_avg, MAX(`hs_<candidate_c>`) AS c_max
FROM goodparty_data_catalog.dbt.int__l2_nationwide_uniform_w_haystaq
WHERE `<L2_TYPE>` = :district_name
  AND Voters_Active = 'A'
```

Pass `{"district_name": L2_NAME}`. Substitute `<L2_TYPE>` literally into the SQL string (it's a column identifier, not a value — placeholders can't bind identifiers).

If `max <= 1` for any column → it's binary; use `= 1` for that column. If `max ~= 100` → continuous; use `>= 50`. The runbook's experience says continuous is overwhelmingly the case; if you see binary, log a note in your reasoning and adjust thresholds for that specific column.

### Step 4 — Batched per-issue support query

ONE query, all 10-12 candidates at once. Build the SUM aggregations programmatically:

```python
candidates = [...]  # your 10-12 hs_* columns from step 2
aggs = ", ".join(
    f"SUM(CASE WHEN `{c}` >= 50 THEN 1 ELSE 0 END) AS `{c}`"
    for c in candidates
)
sql = f"""
SELECT
  COUNT(*) AS total_active,
  {aggs}
FROM goodparty_data_catalog.dbt.int__l2_nationwide_uniform_w_haystaq
WHERE `{L2_TYPE}` = :district_name
  AND Voters_Active = 'A'
"""
# execute with params={"district_name": L2_NAME}
```

The result is one row: `total_active` + one count per candidate column. Sort the per-candidate counts descending and take the top 5. Compute `voter_percentage = round(100.0 * voter_count / total_active, 1)` per issue.

Keep `hs_column` as the raw column name. Derive `issue_label` by stripping the `hs_` prefix and the stance suffix, replacing underscores with spaces, and title-casing (e.g. `hs_min_wage_15_increase_support` → "Min Wage 15 Increase").

### Step 5 — One news source per top issue

For each of the top 5: WebSearch `<city> <state> <issue_label> 2026` (or `2025` if 2026 returns nothing). Pick the most credible / most recent local news result. Then WebFetch that URL to confirm the page actually loads AND mentions the issue. If it doesn't mention the issue, pick the next result.

Capture per issue:
- `source_name`: the publication (e.g. "Fayetteville Observer")
- `url`: the article URL
- `published_date`: ISO date `YYYY-MM-DD` if visible on the page; omit if not findable
- `summary`: one sentence, <= 400 chars, describing what the article says about this issue in this city.

### Step 6 — Assemble and write

```python
import json, datetime, pathlib
artifact = {
  "generated_at": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
  "state": STATE,
  "city": CITY,
  "l2_district_type": L2_TYPE,
  "l2_district_name": L2_NAME,
  "total_active_voters": total_active,
  "top_issues": [
    {
      "rank": 1,
      "issue_label": ...,
      "hs_column": ...,
      "voter_count": ...,
      "voter_percentage": ...,
      "news": {"source_name": ..., "url": ..., "published_date": ..., "summary": ...}
    },
    # ranks 2..5
  ],
}
pathlib.Path("/workspace/output").mkdir(parents=True, exist_ok=True)
pathlib.Path("/workspace/output/district_issue_pulse.json").write_text(json.dumps(artifact, indent=2))
```

### Step 7 — Validate

```bash
python3 /workspace/validate_output.py
```

If validation fails, read the error, fix the artifact, re-run. Do NOT declare success until validation passes.

## Spot-check

Validator-passing JSON can still be garbage. Before declaring success, manually verify:

- **`total_active_voters` plausibly matches one district, not the whole city.** If the number looks like a city-wide voter count, the L2 district WHERE clause matched zero rows and the broker's auto-injected city scope is the only filter that hit. Re-confirm `L2_TYPE` and `L2_NAME` came verbatim from `PARAMS_JSON` and that you backtick-quoted the column.
- **No top-5 entry has `voter_percentage` < 5%.** All-low percentages mean you used `= 1` instead of `>= 50` (binary inference from suffix). Re-do the distribution check in Step 3.
- **No two top-5 entries are from the same policy area.** If the top 5 is ["police_trust_yes", "violent_crime_very_worried", "crime_too_lax", ...], your candidate list in Step 2 was too narrow — broaden it and re-run Step 4.
- **Every news URL loads AND mentions the issue.** Don't trust search snippets blindly; you already WebFetched in Step 5, but re-confirm any URL where the summary feels generic.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| HTTP 422 `ScopeViolation: scope_predicate_override` | Added `WHERE Residence_Addresses_State = ?` or `Residence_Addresses_City = ?` | Remove those clauses; the broker auto-injects them |
| Databricks query "syntax error" on `COUNT(*) FILTER` | Postgres syntax, not Databricks | Use `SUM(CASE WHEN ... THEN 1 ELSE 0 END)` |
| `Voters_Active = 1` returns 0 rows | `Voters_Active` is a STRING | Use `Voters_Active = 'A'` |
| All top-5 percentages < 5% | Used `= 1` instead of `>= 50` (binary inference from suffix) | Re-run Step 3 distribution check, then Step 4 |
| `total_active_voters` looks like the whole city | Backtick-quoted L2 column wrong, or `L2_NAME` mismatched | Re-confirm L2_TYPE/L2_NAME from PARAMS_JSON; check column name spelling |
| Bare `SELECT 1` rejected | Every query must reference the allowlisted table | Add `FROM goodparty_data_catalog.dbt.int__l2_nationwide_uniform_w_haystaq` |
| Positional `?` placeholder errors | Databricks requires named placeholders | Use `:name` and pass `{"name": value}` |
| News URL 404s or doesn't mention the issue | Trusted search snippet without WebFetch confirmation | WebFetch each URL; pick a different result if it doesn't load or doesn't mention the issue |
| Runner: `No artifact files found in /workspace/output` | Wrote to wrong path or never wrote | Write to `/workspace/output/district_issue_pulse.json` exactly |
