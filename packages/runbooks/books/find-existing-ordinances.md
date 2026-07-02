Given an elected official's jurisdiction (state + place), locate and verify the authoritative source of their current municipal code, and enumerate its top-level structure. This is the "current law" foundation for the Ordinances feature: reliably find an EO's existing ordinances without grabbing the wrong jurisdiction's code.

This is the source runbook, it captures the human-runnable version of the workflow. It has been ported to the PMF experiment `experiments/find_existing_ordinances/` (via the `build-cap-agent` skill; naming: runbook `find-X.md` → experiment `experiments/X/`). The experiment ships as manifest version 1 (15th dev iteration). Certification: a 300-jurisdiction stratified ICP sample (94% verified consolidated-code coverage, 98% reachable in any form, median 13 turns / ~$0.33 per run), plus a release-candidate 17-case regression gate: 17/17 found-parity vs baseline, 0/17 over the 2-WebSearch run-total budget (subagent-inclusive, counted from ECS streams -- parent session.jsonl alone under-counts because subagent tool calls are not recorded there), 5/17 runs captured code files to the workspace. The `office`-only input contract (`organization_slug`, `state`, `office`) matches gp-api's serve dispatch pattern (communityIssueDispatch.service.ts builds the identical triple from resolveServeContext); `county` is optional and NOT available from gp-api.

