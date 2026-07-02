<!-- The schemas in manifest.json are the stable contract. This prose encodes the method; the JSON Schema is what the validator enforces. -->

# Top Community Issues

Given an elected official's jurisdiction, produce a ranked list of up to 5 community issues that constituents are actively talking about — **each one a specific, named, currently-relevant problem**, not a policy category. This is a **demand-side** list: the question it answers is "what is on residents' minds here," not "what is on the office's agenda." Two signals are combined. Resident-demand web sources (local news, letters/op-eds, community advocacy groups, petitions, 311) are the **salience signal** — they say what residents are raising and how loudly. Haystaq priority scores from Databricks (`int__l2_nationwide_uniform_w_haystaq`) are a **lean annotation only** — they say how the local electorate _tilts_ on an issue once salience has surfaced it, never which issue to rank. **The governing body's own record is excluded as a source** (no council/select-board agendas, minutes, ordinances, or legislative portals): the office's agenda is exactly the filter this list is meant to see around. Begin by reading the current issue feed via the MCP tool so carried issues keep their existing IDs.

## What counts as an issue (this drives everything)

**An issue is something constituents are actively talking about — raising, complaining about, organizing around, or arguing over — that bears on daily life in the jurisdiction.** Salience to residents is the selection and ranking criterion. An issue does **not** have to be something the office can act on, and it need not be strictly hyperlocal: if residents are loudly talking about a state mandate, a school-funding formula, a tax bill, or a feared development, it counts.

**Annotate actionability; do not select on it.** For each issue, the `summary` should note who can act and what they could do, so the reader knows whether their office can move it. This is a downstream annotation, not a filter — a top resident concern the office cannot directly fix is still a top resident concern, and dropping it would defeat the purpose of a demand-side scan.

**Every output row MUST be a specific named issue, not a taxonomy category.** "Housing" is not an issue; "the proposed 40-unit development on Route 3" or "the 21% jump in the local tax rate" is. The `category` field is only a tag; the `title` must name the concrete instance — the actual project, vote, dollar figure, rate change, or location.

**Time horizon: sustained issues.** This list surfaces established concerns with evidence of resident attention going back at least ~6 months. That is the defining difference from the companion `trending_issues` experiment, which surfaces issues that arose within the past ~6 weeks. Weight current sources, but require that an issue has been a live resident concern for a while; a one-week flare-up belongs in trending, not here.

**Re-verify every fact against a current source before you publish it.** Do not assert a project, vote, dollar figure, or claim from memory or a search snippet alone. Name dollars, dates, votes, and locations, and attach a source to each. Distinguish "residents believe X" (a citable salience fact) from "X is true." A confident-but-wrong issue is worse than a thinner true one.

## Source order

Resident-demand sources rank the list; Haystaq only annotates lean. The governing body's record is intentionally excluded.

1. **Local civic news, plus letters to the editor and op-eds**, via `WebSearch`. The workhorse: what reporters cover tracks what residents raise, and letters/op-eds are direct resident voice. Read article bodies, not just headlines. Supplies dollars, dates, and the named instance.
2. **Local community advocacy groups (prefer nonpartisan)**, via `WebSearch`. Standing, resident-led civic organizations that speak for neighborhood priorities: neighborhood/community associations, Business Improvement Areas (BIAs/BIDs), elected or volunteer neighborhood councils, civic leagues, residents' and tenants' associations, merchant associations, and single-issue coalitions (parks-friends, transit-riders groups). Pull their public output: newsletters, meeting minutes/agendas, public statements, position pages. This is organized, semi-structured resident demand. **Prefer groups with no political-party affiliation;** when a group has a clear partisan tie, flag the affiliation in the source `name`/snapshot and never let its framing stand in as resident salience without a second, independent source.
3. **Petitions, ballot questions raised by residents, and organized campaigns** (save-our-X groups, referendum drives), via `WebSearch`. Direct evidence of concentrated demand.
4. **311 / service requests**, via `WebSearch`, when a public feed or report is discoverable. Resident-driven, geocoded, operational demand. Use if found; flag as missing if not.
5. **Representative resident survey**, via `WebSearch`, if one exists (town/community survey, university or regional poll broken out to the area). The only near-representative anchor; sets the prior when present. Flag the gap when absent.
6. **Haystaq priority scores (Databricks), lean annotation only.** Not a salience source and not a report-ranking input. One batched aggregation (below) yields a per-issue lean chip. Run the per-variable coverage check first; many states return 0 coverage on some columns.

