Given a state + city + L2 district + an issue keyword, find the voter alignment on that one issue paired with one recent local news article.

A focused single-issue version of `find-district-issue-pulse` — useful when a campaign already knows which issue they want to talk about and just needs to know "how do voters here feel about it" + "is this issue in the local news right now?".

## Prerequisites

**books/.env variables**: none
**scripts/.env variables**: `DATABRICKS_SERVER_HOSTNAME`, `DATABRICKS_HTTP_PATH`, `DATABRICKS_API_KEY`
**Tools**: `uv`, web search (any), `curl`

## Inputs

```
state          — 2-letter code, e.g. "NC"
city           — full name, e.g. "Fayetteville"
l2DistrictType — L2 voter-file column, e.g. "City_Ward"
l2DistrictName — value matching that column, e.g. "FAYETTEVILLE CITY WARD 2"
issueKeyword   — short phrase, e.g. "affordable housing", "minimum wage", "abortion"
```

## Output shape (one JSON object)

```json
{
  "state": "NC",
  "city": "Fayetteville",
  "l2_district_type": "City_Ward",
  "l2_district_name": "FAYETTEVILLE CITY WARD 2",
  "issue_keyword": "affordable housing",
  "matched_hs_column": "hs_affordable_housing_gov_has_role",
  "issue_label": "Affordable Housing — Government Has A Role",
  "total_active_voters": 12451,
  "aligned_voter_count": 8312,
  "aligned_voter_percentage": 66.8,
  "news": {
    "source_name": "CityView NC",
    "url": "https://www.cityviewnc.com/.../affordable-housing-fayetteville-2025",
    "title": "Fayetteville council weighs new affordable-housing ordinance",
    "summary": "One-paragraph summary of why this article is relevant.",
    "published_date": "2025-11-12"
  },
  "generated_at": "2026-05-05T22:15:00Z"
}
```

`aligned_voter_percentage` is `aligned_voter_count / total_active_voters * 100`, one decimal place.

## Steps

### 1. Find the matching `hs_*` column

The L2 + Haystaq join carries hundreds of `hs_*` columns. Each is a 0-100 alignment score on a specific issue (NOT a binary flag despite suffixes like `_yes`, `_support`, `_oppose`). Pick ONE column whose name semantically matches `issueKeyword`.

```bash
cd ~/work/runbooks/scripts/python
uv run python databricks_query.py \
  "SELECT column_name FROM information_schema.columns
   WHERE table_name = 'int__l2_nationwide_uniform_w_haystaq'
     AND column_name LIKE 'hs_%'
   ORDER BY column_name" | grep -iE "affordable|housing"
```

If multiple match, pick the most general one (e.g. `hs_affordable_housing_gov_has_role` over `hs_affordable_housing_subsidy_oppose`). Record the chosen column as `matched_hs_column`.

If nothing matches: the keyword has no Haystaq column. Write `matched_hs_column: null` and skip Step 2.

### 2. Count voters aligned on that issue

```bash
cd ~/work/runbooks/scripts/python
uv run python databricks_query.py "
SELECT
  COUNT(*) AS total_active_voters,
  SUM(CASE WHEN \`<matched_hs_column>\` >= 50 THEN 1 ELSE 0 END) AS aligned_voter_count
FROM goodparty_data_catalog.dbt.int__l2_nationwide_uniform_w_haystaq
WHERE Residence_Addresses_State = 'NC'
  AND Residence_Addresses_City = 'Fayetteville'
  AND \`City_Ward\` = 'FAYETTEVILLE CITY WARD 2'
  AND Voters_Active = 'A'
"
```

The L2 district column name is the VALUE of `l2DistrictType` (so `City_Ward` here, backtick-quoted). The value to match is `l2DistrictName`. `Voters_Active` is a STRING `'A'`, not `1`.

Compute `aligned_voter_percentage = aligned_voter_count / total_active_voters * 100` to one decimal.

### 3. Find one local news article on the issue

Web search for the issue + city + recency:

```
"affordable housing" Fayetteville NC site:cityviewnc.com 2025
```

Restrict to the past ~12 months. Prefer local outlets (city paper, regional NPR affiliate, county news site) over national wire stories. Open the top result, confirm it actually mentions the issue + the city — search snippets lie.

Record `source_name`, `url`, `title`, `summary` (one paragraph: why this article is relevant), `published_date` (ISO YYYY-MM-DD).

### 4. Generate `issue_label`

Title-case the issue keyword and append the column's narrative angle in parentheses if non-obvious:
- `affordable_housing_gov_has_role` → `"Affordable Housing — Government Has A Role"`
- `medicare_for_all_support` → `"Medicare For All"`
- `abortion_pro_choice` → `"Abortion (Pro-Choice)"`

### 5. Assemble + emit

Single JSON object as shown in "Output shape". `generated_at` is current ISO-8601 UTC.

## Spot-check rules

- `total_active_voters` is plausibly the size of one ward (~5K–20K), NOT the whole city (~50K+). If it looks city-wide, your district WHERE clause matched zero rows and the broker's auto-injected city scope was the only filter that hit.
- `aligned_voter_percentage` is in 30–80 range. If it's 0–5% you used `= 1` instead of `>= 50` (binary inference from suffix). If it's >95% you matched the wrong column or your sample is too narrow.
- The news URL actually loads AND the article content mentions the issue keyword AND mentions the city. Don't trust search snippets blindly.
- `published_date` is within the past 12 months. Older articles indicate stale local discourse.

## Why this exists

`find-district-issue-pulse` does discovery — top 5 issues a campaign should care about. This runbook does the reverse: a campaign already knows their pillar issue and wants to know if voters here are with them AND if the local press is talking about it. Use cases:
- Pre-flight check before a candidate's policy speech (do voters care?)
- Decide whether to lean into an issue in a particular ward
- Quickly cite local news + voter alignment in a fundraising email
