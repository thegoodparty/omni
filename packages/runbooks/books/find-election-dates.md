Recover missing election dates for a list of candidates: dedupe to distinct jurisdictions, seed from election-api where possible, fan out parallel web-research subagents for the rest, verify every source URL returns 200, and emit a sourced date table keyed on the caller's id.

## Prerequisites

**books/.env variables**: `$ELECTION_API_URL` (optional seed step only; e.g. `https://election-api-dev.goodparty.org`)
**scripts/.env variables**: none (election-api is unauthenticated; network-gated only)
**Tools**: `curl`, `jq` (optional election-api seed), `uv` (for `scripts/python/verify_urls.py`), web search of your choice, and the ability to spawn parallel subagents (Agent/Task tool). If you have the `superpowers:dispatching-parallel-agents` skill, use it to structure the fan-out. If the runtime cannot spawn subagents, the research phase degrades to a sequential loop over the same per-jurisdiction brief.
**Inputs**: a list of candidates missing election dates. Each row needs: name, office type (e.g. Mayor, City Council), jurisdiction or city, state, and the caller's own id (the key you map results back onto). Also the target election year (the cycle you are filling). If the year is not supplied and cannot be inferred unambiguously from the request, stop and ask the caller for it before proceeding; do not guess or default to the current calendar year, since the target-year gate in steps 2 and 3 would otherwise misclassify every row.
**Output**: one row per input candidate, keyed on the caller's id, with columns: name, jurisdiction, state, office type, Primary Election Date, General Election Date, Election Date, Source URL, Confidence (high / medium / blank), Status (filled / not_found), Notes. Dates as ISO `YYYY-MM-DD`. Notes carries one line per row; on a not_found row it states why the row is blank (e.g. odd-year cycle, or no authoritative source online), so the not_found list reads as a triageable phone-call queue rather than a column of bare blanks.

## What you need to know about election dates

- **The date is a property of the race, not the candidate.** A jurisdiction sets one election date and every candidate in it shares that date. Search at the jurisdiction grain, never per candidate.
- **Many local elections are fixed by state statute to one uniform date**, so a single authoritative Secretary of State source can validate many jurisdictions at once. Reusable examples: some states hold all city elections at the June state primary; some consolidate municipal elections onto the May primary; some run city elections only in odd years.
- **Nonpartisan single-election municipal races have ONE date.** There is no primary / general split. Put the date in the consolidated Election Date field and leave Primary and General blank. A two-stage partisan race gets a Primary date and a General date.
- **Odd-year vs even-year cycles.** If a candidate's jurisdiction holds no election in the target year, the contact is probably mis-cycled (entered against the wrong cycle). Return not_found. Do not borrow a date from an adjacent year.
- **Tiny jurisdictions are often not online.** A not_found plus a flag to phone the county auditor or city clerk is the correct output. A wrong date is worse than a blank.
- **Confidence tags drive review.** The caller verifies every medium row and every not_found before importing anything downstream, so tag honestly.

## Steps

### 1. Dedupe to distinct (state, jurisdiction)

Collapse the input to distinct (state, jurisdiction) places. Offices within the same municipality (city council, mayor, city commission) almost always share one municipal election date, so a list of dozens of candidates usually collapses to a couple dozen places. Look up once per place, then map the date back to every candidate in that place in step 5.

### 2. Seed from election-api (optional, recommended)

Some dates are only missing from the caller's copy and already exist in election-api (BallotReady-sourced). It is cheap and authoritative, so check it before doing any web research. If you have a candidate slug:

```bash
CANDIDATE_SLUG=        # e.g. jane-doe/north-dakota-...
curl -sS "$ELECTION_API_URL/v1/candidacies?slug=$CANDIDATE_SLUG&includeRace=true" \
  | jq '.[0].Race | {electionDate, isPrimary, isRunoff, partisanType, officeType, officialOfficeName}'
```

If you only have name + state, resolve the slug via the name+state branch of `books/find-opposition-research.md` step 1 (search by state, filter by first and last name, disambiguate by `placeName` if multiple rows match, then re-run the slug query with the chosen slug), then read that candidacy's `.Race.electionDate`.

Any place where a matched race carries an `electionDate` **in the target year** is seeded high-confidence (candidate-specific authoritative data); drop it from the fan-out in step 3. Record its source as `election-api` (BallotReady-sourced data), not a web URL; seed rows are exempt from the step 4 web 200-verify, which applies only to web-researched sources. A matched race whose `electionDate` is **null, or in any year other than the target**, does not count as found and falls through to step 3. This is the same target-year rule step 3 enforces: a different-year `electionDate` usually means you matched a past or wrong-cycle race record, not the one you are filling, so a stale date never gets seeded as truth. election-api also misses small, independent, and late-filed local races entirely, so expect the small-town long tail to fall through. That tail is exactly what the web-research phase is for.

### 3. Fan out parallel web-research subagents, batched by state / jurisdiction

The remaining places are independent, so research them concurrently. Batch them (for example one subagent per state, or per 3 to 5 jurisdictions) and dispatch all subagents in a single turn. Each subagent starts cold with no shared context, so its brief must carry everything it needs.

**Per-subagent brief (fill in per batch):**

