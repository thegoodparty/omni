Given a state + district, find the top 5 issues voters there care about and pair each with one recent local news headline. Combines Haystaq priority scores (Databricks) with current local discourse (web).

This is the source runbook — it captures the human-runnable version of the workflow. Once it's stable, port it into a PMF agent experiment by following `books/develop-pmf-experiment.md`. Naming convention: runbook `find-X.md` → experiment `experiments/X/` (kebab-case → snake_case, drop the `find-` prefix).

## Prerequisites

**books/.env variables**: none
**scripts/.env variables**: `DATABRICKS_SERVER_HOSTNAME`, `DATABRICKS_HTTP_PATH`, `DATABRICKS_API_KEY`
**Tools**: `uv` (for `scripts/python/databricks_query.py`), `psql`, `curl`, `jq`, AWS CLI authenticated as `work` profile, WireGuard VPN connected (RDS lookup)
**Output**: prints top 5 issues with voter counts + one news source per issue

## What you need to know about the data

The voter file lives at `goodparty_data_catalog.dbt.int__l2_nationwide_uniform_w_haystaq`. Three rules that bite people every time:

1. `Voters_Active = 'A'` (string, not int)
2. `hs_*` columns are CONTINUOUS 0-100 SCORES regardless of name suffix (`_yes`, `_treat`, `_oppose`, etc.). Threshold with `>= 50` for moderate support.
3. The L2 district column is the VALUE of `PARAMS.l2DistrictType` (e.g. `City_Ward`), and the value to match is `PARAMS.l2DistrictName` (e.g. `FAYETTEVILLE CITY WARD 2`). Confirm the district exists in the canonical election-api table before you query — guessed names match zero rows and you measure the whole city by accident.

## Steps

### 1. Resolve the district from election-api RDS

Don't guess L2 district names. Look them up:

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

Pick the row that matches the district you want. Use those exact `l2_district_type` and `l2_district_name` values for the rest of the workflow.

### 2. Discover candidate `hs_*` issue columns

```bash
cd scripts/python
uv run python databricks_query.py "
SELECT column_name FROM information_schema.columns
WHERE table_catalog = 'goodparty_data_catalog'
  AND table_schema = 'dbt'
  AND table_name = 'int__l2_nationwide_uniform_w_haystaq'
  AND column_name LIKE 'hs_%'
ORDER BY column_name
LIMIT 100
" | head -60
```

Filter to issue-stance columns by suffix (`_support`, `_oppose`, `_yes`, `_no`, `_treat`, `_fund_more`, `_pro_choice`, `_believer`, `_worried`, `_good`, `_bad`, `_too_harsh`, `_too_lax`, `_increase`, `_decrease`, `_has_role`, `_at_fault`, `_no_fault`). Pick 10-12 candidates. The full set is large — don't try to score all 300+ in one query.

### 3. Confirm column distribution (REQUIRED)

`hs_*` columns SHOULD be 0-100 scores, but verify before applying the `>= 50` threshold. Sample 3 candidates:

```bash
STATE=NC
CITY="Fayetteville"
DISTRICT_TYPE=City_Ward
DISTRICT_NAME="FAYETTEVILLE CITY WARD 2"

cd scripts/python
uv run python databricks_query.py "
SELECT
  AVG(hs_dei_support) AS dei_avg, MAX(hs_dei_support) AS dei_max,
  AVG(hs_violent_crime_very_worried) AS vc_avg, MAX(hs_violent_crime_very_worried) AS vc_max,
  AVG(hs_min_wage_15_increase_support) AS mw_avg, MAX(hs_min_wage_15_increase_support) AS mw_max
FROM goodparty_data_catalog.dbt.int__l2_nationwide_uniform_w_haystaq
WHERE Residence_Addresses_State = '$STATE'
  AND Residence_Addresses_City = '$CITY'
  AND \`$DISTRICT_TYPE\` = '$DISTRICT_NAME'
  AND Voters_Active = 'A'
"
```

If `max <= 1` for any column, it's binary — use a different threshold (e.g. `= 1` instead of `>= 50`). If `max ~= 100`, you have a continuous score and `>= 50` is correct.

