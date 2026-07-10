# Meeting Briefing

Run a meeting briefing for one elected official's specific city council meeting. The target meeting date is provided in `PARAMS.meetingDate` (required); the agent does NOT discover the next meeting. Produces a single JSON artifact with featured/queued/standard agenda items, Haystaq sentiment, news, budget figures, talking points, sources, and claims for QA. The artifact combines agenda-packet evidence (the canonical record of what is being decided) with Haystaq modeled constituent sentiment and recent local news so a single briefing covers what the item does, what the district appears to want, and what coverage surrounds it.

## BEFORE YOU START

1. Read this entire instruction end-to-end before executing anything.
2. Maintain a TodoWrite list mirroring the TODO CHECKLIST below.
3. Your params are in the `PARAMS_JSON` env var. Read them once at the top.
4. Write the final artifact to `/workspace/output/meeting_briefing.json` and nowhere else.
5. Perform the spot-check at the bottom — schema-valid data can still be garbage.
6. As you ENTER each phase below, mark a milestone so cost analysis can attribute per-turn spend to named phases. Run this line (it appends a marker, nothing else):
   ```python
   try:
       from pmf_runtime import milestone; milestone("<phase>")
   except Exception:
       pass  # primitive absent on this runner build — never fail the run over a marker
   ```
   The phase markers are called out at each Step. A run that bails early (e.g. a channel-0 confirmed miss) simply emits fewer markers — that is expected.

## EARLY EXIT CONDITIONS (gate the run before any heavy work)

Two conditions abort the run with a placeholder artifact instead of a full briefing. Check both before you start downloading attachments or running Databricks queries:

1. **No meeting on the platform for `PARAMS.meetingDate`** → `briefing_status: "no_meeting_found"`. The caller supplied the target date from the official's meeting_schedule; if the streaming platform shows no meeting of the official's body on that date, the schedule was stale or the meeting was cancelled. Do not invent a substitute date.
2. **No agenda packet published yet** for the target meeting (only a summary exists) → `briefing_status: "awaiting_agenda"`.

Either condition: emit the single-placeholder `items[]` shape (see Step 3), `claims: []`, write the artifact, validate, exit. Do not do web research or Databricks queries in either case — the artifact's job is to tell the UI "check back later," not to fabricate a briefing.

**Exception when the user supplied an agenda.** Both abort conditions above presume the agent is discovering the agenda from a platform. When a user-supplied agenda is present — either pre-staged at `/workspace/input/agenda.pdf` (upload path) or pasted in `PARAMS.agendaPacketUrl` (URL-paste path) — skip the "no meeting on platform" check entirely. The user has told us the meeting exists by providing materials for it; trust the user-supplied source even if the streaming platform doesn't list a meeting for `PARAMS.meetingDate`. The agenda packet itself IS the proof of meeting existence, and ad-hoc / smaller-jurisdiction meetings often don't appear on third-party platforms. Proceed to the full briefing with `briefing_status: "agenda_provided_by_user"`. The packet-availability gate still applies — if the user-supplied packet itself has no substantive items, still route to `awaiting_agenda` per Step 3 Gate B.

## WHAT COUNTS AS THE AGENDA PACKET (read this before Step 2)

The briefing's source of truth is the **agenda packet** — the substantive briefing documents the elected official receives ahead of the meeting. It contains staff reports, ordinance text, resolutions, fiscal impact memos, exhibits, bid tabulations, engineer recommendations, and similar decision-relevant material. Total length is typically 30–100+ pages of PDF content.

The packet is **not** the published agenda summary page. The summary lists item numbers, titles, and motion text but contains no decision-supporting analysis. A briefing built only from the summary is not grounded in source material and will fabricate or paraphrase. Do not proceed past Step 3 without packet content in hand.

**Label varies by jurisdiction.** The packet may be called any of: "agenda packet," "agenda," "council packet," "meeting packet," "supporting documents," "agenda materials." Do not gate on the label — gate on the content.

**Shape varies by platform.** Two common forms:

- **One compiled PDF** (CivicPlus AgendaCenter, some PrimeGov sites, many smaller jurisdictions): a single multi-hundred-page file linked from the meeting page. Download it once.
- **N per-item attachment PDFs** (Granicus, Legistar, many PrimeGov sites, eSCRIBE, CivicClerk): each substantive agenda item links to one or more attachment PDFs (staff report, ordinance draft, exhibits). The packet is the _collection_ of these attachments — there is no compiled file. Download each substantive item's attachments.

**Specific anti-patterns** — these are summaries, NOT packets. Treating them as the packet is a hallucination risk:

- Granicus `GeneratedAgendaViewer.php?event_id=N` is index HTML only. Look for `MetaViewer.php?meta_id=M` links on the page; those are the per-item attachment PDFs (`Content-Type: application/pdf`). Fetch every substantive item's MetaViewer links.
- Legistar `MeetingDetail.aspx?ID=N` is the item list only. Per-item packet content is at `/matters/{matterId}/attachments` (API) or the matter detail page (HTML), which links to attachment PDFs.
- CivicPlus AgendaCenter index page (`/AgendaCenter`) links to the per-meeting compiled PDF. Don't stop at the index; follow through to the PDF.
- PrimeGov portal meeting page is the item list only. Follow each item's "Attachments" link.
- A meeting's HTML page when none of the links resolve to PDFs (`Content-Type: application/pdf`) means the packet has not been published yet.

**If the packet is not yet published** — e.g. the meeting exists on the calendar but only a summary is available, or the platform shows a "Not available" placeholder for attachments — route to `briefing_status: "awaiting_agenda"` per Step 3. Do not synthesize a briefing from summary + news.

**Verification rule for `run_metadata.agenda_packet_url`:** the URL you record must either (a) return `Content-Type: application/pdf` when fetched, OR (b) point to a discoverable index page where every substantive item resolves to one or more PDF attachments you actually downloaded and chunked into `raw_context[]`. If neither is true, the briefing is not grounded — set `briefing_status: "awaiting_agenda"`.

**Exception for the upload path.** When the packet was pre-staged at `/workspace/input/agenda.pdf` (`briefing_status: "agenda_provided_by_user"`), `run_metadata.agenda_packet_url` is `null` because there is no permanent URL. That is the correct value and does NOT trigger the verification rule above — the pre-staged file itself is the grounded source, and you have chunked its contents into `raw_context[]`. Do not flip to `awaiting_agenda` just because the URL is null in this case.

## TODO CHECKLIST

1. Read PARAMS_JSON; verify Databricks env via a trivial ping query. Capture `PARAMS.meetingDate` (required) as the target meeting date. Capture `PARAMS.knownAgendaLocation` (optional) as a channel-0 hint for Step 2.
2. Resolve the agenda **packet** source for the target date — full briefing PDFs, not the summary page — per the precondition above (path > URL > **channel-0 hint** > channels 1-4 platform discovery). If the user supplied an agenda (path or URL), use it and skip platform verification entirely. Otherwise, verify the target meeting exists on the platform calendar for `PARAMS.meetingDate`; if the platform shows no meeting on that date (stale schedule signal) and the user did NOT supply an agenda, set `briefing_status: "no_meeting_found"` and exit early.
3. Substantive-items check + packet-availability gate. If no attachments / no compiled PDF, route to `awaiting_agenda`.
4. Chunk the agenda packet section-aware → page-fallback into `raw_context[]`.
5. Classify items into featured / queued / standard tiers.
6. Map each featured/queued item to a column from the inline Haystaq catalog — null if no defensible topic match.
   6b. Selection rules and L2 district-value discovery (one-shot `SELECT DISTINCT` against the L2 table) when `l2DistrictType` is set.
7. Discover the exact L2 district value (when `l2DistrictType` is set).
8. Run ONE batched AVG query against L2 — district scope when `l2DistrictType` is set and confirmed, otherwise state scope (broker auto-injects state).
9. Per featured item: overview, talking points (3–5), recent news, budget impact.
10. Per queued item: overview, sentiment, recent news, budget impact. (No talking points required for queued.)
11. Recent news search for each priority item (capped per-item search budget).
12. Budget impact per priority item.
13. Compile claims with verbatim source extracts.
14. Compile sources with `retrieved_text_or_snapshot`.
15. Set `briefing_status` and emit `required_data_points`.
16. Format the constituent sentiment output per item using Step 8 results.
17. Write artifact to `/workspace/output/meeting_briefing.json`.
18. Spot-check.

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

The posture override is INTERNAL authorization for how you write the section — it is NOT content. **Never emit a `## Posture override` block, a rules declaration, or any meta/preamble into the artifact.** The `talking_points` array contains ONLY the actual `{text, why}` talking-point entries the official reads; its first element must be a real talking point, never a statement about voice, rules, or which posture applies.

### Constituent-data framing (never expose data internals)

Every constituent-sentiment figure in a briefing comes from **GoodParty.org's modeled constituent data**. In every candidate-facing field — `display.constituent_sentiment.summary` / `detail` / `score_direction`, `talking_points`, item `summary` and executive-summary overviews, and every `sources[].name` — describe this data in plain English and attribute it to **GoodParty.org's constituent data** (or "GoodParty.org's modeled constituent sentiment"). NEVER surface data-source internals in these fields: no `hs_*` column names, no "Haystaq", "L2", "Databricks", "voter file", table names, or SQL. The `hs_*` column name belongs ONLY in the structured `haystaq_column` metadata field (never in prose or a source name).

- Good: "GoodParty.org's data shows constituents in this district lean toward supporting tax cuts — a modeled 59 on a 0–100 scale."
- Bad: "hs_tax_cuts_support is a modeled estimate of how strongly each L2-active voter aligns..." / source name "Haystaq L2 — hs_tax_cuts_support".