- **Scope:** the list of (state, jurisdiction, office types) it owns, and the target election year.
- **Job:** for each jurisdiction, find the target-year election date(s) from an authoritative source.
- **Source priority:** (1) the state Secretary of State election calendar, (2) the county auditor / clerk or board of elections, (3) an official sample ballot, (4) Ballotpedia or a reputable local-news notice of election. Prefer official `.gov`.
- **Hard rules (enforce inside the subagent):**
  - Cite a source URL for every date. No URL means it does not count as found.
  - The date must fall in the target calendar year. Reject any other-year date. If the only election you can find for a jurisdiction is in another year, return not_found and note the year you saw (a likely cycle mismatch).
  - Do not guess and do not infer from a similar jurisdiction. If no authoritative target-year date is verifiable, return not_found.
  - A single nonpartisan municipal election with no stage label goes in Election Date. A two-stage partisan race fills Primary and General.
  - Confidence: `high` = official `.gov` source. `medium` = a reputable secondary source (Ballotpedia, local news), or a date that rests only on a statewide statutory date with no jurisdiction-specific confirmation. Leave blank for not_found.
  - Never cite: aggregator pages that return 200 but are machine-generated, PR-wire or self-published release pages, or LinkedIn. Same source discipline as `books/find-opposition-research.md`.
- **Verify URLs inside the subagent** (so verification parallelizes too):

```bash
cd scripts/python
uv run python verify_urls.py <url1> <url2> ...   # or: ... < urls.txt
# keep only rows where ok == true; if a URL redirected, use final_url
# unless the redirect only appended tracking query params
```

- **Return contract (one object per jurisdiction):**

```json
{
  "state": "North Dakota",
  "jurisdiction": "Example City",
  "primary_date": null,
  "general_date": null,
  "election_date": "2026-06-09",
  "source_url": "https://...verified-200...",
  "confidence": "high | medium | null",
  "status": "filled | not_found",
  "note": "one line on what the source said and any cycle caveat"
}
```

On a `not_found` row, set `status` to `not_found` and leave `confidence` and the three date fields `null` (rendered as blank in the emitted output table).

### 4. Collect and run a final verification audit

Gather every subagent's rows. Each subagent already verified its own URLs, so this is a fast sanity check, not a re-run. Concatenate every cited `source_url` and re-run the verifier once:

```bash
cd scripts/python
uv run python verify_urls.py < all_source_urls.txt > url_status.json
jq '[.[] | select(.ok == false)]' url_status.json   # must be empty
```

Drop or re-source any citation that is not 200 before emitting.

### 5. Map dates back to all candidates and emit the table

Expand each (state, jurisdiction) result back onto every input candidate in that place. Council and mayor in the same town get the same municipal date unless a source says otherwise. Emit one row per input candidate keyed on the caller's id, with the output columns from Prerequisites. Carry each jurisdiction's `note` from the step 3 return contract (or the seed step) into the Notes column rather than dropping it, so a not_found row records its reason (odd-year cycle, no online source); the caller reviews every not_found, and the reason is what makes that queue triageable.

Then print a short summary: filled vs not_found counts, the breakdown by state, and the list of jurisdictions still not_found. The not_found list is the phone-call queue (county auditor or city clerk).

## Data-quality bar (must follow)

- Accuracy over coverage: a wrong date is worse than a blank one. Anything downstream (a CRM import, a mailing) treats a populated date as truth.
- Every web-researched date has a 200-verified source URL; a date seeded from election-api records its source as `election-api` instead (there is no web URL to verify). Every populated date carries a confidence tag.
- Dates are in the target year only.
- not_found is a valid and expected outcome. Do not fill it to improve coverage.
- The caller reviews every medium row and every not_found before importing anything downstream. The confidence tags exist to route that review.
- Plain, direct U.S. English in any output prose. No em dashes.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| State SoS lists one statutory election date, but a city votes on a different day | Home-rule / charter cities can set their own date | Treat the statewide date as medium until a jurisdiction-specific `.gov` source (county auditor, city clerk, sample ballot) confirms it. Verify per town for charter cities |
| A jurisdiction has no election in the target year | Odd-year vs even-year municipal cycle | Return not_found and flag the contact as likely mis-cycled. Do not borrow a date from an adjacent year |
| A tiny town has no election info online | Very small jurisdictions do not publish online | Return not_found plus a "call the county auditor / city clerk" flag. A blank beats a guess |
| A source returns 200 but is machine-generated or an aggregator | Auto-generated per-candidate stubs and data aggregators verify clean but are not authoritative | Do not cite. Use an official `.gov` page or a named reputable source. Same rule as `find-opposition-research.md` |
| LinkedIn or a PR-wire page is the only "source" | These are not election authorities | Never cite them for an election date |
| election-api returns the race but `electionDate` is null | BallotReady has the race but not the date for this local contest | Does not count as found. Route the jurisdiction to the web-research fan-out in step 3 |
| election-api seed `electionDate` is in a year other than the target | You matched a past-cycle or wrong-cycle race record | Do not seed it. The step 2 target-year gate drops any non-target-year date and routes the jurisdiction to the web-research fan-out |
| Two offices in one town return different dates | One is a special election, or a primary vs general stage was conflated | Re-check the source. Regular municipal council and mayor share the regular municipal date; a differing date usually means a special election or a misread stage |
