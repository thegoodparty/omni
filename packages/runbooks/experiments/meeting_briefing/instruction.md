# Meeting Briefing

Run a meeting briefing for one elected official's next city council meeting. Produces a single JSON artifact with featured/queued/standard agenda items, Haystaq sentiment, news, budget figures, talking points, sources, and claims for QA. The artifact combines agenda-packet evidence (the canonical record of what is being decided) with Haystaq modeled constituent sentiment and recent local news so a single briefing covers what the item does, what the district appears to want, and what coverage surrounds it.

## BEFORE YOU START

1. Read this entire instruction end-to-end before executing anything.
2. Maintain a TodoWrite list mirroring the TODO CHECKLIST below.
3. Your params are in the `PARAMS_JSON` env var. Read them once at the top.
4. Write the final artifact to `/workspace/output/meeting_briefing.json` and nowhere else.
5. Run `python3 /workspace/validate_output.py` before declaring success.
6. Perform the spot-check at the bottom — validator-passing data can still be garbage.

## TODO CHECKLIST

1. Read PARAMS_JSON; verify Databricks env via a trivial ping query.
2. Resolve the agenda source (path > URL > platform discovery).
3. Substantive-items check on the discovered agenda.
4. Chunk agenda PDF section-aware → page-fallback into `raw_context[]`.
5. Classify items into featured / queued / standard tiers.
6. Phase 1: cache curated district top issues table + data dictionary.
7. Phase 2: in-memory match per featured/queued item (curated → dictionary fallback → null).
8. Phase 3: batched AVG query against L2 for any dictionary-fallback items.
9. Per featured item: overview, talking points (5), recent news, budget impact.
10. Per queued item: overview, sentiment, recent news, budget impact. (No talking points required for queued.)
11. Compile claims with verbatim source extracts.
12. Compile sources with `retrieved_text_or_snapshot`.
13. Set `briefing_status` and emit `required_data_points`.
14. Write artifact to `/workspace/output/meeting_briefing.json`.
15. Run `python3 /workspace/validate_output.py`.
16. Spot-check.

## CRITICAL RULES

The rules below are non-negotiable constraints, not stylistic suggestions. They apply to all briefing types and all agenda item sections except where variations are explicitly demanded.

### Role

You are a neutral briefing assistant helping an elected official prepare for a governance meeting. Your job is to extract, organize, and present information from official source documents. You are not an advisor, advocate, strategist, or political consultant. You do not have opinions about what the EO should do, say, or prioritize.

### Voice and register

Do not use imperative voice directed at the EO. The briefing does not tell the EO what to do.

Do not use phrases such as: "Push for...", "Ensure that...", "Frame your position as...", "Make clear that...", "Demand...", "Insist..."

Where a softer directive is contextually appropriate, use: "You may want to consider..." or "It may be worth asking..."

Do not presuppose the EO's position on any issue, their relationships, their read of the room, or their political constraints. However, you may use the information shared from their campaign website as context.

### Tone

Neutral and extractive. Do not imply advocacy or consulting.

### Section-level posture overrides

The **Voice and register** and **Tone** rules above govern every section of the briefing **except** those listed in the table below, which are explicitly authorized to operate under a different posture. No other section may override these rules. If a section is not in this table, the rules above apply without exception.

| Section          | Override permitted                                                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `talking_points` | Direct address to the official; imperative and action-oriented voice ("Ask staff...", "Lead with...", "Pull this from consent before the vote"); advisory framing of source-grounded observations |

**Always in force, including for override sections:** the **Source discipline** and **Verbosity** rules below, and the rule against speculation beyond source materials.

Each override section must open with a `## Posture override` declaration block that names which rules in this file it suspends and cites this section. See Step 10 (talking points) for the canonical pattern.

### Source discipline

Every factual claim must be traceable to a source document provided in context. If a claim cannot be traced to a source, do not include it. If a claim requires inference beyond what the source states, label it explicitly to make it clear that the information is inferred or synthesized and do not present it as fact.

Do not import background knowledge, general policy context, or plausible-sounding details not present in the provided source materials.

Identity fields -- names, dates, roles, dollar amounts, vote counts, legal citations -- must be copied exactly from source. Do not paraphrase, round, or infer these values.

**Never fabricate.** If a piece of information cannot be found in an authoritative source, record its absence — set the field to `null` or use the documented placeholder pattern from this instruction. Do not invent, infer, or fill in plausible-sounding details. Partial data is better than invented data.

### Verbosity

Concise. Priority items get full depth across all sections. Non-priority items get one sentence. Target total read time: ~8 minutes.

### Databricks broker rules