**Social media and community forums are NOT a source here.** Do not attempt to scrape Twitter/X, Facebook, Nextdoor, or Reddit — those platforms block automated access and the signal is unreliable. Resident voice comes from news, letters/op-eds, and the public output of advocacy groups instead.

## BEFORE YOU START

1. Read this entire instruction end-to-end before executing anything.
2. Maintain a TodoWrite list mirroring the TODO CHECKLIST below.
3. Your params are in the `PARAMS_JSON` env var. Read them once at the top.
4. Write the final artifact to `/workspace/output/top_community_issues.json` and nowhere else.
5. Run `python3 /workspace/validate_output.py` before declaring success.
6. Perform the spot-check at the bottom — validator-passing data can still be garbage.
7. As you ENTER each phase below, mark a milestone so cost analysis can attribute per-turn spend to named phases. Run this line (it appends a marker, nothing else):
   ```python
   try:
       from pmf_runtime import milestone; milestone("<phase>")
   except Exception:
       pass  # primitive absent on this runner build — never fail the run over a marker
   ```
   The phase markers are called out at each Step. A run that bails early simply emits fewer markers — that is expected. When a phase STARTS with a python/bash command, prepend the milestone line to that command (same code block, no separate turn). When a phase starts with `WebSearch` (e.g. discovery), run the marker standalone FIRST — the marker must fire before the phase's work or cost attribution mis-tags the phase.

## TODO CHECKLIST

1. Read PARAMS_JSON. Capture `organization_slug`, `state`, `office`, `district_descriptor`.
2. Call `GET_community_issues` with `organization_slug` to retrieve the current issue list. Record existing issue IDs, titles, categories.
3. `WebSearch` the **local civic news + letters/op-eds** for the jurisdiction. Identify candidate named issues residents are raising, with dollars/dates/locations.
4. `WebSearch` the **community advocacy groups** (associations, BIAs, neighborhood councils, coalitions). Record each group's name and any party affiliation; prefer nonpartisan; pull the issues they are pushing.
5. `WebSearch` **petitions / organized campaigns**, then **311 / service requests** and a **resident survey** if discoverable. Flag any layer not found.
6. Pick ~12-15 community-relevant `hs_*` columns from the **inline Haystaq catalog** (CRITICAL RULES) — do NOT query `information_schema`. When `l2_district_type` is set, discover the exact L2 district value with one `SELECT DISTINCT`.
7. Run ONE batched aggregation returning per-domain `ROUND(AVG(hs_x),1)`, coverage `COUNT(hs_x)`, and `COUNT(*) AS n`, **scoped to the district** (`l2_district_type` clause) when present, else state scope. Drop any column below ~80% coverage. Compute distinctiveness = `AVG - 50` and a lean chip per domain.
8. Rank candidate issues by **resident attention mass** (recency + breadth + how many independent sources corroborate). Ground top rows in a live source; label any row inferred from the lean alone as inferred. A single-source issue is low-confidence by construction.
9. Re-verify each issue against a current source; capture dollars, dates, votes, locations; verify the source URL is live with `pmf_runtime.http.head`. Drop anything you cannot confirm.
10. Match each output issue against the existing feed: carry `existing_issue_id` when it maps to an existing record. Prefer carrying the ID over creating a duplicate. If the feed was empty/404, say so in `data_quality_reason`.
11. Classify each issue into exactly one `category` from the allowed enum (the category is a tag; the title is the named instance).
12. Annotate each issue with its Haystaq lean chip where coverage allows; an operational row with no covered var is "hyperlocal, no model lean," which is informative, not a gap. Add a "who can act / what they could do" note to the `summary`.
13. Assign `priority` (`low|medium|high`) and `rank` (1 = most important). Rank by resident attention mass; the Haystaq lean does not move the rank.
14. Write a substantive `detail.overview.summary` (2-3 sourced sentences naming the instance) for every issue — never empty. Deduplicate `detail.sources[]` by URL. Verify every `source_id` resolves to an entry in `detail.sources[]`.
15. Set `sources_used`, `data_quality`, `data_quality_reason`, `notes` honestly — name any missing source layer (no 311 feed, no resident survey, Haystaq domains dropped for zero coverage) and, if fewer than 5 issues, why.
16. Assemble artifact and write to `/workspace/output/top_community_issues.json`.
17. Run `python3 /workspace/validate_output.py`.
18. Perform the spot-check.