This applies even when NO data maps to an item: if no constituent-sentiment topic fits, simply set `constituent_sentiment` to `null` and say nothing about it — do NOT explain the absence by naming the source (never write "no Haystaq column maps to this item" or similar in any candidate-facing field; the words "Haystaq"/"L2"/`hs_*` must not appear at all, present or absent).

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
- The broker auto-injects `WHERE Residence_Addresses_State = '<state>'` into every query that touches `int__l2_nationwide_uniform_w_haystaq`. **DO NOT add a state clause yourself.** Adding one returns HTTP 422 `ScopeViolation: scope_predicate_override`. The only WHERE clauses your L2 query needs are the L2 district column (when `l2DistrictType` is set) and `Voters_Active = 'A'`. Do NOT add a `Residence_Addresses_City` clause — there is no city in PARAMS and the broker does not auto-inject one; scope is state-wide unless an L2 district narrows it.
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
- **Web-access escalation ladder for every news/government-website citation — use the cheapest rung that answers the question, in this order. Do NOT jump straight to `http.get`:**
  1. `WebSearch` (discovery) — free, fast; often the snippet alone tells you enough to keep looking or move on.
  2. `pmf_runtime.http.head(url)` — verify the URL is live before you commit to citing it. Returns `{"status": int, "final_url": str}`; drop the URL if status is not `200`, and cite `final_url` (not the original) if it redirected.
  3. `pmf_runtime.http.get(url)` — LAST RESORT, only on a `403`/`405` from `head`, or when you need the body text to confirm the article's date/topic or extract a claim. Never skip straight to this rung as a substitute for `head`.
- **Use `pmf_runtime.http.get(url)` for page retrieval** (broker-proxied). The response is a **plain dict** (`{"status": int, "headers": dict, "body": str}`) — not a `requests.Response`. Calling `r.status_code` or `r.text` raises `AttributeError`. Verbatim:
  ```python
  from pmf_runtime import http
  r = http.get("https://example.com/article")
  # r = {"status": 200, "headers": {...}, "body": "<html>…</html>"}
  print(r["body"][:2000])
  ```
- **Use `pmf_runtime.pdf.download(url)` for PDFs** — returns raw bytes; `pdftotext -layout file.pdf -` extracts text.
- The broker enforces an SSRF guard and URL allowlist on `http.get` / `pdf.download`. Private IPs and internal hostnames are blocked.
- **A dead, redirected-to-homepage, or off-topic URL is never citable.** This applies to every `news` and `government_website` source captured in Step 14, not just `recent_news` (Step 11) — verify liveness with `head` and confirm topicality in the fetched body before recording the source, not after.

### Output rules

- Write **only** to `/workspace/output/meeting_briefing.json`. The runner publishes nothing else.

## Steps

### Step 1 — Read params and verify Databricks env

Read `PARAMS_JSON` once at the top:

```python
import json, os
PARAMS = json.loads(os.environ["PARAMS_JSON"])
TARGET_MEETING_DATE = PARAMS["meetingDate"]  # required, YYYY-MM-DD
TARGET_MEETING_TIME = PARAMS.get("meetingTime")  # optional, "HH:MM" 24-hour
TARGET_MEETING_TIMEZONE = PARAMS.get("meetingTimezone")  # optional, IANA name
KNOWN_AGENDA_LOCATION = PARAMS.get("knownAgendaLocation")  # optional channel-0 hint from prior run
```

**`meetingDate` is the target.** The caller (gp-api) has already determined which meeting to brief based on the official's meeting_schedule. The agent uses this date directly — it does NOT discover the next meeting. If `meetingTime` and `meetingTimezone` are provided, treat them as source-of-truth and copy them through to the artifact's `meeting_time` and `meeting_timezone` fields; the agent does not need to re-look-up the time from the platform when these are present.

**`city` is not in PARAMS.** Derive the city for narrative use (WebSearch queries, source naming, summary prose) by reasoning over `PARAMS.positionName`, `PARAMS.l2DistrictName`, and `PARAMS.state`. `positionName` usually contains the jurisdiction verbatim (e.g. `"Cheyenne City Council"` → city is `Cheyenne`). When the position name is generic (e.g. `"City Council Member"`), use `l2DistrictName` (which often encodes the city, e.g. `"NEW YORK CITY CNCL DIST 25 (EST.)"`) plus `state` to identify it; confirm via WebSearch when ambiguous. Record the derived city in `run_metadata.run_decisions[]` with reason `"derived_city_for_narrative"`. The derived city is **not** used as an L2 query filter — scope is set by `l2DistrictType`/`l2DistrictName` (district) or by the broker's auto-injected state clause (state).

Before starting the workflow steps, verify the Databricks broker connection is ready. Trust the broker over a grep — run a trivial query against an allowed table and inspect the result:

```python
from pmf_runtime import databricks as sql
conn = sql.connect()
cur = conn.cursor()
cur.execute("SELECT 1 AS ping FROM goodparty_data_catalog.dbt.int__l2_nationwide_uniform_w_haystaq WHERE Voters_Active='A' LIMIT 1")
print(cur.fetchall())
```

Success: the cursor returns a one-row result with `ping = 1`. Continue with the run.

Failure: the call raises (connection error, scope violation, or `UpstreamError`). Do not fail the run — proceed without Haystaq. Set `haystaq_status: "no_match"` on every item that would have used it, omit haystaq sources from `sources[]`, and record the decision in `run_metadata.run_decisions[]` with reason `"databricks_credentials_unavailable: <ExceptionClassName>"` (include only the exception class name — never the raw error message, which may carry hostnames, schema paths, or driver stack hints that should not appear in the published artifact).

### Step 1b — Read official's priorities and community issues (via MCP)

**This step is iterate-separately guidance.** The backend now writes link rows from stamped `executive_summary.items[]` ids. Stamp each `executive_summary` item with the correct ids to activate those links.

Before classifying agenda items, fetch the official's priorities and community issues over MCP. These shape both tier selection (Step 5) and the stamping rule (Step 17):

```
GET /v1/priorities          → org's durable priority list (may be empty)
GET /v1/community-issues → latest community issues for the org (may be empty)
```

Both are `@McpTool` endpoints; call them with the org's auth context. Store the results in memory:

- `PRIORITIES` — array of `{ id, title, description }` objects (non-archived, active)
- `COMMUNITY_ISSUES` — array of `{ id, title, summary, list, category }` objects (non-archived)

If either call fails or returns empty, treat that pool as empty and proceed without it. Do not abort the run — Haystaq district data is the fallback.

### Step 1c — Determine the triage hierarchy for this org

**Triage hierarchy (evaluated once, applied throughout classification and stamping):**

1. **PRIORITIES (highest)** — the org has at least one active priority from `PRIORITIES`. Agenda items that map to a priority are featured/queued first.
2. **COMMUNITY ISSUES (mid)** — use when `PRIORITIES` is empty. Agenda items that map to a `COMMUNITY_ISSUES` entry drive tier selection.
3. **Haystaq district data (fallback)** — use only when both `PRIORITIES` and `COMMUNITY_ISSUES` are empty. The inline Haystaq catalog (Steps 6–8) is the sole source of constituent resonance signals.

Record which tier of the hierarchy applies in `run_metadata.run_decisions[]` (e.g. `decision: "triage_source", reason: "priorities (N active)"`).

### Step 2 — Resolve agenda packet source

**Milestone — run `milestone("discovery")`** (per BEFORE YOU START item 6) before this step's work.

**Target: the agenda packet, not the summary.** Re-read "WHAT COUNTS AS THE AGENDA PACKET" above before proceeding. You are looking for the substantive briefing PDFs (staff reports, ordinances, exhibits, etc.) — either one compiled file or the per-item attachments collection. If you end this step with only a summary, you have not resolved the packet and must route to `awaiting_agenda` in Step 3.

**Precondition — `PARAMS.meetingDate` is the target.** The caller (gp-api) supplies the target meeting date based on the official's `meeting_schedule` artifact. The agent does NOT discover the next meeting on its own. Your job in Step 2 is to **verify** that `PARAMS.meetingDate` corresponds to a real meeting of the official's body on the streaming platform, then proceed to resolve the agenda packet for that specific date.

**Verification procedure.** Fetch the streaming platform's calendar (Granicus `ViewPublisher.php?view_id=N`, Legistar `Calendar.aspx`, PrimeGov `/Portal/Meeting`, CivicClerk Events API, etc.) and confirm there is a meeting **of the official's body specifically** (not a committee meeting) on `PARAMS.meetingDate`. If `PARAMS.meetingTime` and `PARAMS.meetingTimezone` are provided, treat them as the source-of-truth time and copy them through to `meeting_time` and `meeting_timezone` in the artifact. If they are not provided, read the time and timezone from the platform.

If the streaming platform shows NO meeting on `PARAMS.meetingDate` for the official's body (rare — usually means the schedule was stale or the meeting was cancelled):

