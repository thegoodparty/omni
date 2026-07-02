<!-- The schemas in manifest.json are the stable contract. This prose encodes the method; the JSON Schema is what the validator enforces. -->

# Top Community Issues

Given an elected official's jurisdiction, produce a focused ranked list of the community issues constituents are actively talking about — **lead with the 1 to 3 strongest, and add more only when each is independently well-evidenced (never padding toward the schema's max of 10)** — **each one a specific, named, currently-relevant problem**, not a policy category. This is a **demand-side** list: the question it answers is "what is on residents' minds here," not "what is on the office's agenda." Two signals are combined. Resident-demand web sources (local news, letters/op-eds, community advocacy groups, petitions, 311) are the **salience signal** — they say what residents are raising and how loudly. Haystaq priority scores from Databricks (`int__l2_nationwide_uniform_w_haystaq`) are a **lean annotation only** — they say how the local electorate *tilts* on an issue once salience has surfaced it, never which issue to rank. **The governing body's own record is excluded as a source** (no council/select-board agendas, minutes, ordinances, or legislative portals): the office's agenda is exactly the filter this list is meant to see around. Begin by reading the current issue feed via the MCP tool so carried issues keep their existing IDs.

## What counts as an issue (this drives everything)

**An issue is something constituents are actively talking about — raising, complaining about, organizing around, or arguing over — that bears on daily life in the jurisdiction.** Salience to residents is the selection and ranking criterion. An issue does **not** have to be something the office can act on, and it need not be strictly hyperlocal: if residents are loudly talking about a state mandate, a school-funding formula, a tax bill, or a feared development, it counts.

**Annotate actionability; do not select on it.** For each issue, the `summary` should note who can act and what they could do, so the reader knows whether their office can move it. This is a downstream annotation, not a filter — a top resident concern the office cannot directly fix is still a top resident concern, and dropping it would defeat the purpose of a demand-side scan.

**Every output row MUST be a specific named issue, not a taxonomy category.** "Housing" is not an issue; "the proposed 40-unit development on Route 3" or "the 21% jump in the local tax rate" is. The `category` field is only a tag; the `title` must name the concrete instance — the actual project, vote, dollar figure, rate change, or location.

**Lead with 1 to 3 issues; do not pad toward 10.** The list is a focused lead of the few highest-attention concerns, not a quota. Reserve `priority: "high"` for the 1 to 3 best-evidenced, clearly resident-driven issues; include further issues only when each independently clears the same evidence and freshness bar, ranked below at `priority` `medium`/`low`. The schema allows up to 10, but that is a ceiling, not a target — a short, airtight list is the product, and padding it with thin or stale rows is a failure mode. Never drop a real issue just to shorten the list; demote it instead (see the attribution rule).

**Resident-attribution is a labeling rule, not a selection filter.** Only *claim* residents are raising an issue when you have direct resident voice for it: a letter or op-ed (`article_type` `opinion`/`editorial`), a petition, a public-comment write-up, an advocacy-group statement, a resident survey (`source_type` `poll`), or a 311 record. A topic that appears only in straight news reporting, a press release, or a government communication (`article_type` `reporting`/`press_release`/`government_communication`) is not, on its own, evidence that residents care — it may be a reporter's or an official's framing. Do **not** delete such an issue; include it, but say so honestly in the `summary` (e.g. "covered in local news; direct resident voice not yet evidenced") and do not give it `priority: "high"` on salience grounds. The error to avoid is asserting resident demand you cannot source, not mentioning a real issue.

**Use the recipient's identity, but their own voice is not resident demand.** The list is generated for the elected official in `organization_slug`/`office`, who is a public figure quoted in local coverage. Their own statements, campaign messaging, and votes are the supply side, not resident salience: never file a `quotes` item attributed to the official (or their office) as evidence residents are raising an issue, and do not let the official's framing stand in for resident demand. Use identity only to tune the actionability note. (The governing-body record is already excluded as a source.)

