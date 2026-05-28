Produce a strategic Opposition Research section for a candidate's campaign plan — opponents in the race, party affiliation, incumbent status, 2-3 sentence summary, and vetted source URLs (every URL returns 200).

This is the source runbook — it captures the human-runnable version of the workflow. Once stable, port it into a PMF agent experiment by following `books/convert-runbook-to-experiment.md`. Naming convention: runbook `find-X.md` → experiment `experiments/X/` (kebab-case → snake_case, drop the `find-` prefix).

## Prerequisites

**books/.env variables**: `$ELECTION_API_URL` (e.g. `https://election-api-dev.goodparty.org`)
**scripts/.env variables**: none (election-api is unauthenticated — network-gated only; dev ALB is public)
**Tools**: `curl`, `jq`, `uv` (for `scripts/python/verify_urls.py`), web search of your choice, and the ability to spawn parallel subagents (Agent/Task tool) for the research phase. If the runtime cannot spawn subagents, the research phase degrades to a sequential loop over the same per-opponent brief — see step 4.
**Inputs**: the candidate's slug (preferred) OR state + first/last name. Optionally: the candidate's party affiliation if you can't read it off their candidacy record. The campaign-plan-level numeric context (win number, projected turnout, voter contact goal) is treated as known input; this runbook does not compute it.
**Output**: Markdown `### Opposition Research` section per the spec at the bottom of this file

## What you need to know about the data

The election-api is the canonical source for race + candidates. `GET /v1/candidacies?slug=<candidate-slug>&includeRace=true` returns the full candidacy with a nested `Race` object — that's the only call you need to find the race. Then `GET /v1/candidacies?raceSlug=<Race.slug>&includeRace=true` returns all candidates in matching races.

Three rules that will bite you, learned by testing the live dev API:

1. **`raceSlug` is NOT unique.** `pa/state-representative` matches over 200 distinct races (one per district). Always client-side filter the result by `raceId` to isolate the user's race.
2. **The candidate slug's race-suffix differs from `Race.slug`.** Candidate slug `jordan-harris/pennsylvania-house-of-representatives-district-186` has `Race.slug = "pa/state-representative"`. Don't try to derive raceSlug from the candidate slug — read it off the `Race` object.
3. **Candidacies include the candidate you're writing for.** Filter them out by exact `slug` match — name matching is unreliable (suffixes, middle initials, accented characters).

The candidacy record already includes `party`, `isIncumbent`, `about`, `websiteUrl`, and a `urls[]` array (Facebook / Instagram / LinkedIn / campaign sites).

**Use both sources — neither alone is complete.** election-api (BallotReady-sourced) is the authoritative seed for the race structure and known filers, but it lags reality: late filers, write-ins, and especially independents are often missing or added slowly. Web search catches those. So the opponent list is the **union** of (a) the election-api candidacies and (b) names surfaced by web search for this office + district + election date. Every opponent carries a `source` tag so citations stay honest: election-api facts cite "GoodParty.org Data", web-surfaced facts cite the URL they came from.

## Steps

### 1. Resolve the candidacy → race

If you know the candidate's slug, this is one call:

```bash
CANDIDATE_SLUG=          # e.g. jordan-harris/pennsylvania-house-of-representatives-district-186

curl -sS "$ELECTION_API_URL/v1/candidacies?slug=$CANDIDATE_SLUG&includeRace=true" \
  | jq '.[0] | {
      candidateRaceId: .raceId,
      candidateState: .state,
      candidateParty: .party,
      candidateIsIncumbent: .isIncumbent,
      raceSlug: .Race.slug,
      electionDate: .Race.electionDate,
      isPrimary: .Race.isPrimary,
      isRunoff: .Race.isRunoff,
      partisanType: .Race.partisanType,
      officeType: .Race.officeType,
      officeLevel: .Race.officeLevel,
      officialOfficeName: .Race.officialOfficeName,
      normalizedPositionName: .Race.normalizedPositionName,
      numberOfSeats: .Race.numberOfSeats,
      subAreaName: .Race.subAreaName,
      subAreaValue: .Race.subAreaValue
    }'
```

