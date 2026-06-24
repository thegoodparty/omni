<!-- The schemas in manifest.json are the stable contract. This prose encodes the method; the JSON Schema is what the validator enforces. -->

# Top Community Issues

Given an elected official's jurisdiction, produce a ranked list of up to 10 community issues that constituents are actively talking about — **each one a specific, named, currently-relevant problem**, not a policy category. This is a **demand-side** list: the question it answers is "what is on residents' minds here," not "what is on the office's agenda." Two signals are combined. Resident-demand web sources (local news, letters/op-eds, community advocacy groups, petitions, 311) are the **salience signal** — they say what residents are raising and how loudly. Haystaq priority scores from Databricks (`int__l2_nationwide_uniform_w_haystaq`) are a **lean annotation only** — they say how the local electorate *tilts* on an issue once salience has surfaced it, never which issue to rank. **The governing body's own record is excluded as a source** (no council/select-board agendas, minutes, ordinances, or legislative portals): the office's agenda is exactly the filter this list is meant to see around. Begin by reading the current issue feed via the MCP tool so carried issues keep their existing IDs.

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

## TODO CHECKLIST

1. Read PARAMS_JSON. Capture `organization_slug`, `state`, `office`, `district_descriptor`.
2. Call `GET_v1_community-issue-feed` with `organization_slug` to retrieve the current issue list. Record existing issue IDs, titles, categories.
3. `WebSearch` the **local civic news + letters/op-eds** for the jurisdiction. Identify candidate named issues residents are raising, with dollars/dates/locations.
4. `WebSearch` the **community advocacy groups** (associations, BIAs, neighborhood councils, coalitions). Record each group's name and any party affiliation; prefer nonpartisan; pull the issues they are pushing.
5. `WebSearch` **petitions / organized campaigns**, then **311 / service requests** and a **resident survey** if discoverable. Flag any layer not found.
6. Discover candidate `hs_*` issue columns via `information_schema.columns`; run a distribution check on 3 to confirm 0-100 continuous scores.
7. Run ONE batched aggregation returning per-domain `ROUND(AVG(hs_x),1)`, coverage `COUNT(hs_x)`, and `COUNT(*) AS n`. Drop any column below ~80% coverage. Compute distinctiveness = `AVG - 50` and a lean chip per domain.
8. Rank candidate issues by **resident attention mass** (recency + breadth + how many independent sources corroborate). Ground top rows in a live source; label any row inferred from the lean alone as inferred. A single-source issue is low-confidence by construction.
9. Re-verify each issue against a current source; capture dollars, dates, votes, locations; verify the source URL is live with `pmf_runtime.http.head`. Drop anything you cannot confirm.
10. Match each output issue against the existing feed: carry `existing_issue_id` when it maps to an existing record. Prefer carrying the ID over creating a duplicate. If the feed was empty/404, say so in `data_quality_reason`.
11. Classify each issue into exactly one `category` from the allowed enum (the category is a tag; the title is the named instance).
12. Annotate each issue with its Haystaq lean chip where coverage allows; an operational row with no covered var is "hyperlocal, no model lean," which is informative, not a gap. Add a "who can act / what they could do" note to the `summary`.
13. Assign `priority` (`low|medium|high`) and `rank` (1 = most important). Rank by resident attention mass; the Haystaq lean does not move the rank.
14. Write a substantive `detail.overview.summary` (2-3 sourced sentences naming the instance) for every issue — never empty. Deduplicate `detail.sources[]` by URL. Verify every `source_id` resolves to an entry in `detail.sources[]`.
15. Set `sources_used`, `data_quality`, `data_quality_reason`, `notes` honestly — name any missing source layer (no 311 feed, no resident survey, Haystaq domains dropped for zero coverage) and, if fewer than 10 issues, why.
16. Assemble artifact and write to `/workspace/output/top_community_issues.json`.
17. Run `python3 /workspace/validate_output.py`.
18. Perform the spot-check.

## CRITICAL RULES

**Existing issue feed**:

- Call `GET_v1_community-issue-feed` FIRST, before any research. The API returns the complete current issue list for the organization.
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
- The broker auto-injects `WHERE Residence_Addresses_State = '<state>'` AND `Residence_Addresses_City IN (<cities>)` into every query. **DO NOT add these clauses yourself.** Adding them returns HTTP 422 `ScopeViolation: scope_predicate_override`. The only WHERE clause your query needs is `Voters_Active = 'A'`.
- **`Voters_Active` is a STRING.** Use `Voters_Active = 'A'`. `Voters_Active = 1` matches zero rows.
- **All `hs_*` columns are CONTINUOUS 0-100 SCORES** regardless of suffix (`_yes`, `_no`, `_treat`, `_oppose`, `_support`, `_fund_more`, `_pro_choice`, `_believer`, `_worried`, `_increase`, etc.). They are **within-state percentile ranks** (mean ~50, SD ~29), so the lean is `AVG(hs_x) - 50` ("distance from the average voter in this state"), NOT absolute support. Do not compute separate state/national priors; both collapse to 50. Because the scores center on 50 by construction, a raw "count >= 50" is roughly half the cohort regardless of domain — that is why Haystaq is a lean annotation here, not the salience ranker.
- **Use `AVG` for the lean, not a thresholded count.** `SUM(CASE WHEN ... THEN 1 ELSE 0 END)` and Postgres `COUNT(*) FILTER (WHERE ...)` are not how the lean is computed; `FILTER` is also a Databricks syntax error.
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
RUN_ID = os.environ.get("RUN_ID", "unknown")
```

### Step 2 — Read current issue feed

Call `GET_v1_community-issue-feed` with `organization_slug=ORG_SLUG`. Record every existing issue: capture `id`, `title`, and `category`. You will use these IDs in Step 8 to carry issues forward. A 404 means no feed yet — treat as empty and note it in `data_quality_reason`.

### Step 3 — Resident-demand discovery (the salience signal)

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

### Step 4 — Haystaq lean annotation (Databricks)

Discover candidate columns, confirm they are 0-100 continuous, then one batched aggregation for the lean.

```python
from pmf_runtime import databricks as sql
conn = sql.connect(); cur = conn.cursor()
cur.execute("""
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'int__l2_nationwide_uniform_w_haystaq' AND column_name LIKE 'hs_%'
  ORDER BY column_name
""", {})
hs_cols = [r[0] for r in cur.fetchall()]

ALLOWED_COLS = set(hs_cols)
candidate_cols = [...]  # ~12-15 community-relevant columns; assert all in ALLOWED_COLS
sums_sql = ", ".join(
    f"ROUND(AVG(`{c}`),1) AS `avg_{c}`, COUNT(`{c}`) AS `cov_{c}`" for c in candidate_cols
)
cur.execute(f"""
  SELECT COUNT(*) AS n, {sums_sql}
  FROM goodparty_data_catalog.dbt.int__l2_nationwide_uniform_w_haystaq
  WHERE Voters_Active = 'A'
""", {})
row = cur.fetchone()
```

Drop any column whose coverage `cov_*` is below ~80% of `n` (no coverage in this state — record it). For survivors, distinctiveness = `avg_* - 50`; translate to a chip (e.g. `+11` → "+11 pro-transit", `-19` → "-19 low police trust"). This lean annotates issues; it never ranks them.

### Step 5 — Rank by resident attention mass

Rank candidate issues by how much resident attention they carry: recency, breadth of coverage, and how many independent sources corroborate. Ground the top rows in a live source; label any row inferred from the Haystaq lean alone as "inferred." A single-source issue is low-confidence. Keep up to 10.

### Step 6 — Re-verify and capture sources

```python
from pmf_runtime import http
r = http.head(url)                       # {"status": 200, "final_url": "https://..."}
if r["status"] in (403, 405):
    r = http.get(url)                    # browser render, only if head was blocked