## CRITICAL RULES

**Turn efficiency — every turn re-reads the whole conversation, so cost tracks turn count and transcript size. These rules are as binding as the data rules:**

- **Batch aggressively.** Issue 2-4 `WebSearch` calls in a SINGLE turn. Verify ALL URLs in ONE python block. Combine consecutive python steps into one block. Never do in five turns what fits in one.
- **Search budget: at most 14 `WebSearch` calls for the whole run.** Work the source order within that budget; snippets usually carry the named instance, the date, and the publisher — mine them before fetching anything.
- **NEVER print a raw page body.** When `http.get` is unavoidable, extract the specific fact inside the SAME python block and print ≤300 chars (the claim, the date, the figure). A printed page body inflates the cost of every later turn.
- **Keep `retrieved_text_or_snapshot` ≤1500 chars** — the minimum excerpt that proves the claim, not the whole article.
- **After you assemble the artifact, never re-open discovery.** If validation or the spot-check flags a specific source or field, fix or drop THAT item with a surgical `Edit`; do not re-search, re-render pages, or rebuild the artifact from scratch.
- **Never spend a turn solely on task bookkeeping.** Batch `TaskCreate`/`TaskUpdate` calls alongside the next real tool call in the same turn.

**Existing issue feed**:

- Call `GET_community_issues` FIRST, before any research. The API returns the complete current issue list for the organization.
- When an output issue corresponds to an issue already in the feed, set `existing_issue_id` to that issue's ID. Never drop a prioritized existing issue unless it is clearly resolved.
- Prefer carrying an existing ID over creating a net-new issue for the same underlying concern.
- A 404 means no feed yet — treat as empty, set no `existing_issue_id`, and state "feed empty/404" in `data_quality_reason`.

**Databricks (`pmf_runtime.databricks`) — Haystaq lean annotation only**:

- Connect via the `pmf_runtime.databricks` module — verbatim:

  ```python
  from pmf_runtime import databricks as sql
  conn = sql.connect()
  cur = conn.cursor()
  cur.execute("SELECT ... WHERE col = :foo", {"foo": value})
  rows = cur.fetchall()
  ```

  The module exports `connect()`, `Connection`, `Cursor`, `ScopeViolation`, `UpstreamError`. There is no `databricks.query()` shortcut — you must `connect() → cursor() → execute() → fetchall()`. Skipping this snippet costs 3+ turns to discover via `dir()`.