**Time horizon: sustained but still live.** This list surfaces established concerns with evidence of resident attention going back at least ~6 months **that are also still active now**: each issue needs at least one reputable source with a **verified `article_date` within the last ~12 months** of the run. Sustained does not mean stale — if the most recent credible coverage is older than ~12 months, treat the issue as lapsed and drop it (this is what removes multi-year date-traps). This still differs from the companion `trending_issues` experiment, which requires issues to have *arisen* within its recent window; here the test is a long history plus a recent pulse. **Verify the real byline `article_date` from the source itself** — a search-snippet date can be wrong, so when a date is load-bearing near the ~12-month boundary, confirm it from the article body. A one-week flare-up belongs in trending, not here.

**Re-verify every fact against a current source before you publish it.** Do not assert a project, vote, dollar figure, or claim from memory or a search snippet alone. Name dollars, dates, votes, and locations, and attach a source to each. Distinguish "residents believe X" (a citable salience fact) from "X is true." A confident-but-wrong issue is worse than a thinner true one.

## Source order

Resident-demand sources rank the list; Haystaq only annotates lean. The governing body's record is intentionally excluded. When you record each source, set `article_type` honestly: `opinion`/`editorial` (letters/op-eds), plus petitions, advocacy-group statements, a resident survey, and 311 are **resident voice**; plain `reporting`/`press_release`/`government_communication` is **not** (see the resident-attribution labeling rule above).

1. **Local civic news, plus letters to the editor and op-eds**, via `WebSearch`. The workhorse: what reporters cover tracks what residents raise, and letters/op-eds are direct resident voice. Read article bodies, not just headlines. Supplies dollars, dates, and the named instance.
2. **Local community advocacy groups (prefer nonpartisan)**, via `WebSearch`. Standing, resident-led civic organizations that speak for neighborhood priorities: neighborhood/community associations, Business Improvement Areas (BIAs/BIDs), elected or volunteer neighborhood councils, civic leagues, residents' and tenants' associations, merchant associations, and single-issue coalitions (parks-friends, transit-riders groups). Pull their public output: newsletters, meeting minutes/agendas, public statements, position pages. This is organized, semi-structured resident demand. **Prefer groups with no political-party affiliation;** when a group has a clear partisan tie, flag the affiliation in the source `name`/snapshot and never let its framing stand in as resident salience without a second, independent source.
3. **Petitions, ballot questions raised by residents, and organized campaigns** (save-our-X groups, referendum drives), via `WebSearch`. Direct evidence of concentrated demand.
4. **311 / service requests**, via `WebSearch`, when a public feed or report is discoverable. Resident-driven, geocoded, operational demand. Use if found; flag as missing if not.
5. **Representative resident survey**, via `WebSearch`, if one exists (town/community survey, university or regional poll broken out to the area). The only near-representative anchor; sets the prior when present. Flag the gap when absent.
6. **Haystaq priority scores (Databricks), lean annotation only.** Not a salience source and not a report-ranking input. One batched aggregation (below) yields a per-issue lean chip. Run the per-variable coverage check first; many states return 0 coverage on some columns.

**Social media and community forums are NOT a source here.** Do not attempt to scrape Twitter/X, Facebook, Nextdoor, or Reddit — those platforms block automated access and the signal is unreliable. Resident voice comes from news, letters/op-eds, and the public output of advocacy groups instead.

## The QA projection: `claims[]` and `sources[]`

This artifact is quality-checked by a shared validator (`qa_validate.py`) that adjudicates **discrete claims**, not whole issues. So alongside the human-facing `issues[]`, emit two machine-facing arrays **at the artifact root**. `issues[]` stays exactly as specified elsewhere — these two arrays are additive, and they are what a reviewer on GitHub runs QA against.

**`sources[]` (artifact root)** — the deduped union of every issue's `detail.sources[]`. Same `Source` shape (`id`, `name`, `source_type`, `url`, `article_date`, `retrieved_at`, `retrieved_text_or_snapshot`). One entry per unique source: a source cited by two issues appears once, and both issues' claims reference that one `id`. Every `source_id` used anywhere in the artifact must resolve to an entry here.