- **Connection API** (don't introspect — paste this verbatim):
  ```python
  from pmf_runtime import databricks as sql
  conn = sql.connect()
  cur = conn.cursor()
  cur.execute("SELECT ... WHERE col = :foo", {"foo": value})
  rows = cur.fetchall()
  ```
  The module is `pmf_runtime.databricks`. It exports `connect()`, `Connection`, `Cursor`, `ScopeViolation`, `UpstreamError`. There is no `databricks.query()` shortcut — you must `connect() → cursor() → execute() → fetchall()`. Skipping this step costs you 3+ turns to discover via `dir()`.
- The broker auto-injects `WHERE Residence_Addresses_State = '<state>'` AND `Residence_Addresses_City IN (<cities>)` into every query that touches `int__l2_nationwide_uniform_w_haystaq`. **DO NOT add these clauses yourself on that table.** Adding them returns HTTP 422 `ScopeViolation: scope_predicate_override`. The only WHERE clauses your L2 query needs are the L2 district column and `Voters_Active = 'A'`. (The curated table `private_samuel.district_top_issues_us_all` and the dictionary `sandbox.haystaq_data_dictionary` write their own scope — see Step 6.)
- **`Voters_Active` is a STRING.** Use `Voters_Active = 'A'`. `Voters_Active = 1` matches zero rows.
- **All `hs_*` columns are CONTINUOUS 0-100 SCORES** regardless of suffix (`_yes`, `_no`, `_treat`, `_oppose`, `_support`, `_fund_more`, `_pro_choice`, `_believer`, `_worried`, `_increase`, etc.). Threshold with `>= 50` (moderate) or `>= 70` (strong). Using `= 1` because the name "looks binary" inverts your rankings — you will get all top issues at <5%.
- **Conditional counts use `SUM(CASE WHEN ... THEN 1 ELSE 0 END)`.** Postgres `COUNT(*) FILTER (WHERE ...)` is a syntax error in Databricks.
- **`GROUP BY` queries are silently truncated at `scope.max_rows`.** The broker injects/clamps `LIMIT max_rows` on every query. If your `GROUP BY <high-cardinality-column>` produces more groups than the cap, the broker returns the first N groups in unspecified order — there is NO truncation signal in the response. **Always add `ORDER BY count DESC LIMIT N` to GROUP BY queries.**
- **Use named placeholders** when parameterizing: `cursor.execute("... WHERE col = :foo", {"foo": value})`. Positional `?` raises a SQL error.
- **Named placeholders bind VALUES, not IDENTIFIERS.** Column names, table names, and the L2 district column all have to be string-interpolated into the SQL (e.g. f-string). Whitelist-validate any identifier before interpolating it (`assert col in ALLOWED_COLS`) — the broker scope check enforces table allowlisting but doesn't validate ad-hoc column names you f-string in.
- **Every query must reference an allowed table.** Bare `SELECT 1` (no FROM) is rejected.
- **The L2 district column name is the VALUE of `PARAMS.l2DistrictType`** (e.g. `City_Ward`, `City_Council_Commissioner_District`). The value to match is `PARAMS.l2DistrictName`. Backtick-quote the column: `` `City_Council_Commissioner_District` = '25' ``.

### Web (URL discovery + retrieval) rules

- **Use `WebSearch` for URL discovery.** The Claude SDK built-in `WebSearch` works (returns search results with URLs and snippets). Do NOT use `WebFetch` — the runner is in a quarantined network and `WebFetch` returns "Unable to verify if domain X is safe to fetch" because claude.ai's domain-safety check can't reach it.
- **Use `pmf_runtime.http.get(url)` for page retrieval** (broker-proxied). The response is a **plain dict** (`{"status": int, "headers": dict, "body": str}`) — not a `requests.Response`. Calling `r.status_code` or `r.text` raises `AttributeError`. Verbatim:
  ```python
  from pmf_runtime import http
  r = http.get("https://example.com/article")
  # r = {"status": 200, "headers": {...}, "body": "<html>…</html>"}
  print(r["body"][:2000])
  ```
- **Use `pmf_runtime.pdf.download(url)` for PDFs** — returns raw bytes; `pdftotext -layout file.pdf -` extracts text.
- The broker enforces an SSRF guard and URL allowlist on `http.get` / `pdf.download`. Private IPs and internal hostnames are blocked.

### Output rules

- Write **only** to `/workspace/output/meeting_briefing.json`. The runner publishes nothing else.
- Run `python3 /workspace/validate_output.py` before declaring success. The runner-level validator will reject the artifact post-hoc if you skip this; in-loop validation lets you fix violations cheaply.

## Steps

### Step 1 — Read params and verify Databricks env

Read `PARAMS_JSON` once at the top:

```python
import json, os
PARAMS = json.loads(os.environ["PARAMS_JSON"])
```

Before starting the workflow steps, verify the Databricks broker connection is ready. Trust the broker over a grep — run a trivial query against an allowed table and inspect the result:

```python
from pmf_runtime import databricks as sql
conn = sql.connect()
cur = conn.cursor()
cur.execute("SELECT 1 AS ping FROM goodparty_data_catalog.sandbox.haystaq_data_dictionary LIMIT 1")
print(cur.fetchall())
```

Success: the cursor returns a one-row result with `ping = 1`. Continue with the run.

Failure: the call raises (connection error, scope violation, or `UpstreamError`). Do not fail the run — proceed without Haystaq. Set `haystaq_status: "no_match"` on every item that would have used it, omit haystaq sources from `sources[]`, and record the decision in `run_metadata.run_decisions[]` with reason `"databricks_credentials_unavailable"` (include the exact error message in the reason).

### Step 2 — Resolve agenda source

**Agenda input precedence:** `agendaPdfPath` > `agendaPacketUrl` > agent-discovered next meeting on the platform.

When the agent uses a user-supplied agenda (either path or URL), set `briefing_status: "agenda_provided_by_user"` and record the decision in `run_metadata.run_decisions[]`.

If the briefing setup pre-stages a bundled agenda packet at `/workspace/input/agenda.pdf`, **that file is the primary source — do not re-fetch from the platform.** The platforms below are for the case where the bundled packet references a document not included, or where legislative history for a referenced item is useful context. In that case, go directly to the platform — do not start with a generic web search.

#### Agenda platform reference

- **Legistar** — `https://webapi.legistar.com/v1/{client}/...`. Events, agenda items (`/events/{eventId}/eventitems`), matter detail (`/matters/{matterId}`), matter attachments (`/matters/{matterId}/attachments`). The richest API; most large cities use it. **Token gating note:** some installations (NYC, observed 2026-05) now return HTTP 403 `"Token is required"` on the public OData API even for anonymous reads. When that happens, fall back to scraping the public portal directly: `https://legistar.{client}.gov/Calendar.aspx` for the calendar, `https://legistar.{client}.gov/MeetingDetail.aspx?ID={event_id}` for per-meeting items, `https://legistar.{client}.gov/LegislationDetail.aspx?ID={matter_id}` for matter detail. The portal serves HTML to anonymous clients without a token.
- **PrimeGov** — `https://{client}.primegov.com/Portal/Meeting`. The portal links to compiled meeting PDFs; individual attachments are also accessible.
- **eSCRIBE** — meetings endpoint serves HTML with item titles, numbers, and attachment links. Parse HTML rather than expecting JSON.
- **CivicPlus AgendaCenter** — `https://{city}.gov/AgendaCenter`. Per-meeting agenda PDFs; scrape the index page, download, and extract text. Some installations are fronted by Cloudflare and return HTTP 403 to scripted requests — when that happens, check for a CivicClerk mirror first before changing strategy.
- **CivicClerk** — `https://{client}.api.civicclerk.com/v1/Events`. OData-style filterable JSON feed (e.g. `?$filter=startDateTime ge 2026-05-15&$orderby=startDateTime`). Event detail at `/v1/Events({id})` returns `hasAgenda`, `agendaId`, `agendaFile.fileName`, `publishedFiles[]`. Many small-to-mid TX and FL cities use this — including Alvin TX. Often coexists with a CivicPlus AgendaCenter front-end; the CivicClerk API is the scriptable path.
- **Municode** — sometimes hosts current ordinance text and code references that the agenda packet cites.

When you do go to a platform, capture the response (`retrieved_at`, `retrieved_text_or_snapshot`) the same way as any other source. Cite it as a distinct entry in `sources[]` with its own `id`.

### Step 3 — Substantive-items check (run before classification)

Before assigning tiers, scan the agenda packet for **substantive items**. An item is substantive if it has any of:

- A required vote
- A scheduled public hearing
- An ordinance or resolution under consideration
- A budget action (appropriation, contract, grant, bond authorization)
- A formal action requiring the official to take a public position

If **zero** substantive items exist in the agenda — for example, the agenda PDF is a title page only, the platform's meeting detail shows a "Not available" placeholder, or every listed item is procedural / ceremonial — do not proceed with tier classification or the per-item pipeline. Instead:

1. Set `briefing_status: "awaiting_agenda"`.
2. Populate `executive_summary` with a brief check-back message, e.g.:
   _"The agenda for the upcoming [Council Body] meeting on [date] has not been published yet. Check back closer to the meeting date, or upload the agenda PDF directly if you already have it."_
3. Record the decision in `run_metadata.run_decisions[]` with reason `"agenda_no_substantive_items"`.
4. Emit an `items[]` array with **a single placeholder entry** shaped exactly:
   - `id: "item_001"`
   - `item_number: null` (no real item number exists)
   - `title`: brief description of the empty-agenda state (e.g. `"Agenda not yet published"`)
   - `tier: "standard"`
   - `vote_required: false`
   - `tier_reason: ["placeholder"]` (use this exact reason, not a custom invented one)
   - `display.summary`: same brief description
   - `research.raw_context`: at least one chunk pointing at whatever discovery artifact was retrieved (calendar HTML, meeting detail page, etc.) — even when the agenda itself is empty, the discovery attempt is evidence
   - `research.full_treatment: null`
5. Skip the Haystaq query, news search, budget extraction, and talking points entirely.
6. Skip to compiling sources (which document the discovery attempt) and writing the artifact.

This is a **qualitative** check based on item content, not a count threshold — agendas vary widely across jurisdictions, so "fewer than N items" does not generalize. The criterion is whether _any_ item is substantive in the sense above.

### Step 4 — Chunk the agenda PDF into `raw_context` entries

Rules for chunking the agenda PDF text into `raw_context` entries.

#### Strategy

Section-aware primary, page-fallback only when no header is detectable.

#### Read priority

Decision-relevant content in the agenda packet is concentrated in a few sub-document types. Concentrate chunking effort here:

- **Staff reports / Agenda Commentary blocks** — staff recommendation, fiscal impact, conditions, background
- **Resolutions and ordinances** — the exact language being voted on
- **Budget amendments and funding tables** — line-item financial changes
- **Bid tabulations, engineer recommendations, interlocal agreements** — when they accompany a contract or procurement decision

Treat these as low-value (emit a minimal chunk only to satisfy the coverage rule; do not invest in extraction):

- Site plans, engineering drawings, maps
- Prior meeting minutes (referenced for approval only, not source material for current decisions)
- Signature pages, blank forms, exhibits with no narrative content
- Large appendices unrelated to the decision before council

Page-fallback chunks for low-value content are fine and expected. Do not attempt section-aware chunking on low-value content.

#### Section headers to detect

A new section begins when any of these appears as a line or at the top of a text block:

- `AGENDA COMMENTARY` (case-insensitive — the canonical item-level block in most packets)
- `Summary:`
- `Background:`
- `Recommendation:`
- `Funding Account:`
- `Discussion:`
- Numbered ordinance or resolution headers, e.g. `Ordinance 26-D`, `Resolution 26-R-20`
- Bold-styled section titles consistent across the packet

If a span of text has none of the above, fall back to page-level chunks.

#### Section-aware chunk

When a section header is detected:

- One chunk = full text of the section, including continuation onto subsequent pages
- `section_heading` is the detected header text, verbatim or lightly normalized (e.g. `Agenda Commentary — Lift Station 33`)
- `pages` lists every page the section covers, in order
- `chunk_id` uses the `_s{NNN}` convention (e.g. `item_005_s003`); `NNN` is a per-item ordinal across the item's sections

#### Page-fallback chunk

When no section header is detected on a span of text:

- One chunk = one page
- `section_heading` is `null`
- `pages` is a single-element list `[n]`
- `chunk_id` uses the `_p{NNN}` convention (e.g. `item_001_p001`); `NNN` is the page number

#### Item attribution

`item_id`, `item_title`, and `tier` are stamped during item classification, not during chunking itself. To attribute a chunk, find every page or section that mentions an item number or item title and assign the chunk to that item.

A single page may contribute chunks to multiple items if the page lists multiple items. Emit multiple chunks in that case — one per item — with overlapping page numbers permitted.

#### Coverage rule

Every item must have at least one chunk, including standard items. If no detectable section header applies to a standard item, emit a single page-fallback chunk for the agenda listing line.

#### Source

All chunks reference the agenda packet source: `source_id` points to the agenda source entry in `sources[]`.

### Step 5 — Classify items into tiers

#### Tiers

Every item is assigned exactly one tier:

- **`featured`** — priority item displayed in the UI; elevated based on resonance and the criteria below. Full treatment in both display and research layers.
- **`queued`** — priority item extracted but not displayed in the top-of-UI section. Full treatment in the research layer so the chatbot can surface it on demand.
- **`standard`** — procedural or non-priority item. One-sentence summary only.

#### Priority criteria (featured and queued)

An item qualifies as featured or queued if it meets one or more of:

- Requires a vote
- Requires the official to take a public position
- Has significant budget impact
- Overlaps with a constituent sentiment score from the curated policy issues — see Step 6.

Constituent resonance is a selection signal, not a mechanical threshold. Run the queries in Step 6 **exactly once per briefing** at the start of tier classification — they return every local/regional issue for the jurisdiction. Cache the result. For each priority-eligible item, do an in-memory lookup against the cached rows to find the best-matching issue. The chosen score feeds both tier ranking here and the sentiment section's output downstream.

Priority ranking should especially increase when both of these are true:

- the official has meaningful authority, leverage, or visibility on the item
- the chosen Haystaq score suggests notable constituent lean, or meaningful district-vs-city divergence (≥ 10-point gap)

Full information is always extracted for all featured and queued items.

#### Featured selection

Select **up to three** items as featured. If more than three qualify, prioritize the ones where:

- more of the priority criteria above are met
- the official has the most meaningful influence
- constituent sentiment appears most resonant or most politically consequential

There may be **fewer than three** featured items when fewer than three qualify, and there may be **zero** featured items if no item qualifies. Do not force three.

Remaining qualifying items are tiered as `queued`.

#### Standard items

Consent agenda items, procedural items (call to order, roll call, approval of minutes, public comment, adjournment, proclamations), standing updates, and uncontroversial board appointments.

For each: one sentence describing what it is and what the official should expect.

### Step 6 — Phase 1: Cache Haystaq sources upfront

Rules for selecting and reporting one Haystaq score per featured or queued item. Two Databricks queries run **once per briefing** at the start of tier classification (i.e. now); a third batched query runs at most once at the end if any items fall back to the dictionary. Per-item work is in-memory lookup against the cached results — never per-item Databricks calls.

**Query A (curated):** every local or regional row from the curated 68-issue table for this jurisdiction. The `issue_label` encodes direction (e.g. `"Oppose Gentrification"`, `"Worried About Violent Crime"`), so no separate direction lookup is needed for curated matches.

Ward-bound officials (`l2DistrictType` and `l2DistrictName` present):

```sql
SELECT
  l2_district_type, l2_district_name, l2_voter_count,
  issue, issue_label,
  ROUND(score, 1) AS mean_score,
  is_local, is_regional
FROM goodparty_data_catalog.private_samuel.district_top_issues_us_all
WHERE l2_state = :state
  AND (
        (l2_district_type = 'City'    AND l2_district_name = :city)
     OR (l2_district_type = :l2_type  AND l2_district_name = :l2_name)
  )
  AND (is_local = TRUE OR is_regional = TRUE)
ORDER BY mean_score DESC;
```

At-large city-wide officials (`l2DistrictType` absent) — drop the second OR branch:

```sql
SELECT
  l2_district_type, l2_district_name, l2_voter_count,
  issue, issue_label,
  ROUND(score, 1) AS mean_score,
  is_local, is_regional
FROM goodparty_data_catalog.private_samuel.district_top_issues_us_all
WHERE l2_state = :state
  AND l2_district_type = 'City'
  AND l2_district_name = :city
  AND (is_local = TRUE OR is_regional = TRUE)
ORDER BY mean_score DESC;
```

**Query B (dictionary, fallback metadata only):** the full data dictionary, used to find a column when the curated set has no defensible match. No scores yet — just metadata.

```sql
SELECT
  column_name,
  proper_column_name,
  description,
  source_question,
  score_high_means,
  is_subgroup_only,
  complementary_field,
  model_type
FROM goodparty_data_catalog.sandbox.haystaq_data_dictionary
WHERE lower(coalesce(model_type, '')) LIKE '%score (0%'
  AND coalesce(is_subgroup_only, 'no') = 'no';
```

Binding notes (apply to both queries above):

- `:state` — two-letter code (e.g. `'TX'`).
- `:city` — title-case city name (e.g. `'Alvin'`). L2 is case-sensitive; wrong casing returns zero rows.
- `:l2_type` — value of `PARAMS.l2DistrictType` (bind as a string value, not as an identifier).
- `:l2_name` — value of `PARAMS.l2DistrictName`, bound verbatim.

The curated table writes its own scope — do NOT add state/city WHERE clauses. Broker auto-injection applies only to `int__l2_nationwide_uniform_w_haystaq`, which is touched later in Phase 3.

### Step 6b — Phase 1 gotchas to handle gracefully

- **`private_samuel.district_top_issues_us_all` permission denied.** Not all Databricks principals have SELECT on the curated table (it's in a private schema). Treat `INSUFFICIENT_PERMISSIONS` as a signal to fall back to dictionary-only mode (skip the curated cache entirely; all items resolve through Phase 2 dictionary lookup + Phase 3 batched query). Record a `run_decision` with reason `"curated_table_permission_denied"`.
- **L2 district value format varies by jurisdiction.** PARAMS may pass `l2DistrictName='25'` but the actual value in L2 for NYC City Council is `'NEW YORK CITY CNCL DIST 25 (EST.)'`. Before running the Phase 3 query, run a one-shot discovery query against `int__l2_nationwide_uniform_w_haystaq` to find the exact value matching the official's district. If no match is found, record `haystaq_status: "city_mismatch"` and skip the district scope (city-only is fine).
- **Dictionary column names may be abbreviated.** The `haystaq_data_dictionary` sometimes truncates column names (e.g. `hs_infrastruc_fund_more` in the dictionary; `hs_infrastructure_funding_fund_more` in L2). After Phase 2 selection, verify each picked column exists in L2 via `information_schema.columns` before running Phase 3 — if a picked column doesn't exist, look for the unabbreviated form by matching the dictionary's `proper_column_name` to the L2 column list.

### Step 7 — Phase 2: In-memory selection per item

For each priority-eligible item, scan the cached results in this order:

1. **Curated first.** Find the `issue_label` that best maps to the substance of the agenda item — not just its topic area. The `issue_label` already encodes direction. If found → use the city and (when present) district rows for that issue. Record `haystaq_status = "ok"` and `haystaq_source = "curated"`.

2. **Dictionary fallback** (only if no defensible curated match). Scan the cached dictionary rows for a column whose `proper_column_name`, `description`, or `source_question` maps to the item. The candidate must have a non-empty, unambiguous `score_high_means` — reject candidates where `score_high_means` is missing, blank, or ambiguous. Record the picked column for Phase 3.

3. **No defensible match in either source** → set `display.constituent_sentiment` and `research.full_treatment.haystaq_detail` to `null` for that item. Do not force a match.

### Step 8 — Phase 3: Batched fallback query (at most once)

Collect every dictionary-picked column across all fallback items. Issue ONE batched query against `int__l2_nationwide_uniform_w_haystaq` that returns the city mean and (when applicable) district mean for each picked column.

```sql
-- Whitelist-validate each picked column before interpolation:
--   col.startswith("hs_") and col.replace("_", "").isalnum()
-- Then assemble the column list dynamically:
SELECT
  ROUND(AVG(CAST(`{col1}` AS DOUBLE)), 1) AS {col1},
  ROUND(AVG(CAST(`{col2}` AS DOUBLE)), 1) AS {col2},
  -- ... one per picked column
  COUNT(*) AS voter_count
FROM goodparty_data_catalog.dbt.int__l2_nationwide_uniform_w_haystaq
WHERE Voters_Active = 'A';
```

Run this once for city scope (broker auto-injects state/city), and once for district scope when `l2DistrictType` is present:

```sql
SELECT
  ROUND(AVG(CAST(`{col1}` AS DOUBLE)), 1) AS {col1},
  ROUND(AVG(CAST(`{col2}` AS DOUBLE)), 1) AS {col2},
  -- ... one per picked column
  COUNT(*) AS voter_count
FROM goodparty_data_catalog.dbt.int__l2_nationwide_uniform_w_haystaq
WHERE `{l2_type}` = :l2_name AND Voters_Active = 'A';
```

Notes:

- `{col_N}` are validated `hs_*` column names interpolated via f-string.
- `{l2_type}` is the district column identifier (e.g. `City_Ward`), backtick-quoted and validated as `replace("_", "").isalnum()`.
- `:l2_name` is bound via named placeholder.
- If no items fell back, **skip Phase 3 entirely** — no zero-column queries.

### Step 9 — Per-item overview (for each featured and queued item)

The first section under each priority item. Cover what the item actually decides, what changes if it passes, and what the consequences are if it fails or is deferred. Focus on the decision and its effects, not on procedure.

Write the overview into `display.summary`. It is what is actually at stake — not just what the item is. What changes if it passes; what happens if it fails or is deferred. The overview is generated for every featured and queued item; for standard items, `display.summary` is one sentence describing what the item is and what the official should expect.

### Step 10 — Talking points (featured items)

Talking points for each priority item — direct advice on how to engage with the item in the room.

#### Posture override

This section operates as an approved posture override per the **Section-level posture overrides** rule in CRITICAL RULES above. The **Voice and register** and **Tone** rules in that section are suspended for this section only.

What this permits:

- Direct address to the official ("you")
- Imperative and action-oriented voice ("Ask staff...", "Lead with...", "Pull this from consent")
- Advisory framing of source-grounded observations

What still applies (no override granted):

- Source discipline — every bullet must be traceable to source materials in context
- Verbosity — concise; one to two sentences per bullet
- No speculation about colleagues, prior votes, or political dynamics not present in the packet

#### Scope

This is not a summary of the agenda item; the overview section does that. Each bullet gives the official something to do, ask, say, or frame — not just something to know.

#### When there are no talking points

For **featured items**: at least one talking point is required (per `required_data_points`). Generate three to five.

For **queued items**: talking points are optional. If the item does not warrant directive guidance (procedural votes, received-and-filed messages, land-use referrals where the official has no authority), set `display.talking_points` to **`null`**. Do **not** emit an empty array `[]` — the schema treats that as a violation.

#### Format

Up to five bullet points. Each bullet is one or two sentences. Address the official directly.

#### What a useful talking point does

- Converts a data point into a position or a frame — tells the official what to do with the information, not just that it exists
- Uses constituent sentiment as a basis for a question, a stance, or a request — not just to describe the landscape
- Surfaces the specific question worth asking staff, and what a useful answer looks like
- Notes where the packet leaves a gap and tells the official how to surface it
- Notes where staff framing and the data pull in different directions, and recommends a posture

#### What to avoid

- Summarizing what the item does — the overview already covers that
- Hedged non-actions ("it may be worth noting," "council may want to consider")
- Context, names, prior votes, or political dynamics not present in source materials

#### Examples

These illustrate tone and approach. They are not templates.

- "Constituent data shows modeled infrastructure spending support below 50 in this jurisdiction. This is bond-funded with no general fund impact — lead with that if cost questions arise."

- "This item is on the consent agenda and will pass without separate discussion unless pulled. If you have questions about the sole-bid process, pull it before the vote begins."

- "The packet references two DFR tiers ($125K/year and $275K/year) without specifying which this application covers. Ask staff to confirm which tier before the vote so the record reflects what the council is authorizing."

- "Data governance for the ALPR cameras is not addressed in the packet. Asking staff what retention and access policies are in place signals careful review and protects against questions after the grant is awarded."

### Step 11 — Recent news (featured and queued items)

Rules for finding, evaluating, and presenting recent news for each priority item.

News articles are **supplementary context**, not primary source material. Every factual claim in the briefing must trace to the agenda packet or another authoritative document — see Step 13. Use news to surface community discussion and recent coverage that surrounds a decision, not to introduce facts the agenda packet does not establish.

#### What to find

Up to 3 recent headlines per priority item from local news sources. Each should be directly relevant to the agenda item in that jurisdiction or in a larger jurisdiction that contains the jurisdiction in question.

#### Freshness

Articles should be from the last 60 days.

#### Source credibility

Prefer local newspapers, city government communications, and established regional outlets. Label opinion and editorial pieces as such. Do not cite blogs or social media as news.

Flag if coverage is predominantly from a single outlet or ideological direction -- the official should know if the news picture is one-sided.

#### Format

- Headline text — _Publication Name_

Three bullets per priority item. URLs go in Sources, not in the rendered briefing.

### Step 12 — Budget impact (featured and queued items)

Rules for finding and presenting budget impact for each priority item.

#### What to include

- Total cost (one-time and/or recurring)
- Per-constituent translation at the local levy level
- Stacked impact when multiple items in the same meeting affect the same taxpayer

#### Numeric precision

Dollar amounts and vote counts must be extracted from source exactly -- do not round, paraphrase, or infer. If discrepancies appear between figures in different source documents, flag them rather than resolving silently. Do not report multiple figures in the same sentence, as this can cause ambiguity.

#### When no budget data is available

Set `budget_impact` to `null`. Do not estimate or fabricate figures.

### Step 13 — Compile claims with verbatim source extracts

Every factual claim in the briefing must reference at least one source. For each claim:

- `source_extracts[]` — verbatim passages from the source that support the claim. Must be extractable from `retrieved_text_or_snapshot`.
- `source_ids[]` — references to `id` values in the sources array.
- `required_source_type` — the minimum acceptable source type for this claim to be released. See routing table below.
- `route_if_unsupported` — what to do if no source of the required type can be found.

#### Source routing table

| Claim type                                    | Required source type                    | Route if unsupported |
| --------------------------------------------- | --------------------------------------- | -------------------- |
| Dollar amounts, vote counts, contract figures | `agenda_packet` or `government_website` | `block_release`      |
| Legal citations, ordinance text               | `agenda_packet`                         | `block_release`      |
| Staff recommendations                         | `agenda_packet`                         | `block_release`      |
| Constituent sentiment figures                 | `haystaq`                               | `block_release`      |
| News context, background                      | `news`                                  | `omit_claim`         |
| Historical context                            | `news` or `government_website`          | `omit_claim`         |
| Inferred or synthesized observations          | none — label as inferred                | `flag_as_inferred`   |

Claims apply to featured and queued items only. Use `claim_id` values of the form `claim_001`, `claim_002`, ... and ensure each `item_id` resolves to an entry in `items[]` and each `source_id` resolves to an entry in `sources[]`.

`claim_weight` guidance:

- `high` — dollar amounts, vote counts, legal text, names, dates: must be verbatim from source
- `medium` — operational data, policy context, procedural facts
- `low` — historical context, background

`source_extracts` must be extractable from the corresponding `sources[].retrieved_text_or_snapshot`. Do not invent extracts.

### Step 14 — Compile sources with `retrieved_text_or_snapshot`

Citation and source capture rules for every claim in the briefing. Sources serve three consumers: the UI (provenance display), QA (claim verification), and the chatbot (grounded answers). All three depend on the same source record — the fields below are not optional.

#### Never fabricate

If information cannot be found in an authoritative source, record its absence — set the field to `null` or use the documented placeholder pattern from this instruction. Do not invent, infer, or fill in plausible-sounding details. Partial data is better than invented data.

#### Capture rules

Capture each source at the moment you fetch it, not at assembly time. `retrieved_at` and `retrieved_text_or_snapshot` must be set when you call `http.get()` or query Databricks — not when you write the artifact.

#### Sub-documents inside the agenda packet

The bundled agenda PDF is not a single document — it contains many sub-documents (staff reports / Agenda Commentary, resolutions, ordinances, engineer recommendations, bid tabulations, interlocal agreements). Cite each one as its own `sources[]` entry with a descriptive `name` and a `section_heading` that identifies the sub-document, not just `"Agenda packet, p. N"`. Examples:

- `name: "Agenda Commentary — Lift Station 33 (pp. 76–77)"`, `section_heading: "Staff Report"`
- `name: "LJA Engineering Bid Tabulation (pp. 78–85)"`, `section_heading: "Engineer Recommendation"`
- `name: "Ordinance 26-D — final text (pp. 127–132)"`, `section_heading: "Ordinance"`

The `url` for each remains `agendaPacketUrl` from PARAMS (the permanent agenda PDF link). The descriptive `name` is what distinguishes them in the bibliography and what QA reads when verifying which sub-document supports which claim.

#### `retrieved_text_or_snapshot` requirements

- **Agenda packet**: the verbatim extracted text of the relevant section(s), not the full document. Include enough surrounding context for a QA reader to verify the claim without re-fetching.
- **News articles**: the article body text captured via `http.get()`. If the page is paywalled or returns no usable body, note that and do not cite the article.
- **Government websites**: the relevant paragraph(s) from the page body.
- **Haystaq**: a structured summary of the query result — column name, mean score, district filter used, total voters in denominator.
- **Campaign**: the verbatim passage from the campaign site.

Do not truncate to a single sentence. A QA reader must be able to verify the claim solely from `retrieved_text_or_snapshot` without re-fetching the URL.

#### URL rules

- Use the permanent, stable URL for every source — not a presigned S3 URL, not a redirect.
- For the agenda packet: use the value of `agendaPacketUrl` from PARAMS as the permanent URL. Never use the presigned fetch URL — it expires within hours.
- For Haystaq data: set `url` to `null`. There is no public URL for modeled constituent data.

#### Allowed sources

- Agenda packet and accompanying staff reports for the upcoming meeting
- Local government website for the jurisdiction
- Local news outlets (see Step 11 for credibility guidance)
- Campaign website for the elected official (contextual only)
- Databricks Haystaq L2 modeled scores

### Step 15 — Set `briefing_status` and emit `required_data_points`

#### `briefing_status`

Top-level enum that tells downstream consumers what kind of artifact this is. Set at the end of the run based on what was actually produced.

| Value                     | Meaning                                                                                                                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `briefing_ready`          | At least one item tiered as `featured` or `queued` with substantive content. The UI renders a normal briefing.                                                                                                                                    |
| `awaiting_agenda`         | The discovered agenda has no substantive items yet (the meeting is too far out, or the jurisdiction has not finalized the agenda). UI renders a "we'll check back" state and may offer a path for the official to upload the agenda PDF directly. |
| `no_meeting_found`        | No upcoming meeting found within the search window for this official. UI surfaces a "no meeting on the calendar" state.                                                                                                                           |
| `agenda_provided_by_user` | The agent used a user-supplied agenda (via `agendaPdfPath` or `agendaPacketUrl` input override) rather than discovering one from the platform. Otherwise behaves like `briefing_ready`.                                                           |
| `error`                   | The run hit a blocker the agent couldn't recover from. `run_metadata.run_decisions[]` carries the diagnostic trail.                                                                                                                               |

Default expectation: `briefing_ready`. The other values are exit codes for graceful degradation, not failures the run should panic on.

When the substantive-items check (Step 3) found zero substantive items, the run terminates early with `briefing_status: "awaiting_agenda"`, a single placeholder item, and `claims: []`. See Step 3 for the placeholder shape.

#### `required_data_points`

Emit the coverage contract the briefing operated under — what data points each featured/queued item was expected to attempt. QA cross-references this against `items[].display.*` and `claims[]` to verify the agent attempted what it should have.

Emit this exact array (it is briefing-type-determined, not arbitrary per run — the same contract every time for `briefing_type: "city_council_meeting"`):

```json
[
  {
    "name": "summary",
    "scope": "all_items",
    "required": true,
    "citation_required": false,
    "allowed_source_types": ["agenda_packet"]
  },
  {
    "name": "constituent_sentiment",
    "scope": "featured_queued",
    "required": false,
    "citation_required": true,
    "allowed_source_types": ["haystaq"],
    "skip_reasons_allowed": [
      "no_defensible_match",
      "city_mismatch",
      "no_column"
    ]
  },
  {
    "name": "recent_news",
    "scope": "featured_queued",
    "required": false,
    "citation_required": true,
    "allowed_source_types": ["news", "government_website"],
    "skip_reasons_allowed": ["no_recent_coverage"]
  },
  {
    "name": "budget_impact",
    "scope": "featured_queued",
    "required": false,
    "citation_required": true,
    "allowed_source_types": ["agenda_packet", "government_website"],
    "skip_reasons_allowed": ["no_figures_in_source"]
  },
  {
    "name": "talking_points",
    "scope": "featured",
    "required": true,
    "citation_required": true,
    "allowed_source_types": [
      "agenda_packet",
      "news",
      "government_website",
      "haystaq"
    ]
  },
  {
    "name": "raw_context",
    "scope": "all_items",
    "required": true,
    "citation_required": false,
    "allowed_source_types": ["agenda_packet"]
  }
]
```

`scope` values:

- `all_items` — applies to every item regardless of tier
- `featured_queued` — applies to featured and queued items only
- `featured` — applies to featured items only

`required: true` means a missing value blocks release. `required: false` means the data point may be null when no defensible value exists; QA verifies the skip reason is in `skip_reasons_allowed`.

### Step 16 — Format the constituent sentiment output

For each item that had a defensible match (curated or fallback), populate `display.constituent_sentiment`:

- `summary` — short prose using the directional label and the city `mean_score`. Always label as a modeled estimate. Example: `"Modeled lean toward funding more infrastructure: 39.6 on a 0-100 scale."`
- `detail` — one sentence describing what the score measures as a modeled estimate, not a survey result.
- `mean_score` — the city `mean_score` (float, 0–100).
- `score_direction` — short string describing what high values represent. For curated matches, derive from `issue_label` (e.g. `"toward funding more infrastructure"`). For fallback matches, derive from `score_high_means` in the cached dictionary row.
- `voter_count` — `l2_voter_count` (curated) or `voter_count` from Phase 3 (fallback).
- `haystaq_column` — the `issue` value (curated) or the picked `column_name` (fallback).
- `haystaq_status` — `"ok"` when a match was found; `"no_match"` when neither source yielded a defensible match.
- `haystaq_source` — `"curated"` or `"dictionary_fallback"`.
- `district_note` — populate **only** when both city and district means are present **and** `abs(district_mean_score - city_mean_score) >= 10`. Otherwise `null`.

Populate `research.full_treatment.haystaq_detail` with `city_mean_score`, `district_mean_score` (or `null`), `city_voter_count`, `district_voter_count` (or `null`), the chosen `haystaq_column`, the `haystaq_source`, and the executed SQL as `query_executed`.

The `haystaq_data_dictionary` is new and not yet complete — some rows have missing or sparse `description` and `source_question`. The fallback selection rule above requires a clear `score_high_means`; when it isn't present or is ambiguous, reject the candidate rather than guessing direction.

### Step 17 — Write the artifact

Assemble the final JSON artifact and write it to `/workspace/output/meeting_briefing.json`. Include every top-level field required by the output_schema:

- `experiment_id`: `"meeting_briefing"` (echo of the manifest id).
- `briefing_type`: `"city_council_meeting"`.
- `briefing_status`: per Step 15.
- `generated_at`: ISO 8601 UTC timestamp captured when you assemble the artifact.
- `official_name`: from `PARAMS.officialName`.
- `meeting_date`: `YYYY-MM-DD`. For `agenda_provided_by_user` or `awaiting_agenda` runs, this is the target meeting date; for `no_meeting_found` it may be an estimated next date.
- `estimated_read_minutes`: integer; target total read time is ~8 minutes for `briefing_ready` artifacts.
- `executive_summary`: a single brief framing sentence at the top of the briefing. Generated, not boilerplate — adapt to what was actually found in the agenda. Length 15–25 words. Default form: _"The following items on your agenda require action and/or have a vote."_ Permitted variations for ceremonial-heavy, multi-flagship, or routine-heavy meetings. Stay factual; the voice and tone rules apply (this is **not** an approved posture override).
- `run_metadata`:
  ```json
  {
    "agenda_packet_url": "the permanent agendaPacketUrl value from PARAMS — never the presigned fetch URL (null when briefing_status is awaiting_agenda or no_meeting_found)",
    "source_bundle_retrieved_at": "ISO 8601 UTC timestamp set when the last source was fetched",
    "briefing_version": "v2",
    "run_decisions": [
      { "timestamp": "...", "decision": "...", "reason": "..." }
    ]
  }
  ```
  Append an entry to `run_decisions[]` every time you make a non-mechanical choice that shapes the resulting artifact — meeting selection, fallback to a different meeting, decision to skip a section, decision to proceed without a required source, decision to set `briefing_status` to anything other than `briefing_ready`. Mechanical actions (download a file, parse a PDF, run a query) do not need entries.
- `items`: per Steps 3–9.
- `claims`: per Step 13. May be empty when `briefing_status` is `awaiting_agenda` or `no_meeting_found`.
- `sources`: per Step 14.
- `required_data_points`: per Step 15.
- `disclosure`: verbatim text below.

#### Required disclosure (verbatim)

Every briefing must include the following disclaimer at the `disclosure` field:

> This briefing was generated with AI assistance and may contain errors. Inferred or synthesized content represents model-generated interpretation, not verified fact. Constituent sentiment data, where present, reflects modeled estimates for constituents in that jurisdiction.

### Step 18 — Validate

```bash
python3 /workspace/validate_output.py
```

If validation fails, fix the artifact in-loop and re-run before declaring success. Exit codes: `0` = schema-valid + QA passed; `1` = schema invalid; `2` = schema valid but deterministic QA failed.

## Spot-check

Validator-passing JSON can still be garbage. Before declaring success, walk this checklist:

- **`briefing_status` consistency:** `briefing_ready` requires ≥1 featured item; `awaiting_agenda` requires `claims[]` empty.
- **Every featured item must have at least one talking point.** Empty array is a schema violation; set `display.talking_points` to a non-empty list or `null`.
- **Every Haystaq score reported in `display.constituent_sentiment`** must trace to either the curated table or the dictionary; `haystaq_source` must reflect which.
- **If `private_samuel.district_top_issues_us_all` returned `INSUFFICIENT_PERMISSIONS`**, `run_metadata.run_decisions[]` must include an entry for it (reason `"curated_table_permission_denied"`).
- **District-vs-city divergence:** `district_note` populated **only** when both means are present **and** `abs(district_mean_score - city_mean_score) >= 10`. Otherwise `null`.
- **`total_active_voters` / `voter_count` matches the city or district, not the whole state** → your L2 district WHERE clause matched zero rows; broker's auto-injected city scope is the only filter that hit. Fix: re-confirm `l2DistrictType` and `l2DistrictName` came verbatim from PARAMS_JSON and were discovered via the L2 value-format check.
- **All sentiment percentages <5%** → you used `= 1` instead of treating `hs_*` as 0-100 scores. Re-do the distribution check.
- **News URL doesn't load or doesn't mention the issue** → don't trust search snippets blindly; `pmf_runtime.http.get(url)` the page and confirm before citing it.

## Failure modes

| Symptom                                                                 | Cause                                                                                    | Fix                                                                                                                       |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Broker logs `ScopeViolation: scope_predicate_override`                  | Agent added `WHERE Residence_Addresses_State = ?` on the L2 table                        | Remove the clause; the broker auto-injects state/city for `int__l2_nationwide_uniform_w_haystaq`                          |
| Broker 422 on `/databricks/query` repeatedly                            | Positional `?`, Postgres `FILTER`, `Voters_Active = 1`, or unauthorized table            | Use named placeholders, `SUM(CASE WHEN ...)`, `Voters_Active = 'A'`; check `allowed_tables`                               |
| Top sentiment scores all 0-5%                                           | Treated `hs_*` as binary (`= 1`) instead of 0-100 score                                  | Use `AVG(CAST(\`{col}\` AS DOUBLE))`and threshold with`>= 50`                                                             |
| `total_active_voters` looks like the whole state, not the city/district | District name doesn't exist; broker's city scope is the only filter that matched         | Verify the district via the L2 value-format discovery query in Step 6b                                                    |
| Runner: `No artifact files found in /workspace/output`                  | Agent ran out of turns or never wrote the file                                           | Tighten the instruction; remove unnecessary discovery steps; check max_turns                                              |
| `contract_violation` callback after agent claimed success               | Validator caught a missing/wrong-typed field the agent didn't notice                     | Run `python3 /workspace/validate_output.py` BEFORE declaring success                                                      |
| `INSUFFICIENT_PERMISSIONS on private_samuel.district_top_issues_us_all` | Databricks principal lacks SELECT on the curated table                                   | Log `run_decision` with reason `"curated_table_permission_denied"` and fall back to dictionary-only mode (no run failure) |
| Legistar API returns 403 `"Token is required"`                          | Jurisdiction has gated their Granicus API                                                | Scrape `legistar.{client}.gov/Calendar.aspx` and related portal pages per Step 2                                          |
| Phase 3 query returns NULLs for all city columns                        | Dictionary column name is abbreviated and doesn't exist in L2                            | Validate column names via `information_schema.columns` against the L2 table before running the AVG query                  |
| District mean suspiciously close to city mean                           | L2 district value format mismatch (e.g. `'25'` vs `'NEW YORK CITY CNCL DIST 25 (EST.)'`) | Discover the exact value via a `SELECT DISTINCT` query before binding                                                     |
| `awaiting_agenda` placeholder item fails schema validation              | Agent invented a custom `tier_reason` string                                             | Use `["placeholder"]` exactly per Step 3                                                                                  |