- Set `briefing_status: "no_meeting_found"`.
- Set `meeting_date` to `PARAMS.meetingDate` (echoed for the artifact's self-sufficiency).
- Emit `meeting_time: ""` and `meeting_timezone: ""` if not provided in PARAMS; otherwise echo them.
- Emit the single-placeholder `items[]` shape from Step 3's failure path (`item_001`, `tier: "standard"`, `tier_reason: ["placeholder"]`, etc.), and set `claims: []`.
- Record the decision in `run_metadata.run_decisions[]` with reason `"no_meeting_on_target_date"`. Include what the platform DID show (other dates, cancellation notices) so the caller can mark the schedule for re-running.
- Skip Steps 4–16. Write the placeholder artifact (Step 17), self-check its shape (Step 18), exit.

Record what you verified (platform URL, meeting ID/event ID if available, observed time) in `run_metadata.run_decisions[]`.

**Past meeting packets ARE allowed as enrichment** for the target meeting's items. Many agenda items have legislative history that lives in prior packets:

- **Second-reading ordinances** — the staff report and full ordinance text are usually in the _prior_ packet (the 1st reading). The current packet may only contain the motion. Fetch the prior packet to ground the briefing.
- **Contract renewals / amendments** — the original contract approval and terms live in a past packet. Cite it to give the EO the full picture.
- **Recurring policy reviews / annual reports** — last year's version of the same item often has staff context the current packet omits.
- **Referenced resolutions or ordinances** — when the current item cites "Resolution 25-R-14" by number, find the resolution's text in its originating packet (or in Municode if codified).

When you use a past packet as enrichment: cite it as its own `sources[]` entry with `source_type: "agenda_packet"` and a `name` that identifies the past meeting (e.g. `"Cheyenne City Council Agenda Packet — April 28, 2026 (Item 12 1st reading)"`). The chunk can attribute to the current item by `item_id`. Past-packet chunks count toward `raw_context` coverage; they do NOT count as the target meeting's packet for the Gate A check in Step 3.

**Agenda input precedence:** pre-staged `/workspace/input/agenda.pdf` (upload path) > `agendaPacketUrl` from PARAMS (URL-paste path) > agent-discovered next meeting on the platform.

When the agent uses a user-supplied agenda (either pre-staged file or pasted URL), set `briefing_status: "agenda_provided_by_user"` and record the decision in `run_metadata.run_decisions[]`. The "no future meeting" precondition still applies — if the user-supplied agenda is for a past meeting, set `no_meeting_found`.

If the briefing setup pre-stages a bundled agenda packet at `/workspace/input/agenda.pdf`, **that file is the primary source — do not re-fetch from the platform.** The platforms below are for the case where the bundled packet references a document not included, or where legislative history for a referenced item is useful context. In that case, go directly to the platform — do not start with a generic web search.

**Packet-discovery procedure on the primary platform:** after finding the meeting on the platform, enumerate every link on the meeting detail page that returns `Content-Type: application/pdf` (or `application/octet-stream` with a `.pdf` filename in `Content-Disposition`). Each substantive item should have at least one such attachment. Cap at 50 link fetches per meeting (HEAD when possible to avoid downloading every PDF before deciding to chunk it).

**Channel 0 (when `PARAMS.knownAgendaLocation` is present) — try the hint first, and TRUST a positive read.** The hint is a URL or prose describing where prior runs found this body's agendas. Treat it as channel 0 in the discovery hierarchy. Channel 0 keeps its full drill-down behavior: HEAD/GET the URL; if it is a platform calendar / meetings index, drill into it to reach the target meeting and its packet attachments; follow redirects, CDN/API hosts, and sibling links; if the hint is prose, parse it for a URL and follow the navigation it describes. A correct hint is very often a landing page you must drill _through_ to reach the packet — do not treat a landing page as a dead end.

Resolve channel 0 to **exactly one** of the four outcomes below, and record it as a `run_decisions[]` entry whose `decision` is the verbatim label shown. The first two are CONFIRMED bails: they let you declare a placeholder and **skip channels 1-4 entirely**. The last is the only failure mode, and it must fall through.

- `channel_0_confirmed_agenda_found` — you reached the target meeting's agenda packet from the hint. Proceed to the full briefing (the win path).
- `channel_0_confirmed_no_agenda_yet` — you POSITIVELY rendered this body's meetings list / agenda index at the hint, confirmed a meeting on `PARAMS.meetingDate`, and confirmed no agenda packet is published for it yet. Declare `briefing_status: "awaiting_agenda"` and skip channels 1-4. In `reason`, record what you actually saw (the rendered index, the meeting row, the absent packet link).
- `channel_0_confirmed_no_meeting` — you POSITIVELY rendered this body's calendar at the hint and it shows no meeting of the official's body on `PARAMS.meetingDate`. Declare `briefing_status: "no_meeting_found"` and skip channels 1-4. Record what the calendar did show.
- `channel_0_unreachable_or_unconfirmed` — the hint 404'd, redirected to a generic landing page, sat behind a sign-in / bot-wall (HTTP 403), rendered only through a JS-only widget you could not read, timed out, or otherwise did NOT let you positively confirm the meeting/agenda state. **This is NOT a confirmation. Do NOT bail.** Record it and fall through to channels 1-4 exactly as before.

**Only `channel_0_confirmed_no_agenda_yet` or `channel_0_confirmed_no_meeting` lets you skip channels 1-4.** A failure to reach or render the hint is never a confirmation — when in any doubt, treat it as `channel_0_unreachable_or_unconfirmed` and exhaust channels 1-4. The bail is gated on a POSITIVE read at the known location, not on the mere presence of a hint. (The deterministic QA gate honors these two labels: an artifact carrying one of them is exempt from the 4-channel depth requirement; every other miss must still show all 4 channels.)

**Unless channel 0 returned a confirmed-bail outcome above, then before declaring `awaiting_agenda` you MUST exhaust 4 discovery channels.** Do NOT bail after only checking the streaming platform — Fulshear-style jurisdictions hide their packet on a CDN that no public-facing UI links to.

Each channel attempted requires its own `run_decisions[]` entry whose `decision` field begins with `channel_<N>_` (where N is 1–4, matching the channel number below). Channel 1's per-platform sub-attempts (Legistar, PrimeGov, BoardDocs, etc.) go INSIDE the single `channel_1_*` entry's `reason` field — do NOT emit a separate `run_decisions[]` entry per sub-platform, that would inflate the count without exhausting the other 3 channels. The deterministic QA gate extracts the `channel_<N>_` prefix from each decision and treats any `awaiting_agenda` / `no_meeting_found` artifact that doesn't show all 4 distinct channel numbers as a quality failure. Stop early ONLY when you find packet content for the target meeting, OR when channel 0 returned a confirmed-bail outcome (`channel_0_confirmed_no_agenda_yet` / `channel_0_confirmed_no_meeting`), which exempts the run from this 4-channel requirement. (Any other `channel_0_*` entry is informational and ignored by the depth check.)

1. **Primary platform** (try in order; each requires its own search query + verification fetch):
   - Legistar: WebSearch `"<city>" "<state>" legistar` → extract `{client}` from `https://{client}.legistar.com` → verify `https://webapi.legistar.com/v1/{client}/events?$top=1` returns ≥1 event.
   - PrimeGov: WebSearch `"<city>" primegov.com` → URL pattern `{client}.primegov.com/Portal/Meeting`.
   - eSCRIBE: WebSearch `"<city>" escribemeetings.com`.
   - CivicPlus AgendaCenter: WebSearch `"<city>" AgendaCenter`.
   - BoardDocs: WebSearch `"<city>" boarddocs` → `go.boarddocs.com/<state>/<client>/Board.nsf/Public`. The `/Public` suffix is required — `Board.nsf` alone is the Domino splash page; only `/Public` exposes the meeting listing with agenda UUIDs and PDF links.
   - Granicus: WebSearch `"<city>" granicus.com` → `{client}.granicus.com/ViewPublisher.php?view_id=N`.
   - CivicClerk: WebSearch `"<city>" civicclerk` → API at `{client}.api.civicclerk.com/v1/Events`.
   - Novus Agenda: WebSearch `"<city>" novusagenda`. _Drill into the meeting search results — landing-page-only checks don't count._
   - Municode/CivicPlus Meetings: WebSearch `"<city>" meetings civicplus` / `"<city>" municode meetings`.
   - Swagit (streaming): WebSearch `"<city>" swagit.com` — usually only video, but check for linked PDFs.
     For each platform you try: emit a `run_decisions[]` entry with the search query, URL probed, and result.
2. **City's own meeting-schedule page** — at `<city-site>/Your-Government/<body>/`, `/meetings/`, `/agendas-minutes/`, or the council clerk page. Drill at least 2 clicks deep into menus before declaring empty.
3. **City site's deterministic PDF mirror.** Many cities mirror packet PDFs at a predictable path independent of the streaming platform. Cheyenne uses `cheyennecity.org/files/sharedassets/public/v/1/your-government/city-council/cc-YYYY/cc-MM-DD-YY-agenda.pdf`; Covington TN uses `covingtontn.gov/utility/openPDF/cicotn/BMA_-_DDMMMYYYY.pdf`. Discover the pattern from a recent past meeting on the same site, then probe the predictable filename for the target date.
4. **Direct WebSearch for the packet PDF on common CDN domains.** This catches the Fulshear-pattern case where the packet exists at a CDN URL but no public-facing UI links to it. Run these queries:
   - `"<city>" "<body>" agenda <month> <year> filetype:pdf`
   - `"<city>" agenda packet <target meeting date> site:cloudfront.net OR site:granicus.com OR site:s3.amazonaws.com OR site:civicclerk.com OR site:legistar.com OR site:boarddocs.com`
   - `"<city>" "agenda packet" "<MM/DD/YYYY of target meeting>"` (Google often indexes the PDF directly even when the city site doesn't link to it)
     For each candidate PDF URL: HEAD-check it — if `Content-Type: application/pdf` and size > 1KB, fetch and use it. Many Granicus installations expose packets at `d3*.cloudfront.net/<client>/...` URLs that are only discoverable via search.

**Only after channels 1–4 yield no packet content for the target meeting may you declare `awaiting_agenda` — UNLESS channel 0 already returned `channel_0_confirmed_no_agenda_yet` / `channel_0_confirmed_no_meeting`, which authorizes an immediate bail.** Absent a confirmed channel-0 bail, the `run_decisions[]` array MUST contain one entry per channel attempted with `decision` prefixed `channel_<N>_<short-label>` (e.g. `channel_1_streaming_platforms`, `channel_4_cdn_search`). All 4 distinct channel numbers must appear. Per-platform sub-attempts in channel 1 go inside that single `channel_1_*` entry's `reason` field, not as separate entries. The deterministic QA gate enforces this — an artifact missing any channel number is a quality failure.

**Publish-lag awareness.** Many jurisdictions release the packet on the Friday before a Monday or Tuesday meeting (~3 days lead time). If today is more than 7 days before the target meeting and channels 1–4 are empty, `awaiting_agenda` is the expected state, not a search failure — note this explicitly in the `awaiting_agenda` `run_decision` reason (e.g. `"packet_not_published — target meeting 2026-05-26 is 11 days out; typical Cheyenne lag is ~3 days, expected packet release Fri 2026-05-22"`).

#### Agenda platform reference

- **Legistar** — `https://webapi.legistar.com/v1/{client}/...`. Events, agenda items (`/events/{eventId}/eventitems`), matter detail (`/matters/{matterId}`), matter attachments (`/matters/{matterId}/attachments`). The richest API; most large cities use it. Verify the client exists:

  ```python
  from pmf_runtime import http
  r = http.get(f"https://webapi.legistar.com/v1/{client}/events?$top=1")
  # 200 with non-empty list confirms client; 404 means wrong client name.
  # 403 ("Token is required") means the client EXISTS but has gated its API —
  # fall back to scraping the portal directly per the Token gating note below.
  ```

  **Token gating note:** some installations (NYC, observed 2026-05) now return HTTP 403 `"Token is required"` on the public OData API even for anonymous reads. When that happens, fall back to scraping the public portal directly: `https://legistar.{client}.gov/Calendar.aspx` for the calendar, `https://legistar.{client}.gov/MeetingDetail.aspx?ID={event_id}` for per-meeting items, `https://legistar.{client}.gov/LegislationDetail.aspx?ID={matter_id}` for matter detail. The portal serves HTML to anonymous clients without a token.

- **BoardDocs** — `https://go.boarddocs.com/{state}/{client}/Board.nsf/Public`. Common for school boards but also some city councils. Meeting agenda items each have a UUID; PDFs at `Board.nsf/files/<uuid>/$file/<filename>.pdf`. Scrape the meeting page and follow file links.
- **PrimeGov** — `https://{client}.primegov.com/Portal/Meeting`. The portal links to compiled meeting PDFs; individual attachments are also accessible.
- **eSCRIBE** — meetings endpoint serves HTML with item titles, numbers, and attachment links. Parse HTML rather than expecting JSON.
- **CivicPlus AgendaCenter** — `https://{city}.gov/AgendaCenter`. Per-meeting agenda PDFs; scrape the index page, download, and extract text. Some installations are fronted by Cloudflare and return HTTP 403 to scripted requests — when that happens, check for a CivicClerk mirror first before changing strategy.
- **CivicClerk** — `https://{client}.api.civicclerk.com/v1/Events`. OData-style filterable JSON feed (e.g. `?$filter=startDateTime ge 2026-05-15&$orderby=startDateTime`). Event detail at `/v1/Events({id})` returns `hasAgenda`, `agendaId`, `agendaFile.fileName`, `publishedFiles[]`. Many small-to-mid TX and FL cities use this — including Alvin TX. Often coexists with a CivicPlus AgendaCenter front-end; the CivicClerk API is the scriptable path.
- **Municode** — sometimes hosts current ordinance text and code references that the agenda packet cites.
- **City site PDF mirror** — many cities mirror packet PDFs at a deterministic path on their own domain, independent of the streaming platform. The path varies by city but commonly looks like `<city-site>/files/.../<body-abbr>-<YYYY>/<body-abbr>-<MM-DD-YY>-agenda.pdf` or `<city-site>/AgendaCenter/ViewFile/Agenda/_MMDDYYYY-NNN`. **Cheyenne example:** `cheyennecity.org/files/sharedassets/public/v/1/your-government/city-council/cc-2026/cc-05-26-26-agenda.pdf` (note `cc-` for Council, `fc-` for Finance Committee, `psc-` for Public Services Committee, `wscow-` for Work Session / Committee of the Whole). Once you discover the pattern from a recent past meeting on the same site, you can probe the predictable filename for the target meeting directly — often the city site has the packet before the streaming platform does. Always check this channel before declaring `awaiting_agenda`.

When you do go to a platform, capture the response (`retrieved_at`, `retrieved_text_or_snapshot`) the same way as any other source. Cite it as a distinct entry in `sources[]` with its own `id`.

### Step 3 — Substantive-items check + packet-availability gate (run before classification)

**Milestone — run `milestone("gate")`** (per BEFORE YOU START item 6) before this step's work.

This step has two gates. Either gate failing routes to `briefing_status: "awaiting_agenda"`.

**Gate A — packet availability.** Confirm Step 2 actually produced packet content, not just summary HTML. Inspect what was downloaded:

- If a pre-staged `/workspace/input/agenda.pdf` or `agendaPacketUrl` provided packet content — pass.
- If platform discovery yielded a compiled PDF (`Content-Type: application/pdf`) — pass.
- If platform discovery yielded at least one per-item attachment PDF for at least one substantive item — pass for that item; non-attached items are forced to `tier: "standard"` regardless of their substance (insufficient material for featured/queued treatment).
- If platform discovery yielded **zero** PDF attachments across the whole meeting — fail Gate A, the packet is not yet published, route to `awaiting_agenda` below.

**Gate B — substantive items.** Scan the agenda packet for **substantive items**. Gate B counts only items that passed Gate A (have at least one attached packet PDF). Items forced to `tier: standard` for lack of attachments do NOT count toward Gate B's substantive-items check. An item is substantive if it has any of:

- A required vote
- A scheduled public hearing
- An ordinance or resolution under consideration
- A budget action (appropriation, contract, grant, bond authorization)
- A formal action requiring the official to take a public position

If **zero** substantive items exist — for example, the agenda packet is a title page only, the platform's meeting detail shows a "Not available" placeholder, or every listed item is procedural / ceremonial — fail Gate B.

**On failure of either gate** — do not proceed with tier classification or the per-item pipeline. Instead:

1. Set `briefing_status: "awaiting_agenda"`.
2. Populate `executive_summary` with the brief check-back message in `lead_in` and an empty `items: []` array:
   ```json
   {
     "lead_in": "The agenda for the upcoming [Council Body] meeting on [date] has not been published yet. Check back closer to the meeting date, or upload the agenda PDF directly if you already have it.",
     "items": []
   }
   ```
3. Record the decision in `run_metadata.run_decisions[]`. Use reason `"packet_not_published"` for Gate A failures and `"agenda_no_substantive_items"` for Gate B failures.
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

### Step 4 — Chunk the agenda packet into `raw_context` entries

**Milestone — run `milestone("chunk")`** (per BEFORE YOU START item 6) before this step's work.

Rules for chunking the agenda packet text into `raw_context` entries.

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

**Milestone — run `milestone("classify")`** (per BEFORE YOU START item 6) before this step's work.

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
- Overlaps with a constituent sentiment topic from the inline Haystaq catalog — see Step 6.

Constituent resonance is a selection signal, not a mechanical threshold. For each priority-eligible item, scan the inline catalog in Step 6 for a topic whose substance maps to the item, then pick a polarized column. The chosen column feeds both tier ranking here and the sentiment section's output downstream. The actual mean score is computed once at the end via the batched AVG query in Step 8.

Initial tier assignment uses qualitative signals (vote_required, public position, budget impact, topic alignment with the inline Haystaq catalog). Tier may be revised after Step 8 if district-vs-city divergence (≥10-point gap) elevates an item's importance.

**Apply the triage hierarchy from Step 1c when selecting featured/queued items.** If PRIORITIES are active, items that map to a priority get first pick for featured/queued slots — they count as resonant regardless of Haystaq score. If only COMMUNITY_ISSUES are active, items that map to a community issue get first pick. Haystaq resonance still elevates items when neither pool provides a match.

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

### Step 6 — Pick Haystaq columns from the inline catalog

Rules for selecting one Haystaq column per featured or queued item. The catalog below is the **complete, L2-verified** list of polarized constituent-sentiment columns available to this experiment. Do not query any catalog or dictionary table at runtime — every column you can use is listed here. Per-item work is an in-memory string match against this catalog; the actual mean scores are computed once at the end via a single batched query in Step 8.

The catalog is grouped into 9 policy topics. Each entry pairs a column name with a one-line `meaning` that already encodes direction (e.g. `hs_gun_control_support` → "supports gun control").

#### Inline Haystaq catalog (L2-verified)

**housing** — Housing affordability, gentrification views, homeownership status

| Column                               | Meaning                                            |
| ------------------------------------ | -------------------------------------------------- |
| `hs_affordable_housing_gov_has_role` | agrees government has a role in affordable housing |
| `hs_affordable_housing_gov_no_role`  | opposes government role in affordable housing      |
| `hs_gentrification_support`          | supports gentrification                            |
| `hs_gentrification_oppose`           | opposes gentrification                             |
| `hs_new_home_buyer`                  | recently bought a home                             |
| `hs_any_home_buyer`                  | has ever bought a home                             |

**taxes** — Tax cuts, gas tax, social security tax, minimum wage, fiscal ideology

| Column                                    | Meaning                                |
| ----------------------------------------- | -------------------------------------- |
| `hs_tax_cuts_support`                     | supports tax cuts                      |
| `hs_tax_cuts_oppose`                      | opposes tax cuts                       |
| `hs_gas_tax_support`                      | supports the gas tax                   |
| `hs_gas_tax_oppose`                       | opposes the gas tax                    |
| `hs_social_security_tax_increase_support` | supports raising social security taxes |
| `hs_social_security_tax_increase_oppose`  | opposes raising social security taxes  |
| `hs_min_wage_15_increase_support`         | supports raising min wage to $15       |
| `hs_min_wage_15_increase_oppose`          | opposes raising min wage to $15        |
| `hs_ideology_fiscal_conserv`              | fiscally conservative ideology         |
| `hs_ideology_fiscal_liberal`              | fiscally liberal ideology              |

**education** — School choice, school funding, charter schools, teachers union views

| Column                              | Meaning                          |
| ----------------------------------- | -------------------------------- |
| `hs_school_choice_support`          | supports school choice           |
| `hs_school_choice_oppose`           | opposes school choice            |
| `hs_school_funding_more`            | favors more school funding       |
| `hs_school_funding_less`            | favors less school funding       |
| `hs_charter_schools_support`        | supports charter schools         |
| `hs_charter_schools_oppose`         | opposes charter schools          |
| `hs_teachers_union_positive`        | positive view of teachers unions |
| `hs_teachers_union_negative`        | negative view of teachers unions |
| `hs_community_college_free_support` | supports free community college  |
| `hs_community_college_free_oppose`  | opposes free community college   |

**healthcare** — Medicaid expansion, Medicare for All, ACA, family medical leave, opioid policy

| Column                            | Meaning                                         |
| --------------------------------- | ----------------------------------------------- |
| `hs_medicaid_expansion_support`   | supports medicaid expansion                     |
| `hs_medicaid_expansion_oppose`    | opposes medicaid expansion                      |
| `hs_medicare_for_all_support`     | supports Medicare for All                       |
| `hs_medicare_for_all_oppose`      | opposes Medicare for All                        |
| `hs_obamacare_aca_expand`         | supports expanding the ACA                      |
| `hs_obamacare_aca_protect`        | supports protecting ACA                         |
| `hs_obamacare_aca_oppose`         | opposes the ACA                                 |
| `hs_family_medical_leave_support` | supports paid family/medical leave              |
| `hs_family_medical_leave_oppose`  | opposes paid family/medical leave               |
| `hs_opioid_crisis_treat`          | treats opioid crisis as a health issue          |
| `hs_opioid_crisis_enforce`        | treats opioid crisis as a law-enforcement issue |

**climate_energy** — Climate change belief, EVs, solar, fracking, federal lands, Green New Deal

| Column                             | Meaning                                 |
| ---------------------------------- | --------------------------------------- |
| `hs_climate_change_believer`       | believes in human-caused climate change |
| `hs_climate_change_nonbeliever`    | rejects human-caused climate change     |
| `hs_electric_vehicle_likely_buyer` | likely to buy an electric vehicle       |
| `hs_electric_vehicle_not_likely`   | unlikely to buy an electric vehicle     |
| `hs_solar_panel_buyer_yes`         | has bought solar panels                 |
| `hs_solar_panel_buyer_no`          | has not bought solar panels             |
| `hs_pipeline_fracking_support`     | supports pipelines/fracking             |
| `hs_pipeline_fracking_oppose`      | opposes pipelines/fracking              |
| `hs_green_new_deal_support`        | supports the Green New Deal             |
| `hs_green_new_deal_oppose`         | opposes the Green New Deal              |
| `hs_sell_federal_lands_support`    | supports selling federal lands          |
| `hs_sell_federal_lands_oppose`     | opposes selling federal lands           |

**immigration** — Mass deportations, border wall, immigration policy views

| Column                          | Meaning                                |
| ------------------------------- | -------------------------------------- |
| `hs_mass_deporations_support`   | supports mass deportations             |
| `hs_mass_deporations_oppose`    | opposes mass deportations              |
| `hs_mexican_wall_support`       | supports a border wall                 |
| `hs_mexican_wall_oppose`        | opposes a border wall                  |
| `hs_immigration_process_unfair` | sees the immigration process as unfair |
| `hs_immigration_undesirable`    | sees more immigration as undesirable   |

**crime_safety** — Violent crime concern, gun control, police trust, death penalty

| Column                          | Meaning                          |
| ------------------------------- | -------------------------------- |
| `hs_violent_crime_very_worried` | very worried about violent crime |
| `hs_violent_crime_not_worried`  | not worried about violent crime  |
| `hs_gun_control_support`        | supports gun control             |
| `hs_gun_control_oppose`         | opposes gun control              |
| `hs_police_trust_yes`           | trusts the police                |
| `hs_police_trust_no`            | does not trust the police        |
| `hs_death_penalty_support`      | supports the death penalty       |
| `hs_death_penalty_oppose`       | opposes the death penalty        |

**social_issues** — Abortion, same-sex marriage, trans athletes, DEI, religion salience

| Column                         | Meaning                                 |
| ------------------------------ | --------------------------------------- |
| `hs_abortion_pro_choice`       | pro-choice on abortion                  |
| `hs_abortion_pro_life`         | pro-life on abortion                    |
| `hs_same_sex_marriage_support` | supports same-sex marriage              |
| `hs_same_sex_marriage_oppose`  | opposes same-sex marriage               |
| `hs_trans_athlete_yes`         | supports trans athlete participation    |
| `hs_trans_athlete_no`          | opposes trans athlete participation     |
| `hs_dei_support`               | supports DEI initiatives                |
| `hs_dei_oppose`                | opposes DEI initiatives                 |
| `hs_religion_important`        | religion is important in their life     |
| `hs_religion_not_important`    | religion is not important in their life |

**regulation_economy** — Regulation, capitalism, unions, income inequality, infrastructure spending

| Column                                   | Meaning                                     |
| ---------------------------------------- | ------------------------------------------- |
| `hs_regulations_too_harsh`               | sees regulations as too harsh               |
| `hs_regulations_good`                    | sees regulations as good                    |
| `hs_capitalism_believe_sound`            | believes capitalism is fundamentally sound  |
| `hs_capitalism_believe_flawed`           | believes capitalism is fundamentally flawed |
| `hs_unions_beneficial`                   | views unions as beneficial                  |
| `hs_unions_not_beneficial`               | views unions as not beneficial              |
| `hs_income_inequality_serious`           | sees income inequality as a serious problem |
| `hs_income_inequality_no_issue`          | sees income inequality as not a real issue  |
| `hs_infrastructure_funding_fund_more`    | favors more infrastructure funding          |
| `hs_infrastructure_funding_enough_spent` | believes enough is spent on infrastructure  |

### Step 6b — Selection rules

For each priority-eligible item:

1. **Map the item to a topic.** Read the staff report / agenda commentary for the item. Pick the topic above whose policy domain most closely matches the substance of what's being decided. Topic-area match is necessary but not sufficient — a rezoning item is `housing`, not just "regulation."
2. **Pick a polarized column.** Within the chosen topic, pick the column whose `meaning` is the _position-being-advanced_ by the proposed action. Example: a "rezone to allow more multifamily housing" item → `hs_affordable_housing_gov_has_role`. The column you pick determines what direction "high score = aligned with this item" means.
3. **No defensible topic match → null.** If the item doesn't map cleanly to any of the 9 topics above (e.g. a procurement contract for street paving, a routine board appointment), set `display.constituent_sentiment` and `research.full_treatment.haystaq_detail` to `null` for that item. Do not force a match — citing an unrelated topic is worse than no citation.

### Step 7 — Discover the exact L2 district value (when `l2DistrictType` is set)

**Milestone — run `milestone("haystaq")`** (per BEFORE YOU START item 6) before this step's work (covers Steps 7-8, the L2 district discovery + batched query).

L2 district value format varies by jurisdiction. PARAMS may pass `l2DistrictName='25'` but the actual value in L2 for NYC City Council is `'NEW YORK CITY CNCL DIST 25 (EST.)'`. Before running the Step 8 batched query for district scope, run a one-shot discovery query against `int__l2_nationwide_uniform_w_haystaq` to find the exact value matching the official's district:

```python
cur.execute(f"""
  SELECT DISTINCT `{l2_type}` AS district_value, COUNT(*) AS n
  FROM goodparty_data_catalog.dbt.int__l2_nationwide_uniform_w_haystaq
  WHERE Voters_Active = 'A'
  GROUP BY `{l2_type}`
  ORDER BY n DESC
  LIMIT 50
""")
```

(`{l2_type}` is `PARAMS.l2DistrictType`, validated as `re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", l2_type)` before f-string interpolation — ASCII-only to defeat Unicode-homoglyph identifiers.) Scan the result for a row whose value matches `PARAMS.l2DistrictName` (exact or case-insensitive substring). If no match found, record `haystaq_status: "no_match"` and fall back to the state-scope query in Step 8 (drop the district clause entirely).

Skip this step entirely when `l2DistrictType` is null/absent in PARAMS — only state scope applies (broker auto-injects state).

### Step 8 — Run the batched AVG query against L2

Collect the picked columns across every priority item that found a topic match. Issue ONE batched query. Scope is determined by whether `l2DistrictType` is set and was confirmed in Step 7:

- **District scope** (`l2DistrictType` set AND value confirmed via Step 7): include the L2 district WHERE clause.
- **State scope** (`l2DistrictType` absent, OR set but not confirmed in Step 7): omit the district clause — the broker's auto-injected state clause is the only geographic filter.

```sql
-- Whitelist-validate each picked column before interpolation (ASCII-only):
--   re.fullmatch(r"hs_[a-z0-9_]{1,60}", col)
-- Then assemble the column list dynamically.
-- District scope:
SELECT
  ROUND(AVG(CAST(`{col1}` AS DOUBLE)), 1) AS {col1},
  ROUND(AVG(CAST(`{col2}` AS DOUBLE)), 1) AS {col2},
  -- ... one per picked column
  COUNT(*) AS voter_count
FROM goodparty_data_catalog.dbt.int__l2_nationwide_uniform_w_haystaq
WHERE `{l2_type}` = :l2_name AND Voters_Active = 'A';

-- State scope (drop the district clause):
SELECT
  ROUND(AVG(CAST(`{col1}` AS DOUBLE)), 1) AS {col1},
  ROUND(AVG(CAST(`{col2}` AS DOUBLE)), 1) AS {col2},
  COUNT(*) AS voter_count
FROM goodparty_data_catalog.dbt.int__l2_nationwide_uniform_w_haystaq
WHERE Voters_Active = 'A';
```

Notes:

- `{col_N}` are validated `hs_*` column names interpolated via f-string. Every value in the inline catalog above is L2-verified — column-existence checks are not required.
- `{l2_type}` is the district column identifier (e.g. `City_Ward`), backtick-quoted and validated as `re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", l2_type)` (ASCII-only).
- `:l2_name` is bound via named placeholder. Use the value confirmed in Step 7 — not raw `PARAMS.l2DistrictName` if the discovery query found a different exact match.
- Do NOT add a `Residence_Addresses_City` clause — there is no city in PARAMS, and adding one returns `ScopeViolation`. State-scope queries are state-wide intentionally.
- If no priority item picked a column, **skip Step 8 entirely** — no zero-column queries.

### Step 9 — Per-item overview (for each featured and queued item)

**Milestone — run `milestone("per_item")`** (per BEFORE YOU START item 6) before this step's work (covers Steps 9-12, the per-item generation pipeline).

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

Every new run emits `display.talking_points` as an array of `{text, why}` objects — never bare strings. (Bare-string arrays remain schema-valid only because older artifacts already in S3 used that shape; do not emit that shape yourself.) Up to five entries. Each array element is a single `{text, why}` object and nothing else — do NOT prepend a `## Posture override` block, a rules/voice declaration, or any header/preamble. The first element must be a real talking point.

- `text` — the bullet itself: one or two sentences, addressed to the official directly. Same voice and content rules as before (see "What a useful talking point does" / "What to avoid" below) — this is what changes, not the writing standard for it.
- `why` — one to three sentences of rationale, written for the official, covering:
  - **Strategic intent** — why this matters enough to raise in the room, not just that it's true
  - **Risk framing** — whether raising it carries a downside (does asking make the official look uninformed, or expose a position they may not want on the record) or whether staying silent is the risk
  - **Handling the response** — what a likely staff/colleague response looks like and how the official should handle it

`why` must be substantive and specific to this item — never a restatement of `text` in different words, and never a generic "this is important because it affects constituents." If you can't write a `why` that adds new information beyond the bullet, the talking point itself is probably not sharp enough; sharpen `text` first.

**`why` must not presuppose how the official will vote or where they will land.** Explain the rationale, the risk, and how to handle the likely response — never narrate an assumed position as already decided. Banned constructions: "while supporting/opposing...", "while not opposing...", "since you'll likely vote yes/no...", or any phrase that treats a vote or stance as settled. Bad: "acknowledges the constituent lean while not opposing the policy." Good: "acknowledges the constituent lean without committing you to a position — useful regardless of how you vote."

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
- A `why` that just repeats `text` ("why: this is a good question to ask") — every `why` must add strategic context the bullet itself doesn't state
- A `why` that presupposes the official's vote or position ("while supporting...", "since you'll oppose...") — see the banned-construction list above

#### Examples

These illustrate tone and approach. They are not templates.

- `text`: "Constituent data shows modeled infrastructure spending support below 50 in this jurisdiction. This is bond-funded with no general fund impact — lead with that if cost questions arise."
  `why`: "Framing this as bond-funded up front pre-empts the cost objection the sentiment data suggests is likely, without you having to look defensive if a colleague raises it first."

- `text`: "This item is on the consent agenda and will pass without separate discussion unless pulled. If you have questions about the sole-bid process, pull it before the vote begins."
  `why`: "Once the consent agenda passes as a block, there's no procedural path to revisit the sole-bid question — pulling it is the only point of leverage, and it costs you nothing if the answer turns out to be routine."

- `text`: "The packet references two DFR tiers ($125K/year and $275K/year) without specifying which this application covers. Ask staff to confirm which tier before the vote so the record reflects what the council is authorizing."
  `why`: "Voting on an ambiguous figure creates a record problem later if the wrong tier gets billed; asking costs one sentence and staff should have the answer ready, so there's minimal downside to asking."

- `text`: "Data governance for the ALPR cameras is not addressed in the packet. Asking staff what retention and access policies are in place signals careful review and protects against questions after the grant is awarded."
  `why`: "ALPR grants draw privacy scrutiny after the fact; asking now, before the vote, puts the governance question on the record as something the council raised proactively rather than something a constituent had to force later."

### Step 11 — Recent news (featured and queued items)

Rules for finding, evaluating, and presenting recent news for each priority item.

News articles are **supplementary context**, not primary source material. Every factual claim in the briefing must trace to the agenda packet or another authoritative document — see Step 13. Use news to surface community discussion and recent coverage that surrounds a decision, not to introduce facts the agenda packet does not establish.

#### What to find

Up to 3 recent headlines per priority item from local news sources. Each should be directly relevant to the agenda item in that jurisdiction or in a larger jurisdiction that contains the jurisdiction in question.

#### Search budget

At most 2 `WebSearch` queries per priority item. Construct each query as `"<jurisdiction>" <item topic keywords> news 2026` or similar; don't run open-ended exploratory searches. If 2 queries don't produce relevant local coverage, set `display.recent_news: null`.

#### Freshness — hard requirement, not a preference

`publication_date` is a **required, non-nullable** field on every `recent_news` entry — the schema rejects a missing value, and the QA gate independently rejects any entry more than 60 days before `PARAMS.meetingDate`. Capture the real publication date from the article (byline date, dateline, or `<meta>` publish date) when you fetch it — never leave it blank and never guess.

An article you cannot date, or can date but is more than 60 days before `PARAMS.meetingDate`, does not qualify. If no article within that window can be found and verified, **omit `recent_news` entirely** (`display.recent_news: null`) rather than shipping a stale one padded in to hit the "up to 3" target. A `null` recent_news section is a correct, expected outcome; a stale one is a QA failure.

#### Link liveness — verify before citing

Use the same escalation ladder as URL retrieval elsewhere in this instruction, applied specifically to every candidate article before it goes in `display.recent_news` or `sources[]`:

1. `WebSearch` (discovery) — find the candidate article and its snippet.
2. `pmf_runtime.http.head(url)` — verify the URL is live. Returns `{"status": int, "final_url": str}`; drop the article if status is not `200`, and cite `final_url` if it redirected.
3. `pmf_runtime.http.get(url)` — LAST RESORT, only when `head` returns `403`/`405` or you need the body to confirm the article's date and topic (which you do, for every article — see below).

```python
from pmf_runtime import http
r = http.head(url)
if r["status"] == 200:
    body = http.get(url)   # confirm date + topic in the same pass
elif r["status"] in (403, 405):
    body = http.get(url)   # head blocked; get is the only option
else:
    body = None            # drop the article — not live
```

After confirming liveness, confirm the fetched content actually discusses the claimed topic before citing it — a live URL that redirected to a homepage, a paywall wall, or an unrelated story is not a usable source even though it returned `200`. Drop it rather than cite an off-topic or content-less page.

#### Source credibility

Prefer local newspapers, city government communications, and established regional outlets. Label opinion and editorial pieces as such. Do not cite blogs or social media as news.

Flag if coverage is predominantly from a single outlet or ideological direction -- the official should know if the news picture is one-sided.

#### Format

- Headline text — _Publication Name_

Up to 3 bullets per priority item; set `display.recent_news` to `null` if no fresh, live, on-topic local coverage is found. URLs go in Sources, not in the rendered briefing.

### Step 12 — Budget impact (featured and queued items)

Rules for finding and presenting budget impact for each priority item.

#### What to include

- Total cost (one-time and/or recurring)
- Per-constituent translation at the local levy level
- Stacked impact when multiple items in the same meeting affect the same taxpayer

#### Numeric precision

Dollar amounts and vote counts must be extracted from source exactly -- do not round, paraphrase, or infer. If discrepancies appear between figures in different source documents, flag them rather than resolving silently. Do not report multiple figures in the same sentence, as this can cause ambiguity.

#### Section-level source_ids

Populate `budget_impact.source_ids` with the ids (from the top-level `sources[]` list) of every source that backs the section as a whole — typically the staff report / Agenda Commentary entry and any supplementary document (engineer recommendation, bid tabulation, ordinance) cited in `summary`. This is in addition to the per-figure `figures[].source_id`, which cites the specific document a single number was extracted from. The UI renders `source_ids` as inline source pills below the section. Required-but-may-be-empty: emit `[]` only when the section's narrative draws solely from figures whose `source_id` already covers it; do not fabricate citations.

#### When no budget data is available

Set `budget_impact` to `null`. Do not estimate or fabricate figures.

### Step 13 — Compile claims with verbatim source extracts

**Milestone — run `milestone("claims_sources")`** (per BEFORE YOU START item 6) before this step's work (covers Steps 13-14, claims + sources compilation).

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

#### Link liveness + topicality (mandatory for `news` and `government_website` sources)

Before adding a `news` or `government_website` entry to `sources[]`, run it through the escalation ladder in the "Web (URL discovery + retrieval) rules" section above: `head` to confirm the URL is live (drop on non-`200`, cite `final_url` on redirect), then `get` only when forced (a `403`/`405`, or to read the body). This is not optional and not limited to `recent_news` — every citable news or government-website URL in the briefing goes through this check, because `sources[]` backs claims the QA gate treats as authoritative.

After liveness, confirm the fetched body actually discusses the claimed topic. A `200` that resolves to a homepage, a paywall/consent wall with no article body, or a page about something else is not a usable source — drop it and either find another source or route the claim per the Step 13 routing table (`omit_claim` for news-sourced claims). Never cite a URL you have not both verified live and read for topical relevance.

#### Sub-documents inside the agenda packet

The bundled agenda PDF is not a single document — it contains many sub-documents (staff reports / Agenda Commentary, resolutions, ordinances, engineer recommendations, bid tabulations, interlocal agreements). Cite each one as its own `sources[]` entry with a descriptive `name` and a `section_heading` that identifies the sub-document, not just `"Agenda packet, p. N"`. Examples:

- `name: "Agenda Commentary — Lift Station 33 (pp. 76–77)"`, `section_heading: "Staff Report"`
- `name: "LJA Engineering Bid Tabulation (pp. 78–85)"`, `section_heading: "Engineer Recommendation"`
- `name: "Ordinance 26-D — final text (pp. 127–132)"`, `section_heading: "Ordinance"`

The `url` for each remains `agendaPacketUrl` from PARAMS when present (the permanent agenda PDF link); when the packet was pre-staged at `/workspace/input/agenda.pdf` (upload path) there is no permanent URL, so set `url: null` for each sub-document. The descriptive `name` is what distinguishes them in the bibliography and what QA reads when verifying which sub-document supports which claim.

#### `retrieved_text_or_snapshot` requirements

- **Agenda packet**: the verbatim extracted text of the relevant section(s), not the full document. Include enough surrounding context for a QA reader to verify the claim without re-fetching.
- **News articles**: the article body text captured via `http.get()`, after `http.head()` confirmed the URL is live per the liveness rule above. If the page is paywalled or returns no usable body, note that and do not cite the article.
- **Government websites**: the relevant paragraph(s) from the page body.
- **GoodParty.org constituent data** (the modeled-sentiment source): set `source_type` to **`"haystaq"`** (the enum value for GoodParty.org modeled constituent data — the QA gate keys the strict framing check on this type). Set the source `name` to **`GoodParty.org modeled constituent sentiment — <topic> (<jurisdiction>)`** — never "Haystaq", "L2", "Databricks", or the `hs_*` column in the name (it renders as a citation pill the official sees). The `retrieved_text_or_snapshot` is a plain-English structured summary — the modeled position/topic, the mean score (0–100), the geographic scope (district or state), and the voter count in the denominator — attributed to GoodParty.org's data. Do not put the raw `hs_*` column name, the table name, or SQL in it.
- **Campaign**: the verbatim passage from the campaign site.

Do not truncate to a single sentence. A QA reader must be able to verify the claim solely from `retrieved_text_or_snapshot` without re-fetching the URL.

#### URL rules

- Use the permanent, stable URL for every source — not a presigned S3 URL, not a redirect.
- For the agenda packet:
  - If `agendaPacketUrl` is set in PARAMS (URL-paste path), use it verbatim as the permanent URL — it is the user's own pasted URL and is stable.
  - If the packet was pre-staged at `/workspace/input/agenda.pdf` (upload path), there is no permanent URL — set `run_metadata.agenda_packet_url` to `null` and cite the agenda packet sources[] entry with `url: null`. Record the decision in `run_metadata.run_decisions[]` (e.g. `decision: "agenda_packet_user_uploaded_no_url"`).
- For GoodParty.org constituent data: set `url` to `null`. There is no public URL for modeled constituent data.

#### Allowed sources

- Agenda packet (past and present) and accompanying staff reports
- Local government website for the jurisdiction
- Local news outlets (see Step 11 for credibility guidance)
- Campaign website for the elected official (contextual only)
- GoodParty.org modeled constituent data (cite per the Constituent-data framing rule — never "Haystaq", "L2", or "Databricks" in the source name)

### Step 15 — Set `briefing_status` and emit `required_data_points`

#### `briefing_status`

Top-level enum that tells downstream consumers what kind of artifact this is. Set at the end of the run based on what was actually produced.

| Value                     | Meaning                                                                                                                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `briefing_ready`          | At least one item tiered as `featured` or `queued` with substantive content. The UI renders a normal briefing.                                                                                                                                    |
| `awaiting_agenda`         | The discovered agenda has no substantive items yet (the meeting is too far out, or the jurisdiction has not finalized the agenda). UI renders a "we'll check back" state and may offer a path for the official to upload the agenda PDF directly. |
| `no_meeting_found`        | No upcoming meeting found within the search window for this official. UI surfaces a "no meeting on the calendar" state.                                                                                                                           |
| `agenda_provided_by_user` | The agent used a user-supplied agenda (either pre-staged at `/workspace/input/agenda.pdf` or pasted as `agendaPacketUrl`) rather than discovering one from the platform. Otherwise behaves like `briefing_ready`.                                 |
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

For each featured/queued item where Step 6/6b picked a column from the inline catalog, populate `display.constituent_sentiment` using the Step 8 query results. For items with no defensible topic match, set `display.constituent_sentiment` to `null`.

Fields:

- `summary` — short plain-English prose using the direction (from the column's `meaning`) and the `mean_score`, attributed to GoodParty.org's data. Always label as a modeled estimate. Never name the underlying column or data source (see "Constituent-data framing" in CRITICAL RULES). Example: `"GoodParty.org's data shows a modeled lean toward supporting gun control: 62.4 on a 0-100 scale."`
- `detail` — one plain-English sentence describing what the modeled estimate measures, attributed to GoodParty.org's constituent data, not a survey result. Do NOT name the `hs_*` column, "Haystaq", "L2", or any table/source. Example: `"A modeled estimate, from GoodParty.org's constituent data, of how strongly residents in this district lean toward supporting gun control."`
- `mean_score` — the `AVG(...)` result from Step 8 (float, 0–100). District scope when `l2DistrictType` was set and confirmed in Step 7; state scope otherwise.
- `score_direction` — the column's `meaning` line from the inline catalog (e.g. for `hs_gun_control_support` use `"supports gun control"`).
- `voter_count` — the `COUNT(*) AS voter_count` from Step 8 (district or state scope, matching `mean_score`).
- `haystaq_column` — the picked column name from the inline catalog (e.g. `hs_gun_control_support`).
- `haystaq_status` — `"ok"` when the Step 8 query returned a non-null mean; `"no_match"` when no defensible topic match (Step 6/6b returned null for this item) **or** when `l2DistrictType` was set but the value did not resolve in Step 7 (fell back to state scope); `"no_column"` defensively when the picked column wasn't queryable (shouldn't occur with the L2-verified catalog). The `"city_mismatch"` enum value is retained in the output schema for backward compatibility but is **deprecated** — do not emit it.
- `district_note` — **deprecated**, always set to `null`. With city scope removed there is no within-jurisdiction baseline to compare district against.
- `source_ids` — array of `id` values from the top-level `sources[]` list that back this section. For `haystaq_status: "ok"`, reference the Haystaq source entry you compiled in Step 14. Required-but-may-be-empty: emit `[]` only when no source defensibly backs the section (e.g. `haystaq_status` other than `"ok"`); do not fabricate citations. The UI renders these as inline source pills below the section.

Do not emit `haystaq_source` on `display.constituent_sentiment` — the curated/dictionary-fallback split is dead; the field is not in the schema and will cause rejection.

Populate `research.full_treatment.haystaq_detail` with: `district_mean_score` and `district_voter_count` set from the Step 8 district-scope query (or `null` when state scope was used); `city_mean_score` and `city_voter_count` set to `null` (city scope removed); the chosen `haystaq_column`; and the executed SQL as `query_executed`. Set `haystaq_source` to `null` (the field is retained in the schema for backward compatibility but no longer carries a value under the inline-catalog model).

### Step 17 — Write the artifact

**Milestone — run `milestone("assemble")`** (per BEFORE YOU START item 6) before this step's work.

Assemble the final JSON artifact and write it to `/workspace/output/meeting_briefing.json`. Include every top-level field required by the output_schema:

- `experiment_id`: `"meeting_briefing"` (echo of the manifest id).
- `briefing_type`: `"city_council_meeting"`.
- `briefing_status`: per Step 15.
- `generated_at`: ISO 8601 UTC timestamp captured when you assemble the artifact.
- `official_name`: from `PARAMS.officialName`.
- `meeting_name`: the official name of the meeting body as the source refers to it (e.g. `"City Council"`, `"Planning Board"`). Use the body label as it appears on the streaming platform or the city's published meeting schedule; do not paraphrase. For `no_meeting_found` or `error` status, emit an empty string. Used as the list-row title in the candidate dashboard.
- `location`: the customary location for the meeting (e.g. `"City Hall Council Chambers, 200 Main St"`). Capture from the platform's meeting detail page, the city's published meeting schedule, or the agenda packet header — whichever you consulted in Step 2. If only a building is given without a room, use the building plus street address. **If no source consulted for this run mentions a venue at all** (a realistic case for `agenda_provided_by_user` when the user-supplied PDF has no header), emit an empty string and record the decision in `run_metadata.run_decisions[]`. Do not fabricate a location from general knowledge. For `no_meeting_found` or `error` status, emit an empty string.
- `meeting_date`: `YYYY-MM-DD`. For `agenda_provided_by_user` or `awaiting_agenda` runs, this is the target meeting date; for `no_meeting_found` it may be an estimated next date.
- `meeting_time`: start time of the meeting in 24-hour `HH:MM` format, in the local timezone given by `meeting_timezone` (e.g. `"19:00"`). Capture from the same source you used for `meeting_date` (streaming platform meeting detail, city meeting schedule, or agenda packet header). Briefings own this independently of `meeting_schedule` so the row is self-sufficient. For `no_meeting_found` or `error` status, emit an empty string.
- `meeting_timezone`: IANA timezone name for `meeting_time` (e.g. `"America/Chicago"`). Use the timezone the governing body publishes the meeting in, not UTC. If only an abbreviation like `"CST"` or `"Eastern Time"` is visible on the source, resolve to the matching IANA zone for the city's location. For `no_meeting_found` or `error` status, emit an empty string.
- `estimated_read_minutes`: integer; target total read time is ~8 minutes for `briefing_ready` artifacts.
  **Stamping rule for `executive_summary.items[]` entries.** For each entry in `executive_summary.items[]`, set the following fields to record what drove the item into the executive summary:
  - `priority_id` — the `id` of the matching Priority from `PRIORITIES` (Step 1b), if this item was surfaced via a priority match. Otherwise omit or set `null`.
  - `community_issue_id` — the `id` of the matching CommunityIssue entry from `COMMUNITY_ISSUES` (Step 1b), if this item was surfaced via a community-issue match. Otherwise omit or set `null`.

  At most one of these fields should be non-null per item. If both match (rare), prefer `priority_id`. If neither matches (item elevated via Haystaq or vote-requirement alone), leave both omitted. These ids are used by the backend to write `MeetingBriefingItemLink` rows connecting the briefing item to its source priority or issue — they must be the exact database ids returned by the MCP calls, not inferred values.

- `executive_summary`: written **after** the per-featured-item deep-dive content has been authored (Steps 9–16) so each entry reflects what the deep dive actually says. A structured object with `lead_in` (a single framing sentence) and `items` (an array, one entry per **featured** item — not queued, not standard, in the same order they appear in top-level `items[]`). Each `executive_summary.items[]` entry carries: `item_id` (must match an entry in top-level `items[]` with `tier: "featured"` — the UI uses this to link the entry to its deep-dive panel), `title` (must **verbatim equal** `items[item_id].title`; do not paraphrase or shorten), and `overview` (a one-sentence distillation of `items[item_id].display.summary` — same facts, tighter framing, so the lead-of-briefing matches the deep dive). Default `lead_in` when items follow: _"The following items on your agenda require action and/or have a vote:"_ (with trailing colon). Permitted variations for ceremonial-heavy, multi-flagship, or routine-heavy meetings. When zero items qualify as featured, set `items: []` and use a standalone `lead_in` covering the case (e.g. _"This is a ceremonial agenda with no items requiring action or a vote."_). Generated, not boilerplate — adapt to what was actually found in the agenda. Per-field caps enforced by the schema: `lead_in` 300 chars, `title` 100 chars (must match `items[].title`), `overview` 300 chars; max 5 entries. Stay factual; the voice and tone rules apply (this is **not** an approved posture override). Example:
  ```json
  {
    "lead_in": "The following items on your agenda require action and/or have a vote:",
    "items": [
      {
        "item_id": "item_007",
        "title": "Short-term rental ordinance",
        "overview": "First full vote on a citywide ordinance requiring short-term rental operators to register, carry liability insurance, and cap whole-home rentals at 90 nights per year."
      },
      {
        "item_id": "item_012",
        "title": "Lincoln Park renovation bond",
        "overview": "Authorization vote on a $6.8M general obligation bond to fund the Lincoln Park renovation: new playground, accessible paths, restrooms, and stormwater retention."
      },
      {
        "item_id": "item_015",
        "title": "Senior transit subsidy pilot",
        "overview": "Vote to authorize a 12-month pilot program subsidizing on-demand transit rides for residents 65+ within city limits."
      }
    ]
  }
  ```
- `run_metadata`:

  ```json
  {
    "agenda_packet_url": "the permanent agendaPacketUrl value from PARAMS when set, or null when the packet was pre-staged at /workspace/input/agenda.pdf or when briefing_status is awaiting_agenda or no_meeting_found",
    "discovered_agenda_location": "best current prose describing where future agenda packets will likely be found for this body (see guidance below)",
    "source_bundle_retrieved_at": "ISO 8601 UTC timestamp set when the last source was fetched",
    "briefing_version": "v2",
    "run_decisions": [
      { "timestamp": "...", "decision": "...", "reason": "..." }
    ]
  }
  ```

  Append an entry to `run_decisions[]` every time you make a non-mechanical choice that shapes the resulting artifact — meeting selection, fallback to a different meeting, decision to skip a section, decision to proceed without a required source, decision to set `briefing_status` to anything other than `briefing_ready`. Mechanical actions (download a file, parse a PDF, run a query) do not need entries.

  **`discovered_agenda_location` guidance.** gp-api persists this string and passes it back as `knownAgendaLocation` on the next run for the same body. Optimize it for a future agent reading it cold.
  - **Prefer a URL to the parent page that lists meetings**, not the deep link to today's specific packet PDF. Good examples: the streaming platform's calendar (`https://{client}.granicus.com/ViewPublisher.php?view_id=N`), a Legistar `Calendar.aspx`, a CivicClerk Events index, a city site's meetings page, a deterministic CDN directory pattern that holds all packets for the year. Bad examples: a one-off `MetaViewer.php?meta_id=...` PDF link, a presigned S3 URL, a CDN URL to a single packet file.
  - **Prose is allowed when no single URL captures it.** Multi-step paths ("Top nav → Government → City Council → Agendas, then expand the current year accordion") are useful when the parent page is buried. Lead with a URL and append the navigation prose when both add value.
  - **When the channel-0 hint worked.** If you arrived via the hint and it's still the best lead for next time, write it back unchanged.
  - **When the channel-0 hint was stale.** Replace it with whatever location actually worked. Do not chain "X is stale, try Y" into the prose — record the current best location only.
  - **On `awaiting_agenda` and `no_meeting_found`.** Still emit a value when the parent page was reachable; the packet just isn't published yet (or the meeting was cancelled). Set to `null` only when no plausible future-run starting point exists. Preserving the location across these runs is a feature, not an oversight — the next run on this body should not have to rediscover the platform.

- `items`: per Steps 3–9. Each section that supports per-section `source_ids` (constituent_sentiment per Step 16, budget_impact per Step 12) must populate the field with ids from `sources[]`; empty `[]` is permitted when no defensible citation exists, but do not fabricate.
- `claims`: per Step 13. May be empty when `briefing_status` is `awaiting_agenda` or `no_meeting_found`.
- `sources`: per Step 14.
- `required_data_points`: per Step 15.
- `disclosure`: verbatim text below.

#### Required disclosure (verbatim)

Every briefing must include the following disclaimer at the `disclosure` field:

> This briefing was generated with AI assistance and may contain errors. Inferred or synthesized content represents model-generated interpretation, not verified fact. Constituent sentiment data, where present, reflects modeled estimates for constituents in that jurisdiction.

### Step 17b — Grounding self-check (run once, before Step 18)

**Milestone — run `milestone("grounding_check")`** (per BEFORE YOU START item 6) before this step's work.

The deterministic QA gate checks every claim's `source_extracts[]` against the `retrieved_text_or_snapshot` of its cited source(s) using a **whitespace-normalized, case-folded substring match** (it collapses runs of whitespace to one space and lowercases both sides before comparing), and it treats an extract whose **first 60 characters** still match as an acceptable partial (a warning, not a failure). Catch true grounding failures in-loop with the SAME logic the gate uses — so case-only, spacing-only, or trailing-drift differences do NOT get you dropping a valid claim:

```python
import json, re
def _norm(s):
    return re.sub(r"\s+", " ", s or "").strip().lower()
art = json.load(open("/workspace/output/meeting_briefing.json"))
srcs = {s["id"]: _norm(s.get("retrieved_text_or_snapshot")) for s in art.get("sources", [])}
ungrounded = []
for c in art.get("claims", []):
    for ex in c.get("source_extracts", []):
        needle = _norm(ex)
        if not needle:
            continue
        cited = [srcs.get(sid, "") for sid in c.get("source_ids", [])]
        if any(needle in hay for hay in cited):
            continue
        # Mirror the QA gate's 60-char partial-match fallback (qa_checks.py):
        # an extract whose first 60 chars appear in the source is a WARNING,
        # not a grounding failure — do NOT flag it ungrounded / drop the claim.
        head = needle[:60]
        if len(head) >= 20 and any(head in hay for hay in cited):
            continue
        ungrounded.append((c.get("claim_id"), ex))
for cid, ex in ungrounded:
    print("UNGROUNDED", cid, "::", repr(ex[:120]))
print(f"{len(ungrounded)} ungrounded extract(s)")
```

For each `UNGROUNDED` line, fix it by exactly one of:

1. **Copy the verbatim substring.** Replace the `source_extracts` entry with text copied from the cited source's `retrieved_text_or_snapshot`. Case and whitespace differences are tolerated (the check normalizes both), but the words themselves must appear in the source — don't paraphrase or drop/insert words.
2. **Widen the snapshot.** If the passage the claim relies on is real but not in the captured snapshot, expand that source's `retrieved_text_or_snapshot` to include it (Step 14 explicitly allows generous snapshots).
3. **Drop the claim.** If the extract cannot be grounded in any real source (it was paraphrased from memory or inferred), remove the claim, or route it per its `route_if_unsupported` (Step 13). A dropped claim is better than an ungrounded one.

**Bounded fix loop — at most TWO fix passes, then finalize no matter what.** The artifact is already written (Step 17); this check only repairs grounding, it must never block delivery. Run the block, apply fixes, re-run it once more. If a second pass still shows ungrounded extracts, **drop those specific claims** (remove them, honoring `route_if_unsupported`) and move on — do NOT keep looping. Two passes maximum: a delivered briefing with a couple of dropped claims always beats a run that exhausts its turn budget chasing grounding and delivers nothing. Once the block prints `0 ungrounded extract(s)`, or you have completed the second pass, stop and go to Step 18.

### Step 18 — Self-check the artifact shape

**Milestone — run `milestone("validate")`** (per BEFORE YOU START item 6) before this step's work.

For a fast in-loop sanity check, you may run the runner's generic schema-only shim:

```bash
python3 /workspace/validate_output.py
```

It only does JSON-schema validation — it does NOT check cross-references, required_data_points coverage, discovery-channel depth, or source-extract presence. Use it as a quick fail-fast on shape, then rely on the requirements throughout this instruction (cross-references resolve, every featured item has talking points, all 4 discovery channels recorded for `awaiting_agenda` / `no_meeting_found`, the disclosure phrases are present) to get the deeper quality right.

The full deterministic QA — schema + cross-references + required_data_points coverage + discovery-channel depth + source-extract presence — runs automatically after the run as a separate quality gate; you do not invoke it yourself. Get the requirements right in-loop so the artifact clears it.

**Validate at most ONCE on a complete artifact, then STOP.** If `validate_output.py` exits 0 (schema-valid), you are DONE: do not re-run the validator, do not re-read the artifact back into context to "double-check" it, and do not re-open already-completed steps to second-guess them. Re-validating a passing artifact or re-reading it to inspect it spends turns for zero quality gain — trust the clean exit and finish the run. Re-run the validator only after you have actually edited the artifact to fix a specific error it reported.

## Spot-check

Validator-passing JSON can still be garbage. Before declaring success, walk this checklist:

- **`briefing_status` consistency:** `briefing_ready` requires ≥1 featured OR queued item (Step 5 may produce zero featured items if no item qualifies). `awaiting_agenda` AND `no_meeting_found` require `claims[]` empty.
- **Every featured item must have at least one talking point.** Empty array is a schema violation; set `display.talking_points` to a non-empty list or `null`.
- **Every Haystaq score reported in `display.constituent_sentiment`** must trace to a column in the Step 6 inline catalog and a row in the Step 8 batched L2 query.
- **`district_note` is always `null`** — deprecated since city scope was removed.
- **When `l2DistrictType` is set, `voter_count` should reflect the district, not the whole state** → if it looks state-sized, the L2 district WHERE clause matched zero rows and you silently fell back to state scope. Fix: re-confirm `l2DistrictType` and `l2DistrictName` came verbatim from PARAMS_JSON and were discovered via the L2 value-format check; set `haystaq_status: "no_match"` if the value genuinely doesn't resolve.
- **All sentiment percentages <5%** → you used `= 1` instead of treating `hs_*` as 0-100 scores. Re-do the distribution check.
- **News URL doesn't load or doesn't mention the issue** → don't trust search snippets blindly; this is a required step, not a spot-check afterthought — every `news`/`government_website` source must clear the `http.head` liveness check plus a topicality read of the fetched body (Step 14) before it is cited anywhere.
- **`recent_news` entry missing `publication_date` or older than 60 days before `meetingDate`** → the schema requires the field and the QA gate rejects stale entries; drop the entry and set `display.recent_news: null` if nothing else qualifies (Step 11).
- **`run_metadata.discovered_agenda_location` is the parent page, not a deep link.** If it points at one specific packet PDF or one MetaViewer link, swap it for the platform calendar, the city's meetings index, or whatever page LISTS this body's meetings. A future run can drill into the parent page; it cannot navigate up from a deep link.

## Failure modes

| Symptom                                                                       | Cause                                                                                                                           | Fix                                                                                                                                        |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Broker logs `ScopeViolation: scope_predicate_override`                        | Agent added `WHERE Residence_Addresses_State = ?` or `WHERE Residence_Addresses_City = ?` on the L2 table                       | Remove the state clause (broker auto-injects state); never add a city clause (city is not in PARAMS, broker does not auto-inject one)      |
| Broker 422 on `/databricks/query` repeatedly                                  | Positional `?`, Postgres `FILTER`, `Voters_Active = 1`, or unauthorized table                                                   | Use named placeholders, `SUM(CASE WHEN ...)`, `Voters_Active = 'A'`; check `allowed_tables`                                                |
| Top sentiment scores all 0-5%                                                 | Treated `hs_*` as binary (`= 1`) instead of 0-100 score                                                                         | Use `AVG(CAST(\`{col}\` AS DOUBLE))`and threshold with`>= 50`                                                                              |
| `total_active_voters` looks like the whole state when `l2DistrictType` is set | L2 district value didn't resolve in Step 7; agent silently fell back to state scope                                             | Verify the district via the L2 value-format discovery query in Step 6b/7; set `haystaq_status: "no_match"` if it genuinely doesn't resolve |
| Runner: `No artifact files found in /workspace/output`                        | Agent ran out of turns or never wrote the file                                                                                  | Tighten the instruction; remove unnecessary discovery steps; check max_turns                                                               |
| `contract_violation` callback after agent claimed success                     | The runner's schema validator caught a missing/wrong-typed field the agent didn't notice                                        | Run `python3 /workspace/validate_output.py` (schema-only shim) to catch shape errors BEFORE declaring success                              |
| Legistar API returns 403 `"Token is required"`                                | Jurisdiction has gated their Granicus API                                                                                       | Scrape `legistar.{client}.gov/Calendar.aspx` and related portal pages per Step 2                                                           |
| District mean suspiciously close to state mean                                | L2 district value format mismatch (e.g. `'25'` vs `'NEW YORK CITY CNCL DIST 25 (EST.)'`) caused silent fall-back to state scope | Discover the exact value via a `SELECT DISTINCT` query before binding                                                                      |
| `awaiting_agenda` placeholder item fails schema validation                    | Agent invented a custom `tier_reason` string                                                                                    | Use `["placeholder"]` exactly per Step 3                                                                                                   |