- A query can return `state=PENDING` with no fetch-by-id (async). If so, just re-run the same statement.
- The broker auto-injects `WHERE Residence_Addresses_State = '<state>'` (and any city clause) into every query. **DO NOT add a state or `Residence_Addresses_City` clause yourself** — it returns HTTP 422 `ScopeViolation: scope_predicate_override`. The WHERE clauses your query needs are the **L2 district column** (when `L2_TYPE` is set) and `Voters_Active = 'A'`. **The L2 district column NAME is the VALUE of `L2_TYPE`** (e.g. `City_Ward`, `City_Council_Commissioner_District`); backtick-quote it and match the Step-4-confirmed value: `` `City_Ward` = :l2_name ``. When `L2_TYPE` is absent, `Voters_Active = 'A'` alone is correct — that is state scope. State scope is a fallback, not the goal: an unscoped statewide average makes the lean meaningless (see Step 4).
- **`Voters_Active` is a STRING.** Use `Voters_Active = 'A'`. `Voters_Active = 1` matches zero rows.
- **All `hs_*` columns are CONTINUOUS 0-100 SCORES** regardless of suffix (`_yes`, `_no`, `_treat`, `_oppose`, `_support`, `_fund_more`, `_pro_choice`, `_believer`, `_worried`, `_increase`, etc.). They are **within-state percentile ranks** (mean ~50, SD ~29), so the lean is `AVG(hs_x) - 50` ("distance from the average voter in this state"), NOT absolute support. Do not compute separate state/national priors; both collapse to 50. Because the scores center on 50 by construction, a raw "count >= 50" is roughly half the cohort regardless of domain — that is why Haystaq is a lean annotation here, not the salience ranker.
- **Use `AVG` for the lean, not a thresholded count.** `SUM(CASE WHEN ... THEN 1 ELSE 0 END)` and Postgres `COUNT(*) FILTER (WHERE ...)` are not how the lean is computed; `FILTER` is also a Databricks syntax error.
- **Use named placeholders** when parameterizing: `cursor.execute("... WHERE col = :foo", {"foo": value})`. Positional `?` raises a SQL error.
- **Named placeholders bind VALUES, not IDENTIFIERS.** Column names must be string-interpolated (f-string). Whitelist-validate any identifier before interpolating: `assert col in ALLOWED_COLS`.
- **Every query must reference an allowed table.** Bare `SELECT 1` (no FROM) is rejected.
- **Do NOT query `information_schema.columns` or `SHOW COLUMNS`** — the broker blocks them (`ScopeViolation: disallowed_table` / `disallowed_verb`), and probing burns turns. Use the **inline Haystaq catalog** below for column names; it is the complete, L2-verified set for this experiment. `ALLOWED_COLS` (Step 4) is exactly the columns listed there.

#### Inline Haystaq catalog (L2-verified)

Pick `~12-15` community-relevant columns from this catalog for the Step-4 batched
lean query. This is the **complete** set available to this experiment — do not
query a dictionary/metadata table at runtime. Columns are continuous 0-100
within-state percentile ranks (see the score rule above); the entry names encode
direction. Grouped into 9 topics:

**housing** — `hs_affordable_housing_gov_has_role` (gov has a role in affordable housing), `hs_affordable_housing_gov_no_role` (opposes gov role), `hs_gentrification_support`, `hs_gentrification_oppose`, `hs_new_home_buyer`, `hs_any_home_buyer`

**taxes** — `hs_tax_cuts_support`, `hs_tax_cuts_oppose`, `hs_gas_tax_support`, `hs_gas_tax_oppose`, `hs_social_security_tax_increase_support`, `hs_social_security_tax_increase_oppose`, `hs_min_wage_15_increase_support`, `hs_min_wage_15_increase_oppose`, `hs_ideology_fiscal_conserv`, `hs_ideology_fiscal_liberal`

**education** — `hs_school_choice_support`, `hs_school_choice_oppose`, `hs_school_funding_more`, `hs_school_funding_less`, `hs_charter_schools_support`, `hs_charter_schools_oppose`, `hs_teachers_union_positive`, `hs_teachers_union_negative`, `hs_community_college_free_support`, `hs_community_college_free_oppose`

**healthcare** — `hs_medicaid_expansion_support`, `hs_medicaid_expansion_oppose`, `hs_medicare_for_all_support`, `hs_medicare_for_all_oppose`, `hs_obamacare_aca_expand`, `hs_obamacare_aca_protect`, `hs_obamacare_aca_oppose`, `hs_family_medical_leave_support`, `hs_family_medical_leave_oppose`, `hs_opioid_crisis_treat`, `hs_opioid_crisis_enforce`