**`claims[]` (artifact root)** — decompose each issue into the individual factual assertions a skeptical reader would check, **one assertion per claim**: a single dollar figure, a single date, a single vote, the existence of a named project/ordinance, a specific location, or a specific resident-demand attribution. "The $2M shelter purchase was debated at the Jan 7 2026 meeting" is *two* claims (the $2M figure; the Jan 7 2026 date), not one.

Each claim carries:

- `claim_id` — unique within the artifact.
- `item_id` — the `id` of the issue in `issues[]` it supports.
- `claim_text` — the self-contained assertion, naming the specific value.
- `claim_type` and `claim_weight` — pick from this table:

  | `claim_type` | use for | `claim_weight` |
  | --- | --- | --- |
  | `existence_or_event` | the named project / ordinance / measure / event is real and occurred | high |
  | `figure_or_dollar` | a dollar amount, count, rate, or percentage | high |
  | `date_or_timeframe` | a specific date, or the ~12-month freshness of the issue | high |
  | `vote_or_official_action` | a vote tally or a specific official decision/action | high |
  | `location_or_geography` | the issue is in this jurisdiction / at a specific place | high |
  | `attribution_resident_demand` | residents are raising it (letter, petition, survey, 311, advocacy statement) | medium |
  | `background_context` | supporting context that is not load-bearing | medium |
  | `lean_annotation` | a Haystaq lean chip (a labeled, modeled figure) | low |
  | `synthesis` | a summary or inference across sources | low |

- `source_ids` — the `sources[]` entries that ground the claim (at least one).
- `source_extracts` — the **verbatim** text from those sources that states the claim. **Each extract MUST be a literal substring of the cited source's `retrieved_text_or_snapshot`** — the validator checks this, so copy it exactly, do not paraphrase or summarize. Prefer the object form `{"text": "...", "section_header": "..."}` so the judge sees where in the source it came from.

**Why the decomposition quality is the QA quality.** The validator's judge classifies each claim as supported / unsupported / contradicted against its extracts — the same adjudication a human QA reviewer does. A **contradicted** high-weight claim blocks the release (the issue was Incorrect); an **unsupported** specific claim warns (Unverified). So: emit every load-bearing fact as its own claim with a real verbatim extract, and never manufacture support — an honest claim whose extract does not actually state it is one the judge should catch, not one to paper over. Every high-weight fact in an issue's `detail` (its dollars, dates, votes, named instance, location, and ~12-month freshness) should appear as a claim. A rich overview with only one or two claims is under-decomposed — the QA layer cannot see facts you did not project.

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
8. Rank candidate issues by **resident attention mass** (recency + breadth + how many independent sources corroborate). **Lead with the 1 to 3 strongest (reserve `priority: "high"` for these); add more only if each independently clears the evidence + freshness bar; never pad toward 10.** Ground top rows in a live source; label any row inferred from the lean alone, or carried by press coverage with no direct resident voice, accordingly. A single-source issue is low-confidence by construction.
9. Re-verify each issue against a current source; capture dollars, dates, votes, locations; verify the source URL is live with `pmf_runtime.http.head`. **Verify the real byline `article_date` and require at least one source within the last ~12 months; drop stale issues (and date-traps) whose newest verifiable source is older.** Drop anything you cannot confirm.
10. Match each output issue against the existing feed: carry `existing_issue_id` when it maps to an existing record. Prefer carrying the ID over creating a duplicate. If the feed was empty/404, say so in `data_quality_reason`.
11. Classify each issue into exactly one `category` from the allowed enum (the category is a tag; the title is the named instance).
12. Annotate each issue with its Haystaq lean chip where coverage allows; an operational row with no covered var is "hyperlocal, no model lean," which is informative, not a gap. Add a "who can act / what they could do" note to the `summary`. For any issue carried only by press/agenda coverage (no resident-voice source), say so in the `summary` and keep it below `priority: "high"`; do not file the official's own quotes as resident voice.
13. Assign `priority` (`low|medium|high`) and `rank` (1 = most important). Rank by resident attention mass; the Haystaq lean does not move the rank.
14. Write a substantive `detail.overview.summary` (2-3 sourced sentences naming the instance) for every issue — never empty. Give every issue a stable `id`. Deduplicate `detail.sources[]` by URL. Verify every `source_id` resolves to an entry in `detail.sources[]`.
15. Build the QA projection (see "The QA projection" above): flatten every `detail.sources[]` into a deduped top-level `sources[]`; decompose each issue into top-level `claims[]` (one discrete fact per claim, linked by `item_id`), each with a `claim_type`/`claim_weight` and a **verbatim** `source_extracts` substring of the cited source.
16. Set `sources_used`, `data_quality`, `data_quality_reason`, `notes` honestly — name any missing source layer (no 311 feed, no resident survey, Haystaq domains dropped for zero coverage). The list is intentionally short (1 to 3 lead issues is normal); use `data_quality_reason`/`notes` to explain the lead and any issue dropped for staleness, not to apologize for being under 10.
17. Assemble artifact and write to `/workspace/output/top_community_issues.json`.
18. Run `python3 /workspace/validate_output.py`.
19. Perform the spot-check.

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

