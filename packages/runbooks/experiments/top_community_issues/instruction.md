<!-- PROMPT PROSE IS A FIRST DRAFT; iterated in a separate conversation. The schemas in manifest.json are the stable contract. -->

# Top Community Issues

Given an elected official's district, produce a ranked list of up to 10 community issues that matter most to constituents. Combines Haystaq priority scores from Databricks (`int__l2_nationwide_uniform_w_haystaq`) with current local discourse from web and news search. The Haystaq scores reveal what residents privately care about; the web signal confirms each issue is alive in local discourse and surfaces supporting sources. Begin by reading the current issue feed via the MCP tool so carried issues keep their existing IDs.

## BEFORE YOU START

1. Read this entire instruction end-to-end before executing anything.
2. Maintain a TodoWrite list mirroring the TODO CHECKLIST below.
3. Your params are in the `PARAMS_JSON` env var. Read them once at the top.
4. Write the final artifact to `/workspace/output/top_community_issues.json` and nowhere else.
5. Run `python3 /workspace/validate_output.py` before declaring success.
6. Perform the spot-check at the bottom — validator-passing data can still be garbage.

## TODO CHECKLIST

1. Read PARAMS_JSON. Capture `organization_slug`, `state`, `office`, `district_descriptor`.
2. Call `GET_v1_community-issues` with `organization_slug` to retrieve the current issue list. Record existing issue IDs.
3. Discover candidate `hs_*` issue columns via `information_schema.columns`.
4. Run a distribution check on 3 sample `hs_*` columns to confirm they are 0-100 continuous scores.
5. Run ONE batched aggregation query returning per-issue `SUM(CASE WHEN >= 50 THEN 1 ELSE 0 END)` counts for ~12 candidate columns.
6. Sort counts descending. Select up to 10 top issues.
7. For each issue: `WebSearch` `<district_descriptor> <issue label> 2026`, then retrieve the most credible local result body via `pmf_runtime.http.head(url)` (escalate to `http.get` only if head returns 403/405).
8. Match each output issue against the existing feed: carry `existing_issue_id` when the issue maps to an existing record. Prefer carrying the ID over creating a duplicate.
9. Classify each issue into exactly one `category` from the allowed enum.
10. Assign `priority` (`low|medium|high`) and `rank` (1 = most important).
11. Deduplicate `detail.sources[]` by URL. Verify every `source_id` referenced in `source_ids` or `source_id` fields resolves to an entry in `detail.sources[]`.
12. Assemble artifact and write to `/workspace/output/top_community_issues.json`.
13. Run `python3 /workspace/validate_output.py`.
14. Perform the spot-check.

## CRITICAL RULES

**Existing issue feed**:

- Call `GET_v1_community-issues` FIRST, before any research. The API returns the complete current issue list for the organization.
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

- The broker auto-injects `WHERE Residence_Addresses_State = '<state>'` AND `Residence_Addresses_City IN (<cities>)` into every query. **DO NOT add these clauses yourself.** Adding them returns HTTP 422 `ScopeViolation: scope_predicate_override`. The only WHERE clauses your query needs are the L2 district column and `Voters_Active = 'A'`.
- **`Voters_Active` is a STRING.** Use `Voters_Active = 'A'`. `Voters_Active = 1` matches zero rows.
- **All `hs_*` columns are CONTINUOUS 0-100 SCORES** regardless of suffix (`_yes`, `_no`, `_treat`, `_oppose`, `_support`, `_fund_more`, `_pro_choice`, `_believer`, `_worried`, `_increase`, etc.). Threshold with `>= 50` (moderate) or `>= 70` (strong). Using `= 1` because the name "looks binary" inverts your rankings — you will get all top issues at <5%.
- **Conditional counts use `SUM(CASE WHEN ... THEN 1 ELSE 0 END)`.** Postgres `COUNT(*) FILTER (WHERE ...)` is a syntax error in Databricks.
- **Use named placeholders** when parameterizing: `cursor.execute("... WHERE col = :foo", {"foo": value})`. Positional `?` raises a SQL error.
- **Named placeholders bind VALUES, not IDENTIFIERS.** Column names must be string-interpolated (f-string). Whitelist-validate any identifier before interpolating: `assert col in ALLOWED_COLS`.
- **Every query must reference an allowed table.** Bare `SELECT 1` (no FROM) is rejected.

**Web (`WebSearch` + `pmf_runtime.http`)**:

- **Use `WebSearch` for URL discovery.** Do NOT use `WebFetch` — the quarantined network can't reach claude.ai's domain-safety check, so it always fails.
- **Web-access escalation ladder — use the cheapest rung that answers the question:**
  1. `WebSearch` (free, fast) — snippets often answer the question outright.
  2. `pmf_runtime.http.head(url)` — verify a URL is live. Returns `{"status": int, "final_url": str}`.
  3. `pmf_runtime.http.get(url)` — browser render (Chromium), LAST RESORT. Returns `{"status", "headers", "body", "source_url"}` (plain dict — `r["status"]`/`r["body"]`, never `.status_code`/`.text`). Use ONLY when head returned 403/405 or you must read the body.

  ```python
  from pmf_runtime import http
  r = http.head("https://example.com/article")
  if r["status"] in (403, 405):
      r = http.get("https://example.com/article")
  ```

- **Re-rendering every URL with `http.get` is the classic perf trap** — it makes runs time out. Verify with `head`; render only when forced.
- The container is network-quarantined — `urllib`/`requests`/`httpx`/`curl`/`wget`/`socket` cannot reach the internet.

**Source integrity**:

- Every `source_id` referenced in `detail.overview.source_ids`, `detail.history.source_ids`, `detail.research.source_ids`, `detail.legislation.source_ids`, and `detail.quotes[].items[].source_id` MUST resolve to an entry in `detail.sources[]` with a matching `id`.
- Deduplicate `detail.sources[]` by URL before assembling.
- `detail.overview` is always required — never omit it.

**Output**:

- Write **only** to `/workspace/output/top_community_issues.json`. The runner publishes nothing else.
- Set `list: "top_community"` in the artifact root.
- Set `schema_version: 1`.
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

Call `GET_v1_community-issues` with `organization_slug=ORG_SLUG`. Record every existing issue: capture `id`, `title`, and `category` for each. You will use these IDs in Step 8 to carry issues forward.

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

Select ~12 candidate columns that map to community-issue topics (infrastructure, safety, housing, education, health, etc.). Skip demographic or partisan columns.

### Step 4 — Distribution check (3 sample columns)

Run a quick count of distinct score buckets on 3 of the candidate columns to confirm they are 0-100 continuous, not binary. If any column returns only `0` and `1`, treat it as binary and exclude it from the aggregation.

### Step 5 — Batched aggregation

```python
# Build dynamic SUM(CASE WHEN ...) for each candidate column
# Replace <COL> with each column name via f-string; whitelist first
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

### Step 6 — Select top issues

Sort per-issue counts descending. Take up to 10. Map each `hs_*` column to a human-readable issue label and `category`.

### Step 7 — Web research per issue

For each selected issue, run one `WebSearch` for `<DISTRICT> <issue label> 2026`. Verify the best URL with `pmf_runtime.http.head`; escalate to `http.get` only if blocked (403/405) or you need the body. Extract: source name, URL, publisher, article_date, and a text snippet for `retrieved_text_or_snapshot`.

### Step 8 — Carry existing issue IDs

Compare each output issue title/category against the existing feed from Step 2. When the issue clearly maps to an existing record, set `existing_issue_id` to that record's ID. Do not invent a mapping if it is ambiguous.

### Step 9 — Assemble artifact

```python
import json, datetime
artifact = {
    "schema_version": 1,
    "list": "top_community",
    "organization_slug": ORG_SLUG,
    "generated_for_run_id": RUN_ID,
    "issues": [...],  # IssueOutput list
    "data_quality": "ok",  # or "partial" if some web lookups failed
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

- **All top-N percentages > 5%.** If all counts are < 5% of total active voters, you likely used `= 1` instead of `>= 50`. Re-do the distribution check in Step 4.
- **Issues span at least 2 different categories.** If all issues fall under one category, your column selection was too narrow.
- **Each `source_id` referenced in `source_ids` / `source_id` fields resolves to an entry in `detail.sources[]`.** A dangling ID means the validator missed it but the downstream renderer will break.
- **`detail.overview` is present on every issue.** It is always required.
- **`list` is set to `"top_community"`.** Not `"trending"`.
- **No fabricated news URLs.** Verify at least 3 issue URLs returned HTTP 200 via `head`.

## Failure modes

| Symptom                                      | Cause                                                         | Fix                                                        |
| -------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------- |
| All issue counts < 5%                        | Used `= 1` instead of `>= 50` on `hs_*` column                | Re-run aggregation with correct threshold                  |
| `ScopeViolation: scope_predicate_override`   | Added `WHERE Residence_Addresses_State = ?` manually          | Remove those clauses; broker auto-injects them             |
| Broker 422 on `/databricks/query`            | Positional `?`, Postgres FILTER syntax, or unauthorized table | Use named placeholders; use `SUM(CASE WHEN ...)`           |
| `source_id` not found in `detail.sources[]`  | Forgot to add the source entry after referencing it           | Add matching entry to `detail.sources[]`                   |
| Validator: missing required field `overview` | `detail.overview` was omitted                                 | Always emit `overview`; it is required                     |
| `GET_v1_community-issues` 404                | Organization has no feed yet                                  | Treat as empty feed; proceed with empty existing_issue_ids |