**climate_energy** — `hs_climate_change_believer`, `hs_climate_change_nonbeliever`, `hs_electric_vehicle_likely_buyer`, `hs_electric_vehicle_not_likely`, `hs_solar_panel_buyer_yes`, `hs_solar_panel_buyer_no`, `hs_pipeline_fracking_support`, `hs_pipeline_fracking_oppose`, `hs_green_new_deal_support`, `hs_green_new_deal_oppose`, `hs_sell_federal_lands_support`, `hs_sell_federal_lands_oppose`

**immigration** — `hs_mass_deporations_support`, `hs_mass_deporations_oppose`, `hs_mexican_wall_support`, `hs_mexican_wall_oppose`, `hs_immigration_process_unfair`, `hs_immigration_undesirable`

**crime_safety** — `hs_violent_crime_very_worried`, `hs_violent_crime_not_worried`, `hs_gun_control_support`, `hs_gun_control_oppose`, `hs_police_trust_yes`, `hs_police_trust_no`, `hs_death_penalty_support`, `hs_death_penalty_oppose`

**social_issues** — `hs_abortion_pro_choice`, `hs_abortion_pro_life`, `hs_same_sex_marriage_support`, `hs_same_sex_marriage_oppose`, `hs_trans_athlete_yes`, `hs_trans_athlete_no`, `hs_dei_support`, `hs_dei_oppose`, `hs_religion_important`, `hs_religion_not_important`

**regulation_economy** — `hs_regulations_too_harsh`, `hs_regulations_good`, `hs_capitalism_believe_sound`, `hs_capitalism_believe_flawed`, `hs_unions_beneficial`, `hs_unions_not_beneficial`, `hs_income_inequality_serious`, `hs_income_inequality_no_issue`, `hs_infrastructure_funding_fund_more`, `hs_infrastructure_funding_enough_spent`