# keep the source only if it resolves; cite r["final_url"] on redirect
```

Capture for each source: `name`, `source_type` (`news|advocacy_org|government_website|poll|research`), `url`, `publisher`, `article_type`, `article_date`, `retrieved_at` (ISO-8601), and a `retrieved_text_or_snapshot` snippet. Record dollars, dates, votes, locations. Drop anything you cannot confirm.

### Step 7 — Annotate actionability and lean

For each issue, add the Haystaq lean chip where coverage allows ("hyperlocal, no model lean" otherwise), and a short "who can act / what they could do" note in the `summary`.

### Step 8 — Carry existing issue IDs

Compare each output issue against the existing feed from Step 2. When the issue clearly maps to an existing record, set `existing_issue_id`. Do not invent a mapping if it is ambiguous.

### Step 9 — Assemble artifact

```python
import json
artifact = {
    "schema_version": 1,
    "list": "top_community",
    "organization_slug": ORG_SLUG,
    "generated_for_run_id": RUN_ID,
    "issues": [...],            # up to 10 IssueOutput, each a specific named issue
    "sources_used": [...],      # layers actually used, e.g. ["local_news", "resident_voice", "advocacy_groups", "petitions", "311", "survey", "haystaq"]
    "data_quality": "ok",       # "partial" if some lookups failed; "insufficient_signal" if you couldn't ground the list
    "data_quality_reason": "...",  # name dropped Haystaq domains, missing layers (no 311, no survey, empty feed), and why fewer than 10 if short
    "notes": "...",
}
with open("/workspace/output/top_community_issues.json", "w") as f:
    json.dump(artifact, f, indent=2)
```

Every issue needs a substantive `detail.overview.summary`; build `history` / `research` / `quotes` where you have sourced material. Every `source_id` must resolve.

### Step 10 — Validate

```bash
python3 /workspace/validate_output.py
```

Fix any schema violations before declaring success.

## Spot-check

After validation passes, verify:

- **Every row is a specific named issue, not a category.** If a `title` reads like "Housing" or "Public safety," you stopped at the domain — name the live instance.
- **The list reflects resident demand, not the office's agenda.** No issue is here because the council took it up; each is here because residents are raising it. The governing-body record was not used as a source.
- **The list leads with sustained attention.** Each top issue should show resident attention over at least the past several months, not a one-week flare-up (that belongs in `trending_issues`).
- **No unverified facts.** Every dollar figure, vote, and date traces to a source whose URL returned 200 via `head`. Re-confirm at least 3 issue URLs.
- **Issues span at least 2 categories.** If every issue is one category, your search was too narrow.
- **Haystaq is a lean annotation, not the ranker.** The rank follows resident attention mass. The lean uses `AVG - 50`; if you used a `>= 50` count to rank, redo it.
- **Advocacy-group framing is nonpartisan or flagged.** Any partisan group's claim is corroborated by an independent source.
- **`detail.overview.summary` is present and substantive on every issue**, and `list` is `"top_community"`.
- **Coverage gaps are stated.** `data_quality_reason` names dropped zero-coverage Haystaq domains, any missing layer (no 311 feed, no resident survey, empty feed), and why the list is short if under 10.

## Failure modes

| Symptom | Cause | Fix |
| --- | --- | --- |
| Rows are categories ("Housing", "Safety") not named issues | Stopped at the domain | Find the specific project/rate/vote/location residents are raising; that is the title |
| List mirrors the council agenda | Used the governing-body record as a source | Drop it; this is demand-side — rank by what residents raise in news/advocacy/petitions |
| List feels stale or one-week-thin | Confused trending with sustained | Require ~6 months of resident attention; send one-week flare-ups to `trending_issues` |
| Haystaq drives the ranking | Treated the lean as salience | Rank by resident attention mass; Haystaq only annotates lean via `AVG - 50` |
| All Haystaq leans near 0 / all domains ~50% | Used a thresholded count on percentile-rank scores | Use `AVG - 50`; scores center on 50 by construction |
| A Haystaq domain shows 0 coverage | No coverage for that model in this state | Drop it; record in `data_quality_reason` |
| `ScopeViolation: scope_predicate_override` | Added `WHERE Residence_Addresses_State/City` manually | Remove those clauses; broker auto-injects them |
| Partisan group's claim ranked as resident salience | Skipped the nonpartisan-corroboration rule | Flag affiliation; require a second independent source |
| `source_id` not found in `detail.sources[]` | Referenced a source you never added | Add the matching entry to `detail.sources[]` |
| Validator: missing/empty `overview` | `detail.overview.summary` omitted or empty | Always emit a substantive `overview.summary`; it is required |
| `GET_v1_community-issue-feed` 404 | Organization has no feed yet | Treat as empty feed; note it in `data_quality_reason` |