### 4. Run the batched per-issue support query

One query, all candidates at once. Replace the candidate list with whatever you picked in step 2.

```bash
CANDIDATES=(
  hs_dei_support
  hs_violent_crime_very_worried
  hs_conspiracy_believer
  hs_united_healthcare_at_fault
  hs_min_wage_15_increase_support
  hs_opioid_crisis_treat
  hs_social_security_tax_increase_support
  hs_infrastructure_funding_fund_more
  hs_police_trust_yes
  hs_trump_ukraine_policy_oppose
)

# Build SUM(CASE WHEN ...) expressions
AGGS=""
for c in "${CANDIDATES[@]}"; do
  AGGS="$AGGS SUM(CASE WHEN \`$c\` >= 50 THEN 1 ELSE 0 END) AS \`$c\`,"
done
AGGS="${AGGS%,}"

cd scripts/python
uv run python databricks_query.py "
SELECT
  COUNT(*) AS total_active,
  $AGGS
FROM goodparty_data_catalog.dbt.int__l2_nationwide_uniform_w_haystaq
WHERE Residence_Addresses_State = '$STATE'
  AND Residence_Addresses_City = '$CITY'
  AND \`$DISTRICT_TYPE\` = '$DISTRICT_NAME'
  AND Voters_Active = 'A'
"
```

This returns one row: total active voters + per-issue counts. Sort the per-issue counts descending and take the top 5.

### 5. Pull one news source per top issue

For each of the top 5 columns, do a Google search and pick the most recent local news result. The `_oppose` and `_support` suffixes carry stance — strip them when forming the query (e.g. `hs_min_wage_15_increase_support` → "minimum wage 15 increase").

```bash
for ISSUE in "Min Wage 15 Increase" "Violent Crime" "DEI"; do
  echo "=== $ISSUE ==="
  curl -s "https://www.google.com/search?q=$(echo "$CITY $STATE $ISSUE 2026" | sed 's/ /+/g')" \
    -A "Mozilla/5.0" | grep -oE 'https?://[^"]+' | grep -v google | head -3
done
```

Pick the most credible / recent URL per issue. Capture: source name, URL, published date if visible, and a one-sentence summary.

### 6. Assemble the output

Format as Markdown for human consumption (the experiment version produces JSON):

```
# District Issue Pulse — <DISTRICT_NAME>

State: <STATE>  |  City: <CITY>  |  Total active voters: <N>

## Top 5 issues

| Rank | Issue | Voters | % | Local context |
|------|-------|--------|---|----------------|
| 1 | <issue> | <count> | <pct>% | <source name> ([link](<url>)) — <summary> |
| ... |
```

That's the runbook output. Done.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| All ratios <5% | Used `= 1` instead of `>= 50` (you skipped step 3) | Re-run step 3, then re-run step 4 |
| Total active voters way too high (e.g. whole city) | District name doesn't exist; the WHERE clause matched 0 rows | Re-do step 1 — verify the L2 district name actually exists |
| `Voters_Active = 1` returns 0 rows | `Voters_Active` is a STRING (`'A'`) | Use `Voters_Active = 'A'` |
| Databricks query "syntax error" on `COUNT(*) FILTER` | Postgres syntax, not Databricks | Use `SUM(CASE WHEN ... THEN 1 ELSE 0 END)` |

## Promote to a self-service experiment

This runbook is a one-off — you run it manually from your shell. Candidates can't run it themselves.

To make it a self-service experiment available in the dashboard (gp-webapp AI Insights tab), follow `books/develop-pmf-experiment.md`. The naming convention is:

- This runbook: `find-district-issue-pulse.md`
- The PMF experiment: `experiments/district_issue_pulse/` (drop `find-` prefix, kebab → snake)

The translation effectively encodes everything in this runbook into:
- `manifest.json` — schema for the JSON artifact + scope (allowed Databricks tables)
- `instruction.md` — the same steps as above, but written for the agent (with the broker's quirks called out as CRITICAL RULES)

See `experiments/CLAUDE.md` for the runbook → experiment translation pattern.