`INLINE_HAYSTAQ_COLUMNS` (Step 4's `ALLOWED_COLS`) is the set of every `hs_*` name listed above. Note: coverage varies by state — some columns return near-zero `cov_*` and are dropped in Step 4 (informative, not a gap).

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
- `source_type` is one of `news` (incl. letters/op-eds, with `article_type` `opinion`/`editorial`), `advocacy_org` (community associations, BIAs, neighborhood councils, coalitions), `government_website` (311/official city pages), `poll` (a resident survey), or `research`.
- Deduplicate `detail.sources[]` by URL before assembling.
- `detail.overview` is always required and its `summary` must be substantive (2-3 sentences naming the instance) — never an empty string.
- Every factual claim in a subsection (a dollar figure, a vote, a date, a project) must trace to a source in `source_ids`. An unsourced claim is a re-verify failure — drop it or source it.
- Do not reproduce an individual resident's personal data (name, address, contact) from a letter, petition, or group roster; report the topic and aggregate intensity only.

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
# Optional L2 district key. When present, the Haystaq lean is scoped to this
# office's constituents; when absent, it falls back to state scope (Step 4).
L2_TYPE = PARAMS.get("l2_district_type")  # L2 column name, e.g. "City_Ward"
L2_NAME = PARAMS.get("l2_district_name")  # value to match, e.g. "FAYETTEVILLE CITY WARD 2"
RUN_ID = os.environ.get("RUN_ID", "unknown")
```

### Step 2 — Read current issue feed

**Milestone — run `milestone("feed")`** (per BEFORE YOU START item 7) before this step's work.

Call `GET_community_issues` with `organization_slug=ORG_SLUG`. Record every existing issue: capture `id`, `title`, and `category`. You will use these IDs in Step 8 to carry issues forward. A 404 means no feed yet — treat as empty and note it in `data_quality_reason`.

### Step 3 — Resident-demand discovery (the salience signal)

**Milestone — run `milestone("discovery")`** (per BEFORE YOU START item 7) before this step's work.

Work down the source order. Lead with news + resident voice; the council/legislation record is out of scope.

```python
# Local news + direct resident voice:
#   f'"{DISTRICT}" local issues news 2026'
#   f'"{DISTRICT}" letter to the editor OR op-ed 2026'
# Community advocacy groups (prefer nonpartisan):
#   f'"{DISTRICT}" neighborhood association OR community association'
#   f'"{DISTRICT}" business improvement district OR BIA OR neighborhood council'
# Concentrated demand:
#   f'"{DISTRICT}" petition OR ballot question OR referendum 2026'
#   f'"{DISTRICT}" 311 OR service requests report'
#   f'"{DISTRICT}" resident survey OR community survey results'
```

For each candidate, capture the **named instance** (the project, rate, vote, dollar figure, location) and which residents/groups are raising it. For advocacy groups, record the group name and any party affiliation; prefer nonpartisan, and require a second independent source before a partisan group's framing counts as resident salience. Do NOT scrape social platforms.

**Run this step in ~4-5 turns, not 20+**: issue the queries 2-4 per turn (they are independent — batch them), and record candidates from the snippets (title, URL, date, named instance). Do not fetch page bodies during discovery; body reads happen only in Step 6 for facts you will publish. Stay inside the 14-search budget — roughly 8-10 here, leaving 4-6 for gap-filling later.

### Step 4 — Haystaq lean annotation (Databricks)

**Milestone — run `milestone("haystaq")`** (per BEFORE YOU START item 7) before this step's work.

Pick community-relevant columns from the **inline Haystaq catalog** (CRITICAL
RULES below) — do NOT query `information_schema`/`SHOW COLUMNS`; the broker
blocks them and the catalog is the complete, L2-verified column set. Then scope
the lean to **this office's district**: discover the exact L2 district value,
and run ONE batched aggregation — **district scope when `L2_TYPE` is set and
confirmed, otherwise state scope** (the broker auto-injects the state clause).
Scoping matters: `hs_*` are within-state percentile ranks, so averaging them
over the whole state collapses every lean to ~0. The district scope is what
makes the lean meaningful.

**Run this ENTIRE step as ONE python block (the block below is complete — both queries, the PENDING retry, and a compact printout). Target 1-2 turns.** If the block fails twice end-to-end, SKIP the lean annotation entirely — record `haystaq: skipped (<reason>)` in `notes` and move on. The lean is an annotation, not a requirement; do not spend more turns debugging it.

```python
import re, time
from pmf_runtime import databricks as sql

TABLE = "goodparty_data_catalog.dbt.int__l2_nationwide_uniform_w_haystaq"
conn = sql.connect(); cur = conn.cursor()

def run(q, p):
    # a query can return state=PENDING (async, no fetch-by-id) — just re-run it
    for attempt in range(4):
        cur.execute(q, p)
        rows = cur.fetchall()
        if rows: return rows
        time.sleep(2)
    return []

# Columns come from the inline catalog — NOT from information_schema.
ALLOWED_COLS = INLINE_HAYSTAQ_COLUMNS  # the set of column names in the catalog below
candidate_cols = [...]  # ~12-15 community-relevant columns picked from the catalog
assert all(re.fullmatch(r"hs_[a-z0-9_]{1,60}", c) for c in candidate_cols)
assert all(c in ALLOWED_COLS for c in candidate_cols)

# Discover the exact L2 district value (only when L2_TYPE is set). PARAMS may
# pass L2_NAME='25' while the L2 value is 'NEW YORK CITY CNCL DIST 25 (EST.)'.
district_value = None
if L2_TYPE:
    assert re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", L2_TYPE)  # ASCII identifier
    rows = run(f"""
      SELECT DISTINCT `{L2_TYPE}` AS district_value, COUNT(*) AS n
      FROM {TABLE} WHERE Voters_Active = 'A'
      GROUP BY `{L2_TYPE}` ORDER BY n DESC LIMIT 200
    """, {})
    # exact, else case-insensitive substring match against L2_NAME
    district_value = next((r[0] for r in rows if r[0] == L2_NAME), None) or next(
        (r[0] for r in rows if L2_NAME and L2_NAME.lower() in str(r[0]).lower()), None
    )

sums_sql = ", ".join(
    f"ROUND(AVG(`{c}`),1) AS `avg_{c}`, COUNT(`{c}`) AS `cov_{c}`" for c in candidate_cols
)
# District scope when confirmed; otherwise state scope (broker injects state).
where = "Voters_Active = 'A'"
params = {}
if district_value is not None:
    where = f"`{L2_TYPE}` = :l2_name AND " + where
    params = {"l2_name": district_value}
rows = run(f"SELECT COUNT(*) AS n, {sums_sql} FROM {TABLE} WHERE {where}", params)
row = rows[0] if rows else None

# Compact printout ONLY — never dump raw result objects.
if row:
    n = row[0]
    leans = {}
    for i, c in enumerate(candidate_cols):
        avg, cov = row[1 + 2*i], row[2 + 2*i]
        if avg is not None and cov and cov >= 0.8 * n:
            leans[c] = round(avg - 50, 1)
    print({"n": n, "district_value": district_value, "leans": leans})
else:
    print("HAYSTAQ EMPTY — skip the lean annotation, note it, move on")
```

`n` should look like one district, not the whole state — if `L2_TYPE` was set
but `n` is in the millions, the district clause did not apply; record
`haystaq_scope: "state_fallback"` in `notes` and treat the lean as low-confidence.
Drop any column whose coverage `cov_*` is below ~80% of `n` (no coverage here —
record it). For survivors, distinctiveness = `avg_* - 50`; translate to a chip
(e.g. `+11` → "+11 pro-transit", `-19` → "-19 low police trust"). This lean
annotates issues; it never ranks them.

### Step 5 — Rank by resident attention mass

**Milestone — run `milestone("rank")`** (per BEFORE YOU START item 7) before this step's work.

Rank candidate issues by how much resident attention they carry: recency, breadth of coverage, and how many independent sources corroborate. Ground the top rows in a live source; label any row inferred from the Haystaq lean alone as "inferred." A single-source issue is low-confidence. Keep up to 5.

### Step 6 — Re-verify and capture sources

**Milestone — run `milestone("verify")`** (per BEFORE YOU START item 7) before this step's work.

**Verify ALL source URLs in ONE batched python block** (target 1-2 turns for the whole step, not one turn per URL):

```python
from pmf_runtime import http
for url in all_source_urls:              # every URL you intend to cite, in one pass
    try:
        r = http.head(url)               # {"status": 200, "final_url": "https://..."}
        print(r["status"], r.get("final_url", url)[:100])
    except Exception as e:
        print("ERR", url[:80], str(e)[:60])
# keep a source only if it resolves; cite final_url on redirect
```

Escalate to `http.get` ONLY for a 403/405 URL you must keep, or when a fact you will publish needs body confirmation — and extract the fact inside the same block, printing ≤300 chars (never the raw body).

Capture for each source: `name`, `source_type` (`news|advocacy_org|government_website|poll|research`), `url`, `publisher`, `article_type`, `article_date`, `retrieved_at` (ISO-8601), and a `retrieved_text_or_snapshot` snippet (≤1500 chars). Record dollars, dates, votes, locations. Drop anything you cannot confirm.

### Step 7 — Annotate actionability and lean

**Milestone — run `milestone("annotate")`** (per BEFORE YOU START item 7) before this step's work (covers Steps 7-8, annotation + ID carry).

For each issue, add the Haystaq lean chip where coverage allows ("hyperlocal, no model lean" otherwise), and a short "who can act / what they could do" note in the `summary`.

### Step 8 — Carry existing issue IDs

Compare each output issue against the existing feed from Step 2. When the issue clearly maps to an existing record, set `existing_issue_id`. Do not invent a mapping if it is ambiguous.

### Step 9 — Assemble artifact

**Milestone — run `milestone("assemble")`** (per BEFORE YOU START item 7) before this step's work.

```python
import json
artifact = {
    "schema_version": 1,
    "list": "top_community",
    "organization_slug": ORG_SLUG,
    "generated_for_run_id": RUN_ID,
    "issues": [...],            # up to 5 IssueOutput, each a specific named issue
    "sources_used": [...],      # layers actually used, e.g. ["local_news", "resident_voice", "advocacy_groups", "petitions", "311", "survey", "haystaq"]
    "data_quality": "ok",       # "partial" if some lookups failed; "insufficient_signal" if you couldn't ground the list
    "data_quality_reason": "...",  # name dropped Haystaq domains, missing layers (no 311, no survey, empty feed), and why fewer than 5 if short
    "notes": "...",
}
with open("/workspace/output/top_community_issues.json", "w") as f:
    json.dump(artifact, f, indent=2)
```

Every issue needs a substantive `detail.overview.summary`; build `history` / `research` / `quotes` where you have sourced material. Every `source_id` must resolve.

### Step 10 — Validate

**Milestone — run `milestone("validate")`** (per BEFORE YOU START item 7) before this step's work.

```bash
python3 /workspace/validate_output.py
```

Fix any schema violations before declaring success.

## Spot-check

After validation passes, verify the points below. **A spot-check finding is fixed surgically**: drop or `Edit` the specific offending source/field/row. It is NEVER a reason to re-open discovery, re-run searches, or rebuild the artifact — if a whole issue fails its check, delete that issue and say why in `data_quality_reason`.

- **Every row is a specific named issue, not a category.** If a `title` reads like "Housing" or "Public safety," you stopped at the domain — name the live instance.
- **The list reflects resident demand, not the office's agenda.** No issue is here because the council took it up; each is here because residents are raising it. The governing-body record was not used as a source.
- **The list leads with sustained attention.** Each top issue should show resident attention over at least the past several months, not a one-week flare-up (that belongs in `trending_issues`).
- **No unverified facts.** Every dollar figure, vote, and date traces to a source whose URL returned 200 via `head`. Re-confirm at least 3 issue URLs.
- **Issues span at least 2 categories.** If every issue is one category, your search was too narrow.
- **Haystaq is a lean annotation, not the ranker.** The rank follows resident attention mass. The lean uses `AVG - 50`; if you used a `>= 50` count to rank, redo it.
- **Advocacy-group framing is nonpartisan or flagged.** Any partisan group's claim is corroborated by an independent source.
- **`detail.overview.summary` is present and substantive on every issue**, and `list` is `"top_community"`.
- **Coverage gaps are stated.** `data_quality_reason` names dropped zero-coverage Haystaq domains, any missing layer (no 311 feed, no resident survey, empty feed), and why the list is short if under 5.

## Failure modes

| Symptom                                                    | Cause                                                 | Fix                                                                                    |
| ---------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Rows are categories ("Housing", "Safety") not named issues | Stopped at the domain                                 | Find the specific project/rate/vote/location residents are raising; that is the title  |
| List mirrors the council agenda                            | Used the governing-body record as a source            | Drop it; this is demand-side — rank by what residents raise in news/advocacy/petitions |
| List feels stale or one-week-thin                          | Confused trending with sustained                      | Require ~6 months of resident attention; send one-week flare-ups to `trending_issues`  |
| Haystaq drives the ranking                                 | Treated the lean as salience                          | Rank by resident attention mass; Haystaq only annotates lean via `AVG - 50`            |
| All Haystaq leans near 0 / all domains ~50%                | Used a thresholded count on percentile-rank scores    | Use `AVG - 50`; scores center on 50 by construction                                    |
| A Haystaq domain shows 0 coverage                          | No coverage for that model in this state              | Drop it; record in `data_quality_reason`                                               |
| `ScopeViolation: scope_predicate_override`                 | Added `WHERE Residence_Addresses_State/City` manually | Remove those clauses; broker auto-injects them                                         |
| Partisan group's claim ranked as resident salience         | Skipped the nonpartisan-corroboration rule            | Flag affiliation; require a second independent source                                  |
| `source_id` not found in `detail.sources[]`                | Referenced a source you never added                   | Add the matching entry to `detail.sources[]`                                           |
| Validator: missing/empty `overview`                        | `detail.overview.summary` omitted or empty            | Always emit a substantive `overview.summary`; it is required                           |
| `GET_community_issues` 404                                 | Organization has no feed yet                          | Treat as empty feed; note it in `data_quality_reason`                                  |