Scope: locate + verify the code source, list top-level chapters, and capture the code text where a bulk file is fetchable (Municode's full-code zip, city-hosted code PDFs); walled codifiers (eCode360, American Legal) stay pointer-only, retrieved on demand. City-hosted code documents are captured under the run's S3 prefix via the runner's workspace upload and listed in the artifact's `code_capture` field; Municode full text is fetched server-side on demand (X-CSRF header) via the artifact's handles. Per the sourcing research, this per-user on-demand capture is the recommended agentic mode; bulk corpus building and productized reliance on the reverse-engineered endpoints still need the licensing/legal conversation.

## Prerequisites

**books/.env variables**: none
**scripts/.env variables**: `DATABRICKS_SERVER_HOSTNAME`, `DATABRICKS_HTTP_PATH`, `DATABRICKS_API_KEY` (only for step 1, sampling real ICP jurisdictions)
**Tools**: `uv` (for `scripts/python/resolve_ordinance_code.py` and `databricks_query.py`), web search (via your agent), `curl`/`jq` for spot-checks
**Output**: for each jurisdiction, the code host + URL, an edition/date if available, a verified-identity note, a confidence level, and (optional) the top-level chapter list. The experiment version emits this as JSON.

## What you need to know about the data

The whole difficulty is accuracy, not availability. Four facts drive the workflow:

1. **Codified municipal law is concentrated on a few platforms.** In a 300-city ICP sample, ~79% of city councils host their code on three codifier families: Municode/CivicPlus (~34%), eCode360/General Code (~25%), and American Legal (~20%). The rest (~21%) are bespoke city sites or uncodified.
2. **Two of the three publish client directories; one does not.** Municode exposes a client list via `api.municode.com`, and General Code publishes an open list at `generalcode.com/text-library`. Match a jurisdiction against those and you have an authoritative hit with no guessing. American Legal is bot-walled with no bulk list, so it only surfaces via web search, but it does cover deep into small towns (a 1,000-voter borough can be fully codified there).
3. **The dominant failure is the same-name trap, not a missing code.** A search for a small town returns a same-named bigger city's code: Horton KS surfaces Kansas City MO; Melbourne AR surfaces Melbourne FL; Madison MS surfaces Madison MO and Madison County. Never trust a name match alone. Verify the state and the exact place on the landing page, and reject county-level or same-name-other-state results.
4. **Measured coverage (n=300 real runs, stratified ICP sample):** ~63% resolve deterministically via the directories (step 3); **94% reach a verified consolidated code** with the web-search + content-verification tiers (step 4-5); ~4% more are reachable only as scattered ordinance PDFs (98% in any form); ~2% have nothing online. Small towns are the weak band (84% vs ~99% for mid/large). For the tail, degrade gracefully and fall back to the product's paste-a-link path.
5. **Judge content, not packaging.** A consolidated code counts regardless of how it is published: a codifier site, city-hosted HTML, chapter-by-chapter PDFs, a records portal (Laserfiche/WebLink), New England "General Bylaws", or a state basic-code adoption (an Ohio village adopting the "Ohio Basic Code" by ordinance is codified by reference: report found with `data_quality: partial`). Conversely, a page of one-off ordinance PDFs is NOT a code, but you may only conclude "uncodified" after downloading the most code-like document and checking it for codified structure (a chapters/articles/sections TOC). Bound that check: at most 2 documents, one extraction attempt each; a scanned PDF with no text layer is unverifiable, move on. `data_quality: partial` = consolidated but stale, or codified by reference.

Host authority ranking, best first: official codifier (`library.municode.com`, `ecode360.com`, `codelibrary.amlegal.com`, `codepublishing.com`, `online.encodeplus.com`, `<place>.municipal.codes`) or the city's official `.gov` code page > third-party mirrors and aggregators (e.g. `*.elaws.us`, library pages) > anything else. Prefer a consolidated "Code of Ordinances" over a single ordinance or a zoning-only PDF.

## Steps

### 1. Get the jurisdiction (sample real ICP offices, or take it from params)

The experiment receives `state` and `office` as params from gp-api (resolved from the EO's election-api Position; the agent derives the bare place name from `office`). To run the workflow manually, sample real serve-ICP city councils from Databricks. The ICP source of truth is `goodparty_data_catalog.dbt.int__icp_offices` (see also books/query-voter-data.md).

```bash
cd scripts/python
uv run python databricks_query.py "
SELECT state,
  TRIM(REGEXP_REPLACE(REGEXP_REPLACE(br_position_name,'(?i)\s*\(unexpired term\)\s*$',''),'\s+-\s+.*$','')) AS jurisdiction,
  MIN(voter_count) AS voter_count
FROM goodparty_data_catalog.dbt.int__icp_offices
WHERE icp_office_serve = true
  AND normalized_position_type = 'City Legislature'
  AND l2_district_type IN ('City','Village','Borough','Town_District')
  AND voter_count IS NOT NULL
GROUP BY 1, 2
ORDER BY voter_count
LIMIT 12
"
```

The `jurisdiction` column strips the governing-body suffix. `resolve_ordinance_code.py` strips it too, so passing the raw `br_position_name` also works.

### 2. Check for a user-supplied code link (highest trust)

If the EO (via intake) pasted a link to their code, verify it and skip discovery: confirm the page names the correct state + place, then record it as the source with `confidence: high`. A user-confirmed link beats any automated match.

### 3. Tier 1: bulk codifier directories (deterministic, no web search)

Match the jurisdiction against the Municode and General Code client lists. A hit is authoritative, the directory itself lists the code.

```bash
cd scripts/python
uv run python resolve_ordinance_code.py MN "Ramsey" OH "Shaker Heights" NJ "Clifton"
# or feed a batch: printf 'MN\tRamsey\nOH\tShaker Heights\n' | uv run python resolve_ordinance_code.py --stdin
```

Each line prints JSON: `source` (`municode` | `generalcode/ecode360`), the matched name, `code_url`, and for Municode the `client_id` + `product_id` (the stable handles for later text retrieval). Resolved rows are done. Unresolved rows fall through to step 4.

**A directory hit is not proof the current code lives there.** Somerville MA is listed in Municode's directory but its code moved to encodePlus; a constructed Municode browse URL can also 200 as a state-index redirect that never mentions the place. Verify content before relying on a directory hit (the experiment does).

**Endpoint reference.** Two header regimes: everything on `api.municode.com` (States, Clients, Products, Jobs/latest, codesToc) needs no headers; everything on `library.municode.com/api/*` (ArchivedContent editions + the full-code zip manifest) requires `X-CSRF: 1`, which the quarantined experiment runtime cannot send, so archive/zip retrieval is a **server-side** operation (gp-api can send the header) using the artifact's `client_id`/`product_id`:

- Municode (JSON API): `GET api.municode.com/States` (map state abbr to `StateID`) → `GET api.municode.com/Clients/stateId/{StateID}` (match `ClientName` to the place; the list is state-scoped, so it cannot leak another state) → `GET api.municode.com/Products/clientId/{ClientID}` (pick the product whose `ProductName` contains "Ordinance"). The `ProductID` is the authoritative handle; the browsable URL is `library.municode.com/{state}/{slug}/codes/code_of_ordinances` where `slug` = the full `ClientName` lowercased with spaces replaced by `_` — punctuation kept, trailing body words NOT stripped ("Kansas City" → `kansas_city`, "St. Louis" → `st._louis`; this is Municode's own `UrlEncodeComponent` from the library SPA bundle). Edition metadata: `GET library.municode.com/api/ArchivedContent/{ProductID}` returns editions (`Id`, `Name`, `MaxTrackingDate`), newest first. Full chapter TOC: `GET api.municode.com/codesToc?jobId={jobId}&productId={ProductID}` (jobId = `Jobs/latest/{ProductID}`.`Id`) returns the chapter tree as `Children[].Heading`.
- General Code: `GET generalcode.com/text-library/` returns one large (~2MB) HTML page of `<a href="https://ecode360.com/XXXXX">City of Foo</a>` anchors grouped under state `<h*>` headers. Match anchors under the correct state header only.

### 4. Tier 2: verified web search (for the misses)

For each unresolved jurisdiction, web-search `"<jurisdiction> <state> code of ordinances"`. Then:

- Rank candidate results by host authority (see the ranking above). American Legal (`codelibrary.amlegal.com/codes/<slug>/latest/overview`), Code Publishing, encodePlus, `<place>.municipal.codes`, and the city's official `.gov` code page are the common hits here.
- **Verify identity before accepting.** Open the top candidate (a `HEAD` is usually enough to confirm it is live; read the page only if needed) and confirm it names the same state and the same place. Reject any result for a same-named city in another state, a county, or a single unrelated ordinance. This guard is the point of the step.
- **Bot-walled hosts still count.** On a 403 or a Cloudflare "security verification" body, treat the whole host as walled (do not retry sibling paths); accept identity from convergent search snippets (multiple indexed sections of the code naming the exact city + state) at `confidence: medium` rather than degrading.
- City-hosted codes are often PDFs: fetch with a binary download (not a text GET) and check the first pages for a codified TOC, per fact #5's bounded content test.
- Record the host type, URL, and an edition/adoption date if the page shows one.

### 5. If nothing verifies, degrade (do not fabricate)

Only after the fact #5 content test: if the hits are a same-name trap, a county code, or one-off ordinance PDFs with no codified document and no basic-code adoption (the Horton KS case), stop and return `data_quality: uncodified` or `not_found` with the best official source you did find (usually the city `.gov`). Never return a code URL you could not tie to this exact jurisdiction.

### 6. (Optional) enumerate the top-level structure

For a verified codifier code, list the top-level chapters/titles so downstream steps can pick the relevant one. For Municode, the `client_id`/`product_id` from step 3 drive the `codesToc` endpoint (full chapter tree; see the endpoint reference above), and `ArchivedContent` gives the edition date. This is a table of contents without pulling full text.

### 7. Assemble the output

Human-readable (the experiment version produces JSON matching the output schema):

```
# Existing ordinances: <Jurisdiction>, <ST>

Code source: <host_type>, <url>   (edition/through: <date if known>)
Identity verified: <how, e.g. "page header reads 'City of Ramsey, MN'">
Confidence: <high|medium|low>   Data quality: <ok|partial|uncodified|not_found|ambiguous>

## Top-level chapters (optional)
- <n>. <title>
- ...
```

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Returned a large same-named city's code for a small town | Trusted a name match without identity verification | Do step 4's verify: confirm state + exact place on the page; reject county / other-state |
| Municode/eCode360 page looks empty when fetched | Those pages are SPAs; a plain fetch gets a shell | The directory match (step 3) is authoritative on its own; for content use the Municode content API, not the browse URL |
| American Legal never appears in step 3 | It publishes no bulk client list (bot-walled) | Expected, it only resolves via the step 4 web search |
| No consolidated code exists anywhere | Small/uncodified jurisdiction with only individual ordinance PDFs | Degrade per step 5; fall back to the product's paste-a-link path |
| A jurisdiction on eCode360 is missed by step 3 | The General Code bulk list is not fully exhaustive | The step 4 web search catches it |
| Called a PDF-published code "uncodified" | Judged the packaging, skipped the content test | Download the most code-like document and check for a codified TOC (fact #5) |
| Burned time parsing scanned PDFs | No text layer; OCR rabbit hole | Bounded test: max 2 documents, one extraction attempt, scanned = unverifiable, move on |
| Missed an Ohio-style basic-code adoption | Looked only for a jurisdiction-branded code | Scan the ordinance list for "adopting the ... Basic Code" (found, `partial`) |

## The experiment (already ported)

`experiments/find_existing_ordinances/` (manifest version 1) is the self-service version gp-api can dispatch. It was ported with the `build-cap-agent` skill and certified on the full n=300 sample (zero regressions across instruction versions; see the manifest for the contract). Translation notes that matter if you revise it:

- **No `scope` block.** This experiment needs no Databricks table access, gp-api passes the jurisdiction identity (`organization_slug`, `state`, `office`, optional `county`, optional `user_provided_code_url`) as params; the agent derives the place name from `office`, matching the meeting_schedule convention. Step 1's Databricks query is only for manual sampling.
- **The runner is network-quarantined.** `resolve_ordinance_code.py` uses `urllib` to reach `api.municode.com` and `generalcode.com`; in the experiment those calls become `pmf_runtime.http.get(url)`, and the directory-matching logic lives in the instruction. `WebSearch` stays `WebSearch` (never `WebFetch`).
- **PDF handling.** The runtime's `http.get` refuses binary content; the instruction uses `pmf_runtime.http.download(url)` (returns `{path, byte_size, source_url, content_type}`) and extracts text with pypdf (`pdftotext` is not in the container).
- **The same-name-trap verification and the fact #5 found-contract live in CRITICAL RULES.** They are the accuracy contract, not optional niceties.
- Output schema: `jurisdiction {state, place, verified_evidence}`, `code_found`, `code_source {host_type, url, edition_or_date, client_id?, product_id?}`, `confidence`, optional `toc[]` (items need only `title`), `data_quality` (`ok` | `partial` | `uncodified` | `not_found` | `ambiguous`), and `code_capture` (files saved to `/workspace/code_capture/`, persisted at `.../{run_id}/logs/workspace/code_capture/` in the artifacts bucket; `saved: false` for walled hosts).

See `experiments/CLAUDE.md` for the runbook → experiment lifecycle.
