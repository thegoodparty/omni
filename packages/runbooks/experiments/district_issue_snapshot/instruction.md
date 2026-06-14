# District Issue Snapshot

For one district + one issue keyword, produce a JSON artifact combining (a) the share of active voters whose Haystaq alignment score on that issue is moderate-or-stronger and (b) one recent local news article on the same issue. Both signals together let a campaign decide whether to lean into a pillar issue in this specific ward.

## BEFORE YOU START

1. Read this entire instruction end-to-end before executing anything.
2. Maintain a TodoWrite list mirroring the TODO CHECKLIST below.
3. Your params are in the `PARAMS_JSON` env var. Read them once at the top.
4. Write the final artifact to `/workspace/output/district_issue_snapshot.json` and nowhere else.
5. Run `python3 /workspace/validate_output.py` before declaring success.
6. Perform the spot-check at the bottom — validator-passing data can still be garbage.

## TODO CHECKLIST

1. Parse `PARAMS_JSON` into `STATE`, `CITY`, `L2_TYPE`, `L2_NAME`, `ISSUE_KEYWORD`.
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
- **All `hs_*` columns are CONTINUOUS 0-100 SCORES** regardless of suffix (`_yes`, `_no`, `_treat`, `_oppose`, `_support`, `_fund_more`, `_pro_choice`, `_believer`, `_worried`, `_increase`, `_gov_has_role`, etc.). Threshold with `>= 50` (moderate). Using `= 1` because the name "looks binary" returns 0-5% support — wrong.
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
P = json.loads(os.environ["PARAMS_JSON"])
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
- If `candidates` is empty, set `matched_hs_column = None` and skip Step 3 — the artifact will still be valid (`aligned_voter_count`/`aligned_voter_percentage` become `null`).

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
SELECT {select_clause}
FROM goodparty_data_catalog.dbt.int__l2_nationwide_uniform_w_haystaq
WHERE `{L2_TYPE}` = :l2_name
  AND Voters_Active = 'A'