**QA projection (`claims[]` + `sources[]` at the artifact root)**:

- Emit a top-level `sources[]` that is the deduped union of every issue's `detail.sources[]` (dedupe by URL; one `id` per unique source). Emit a top-level `claims[]` decomposing each issue's facts. See "The QA projection" for the full contract.
- Every issue needs a stable top-level `id`; every claim's `item_id` must equal one of those issue ids; every claim's `source_ids` must resolve to the top-level `sources[]`.
- **Each `source_extracts` entry must be a literal, verbatim substring of the cited source's `retrieved_text_or_snapshot`.** Copy it character-for-character — do not paraphrase, trim mid-word, or reconstruct from memory. The validator fails claims whose extract does not appear in the cited source.
- One assertion per claim. Split compound facts (a dollar figure AND a date = two claims). Use the high-weight `claim_type`s for the load-bearing facts (figure, date, vote, existence, location) — those are the ones a contradiction turns into a blocking defect.

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

Rank candidate issues by how much resident attention they carry: recency, breadth of coverage, and how many independent sources corroborate. Ground the top rows in a live source; label any row inferred from the Haystaq lean alone as "inferred." A single-source issue is low-confidence. **Lead with the 1 to 3 strongest and reserve `priority: "high"` for them; add further issues only when each independently clears the evidence and freshness bar, at `priority` `medium`/`low`. Do not pad toward 10** — the cap is a ceiling, not a target. Demote weaker-but-real issues rather than deleting them.

### Step 6 — Re-verify and capture sources

```python
from pmf_runtime import http
r = http.head(url)                       # {"status": 200, "final_url": "https://..."}
if r["status"] in (403, 405):
    r = http.get(url)                    # browser render, only if head was blocked
# keep the source only if it resolves; cite r["final_url"] on redirect
```

Capture for each source: `name`, `source_type` (`news|advocacy_org|government_website|poll|research`), `url`, `publisher`, `article_type`, `article_date`, `retrieved_at` (ISO-8601), and a `retrieved_text_or_snapshot` snippet. Record dollars, dates, votes, locations. Drop anything you cannot confirm.

**Freshness gate.** Set `article_type` honestly (it decides resident-voice vs press, per the labeling rule) and verify the real `article_date` from the source — not the search-snippet date, which is often wrong. Every issue needs at least one reputable source with a verified `article_date` within the last ~12 months of the run; if the newest source you can confirm is older than that, the issue is lapsed — drop it (this is how multi-year date-traps that resurface in search get removed). When a date sits near the boundary and only a snippet date is available, escalate to `http.get` to read the byline before trusting it.

### Step 7 — Annotate actionability and lean

