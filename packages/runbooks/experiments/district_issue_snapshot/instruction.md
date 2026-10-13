# District Issue Snapshot

For one district + one issue keyword, produce a JSON artifact combining (a) the share of active voters whose Haystaq alignment score on that issue is moderate-or-stronger and (b) one recent local news article on the same issue. Both signals together let a campaign decide whether to lean into a pillar issue in this specific ward.

## BEFORE YOU START

1. Read this entire instruction end-to-end before executing anything.
2. Maintain a TodoWrite list mirroring the TODO CHECKLIST below.
3. Your params are in the JSON file named by the `PARAMS_FILE` env var. Read them once at the top.
4. Write the final artifact to `/workspace/output/district_issue_snapshot.json` and nowhere else.
5. Run `python3 /workspace/validate_output.py` before declaring success.
6. Perform the spot-check at the bottom — validator-passing data can still be garbage.

## TODO CHECKLIST

1. Parse `PARAMS_FILE` into `STATE`, `CITY`, `L2_TYPE`, `L2_NAME`, `ISSUE_KEYWORD`.
2. Discover candidate `hs_*` columns whose names semantically match `ISSUE_KEYWORD` (`information_schema.columns` query).
3. Pick ONE matched column → `matched_hs_column`. If none match, set it to `null`.
4. Run a single aggregation query over `int__l2_nationwide_uniform_w_haystaq`. **Always** select `COUNT(*) AS total_active_voters` for the district (this populates the required `total_active_voters` field even when no `hs_*` column matched). **If `matched_hs_column` is non-null,** also select `SUM(CASE WHEN \`<col>\` >= 50 THEN 1 ELSE 0 END) AS aligned_voter_count`; otherwise set `aligned_voter_count = None` in Python without that part of the query.
5. Compute `aligned_voter_percentage = aligned_voter_count / total_active_voters * 100` (one decimal place). If `matched_hs_column is None` OR `total_active_voters == 0`, set both `aligned_voter_count` and `aligned_voter_percentage` to `null`.
6. Build `issue_label` (title-case + parenthetical angle if the column suffix encodes one).
7. Use `WebSearch` to find one local news article on the issue + city within the last ~12 months. Confirm the page actually mentions the issue + city via `pmf_runtime.http.get(url)`.
8. Assemble the JSON artifact (including ISO-8601 UTC `generated_at`) and write it to `/workspace/output/district_issue_snapshot.json`.
9. Run `python3 /workspace/validate_output.py`.
10. Run the spot-check at the bottom.

## CRITICAL RULES

### Databricks (`/databricks/query`)