"""
cur.execute(q, {"l2_name": L2_NAME})
row = cur.fetchone()
total_active_voters = int(row[0])
if matched_hs_column is not None:
    aligned_voter_count = int(row[1]) if row[1] is not None else 0
else:
    aligned_voter_count = None
print(total_active_voters, aligned_voter_count)
```

Compute the percentage:
```python
if matched_hs_column is not None and total_active_voters > 0:
    aligned_voter_percentage = round(aligned_voter_count / total_active_voters * 100, 1)
else:
    # Either no column matched, or the district returned zero active voters.
    # aligned_voter_count and aligned_voter_percentage are both null. total_active_voters
    # remains a real integer (possibly 0) — never null.
    aligned_voter_count, aligned_voter_percentage = None, None
```

### Step 4 — Build `issue_label`

Title-case the keyword and append the column's narrative angle in parentheses or after an em-dash if non-obvious:

| Column suffix pattern | Label |
|---|---|
| `_gov_has_role`, `_government_has_role` | `"<Issue> — Government Has A Role"` |
| `_support`, `_yes`, `_pro_*` | `"<Issue>"` (no qualifier — the suffix IS the alignment) |
| `_oppose`, `_no`, `_anti_*` | `"<Issue> (Oppose)"` and **flag this in your reasoning — your aligned-voter count measures opposition, not support.** |
| `_pro_choice` | `"Abortion (Pro-Choice)"` |
| `_increase`, `_fund_more` | `"<Issue> (Increase / Fund More)"` |
| no obvious modifier | Title-case the keyword as-is |

If `matched_hs_column is None`, set `issue_label` to the title-cased keyword anyway (e.g. `"Affordable Housing"`) — it's still useful for the dashboard.

### Step 5 — Find one local news article

Use `WebSearch` with a focused query:

```python
# pseudocode — issue WebSearch tool call
query = f'"{ISSUE_KEYWORD}" "{CITY}" {STATE} 2025 OR 2026'
# results -> [{"title": ..., "url": ..., "snippet": ...}, ...]
```

Selection rules:
1. Prefer local outlets (city paper, regional NPR affiliate, county news site) over national wire stories.
2. Reject press releases, government PDFs, and aggregator sites without bylines unless nothing else exists.
3. The article's `published_date` must be within the past ~12 months (today is in `generated_at`'s clock).

Confirm the article actually mentions the issue + city — search snippets lie:

```python
from pmf_runtime import http
r = http.get(chosen_url)
body = r["body"]
assert ISSUE_KEYWORD.lower() in body.lower() or any(t in body.lower() for t in tokens), \
    "article body does not mention the issue keyword"
assert CITY.lower() in body.lower(), "article body does not mention the city"
```

Extract:
- `source_name` — human-readable outlet name (e.g. `"CityView NC"`, not `"cityviewnc.com"`).
- `url` — the URL you actually fetched (post-redirect).
- `title` — the article headline as printed on the page.
- `summary` — one paragraph (1–4 sentences) explaining why this article is relevant to the issue + district. Write this yourself; do not paste the meta description.
- `published_date` — ISO `YYYY-MM-DD`. Pull from a byline / `<time>` tag / page metadata.

### Step 6 — Assemble + write the artifact

```python
import datetime, json, pathlib

artifact = {
    "state": STATE,
    "city": CITY,
    "l2_district_type": L2_TYPE,
    "l2_district_name": L2_NAME,
    "issue_keyword": ISSUE_KEYWORD,
    "matched_hs_column": matched_hs_column,            # str or None
    "issue_label": issue_label,
    "total_active_voters": total_active_voters,
    "aligned_voter_count": aligned_voter_count,        # int or None
    "aligned_voter_percentage": aligned_voter_percentage,  # float or None
    "news": {
        "source_name": source_name,
        "url": url,
        "title": title,
        "summary": summary,
        "published_date": published_date,
    },
    "generated_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
}

pathlib.Path("/workspace/output").mkdir(parents=True, exist_ok=True)
pathlib.Path("/workspace/output/district_issue_snapshot.json").write_text(json.dumps(artifact, indent=2))
```

### Step 7 — Validate

```bash
python3 /workspace/validate_output.py
```

If the validator complains, re-read the failing field name against the `output_schema` and fix the artifact in place. Do not declare success until the validator exits 0.

## Spot-check

Validator-passing JSON can still be garbage. Confirm BEFORE declaring success:

- **`total_active_voters` is plausibly the size of one ward (~5K–20K), NOT the whole city (~50K+).** If it looks city-wide, your district WHERE clause matched zero rows and the broker's auto-injected city scope was the only filter that hit. Re-confirm `L2_TYPE` and `L2_NAME` came verbatim from `PARAMS_JSON`.
- **`aligned_voter_percentage` is in the 30–80 range.** If it's 0–5%, you used `= 1` instead of `>= 50` (binary inference from suffix). If it's >95%, you matched the wrong column or your sample is too narrow.
- **`matched_hs_column` is null only when `information_schema.columns` truly returned no semantic match.** If you set it to null because you couldn't decide between two reasonable candidates, go back and pick one — null suppresses the entire alignment signal.
- **The news URL actually loaded** (`http.get` returned status 200) AND the response body mentions BOTH the issue keyword (or a token from it) AND the city. Don't trust search snippets blindly.
- **`news.published_date` is within the past 12 months.** Older articles indicate stale local discourse and weaken the artifact's value.
- **`issue_label` semantically matches `matched_hs_column`'s alignment direction.** If the column ends in `_oppose` and your label says "support", flip the wording — the aligned-voter count measures the column's stated direction.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Broker logs `ScopeViolation: scope_predicate_override` | Added `WHERE Residence_Addresses_State = ?` or `Residence_Addresses_City = ?` | Drop those clauses — the broker auto-injects them. |
| `total_active_voters` looks like the whole city | `L2_NAME` doesn't exist in this column; broker's city scope is the only filter that matched | Re-confirm `L2_TYPE` and `L2_NAME` came verbatim from PARAMS_JSON; spot-check by querying `SELECT DISTINCT \`<L2_TYPE>\` FROM ... LIMIT 50` |
| `aligned_voter_percentage` is 0-5% | Used `= 1` instead of `>= 50` (binary inference from suffix) | Re-do Step 3 with `>= 50`; remember all `hs_*` are 0-100 scores |
| Databricks returns 422 with positional placeholder error | Used `?` placeholders | Switch to named `:foo` placeholders |
| `WebFetch` returns "Unable to verify if domain X is safe to fetch" | Used `WebFetch` instead of `pmf_runtime.http.get` | Use `pmf_runtime.http.get(url)` for page bodies; `WebSearch` only for discovery |
| Validator: `news.url does not match pattern ^https?://` | URL stored without scheme or with whitespace | Strip and ensure `http(s)://` prefix |
| Validator: `matched_hs_column does not match pattern ^hs_[a-z0-9_]+$` | Column name uppercased or contains characters outside `[a-z0-9_]` | Use the exact `column_name` returned by `information_schema`; do not edit it |
| Runner: `No artifact files found in /workspace/output` | Agent never wrote the file or wrote it to the wrong path | Confirm the path is `/workspace/output/district_issue_snapshot.json` exactly |