For each issue, add the Haystaq lean chip where coverage allows ("hyperlocal, no model lean" otherwise), and a short "who can act / what they could do" note in the `summary`. If the issue is carried only by press/agenda coverage with no direct resident voice, label that in the `summary` and keep it below `priority: "high"`. Exclude the recipient official's own quotes/votes/press from resident-voice evidence — that is the supply side, not resident demand.

### Step 8 — Carry existing issue IDs

Compare each output issue against the existing feed from Step 2. When the issue clearly maps to an existing record, set `existing_issue_id`. Do not invent a mapping if it is ambiguous.

### Step 9 — Build the QA projection and assemble the artifact

Give each issue a stable `id`. Flatten every `detail.sources[]` into one deduped top-level `sources[]`. Decompose each issue into top-level `claims[]` — one discrete fact each, linked by `item_id`, with a verbatim `source_extracts` substring of the cited source (see "The QA projection").

```python
import json

# Each issue carries a stable id used by claims[].item_id (distinct from existing_issue_id).
issues = [
    {"id": "issue-1", "title": "...", "summary": "...", "category": "...",
     "priority": "high", "rank": 1, "detail": {...}},
    # ...
]

# Deduped union of every issue's detail.sources[] — one entry per unique source.
sources = [
    {"id": "src-1", "name": "...", "source_type": "news", "url": "https://...",
     "article_type": "reporting", "article_date": "2026-05-08",
     "retrieved_at": "2026-07-02T00:00:00Z",
     "retrieved_text_or_snapshot": "... full snippet, the text extracts are quoted from ..."},
    # ...
]

# One assertion per claim. source_extracts MUST be verbatim substrings of the cited source's snapshot.
claims = [
    {"claim_id": "c-1", "item_id": "issue-1",
     "claim_text": "The city council debated a >$2M building purchase for a long-term shelter.",
     "claim_type": "figure_or_dollar", "claim_weight": "high",
     "source_ids": ["src-1"],
     "source_extracts": [{"text": "the more than $2 million building purchase",
                          "section_header": "Council weighs shelter options"}]},
    # ... one claim per load-bearing fact (dollars, dates, votes, existence, location, freshness, attribution)
]

artifact = {
    "schema_version": 1,
    "list": "top_community",
    "organization_slug": ORG_SLUG,
    "generated_for_run_id": RUN_ID,
    "issues": issues,           # up to 10 IssueOutput, each a specific named issue
    "claims": claims,           # QA projection: discrete facts the validator adjudicates
    "sources": sources,         # QA projection: deduped provenance, source_ids resolve here
    "sources_used": [...],      # layers actually used, e.g. ["local_news", "resident_voice", "advocacy_groups", "petitions", "311", "survey", "haystaq"]
    "data_quality": "ok",       # "partial" if some lookups failed; "insufficient_signal" if you couldn't ground the list
    "data_quality_reason": "...",  # name dropped Haystaq domains, missing layers (no 311, no survey, empty feed), and why fewer than 10 if short
    "notes": "...",
}
with open("/workspace/output/top_community_issues.json", "w") as f:
    json.dump(artifact, f, indent=2)
```