If you only know name + state, search first:

```bash
CANDIDATE_STATE=NC
FIRST="Aaron"
LAST="McLaughlin"

curl -sS "$ELECTION_API_URL/v1/candidacies?state=$CANDIDATE_STATE" \
  | jq --arg f "$FIRST" --arg l "$LAST" '
      [.[] | select(
        (.firstName | ascii_downcase) == ($f | ascii_downcase) and
        (.lastName  | ascii_downcase) == ($l | ascii_downcase)
      ) | {slug, raceId, placeName}]
    '
```

If multiple rows come back (same name, different races), disambiguate by `placeName` + the race-suffix in the slug. Then re-run the first query with the chosen slug.

Capture these for later steps: `candidateRaceId`, `raceSlug`, `partisanType`, `isPrimary`, `isRunoff`, `numberOfSeats`, `electionDate`, `officeType`, `officialOfficeName`. Three things to watch:

- **Null fields are common.** `numberOfSeats`, `officeType`, `officialOfficeName`, and `isIncumbent` are frequently null. Don't invent values. Map `isIncumbent: null` → "Unknown", `true` → "Yes", `false` → "No" in the output.
- **`officialOfficeName` / `normalizedPositionName` are BallotReady normalizations**, sometimes a generic role label (e.g. "County Executive Head" for a mayor, "City Legislature" for a council). They are NOT good web-search terms. Prefer the human office name from your campaign context input (e.g. "Mayor of Augusta") for searching; fall back to the normalized name only if you have nothing better.
- **`isRunoff: true`** means the field has already narrowed (a primary that advanced to a runoff). Use the standard opponent format in step 6, and let `isRunoff` + `electionDate` inform the summary (it's a runoff, not a first-round contest).
- **If `partisanType` is not available** (e.g. the input is a gp-api campaign context that provides `candidates` but no `Race` object), derive it: county administrative offices (assessor, sheriff, clerk, treasurer), judicial seats, school boards, and most municipal offices are **nonpartisan**; legislative and most state/federal executive seats are **partisan**. When the candidate roster shows a spread of party labels for a county/local administrative office, that's voter-registration data, not the contest — treat the race as nonpartisan. If you can hit election-api for the race, prefer its `partisanType` over inference.

### 2. Build the opponent list from BOTH election-api and web search

The opponent list is the union of two sources. Do part A and part B, then merge.

**Part A — election-api seed.** Pull every candidate in matching races, filter to your race, tag the source:

```bash
RACE_SLUG=             # from step 1, .Race.slug
CANDIDATE_RACE_ID=     # from step 1, .raceId
CANDIDATE_SLUG=        # from inputs

curl -sS "$ELECTION_API_URL/v1/candidacies?raceSlug=$RACE_SLUG&includeRace=true" \
  | jq --arg r "$CANDIDATE_RACE_ID" --arg me "$CANDIDATE_SLUG" '
      [.[]
        | select(.raceId == $r)
        | {slug, firstName, lastName, party, isIncumbent, about, websiteUrl, urls, image,
           isMe: (.slug == $me), source: "election-api"}]
    ' > race_candidates.json

jq 'length' race_candidates.json
jq '[.[] | select(.isMe == false) | {firstName, lastName, party, isIncumbent, slug}]' race_candidates.json
```

URL-encode the slug if it contains slashes (e.g. `pa/state-representative` → `pa%2Fstate-representative`). Most shells and curl handle the bare form fine, but some sites strict-parse.

If part A comes back with **zero rows after the `raceId` filter**, your `Race.slug` is wrong — re-check step 1. (Zero rows is a data error, not an uncontested race; web search in part B will not fix a wrong raceId.)

**Part B — web search discovery.** election-api misses late filers, write-ins, and independents. Search the web for the full field. Run at least two queries, using the human office name + district + election date from step 1:

- `candidates running for <human office> <state> <general election date>`
- `<human office> <district / subAreaValue> candidates <election year>` (and a ballot-info variant, e.g. `<county/city> sample ballot <office> <year>`)

Prefer official sources for the candidate roster: the county / state board of elections, the local clerk's sample ballot, Ballotpedia's race page, and recent local news race previews. From the results, extract every candidate name running for THIS seat in THIS election.

**Merge.** For each name found in part B:

- Skip it if it's the candidate you're writing for (`isMe`), matching loosely (normalize case, strip middle initials / suffixes / accents — name matching across sources is fuzzy).
- Skip it if it already appears in `race_candidates.json` (same fuzzy match) — it's the same person; the election-api row already has richer fields.
- Otherwise append a new opponent row: `{firstName, lastName, party: <if stated, else null>, isIncumbent: null, about: null, websiteUrl: null, urls: [], isMe: false, source: "web", discoverySource: "<url where you found the name>"}`.

Write the merged list back to `race_candidates.json`. Each row now has a `source` of `"election-api"` or `"web"`. Note the merged opponent count (excluding `isMe`) and how many came from each source — you'll need the total for the empty-field logic in step 6, and the `source` per opponent for citations.

**Seed candidates are authoritative filers — keep them even when web search finds nothing.** A name in the election-api seed is a real filing; web silence does not disconfirm it. Such a candidate stays in the list and routes to the "No public information found" line in step 6. Web search can only ADD opponents or ENRICH existing ones — it never removes a seed candidate. (The one exception is obvious test/junk data — see the failure-modes table.)

If BOTH sources find no opponent other than the candidate, the race is genuinely uncontested as far as you can tell — handle it in step 6.

### 3. Tag cross-primary opponents

In a partisan primary (`partisanType == "partisan"` AND `isPrimary == true`), each party runs its own contest. Opponents in a different party's primary are not actual contestants until the general election:

```bash
CANDIDATE_PARTY=       # from step 1

jq --arg p "$CANDIDATE_PARTY" '
  [.[] | select(.isMe == false) | . + {
    crossPrimary: (
      ($p != "Nonpartisan") and
      (.party != $p) and
      (.party != "Nonpartisan") and
      (.party != null)
    )
  }]
' race_candidates.json > opponents.json

jq '[.[] | {firstName, lastName, party, crossPrimary}]' opponents.json
```

If `partisanType == "nonpartisan"` for the race, every opponent contests on the same ballot — `crossPrimary` is meaningless and you should drop party labels from the output.

Web-surfaced opponents (`source == "web"`) often have `party: null`. The jq above leaves them `crossPrimary: false`, so they are treated as same-ballot opponents and get enriched in step 4 — which is what you want (an opponent you can't yet classify is still an opponent to research). If web search told you their party, set it; otherwise leave it null and the output will show "Unknown".

### 4. Research opponents in parallel — fan out one subagent per opponent

Per-opponent web research is the slow part of this workflow, and the opponents are independent. **Fan out: spawn one research subagent per opponent, all in a single batch, and let them run concurrently.** Total research time drops from N opponents to roughly one. The orchestrator (you) does not do the searching — it dispatches, then collects.

**Who gets a subagent:** every row in `opponents.json` where `crossPrimary == false` (in a nonpartisan or general-election race, that's all opponents). Cross-primary candidates get no subagent and no enriched entry — they appear only in the step-6 closing note.

**Dispatch:** launch all subagents in one parallel batch (e.g. multiple Agent/Task calls in a single turn). Each is self-contained — it starts cold with no shared context, so its brief must carry everything it needs.

**Per-subagent brief — pass exactly this, filled in per opponent:**

- **Identity:** the opponent's full name, plus the race context: human office name (the readable one, e.g. "Fresno City Council - District 5", NOT the BallotReady normalized label), state, district, general + primary election dates.
- **Seed data for this opponent** (from `opponents.json`): `party`, `isIncumbent`, `websiteUrl`, `urls[]`, `about`, `source`. Facts already present in the seed (party, incumbency, the `about` bio) are citeable as "GoodParty.org Data".
- **Job:** search the web for this one person in this race. Run `"<full name>" <human office name> <state>` and a `campaign`/`candidate` variant. Capture a 2-3 sentence profile, 2-3 key position/background facts, and every campaign/social/news URL worth citing.
- **Source rules (enforce in the subagent):**
  - Prefer: official government pages (city/county/state), major news outlets (AP, Reuters, local NPR, regional papers of record), the candidate's own campaign site, Wikipedia only as a secondary source.
  - Avoid / never cite: aggregator sites with stale data; opinion blogs with no named author; LLM-generated summary pages and auto-generated fact-check/aggregator domains (e.g. `factually.co`-style per-candidate stubs — they return 200 but are machine-generated); PR-wire and self-published press-release sites (`pr.com`, `prdailywire.com`, PRNewswire, EIN Presswire — paid placements, not reporting; if a platform claim only appears on a PR wire, attribute it as "according to the candidate's own announcements" rather than citing the wire as fact).
  - Ground every fact in a real result. Do not infer or invent. If nothing is findable beyond the name, return `no_info: true`.
- **Verify URLs inside the subagent** (so verification parallelizes too): run `verify_urls.py` on every URL it intends to cite or list, drop any that don't return 200, and if a URL redirected, use the `final_url` — UNLESS the redirect only appended tracking query params, in which case keep the clean original URL.

```bash
cd scripts/python
uv run python verify_urls.py <url1> <url2> ...   # or: ... < urls.txt
# keep only rows where ok == true
```

- **Return contract (the subagent must return exactly this JSON):**

```json
{
  "full_name": "Jane Doe",
  "incumbent": "Yes | No | Unknown",
  "summary": "2-3 sentence profile, grounded in verified sources",
  "facts": [
    {"text": "fact phrased in 1-2 sentences", "source_label": "LAist", "url": "https://...verified-200..."}
  ],
  "websites": ["https://...verified-200 campaign or social URL..."],
  "no_info": false
}
```

A subagent that finds nothing returns `{"full_name": "...", "incumbent": "Unknown", "summary": null, "facts": [], "websites": [], "no_info": true}`.

**Collect:** gather every subagent's returned JSON into one list, in the original opponent order. Each entry's URLs are already 200-verified, so the list is publish-ready for step 6.

**No-subagent fallback:** if the runtime can't spawn subagents, run the exact same per-opponent brief sequentially — loop over the opponents, doing one's web search + URL verification before the next, producing the same return-contract JSON per opponent. The output is identical; only the wall-clock time differs.

### 5. Final verification audit

Each subagent already verified its own URLs, so this is a fast sanity check, not a re-run. Concatenate every `url` from every returned `facts[]` and `websites[]` and re-run the verifier once:

```bash
cd scripts/python
uv run python verify_urls.py < all_cited_urls.txt > url_status.json
jq '[.[] | select(.ok == false)]' url_status.json   # must be empty
```

If anything comes back `ok == false` (a subagent slipped, or a page went down between dispatch and now), drop that citation/website from the assembled output before writing step 6. The published section must contain only 200-verified URLs.

### 6. Assemble the output

Format exactly as below. **Do not** include a preamble, title page, or closing summary — only the section. Refer to the candidate as "you", never by name. Use numbers, not words ("50% + 1", not "half"). No em dashes. Wherever the templates below say `<today's date>`, use the current date of the run (e.g. `date +%Y-%m-%d`).

```markdown
### Opposition Research

- [Opponent full name]
  - Party affiliation: [see rule below]
  - Incumbent: [Yes / No / Unknown]
  - Political summary: [2-3 sentence summary, grounded in search results]
    - [Key position or background fact 1] ([source](url))
    - [Key position or background fact 2] ([source](url))
    - [Key position or background fact 3, if available] ([source](url))
  - Websites found:
    - [URL 1, e.g. campaign website]
    - [URL 2, e.g. Facebook account]
    - [URL 3, e.g. Instagram account]
```

**Party affiliation line:**
- Partisan race: the opponent's `party` (e.g. "Democratic", "Republican").
- Nonpartisan race (`partisanType == "nonpartisan"`): write `Nonpartisan (race is nonpartisan)` — do not imply the party label decides the contest.
- Missing / null party in a partisan race: `Unknown`.

**Websites found line:** include only campaign and social URLs (campaign site, Facebook, Instagram, X, official campaign LinkedIn). Drop URLs from `urls[]` that are not campaign assets — BallotReady sometimes includes an employer or government-office page (e.g. a county tax-commissioner page); those are not opposition websites. Use the verified URL from step 5; if it redirected, cite the `final_url`. If an opponent has no verifiable campaign or social site, write exactly one bullet: `No campaign or social websites found as of <today's date>.`

**Runoff race (`isRunoff == true`):** use the standard opponent format above (the field has already narrowed to the runoff contenders). Reference the runoff and `electionDate` in the summary where relevant.

If no opponent information is found for a given candidate, write: `No public information found as of <today's date>. You should conduct local research.`

**Empty-field handling — evaluate in this order:**

1. **Race uncontested** (the merged list from step 2 has zero opponents — both election-api and web search found only the candidate): write `No opponents are currently registered for this race as of <today's date>. Continue to monitor, since filing windows may still be open.`
2. **Your primary uncontested** (merged list has opponents, but every one is `crossPrimary == true`): your own primary has no opponent. Write `No opponents are currently registered in your <party> primary as of <today's date>. Continue to monitor, since filing windows may still be open.` then add the cross-primary closing note below.
3. **Otherwise**: render each opponent where `crossPrimary == false` in the standard format above. Cross-primary candidates get no enriched entry — they appear only in the closing note count.

**Cross-primary closing note** (whenever step 3 tagged ≥1 cross-primary candidate): add a closing line, matching grammar to the count.
- N = 1: `Note: 1 additional candidate is running in a different partisan primary for this seat and would only become an opponent at the general election.`
- N > 1: `Note: <N> additional candidates are running in different partisan primaries for this seat and would only become opponents at the general election.`

## Constraints (must follow)

- Plain, direct U.S. English. No em dashes. No jargon.
- Bullet points are 1-3 sentences each — not fragments, not essays.
- Grounded in what web search actually returned. Do not fabricate names, affiliations, or URLs.
- Produce ONLY the markdown section above. No title page, no intro, no summary after.
- Replace the candidate's name with "you" throughout.
- Numbers, not words: "50% + 1", not "half"; "5× projected turnout", not "five times".
- Be mindful of local election rules: North Dakota has no voter registration; Connecticut has no counties; Louisiana uses a jungle primary; California uses a top-two primary (in nonpartisan county offices the primary can decide the seat outright at 50% + 1, otherwise the top two advance to November regardless of party).
- Every cited URL must have returned HTTP 200 in step 5.

## Glossary (preferred language)

- **registered voters**: total pool of voters eligible to cast a ballot for a race, from the latest voter file.
- **projected voter turnout**: estimated registered voters expected to cast a ballot in this specific election. Historically +/- 1.5% of actual.
- **projected votes needed to win**: 50% + 1 of projected voter turnout.
- **targeted voter contact goal**: total contacts the campaign aims to deliver. Rule of thumb: 5× projected votes needed to win.
- **voter contact**: a contact attempt that reaches an intended voter via a channel capable of conveying the message (delivered text, answered call, in-person conversation).
- **likely votes**: estimated votes on track to receive based on contacts to date. 1 likely vote per 5 voter contacts.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Step 2 returns hundreds of rows even after raceId filter | You forgot the `select(.raceId == $r)` filter | `raceSlug` matches many races (e.g. `pa/state-representative` matches 200+); the raceId filter is mandatory |
| Step 2 returns 0 rows | `Race.slug` was copied wrong, or the slug needs URL encoding | Re-run step 1 and copy `Race.slug` exactly; URL-encode slashes if needed |
| Step 1 search by name returns multiple rows | Same first+last in different places | Disambiguate by `placeName` then re-run with the chosen slug |
| `numberOfSeats`, `officeType`, `officialOfficeName` are null | BallotReady hasn't populated those fields for this race | Mark unknown in output; do not invent. Use `normalizedPositionName` as a fallback display name |
| Candidacies list still includes the candidate you're addressing | You filtered by `firstName + lastName` and missed a suffix / accent | Filter by `slug` exact match (the `isMe` flag in step 2 handles this) |
| `verify_urls.py` flags a URL as 403 / 405 but it works in a browser | Site blocks bot HEAD/GET | Script sends a browser User-Agent and falls back HEAD → GET; if still failing, try the `final_url`, or replace the citation |
| LinkedIn URL returns `999` (or `404` to HEAD) | LinkedIn hard-blocks non-authenticated bots — the browser UA and GET fallback do not defeat it | Drop the citation. LinkedIn URLs in `urls[]` will essentially never verify; don't use them as cited sources |
| All opponents return same party as candidate in a nonpartisan race | `Race.partisanType == "nonpartisan"` — `party` field reflects voter registration, not the contest | Drop party labels from opponent entries; note the race is nonpartisan in your output |
| Web search surfaces a "candidate" who isn't really in this race | Wrong district, a past-cycle candidate, or someone who withdrew | Confirm via an official roster (board of elections / sample ballot) before adding; if you cannot confirm they're on THIS ballot for THIS election, drop them |
| A seed candidate looks like test / junk data (e.g. "Jack Test", an `@goodparty.org` or `+tag` email, placeholder name) | Non-production rows leak into the dataset | Drop obvious test rows from the opponent list. Do not publish them. When unsure, require web confirmation that the person is a real filer before including |

## Promote to a self-service experiment

This runbook is a one-off — you run it manually. Candidates can't run it themselves.

To make it a self-service experiment in the dashboard (gp-webapp AI Insights tab), follow `books/convert-runbook-to-experiment.md`. Naming:

- This runbook: `find-opposition-research.md`
- The PMF experiment: `experiments/opposition_research/` (drop `find-`, kebab → snake)

The translation encodes everything here into:

- `manifest.json` — `input_schema` (campaign_id only; in production gp-api hydrates the rest), `output_schema` (markdown + structured per-opponent fields), scope (`allowed_external_tools: [WebSearch, http]`).
- `instruction.md` — same steps written for the agent, with broker quirks (`pmf_runtime.http` for verification, `WebSearch` for enrichment) called out as CRITICAL RULES.

In the experiment version, the candidate's slug + party come from gp-api `/v1/campaigns/mine` (no human input needed). The campaign-plan numeric context (win number, projected turnout, voter contact goal) is also pulled from gp-api and passed as additional input to the instruction.

**Fan-out is local-only — the experiment runs step 4 sequentially.** The Fargate harness allows a fixed tool set (`Bash, Write, Edit, Glob, Grep, WebSearch` — see `pmf_engine/runner/harness/claude_sdk.py`) with no `Task`/`Agent` spawn surface, so the per-opponent fan-out cannot run there. The experiment uses step 4's sequential fallback (same per-opponent brief, looped). The fan-out stays in this runbook because the local Claude Code runtime DOES have the Task tool. Either way, the per-opponent return-contract JSON is what the experiment's `output_schema` validates against — keep the runbook's contract and the manifest schema in sync.

**URL verification translates, it does not port.** `verify_urls.py` uses the `requests` library; the Fargate runner is in a quarantined, SSRF-guarded network where that won't work. In `instruction.md`, replace it with `pmf_runtime.http.get(url)` and check `r["status"] == 200` (the response is a plain dict — `r["status"]`, not `r.status_code`). Same drop-if-not-200 logic, broker-proxied transport.