- **Connection API** (don't introspect — paste this verbatim):
  ```python
  from pmf_runtime import databricks as sql
  conn = sql.connect()
  cur = conn.cursor()
  cur.execute("SELECT ... WHERE col = :foo", {"foo": value})
  rows = cur.fetchall()
  ```
  The module is `pmf_runtime.databricks`. It exports `connect()`, `Connection`, `Cursor`, `ScopeViolation`, `UpstreamError`. There is no `databricks.query()` shortcut — you must `connect() → cursor() → execute() → fetchall()`. Skipping this step costs 3+ turns to discover via `dir()`.
- The broker auto-injects `WHERE Residence_Addresses_State = '<state>'` AND `Residence_Addresses_City IN (<cities>)` into every query against `int__l2_nationwide_uniform_w_haystaq`. **DO NOT add these clauses yourself.** Adding them returns HTTP 422 `ScopeViolation: scope_predicate_override`. The only WHERE clauses your data query needs are the L2 district column and `Voters_Active = 'A'`.
- **`Voters_Active` is a STRING.** Use `Voters_Active = 'A'`. `Voters_Active = 1` matches zero rows.
- **All `hs_*` columns are CONTINUOUS 0-100 SCORES** regardless of suffix (`_yes`, `_no`, `_treat`, `_oppose`, `_support`, `_fund_more`, `_pro_choice`, `_believer`, `_worried`, `_increase`, `_gov_has_role`, etc.). Threshold with `>= 50` (moderate). Using `= 1` because the name "looks binary" returns a 0-5% aligned share — wrong.
- **Scores are within-state percentile ranks (mean ~50), so `>= 50` counts voters at or above the state median.** `aligned_voter_percentage` therefore means the share of active district voters scoring at or above the state median on this issue — NOT absolute issue support, and ~50% means "typical for the state", not a 50/50 opinion split. Carry that definition into `issue_label`, `news.summary`, and any consumer-facing copy; never frame it as "X% of voters support Y". A low score is a lean away from the labeled stance relative to the state, not evidence of the opposite stance. Exception: `hs_new_home_buyer`/`hs_any_home_buyer` are ~60-baseline propensity models, not survey-stance ranks — the `>= 50` read does not apply and the aligned share comes out inflated (~60-65%); never pick them (see Step 2). Second exception: ~51 `hs_*` columns exist only in the 12-state December 2025 delivery and are null elsewhere — an all-null column scores 0% aligned with a correct query; treat that as no coverage (null alignment), not opposition (see the spot-check). Separately, even covered columns carry nulls: voters registered after the vendor's spring snapshot are unscored everywhere, and Texas (~72% scored) and Utah (~82%) trail every other state (90%+) on the nationwide columns (those outside the 12-state December 2025 set; vendor-side). Nulls are unscored voters, not errors; they stay in the `>= 50` denominator, so expect somewhat lower `aligned_voter_percentage` in Texas and Utah.
- **Conditional counts use `SUM(CASE WHEN ... THEN 1 ELSE 0 END)`.** Postgres `COUNT(*) FILTER (WHERE ...)` is a syntax error in Databricks.
- **Use named placeholders** when parameterizing: `cursor.execute("... WHERE col = :foo", {"foo": value})`. Positional `?` raises a SQL error.
- **Every query must reference an allowed table.** Bare `SELECT 1` (no FROM) is rejected.
- **The L2 district column name is the VALUE of `PARAMS.l2DistrictType`** (e.g. `City_Ward`). The value to match is `PARAMS.l2DistrictName`. Backtick-quote the column: `` `City_Ward` = 'FAYETTEVILLE CITY WARD 2' ``.
- **`information_schema.columns` discovery is allowed** without listing it in `allowed_tables` as long as the WHERE clause references your real allowed table (e.g. `WHERE table_name = 'int__l2_nationwide_uniform_w_haystaq'`).

### Web (URL discovery + retrieval)

- **Use `WebSearch` for URL discovery.** The Claude SDK built-in `WebSearch` works (returns search results with URLs and snippets). Do NOT use `WebFetch` — the runner is in a quarantined network and `WebFetch` returns "Unable to verify if domain X is safe to fetch" because claude.ai's domain-safety check can't reach it.
- **Use `pmf_runtime.http.get(url)` for page retrieval** (broker-proxied). The response is a **plain dict** — not a `requests.Response`. `r.status_code` / `r.text` raise `AttributeError`. Verbatim:
  ```python
  from pmf_runtime import http
  r = http.get("https://example.com/article")
  # r = {"status": 200, "headers": {...}, "body": "<html>…</html>"}
  print(r["status"], r["body"][:2000])
  ```
- The broker enforces an SSRF guard and URL allowlist on `http.get`. Private IPs and internal hostnames are blocked.

### Output

- Write **only** to `/workspace/output/district_issue_snapshot.json`. The runner publishes nothing else.
- Run `python3 /workspace/validate_output.py` before declaring success. The runner-level validator will reject the artifact post-hoc if you skip this; in-loop validation lets you fix violations cheaply.

## Steps

### Step 1 — Parse params

```python
import os, json
P = json.load(open(os.environ["PARAMS_FILE"]))
STATE          = P["state"]              # e.g. "NC"
CITY           = P["city"]               # e.g. "Fayetteville"
L2_TYPE        = P["l2DistrictType"]     # e.g. "City_Ward"
L2_NAME        = P["l2DistrictName"]     # e.g. "FAYETTEVILLE CITY WARD 2"
ISSUE_KEYWORD  = P["issueKeyword"]       # e.g. "affordable housing"
print(STATE, CITY, L2_TYPE, L2_NAME, ISSUE_KEYWORD)
```

### Step 2 — Discover candidate `hs_*` columns

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
""")
all_hs = [r[0] for r in cur.fetchall()]
print(len(all_hs), "hs_* columns total")

# Tokenize the keyword and keep columns that share at least one meaningful token.
import re
tokens = [t for t in re.split(r"\W+", ISSUE_KEYWORD.lower()) if len(t) >= 3]
candidates = [c for c in all_hs if any(t in c for t in tokens)]
print("candidates:", candidates)
```

Pick ONE column from `candidates`:
- Prefer the most general one (e.g. `hs_affordable_housing_gov_has_role` over `hs_affordable_housing_subsidy_oppose`).
- If multiple match equally well, prefer the shortest name and avoid suffixes like `_oppose`/`_against` (those score the OPPOSITE alignment).
- Never pick `hs_new_home_buyer` or `hs_any_home_buyer` — ~60-baseline propensity models, not stance percentile ranks, so `>= 50` inflates the aligned share (see the score rule in CRITICAL RULES). If they are the only candidates, treat it as no match (`matched_hs_column = None`) — Step 3 still runs for the required voter count.
- If `candidates` is empty, set `matched_hs_column = None` and skip the alignment half of Step 3 (the voter count still runs) — the artifact will still be valid (`aligned_voter_count`/`aligned_voter_percentage` become `null`).

### Step 3 — Count district voters (and alignment if a column matched)

Substitute the chosen column name (if any) AND the L2 district column name directly into the SQL string (named placeholders cannot parameterize identifiers). Both are constrained: the column came from `information_schema`, and `L2_TYPE` came from the param schema.

`total_active_voters` is **always** queried — even when `matched_hs_column is None` — because the `total_active_voters` field in the artifact is required (a non-null integer) by the output schema.

```python
matched_hs_column = "hs_affordable_housing_gov_has_role"  # ← replace with your pick, or None if Step 2 matched nothing

assert L2_TYPE.replace("_", "").isalnum(), "L2_TYPE must be a bare identifier"

if matched_hs_column is not None:
    assert matched_hs_column.startswith("hs_") and matched_hs_column.replace("_", "").isalnum(), \
        "matched_hs_column must look like hs_<alnum_underscore>"
    select_clause = (
        "COUNT(*) AS total_active_voters, "
        f"SUM(CASE WHEN `{matched_hs_column}` >= 50 THEN 1 ELSE 0 END) AS aligned_voter_count"
    )
else:
    # No matching hs_* column for this issue keyword — query the district headcount
    # only. aligned_voter_count / aligned_voter_percentage stay null in the artifact.
    select_clause = "COUNT(*) AS total_active_voters"

q = f"""