Every issue needs a substantive `detail.overview.summary`; build `history` / `research` / `quotes` where you have sourced material. Every `source_id` — in a subsection and in `claims[]` — must resolve to `sources[]`.

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
- **The lead is tight, not padded.** `priority: "high"` is reserved for the 1 to 3 best-evidenced issues; the list is not padded toward 10 with thin rows. A short, airtight list is correct.
- **Resident demand is sourced or labeled.** Every issue that asserts residents are raising it has direct resident voice (op-ed/letter, petition, advocacy statement, survey, 311). Press/agenda-only issues are kept but labeled "resident voice not yet evidenced" and are not `priority: "high"` — and none were deleted just for lacking a quote.
- **Every issue is still live.** Each has a date-verified source within ~12 months; no multi-year date-traps slipped in, and `article_date`s are real bylines, not snippet dates.
- **No issue rests on the official's own voice.** The recipient's quotes/votes/press are not used as evidence of resident demand.
- **No unverified facts.** Every dollar figure, vote, and date traces to a source whose URL returned 200 via `head`. Re-confirm at least 3 issue URLs.
- **Issues span at least 2 categories.** If every issue is one category, your search was too narrow.
- **Haystaq is a lean annotation, not the ranker.** The rank follows resident attention mass. The lean uses `AVG - 50`; if you used a `>= 50` count to rank, redo it.
- **Advocacy-group framing is nonpartisan or flagged.** Any partisan group's claim is corroborated by an independent source.
- **The QA projection is complete and honest.** Every issue has an `id`; every high-weight fact (dollars, dates, votes, named instance, location, ~12-month freshness) is its own `claims[]` entry linked by `item_id`; every claim's `source_extracts` is a verbatim substring of the cited source's snapshot; every `source_ids` resolves to the deduped top-level `sources[]`. No claim's extract was paraphrased or invented to manufacture support.
- **`detail.overview.summary` is present and substantive on every issue**, and `list` is `"top_community"`.
- **Coverage gaps are stated.** `data_quality_reason` names dropped zero-coverage Haystaq domains, any missing layer (no 311 feed, no resident survey, empty feed), and why the list is short if under 10.

## Failure modes

| Symptom | Cause | Fix |
| --- | --- | --- |
| Rows are categories ("Housing", "Safety") not named issues | Stopped at the domain | Find the specific project/rate/vote/location residents are raising; that is the title |
| List mirrors the council agenda | Used the governing-body record as a source | Drop it; this is demand-side — rank by what residents raise in news/advocacy/petitions |
| List feels stale or one-week-thin | Confused trending with sustained | Require ~6 months of resident attention; send one-week flare-ups to `trending_issues` |
| List padded toward 10 with thin rows | Treated 10 as a target | Lead with 1-3; reserve `priority:"high"`; add more only if independently well-evidenced |
| A straight-news topic asserted as resident demand | Counted `reporting` as resident voice | Label it "resident voice not yet evidenced," keep it below high priority; do not delete it |
| An issue's newest source is >12 months old (date-trap) | Trusted a stale or snippet date | Verify the byline `article_date`; drop the issue if nothing reputable is within ~12 months |
| Official's own quote used as resident salience | Recipient's voice treated as demand | Exclude the official's quotes/votes/press; that is supply-side, not resident demand |
| Haystaq drives the ranking | Treated the lean as salience | Rank by resident attention mass; Haystaq only annotates lean via `AVG - 50` |
| All Haystaq leans near 0 / all domains ~50% | Used a thresholded count on percentile-rank scores | Use `AVG - 50`; scores center on 50 by construction |
| A Haystaq domain shows 0 coverage | No coverage for that model in this state | Drop it; record in `data_quality_reason` |
| `ScopeViolation: scope_predicate_override` | Added `WHERE Residence_Addresses_State/City` manually | Remove those clauses; broker auto-injects them |
| Partisan group's claim ranked as resident salience | Skipped the nonpartisan-corroboration rule | Flag affiliation; require a second independent source |
| `source_id` not found in `detail.sources[]` | Referenced a source you never added | Add the matching entry to `detail.sources[]` |
| QA validator: claim extract not found in cited source | Paraphrased or reconstructed the `source_extracts` text | Copy the extract verbatim from `retrieved_text_or_snapshot`; it must be a literal substring |
| QA validator: an issue's facts aren't adjudicated | Under-decomposed — dollars/dates/votes left out of `claims[]` | Emit one claim per load-bearing fact, linked by `item_id`, with the right high `claim_weight` |
| QA validator: `claims[].source_ids` unresolved / no top-level `sources[]` | Left provenance only under `detail.sources[]` | Flatten to a deduped top-level `sources[]`; point `source_ids` at those ids |
| Validator: missing/empty `overview` | `detail.overview.summary` omitted or empty | Always emit a substantive `overview.summary`; it is required |
| `GET_v1_community-issue-feed` 404 | Organization has no feed yet | Treat as empty feed; note it in `data_quality_reason` |
