# Find existing ordinances

Given an elected official's jurisdiction (state + place), locate and verify the authoritative source of their **current municipal code**, and enumerate its top-level structure. The whole difficulty is **accuracy, not availability**: a name match alone is not enough, you must verify the state and exact place on the landing page, because a search for a small town routinely surfaces a same-named bigger city, a county, or a same-name-other-state code. You work a **most-likely-first ranked list** of code hosts and stop at the first verified hit. This is the "current law" foundation for the Ordinances feature; every run writes an ACCESS KIT to the workspace (Step 6a: a README pointer + already-fetched evidence + city-hosted code files when a direct URL is held); codifier-hosted codes stay pointer-only with stable retrieval handles.

## BEFORE YOU START
1. Read this entire instruction end-to-end before executing anything.
2. Maintain a TodoWrite list mirroring the TODO CHECKLIST.
3. Params are in `PARAMS_FILE`. Read once: `organization_slug`, `state`, `office` (the EO's office name, e.g. "Ramsey City Council"), optional `county`, optional `user_provided_code_url`. **Derive the place name from `office`** by stripping the trailing governing-body phrase (Step 1 shows how); if what remains is empty or generic, WebSearch `office` + `state` first to identify the municipality. For `generated_for_run_id`, use the `RUN_ID` env var, falling back to `"unknown"` when unset (`run_id` is never in `PARAMS_FILE` — the input schema rejects it — and the field must be non-empty).
4. **Keep a `FETCHED` cache and never fetch the same URL twice** (fetch-once rule below). Biggest efficiency rule.
5. **Parallelize independent verifications.** When a search yields several candidate hosts to check, verify them concurrently (dispatch one research subagent per candidate via the Agent tool — AT MOST 3, the 3 highest-ranked by RESOLUTION ORDER; discard the rest unless all 3 fail to verify). Do NOT verify candidates one at a time, and do NOT wrap a single sequential step in a subagent.
6. Write the artifact to `/workspace/output/find_existing_ordinances.json`, run `python3 /workspace/validate_output.py`, then do the spot-check.

## RESOLUTION ORDER (work this list, stop at the first verified hit)

Ordered by how often ICP city codes actually live there (measured). Cumulative coverage in parentheses.

1. **Municode** (42%), the ONLY directly queryable host: hit its client API (Step 3). If matched, done.
2. **eCode360** (58%)
3. **American Legal** `codelibrary.amlegal.com` (74%)
4. **City site** consolidated code, HTML or PDF (81%)
5. **Code Publishing** `codepublishing.com` (87%)
6. **municipal.codes / encodePlus** (89%)
7. **other codifier** (92%)
8. **none**, uncodified (~5%): only individual one-off ordinance PDFs, or nothing. Degrade, but ONLY after the PDF content test in Step 5.

Hosts 2-7 are not directly listable/guessable in this runtime, so you reach them with **one WebSearch** (Step 4) and triage its results against this order: prefer the highest-ranked host that verifies to the exact jurisdiction, take the first verified hit, and stop.

## TODO CHECKLIST
1. Read `PARAMS_FILE` + run id; derive `(kind, place)` from `office`; **if `kind == "state"` skip straight to 7** — Steps 2-6 apply only to municipal/county offices. Set up `FETCHED`.
2. If `user_provided_code_url` set, verify it; if it names the correct state+place, record and skip to Step 7.
3. Tier 1: Municode client API for `state`, exact `place` match -> record `municode`, go to Step 6/7.
4. Tier 2 (Municode miss): ONE `WebSearch`; triage candidates against the RESOLUTION ORDER; verify the top candidates in parallel; first verified hit wins.
5. Before concluding uncodified: run the **PDF content test** on the city page's most code-like document, and check for a **state basic-code adoption**.
6. Optional edition date + TOC first (Step 6 — Municode: codesToc + Jobs/latest), THEN build the access kit in `/workspace/code_capture/` (Step 6a: README always; city-hosted code files; the just-fetched Municode JSON + page snapshots).
7. Assemble artifact, write, validate, spot-check.

## CRITICAL RULES

**FETCH EACH URL EXACTLY ONCE, THEN PARSE LOCALLY.** Re-rendering the same page is the #1 turn-waster and trips 403/429 self-throttling. Check `FETCHED` before any `http.get`/`head`; capture the FULL body once and do ALL extraction (identity AND table-of-contents AND edition) from that one body. Never re-fetch a page to pull a second field.

**WHAT COUNTS AS `found`: judge the CONTENT, not the packaging.** `code_found: true` means a **consolidated codified body of law** for THIS exact jurisdiction is retrievable. It counts regardless of how it is published:
- a codifier code (Municode / eCode360 / American Legal / Code Publishing / municipal.codes / encodePlus), even if the host is bot-walled (see walled-host rule);
- a consolidated code on the city's own site, **including as PDF(s)**: one code PDF, chapter-by-chapter PDFs of a codified code, a document-center "Municipal Code" section, or a records portal (Laserfiche/WebLink) holding Parts/Titles of the code. New England towns often call it **"General Bylaws"**, which counts;
- a **state basic-code adoption** (e.g. an Ohio village adopting American Legal's "Ohio Basic Code" by ordinance): the jurisdiction IS codified by reference. `code_found: true`, `host_type` "other", url = the adopting city page (or the basic-code text if directly linked), `data_quality` "partial", and say in `verified_evidence` that current law = the state basic code + local ordinance overlays.

`code_found: false` (uncodified) means: only individual, one-off ordinance PDFs with **no codified structure**, a zoning-only document, or nothing. **You may only conclude this after the PDF content test (Step 5): a page of PDFs is NOT evidence of uncodified until you have downloaded the most code-like document and checked it.** A wrong `found` is worse than a wrong `uncodified`, but a lazy `uncodified` that never opened the PDF is just as wrong.

**`data_quality` semantics:** `ok` = current consolidated code. `partial` = consolidated but degraded: stale (e.g. "updated through 2015" with later amendments as loose PDFs, put the date in `edition_or_date`) or codified-by-reference (basic-code adoption). `uncodified` / `not_found` / `ambiguous` = per Step 5.

**SAME-NAME TRAP.** Never trust a name match alone. Small towns surface a same-named bigger city (Horton KS->Kansas City MO; Melbourne AR->Melbourne FL; Madison MS->Madison MO/County). Verify the page names the same state AND exact place; record how in `verified_evidence`. **When `county` is known** (the optional param, or extracted by Step 1 from a "X County:" office prefix), use it as the tiebreaker wherever two in-state candidates share a name or a page's identity is ambiguous: prefer the candidate whose page/address/directory entry names that county, and mention the county check in `verified_evidence`. Reject same-name-other-state, county codes, single ordinances — EXCEPT when Step 1 classified the office as county-level (`kind == "county"`): then the county code IS the target and same-named city codes are the trap instead.

**Walled-host rule.** On a host that returns 403 or a "security verification"/Cloudflare body, treat the WHOLE host as walled: do not retry its sibling paths. A walled codifier still counts as `found` when the snippet evidence is convergent, e.g. WebSearch shows multiple indexed SECTIONS of that city's code on the codifier (article/chapter pages naming the exact city+state). Record `confidence` "medium" and state in `verified_evidence` that the landing page was walled and identity comes from indexed-section snippets. City sites that 403 non-browser clients often still render via `http.get` (browser render); try it once before giving up.

**CivicPlus / link-less renders.** BOTH `http.get` and `http.download` render HTML pages to plain text by default — hrefs and tags are stripped, so when a town page NAMES a document ("General Town By-Laws") but shows no link, the document's URL is usually unrecoverable. The ONLY sanctioned recovery is the single `render="links"` attempt in Step 6a rule 5 (which may not be supported in this runtime — fail closed). Otherwise do not hunt: the naming page itself is your verification source — record `found` from its text (title, edition, official-site identity), set `code_source.url` to that page, and record capture `saved: false` with the page URL and folder path in the README. Two true quirks worth knowing: CivicPlus `DocumentCenter/View/...` URLs often return 404 to `http.head` but 200 to `http.download` — never disqualify one on a HEAD result alone; and a direct file URL that appears in a WebSearch SNIPPET you already have is a held URL — downloading it is fine, but NEVER spend a WebSearch to obtain such a snippet: the 2-search cap counts every search regardless of motive, and capture never justifies one.

**Search + fetch budget.** At most **2 WebSearches** per run — a HARD STOP, not a guideline, and a RUN-TOTAL: searches fired by your subagents count against the same cap. Subagents are verifiers, not searchers — when you dispatch one, give it concrete URLs to check and state in its prompt that it MUST NOT call WebSearch. Delegating a search you may not run yourself is still running it. Count your searches as you go. When both are spent and nothing has verified, a third search is NEVER the correct move; stop discovering and conclude from what you already hold: run the PDF content test on the most code-like document already fetched (if any), apply the walled-host and basic-code-adoption carve-outs, then write the honest lesser artifact — `found: false` with the appropriate `data_quality`, or `found: true` at `confidence: "low"` if the evidence you already hold is convergent but body-unverified. A lower-confidence honest artifact is a SUCCESS; blowing the search budget is a failure even when it eventually finds the code. Cheapest rung first: `WebSearch` snippets, then `http.head`, then `http.get` (browser render, once per URL), and `http.download` for binary/PDF content. Never `WebFetch`. Never enumerate guessed URL or page-ID patterns in loops — a URL you probe must come from a search result, a page you already fetched, or a directory API. The container is network-quarantined: `urllib`/`requests`/`curl`/`wget`/`socket` fail in <1s; reach URLs only via the `pmf_runtime.http` calls and `WebSearch`.

**PDF handling.** `http.get` refuses binary content ("cannot decode binary content-type"); PDFs are fetched with:
```python
from pmf_runtime import http
d = http.download(pdf_url)          # -> {"path", "byte_size", "source_url", "content_type"}
# read text: pdftotext if available, else python3 -c with pypdf; even the first pages' text
# is enough to check for a codified TOC (chapters/articles/sections).
```

**Schema contract.** `schema_version` is the **integer** `1`. `toc` optional; `number` may be omitted for unnumbered front/back matter (only `title` required). `code_capture` is REQUIRED (use `{"saved": false, "files": [], "note": "..."}` when nothing was captured).

## Steps

### Step 1: params + place derivation + fetch-once wrapper
```python
import json, os, re
P = json.load(open(os.environ["PARAMS_FILE"]))
RUN_ID = os.environ.get("RUN_ID") or "unknown"
state = P["state"]; office = P["office"]; user_url = P.get("user_provided_code_url")
county = P.get("county")

# Production office names come in FOUR shapes. Derivation is a function with EARLY
# RETURNS so each kind structurally short-circuits — nothing falls through:
def derive(office, county, state):
    o = re.sub(r"\s*-\s*(district|ward|seat|precinct|place|position|at[- ]large)\b.*$", "", office, flags=re.I).strip()
    if re.search(r"\b(house of delegates|house of representatives|state senate|state assembly|"
                 r"general assembly|state house)\b", o, re.I):
        return "state", state, county          # state-level: municipal code does not apply
    m = re.match(r"^(.*?)\s+County:\s*(.*)$", o, flags=re.I)   # "Washington County: Muskingum Township Trustee"
    if m:
        county = county or m.group(1).strip(); o = m.group(2).strip()
    CBODY = r"(county commission(ers)?|county council|county legislature|county board of supervisors|county board)"
    m2 = re.match(rf"^(.*?)\s+{CBODY}\b", o, flags=re.I)
    if m2:
        # County office: the COUNTY's code of ordinances IS the target (Municode hosts county
        # codes). The county-code trap-rule INVERTS: verify it is this county's code; reject
        # same-named CITY codes.
        return "county", m2.group(1).strip() + " County", county
    m3 = re.match(r"^(.*?\s+Township)\s+(trustee|supervisor|clerk|fiscal officer|board)\b", o, flags=re.I)
    if m3:
        return "municipal", m3.group(1).strip(), county   # townships keep the suffix: "Bethel Township"
    BODY = (r"(city council|city commission(er)?|common council|borough council|village board|"
            r"village trustee|village council|town council|town board|town commission|village commission|"
            r"board of aldermen|board of trustees|board of selectmen|board of selectpersons|"
            r"select board|selectboard|town chair(man)?|town supervisor|village president|"
            r"mayor|city treasurer|city clerk|town clerk|city auditor|alderman|alderwoman|"
            r"councilmember|council member|board of commissioners|board of supervisors|town trustee)")
    place = re.sub(rf"\s+{BODY}\b.*$", "", o, flags=re.I).strip()
    place = re.sub(r"\s+(city|town|village|borough)$", "", place, flags=re.I).strip()
    return "municipal", place, county

kind, place, county = derive(office, county, state)
if kind == "state":
    # HARD STOP: Steps 2-6 DO NOT APPLY to state-level offices. Go directly to Step 7 and
    # write the artifact: found=false, data_quality "not_found", confidence "low",
    # code_source null, verified_evidence notes the office is state-level. Never search.
    ...
# If place is empty, generic, or nothing was stripped (unknown office shape), WebSearch office + state
# to identify the municipality BEFORE anything else; that search counts toward the budget.
FETCHED = {}
