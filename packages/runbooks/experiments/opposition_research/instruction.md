# Opposition Research

Produce a strategic `### Opposition Research` section for a candidate's campaign plan: the opponents in the race, party affiliation, incumbent status, a 2-3 sentence summary, and vetted source URLs (every URL returns HTTP 200). You combine two signals: the seed opponent roster handed to you in params (gp-api hydrated it from election-api before dispatch) and live web search, which catches late filers, write-ins, and independents the seed roster misses.

## BEFORE YOU START
1. Read this entire instruction end-to-end before executing anything.
2. Maintain a TodoWrite list mirroring the TODO CHECKLIST below.
3. Your params are in the `PARAMS_JSON` env var. Read them once at the top.
4. Write the final artifact to `/workspace/output/opposition_research.json` and nowhere else.
5. Run `python3 /workspace/validate_output.py` before declaring success.
6. Perform the spot-check at the bottom. Validator-passing data can still be garbage.

## TODO CHECKLIST
1. Read `PARAMS_JSON`: `candidate_name`, `office_name`, `state`, `electionDate`, `partisanType`, `isPrimary`, `opponents[]`.
2. Web-search to discover late filers and merge them into the opponent list (Step 1).
3. Tag cross-primary opponents (Step 2).
4. Research each same-ballot opponent as an independent research unit (Step 3, the fan-out).
5. Final URL audit across every cited URL (Step 4).
6. Assemble the exact markdown section (Step 5).
7. Write `/workspace/output/opposition_research.json` and validate.

## CRITICAL RULES
- **Web access escalation ladder — cheapest tool that answers the question, in this order. Do NOT jump straight to the browser.**
  1. **`WebSearch`** (free, fast) — discover candidates, URLs, and facts. The result snippets are often enough on their own; only fetch a page when you need to confirm a specific claim against its body.
  2. **`pmf_runtime.http.head(url)`** — VERIFY a URL is live before citing it. This is a plain, non-browser status check (no Chromium render) and is the default for verification. Returns a plain dict `{"status": int, "final_url": str}` — use `r["status"]`, drop the URL if it is not 200, and cite `r["final_url"]` if it redirected.
     ```python
     from pmf_runtime import http
     r = http.head("https://example.com/article")   # {"status": 200, "final_url": "https://..."}
     if r["status"] != 200:
         pass  # not 200 -> see escalation below
     ```
  3. **`pmf_runtime.http.get(url)`** — the **browser render (Chromium), LAST RESORT.** Use it only when (a) `head` returned **403/405** on a site you believe is real (Cloudflare-style bot protection a bare request can't pass — the browser defeats it), or (b) you must read the page **body** to confirm a claim. `get` returns `{"status", "body", "source_url", ...}`; use `r["status"]`/`r["source_url"]`, never `.status_code`. It is ~100x slower than `head`, so reserve it.
- **Never use `WebFetch`** — the runner's quarantined network can't reach its domain-safety check; it always fails. Discover with `WebSearch`, verify with `http.head`, render with `http.get` only when forced.
- **Do NOT call election-api or any other internal API.** The runner has no direct internet egress and cannot reach election-api. The opponent roster is already in `PARAMS.opponents`. Web search + `pmf_runtime.http` are your only outside-world tools.
- **Write only to `/workspace/output/opposition_research.json`.** The runner publishes nothing else.
- **Run `python3 /workspace/validate_output.py` before declaring success.** In-loop validation lets you fix violations cheaply; the runner-level validator rejects the artifact post-hoc if you skip it.

## Steps

### Step 1 — Discover late filers via web search and merge

The seed roster in `PARAMS.opponents` is authoritative for known filers but lags reality: late filers, write-ins, and especially independents are often missing. Search the web for the full field using the human office name (`PARAMS.office_name`), state, and election date. Run at least two queries:

- `candidates running for <office_name> <state> <electionDate>`
- `<office_name> candidates <election year>` and a ballot-info variant, e.g. `<state> sample ballot <office_name> <year>`

Prefer official sources for the roster: the county / state board of elections, the local clerk's sample ballot, Ballotpedia's race page, recent local news race previews.

**The race MUST line up. A wrong-race candidate is far worse than a missed late filer.** `PARAMS` defines the EXACT race: `office_name` + jurisdiction + `electionDate`. Before adding ANY web-found name, all three must be confirmed:
- **Same office** — must match `office_name`, not just the same city or office *type*. "City Council" ≠ "Government Study Commission" ≠ "Mayor". An office mismatch is the most common error; reject it.
- **Same jurisdiction** (city / district / subarea) and **same `electionDate`**.
- **Found on an authoritative roster** — county/state board of elections, the clerk's sample ballot, or Ballotpedia's race page for THIS office. A stray news mention is not enough.

**Default-drop on ambiguity:** if you cannot positively confirm all three from an authoritative source, DROP the name. Do not add unconfirmed candidates.

**Hard cap:** the final opponent list (seed + confirmed web adds) must not exceed **12**. If you somehow exceed it, you are pulling in the wrong race — re-check the office match.

**Merge rules:**
- Skip any name that is the candidate you write for (`PARAMS.candidate_name`), matching loosely (normalize case, strip middle initials / suffixes / accents).
- Skip any name already in `PARAMS.opponents` (same fuzzy match) — the seed row already has richer fields.
- Otherwise, ONLY if it passed the race-match gate above, append a new opponent: `{firstName, lastName, party: <if stated, else null>, isIncumbent: null, about: null, websiteUrl: null, urls: [], source: "web", discoverySource: "<authoritative-roster url confirming this office+jurisdiction+date>"}`.

**Seed candidates are authoritative filers — keep them even when web search finds nothing.** A name in the seed roster is a real filing; web silence does not disconfirm it. Such a candidate stays in the list and routes to the "No public information found" line in Step 5. Web search can only ADD or ENRICH opponents — never remove a seed candidate. The one exception is obvious test/junk data (placeholder names like "Jack Test", `@goodparty.org` / `+tag` emails): drop those.

If BOTH the seed roster and web search find no opponent other than the candidate, the race is uncontested as far as you can tell — handle it in Step 5.

### Step 2 — Tag cross-primary opponents

In a partisan primary (`partisanType == "partisan"` AND `isPrimary == true`), each party runs its own contest. An opponent in a different party's primary is not an actual contestant until the general election. Tag each opponent:

```
crossPrimary = (partisanType == "partisan")
               and (isPrimary == true)
               and (opponent.party is not null)
               and (opponent.party != "Nonpartisan")
               and (opponent.party != candidate_party)
```

You may not be given the candidate's own party. If you cannot determine it, treat every opponent as same-ballot (`crossPrimary = false`).

**If `partisanType == "nonpartisan"`** (the expected case for offices like a city government study commission): every opponent contests on the same ballot. `crossPrimary` is meaningless — set it false for all, and DROP party labels from the output (use the nonpartisan party line in Step 5). For a nonpartisan race all listed opponents are real opponents; there is no cross-primary set.

Web-surfaced opponents (`source == "web"`) often have `party: null`. Leave them `crossPrimary = false` — an opponent you cannot classify is still an opponent to research; the output shows "Unknown".

### Step 3 — Research each opponent (the fan-out unit)

Per-opponent web research is the slow part, and opponents are independent. **Treat each same-ballot opponent (`crossPrimary == false`) as one independent research unit.** The harness gives you a `researcher` subagent and lets you dispatch several concurrently via the `Agent` tool — dispatch up to 6 at once, one research unit per opponent, then collect. Cross-primary candidates get no research unit and no enriched entry; they appear only in the Step 5 closing note.

**Each research unit (whether dispatched as a subagent or run inline) does exactly this, self-contained:**

- **Identity + context:** the opponent's full name, plus `office_name` (the readable one, NOT a BallotReady normalization), `state`, election date.
- **Seed data for this opponent:** `party`, `isIncumbent`, `websiteUrl`, `urls[]`, `about`, `source`. Facts already in the seed (party, incumbency, the `about` bio) are citeable as "GoodParty.org Data".
- **Job:** `WebSearch` for this one person in this race. Run `"<full name>" <office_name> <state>` and a `campaign`/`candidate` variant. Capture a 2-3 sentence profile, 2-3 key position/background facts, and every campaign/social/news URL worth citing.
- **Source rules (enforce):**
  - Prefer: official government pages (city/county/state), major news outlets (AP, Reuters, local NPR, regional papers of record), the candidate's own campaign site, Wikipedia only as a secondary source.
  - Avoid / never cite: aggregator sites with stale data; opinion blogs with no named author; LLM-generated summary pages and auto-generated fact-check/aggregator stubs (they return 200 but are machine-generated); PR-wire and self-published press-release sites (`pr.com`, PRNewswire, EIN Presswire — paid placements, not reporting). If a platform claim only appears on a PR wire, attribute it as "according to the candidate's own announcements" rather than citing the wire as fact.
  - Ground every fact in a real result. Do not infer or invent. If nothing is findable beyond the name, return `no_info: true`.
- **Verify URLs inside the research unit with `pmf_runtime.http.head(url)`** (the cheap, non-browser check — see the escalation ladder in CRITICAL RULES): drop any URL whose `r["status"] != 200`; if it redirected, cite `r["final_url"]`. Only if `head` returns 403/405 on a site you believe is real should you escalate to `http.get(url)` (browser). LinkedIn URLs almost never verify for non-authenticated bots — drop them. The URLs you return are now considered verified; the parent will NOT re-verify them.
- **Return contract (exactly this shape per opponent):**
  ```json
  {
    "full_name": "Jane Doe",
    "incumbent": "Yes | No | Unknown",
    "summary": "2-3 sentence profile, grounded in verified sources",
    "facts": [
      {"text": "fact in 1-2 sentences", "source_label": "LAist", "url": "https://...verified-200..."}
    ],
    "websites": ["https://...verified-200 campaign or social URL..."],
    "no_info": false
  }
  ```
  An opponent with nothing found returns `{"full_name": "...", "incumbent": "Unknown", "summary": null, "facts": [], "websites": [], "no_info": true}`. Map `isIncumbent`: `true` -> "Yes", `false` -> "No", `null` -> "Unknown".

Collect every research unit's JSON into one list in original opponent order.

**Sequential fallback:** if no subagent dispatch is available, run the exact same per-opponent brief sequentially — loop over the same-ballot opponents, doing one's `WebSearch` + `pmf_runtime.http` URL verification before the next, producing the same return-contract JSON per opponent. The output is identical; only the wall-clock time differs.

### Step 4 — Final verification audit

**TRUST the research units — do NOT re-verify what they already checked.** Each unit verified its own URLs with `http.head` and returned only 200 URLs. Re-fetching all of them on the main agent is the single biggest time sink and is forbidden as a default. This audit is a cheap **`http.head`** dedupe/sanity pass, not a re-run:

```python
from pmf_runtime import http
for url in all_cited_urls:        # the already-verified URLs the units returned
    r = http.head(url)            # cheap, non-browser; NOT http.get
    if r["status"] != 200:
        pass  # rare (page went down since research) -> drop that citation/website
```

Use `http.head` only — never re-render with `http.get` here. Drop any URL that is now not 200 before assembling Step 5. The published section must contain only 200-verified URLs.

### Step 5 — Assemble the output

Format the `markdown` field exactly as below. **Do not** include a preamble, title page, or closing summary — only the section. Refer to the candidate as "you", never by name. Use numbers, not words ("50% + 1", not "half"). No em dashes. Wherever the template says `<today's date>`, use the current date of the run (YYYY-MM-DD).

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

**Websites found line:** include only campaign and social URLs (campaign site, Facebook, Instagram, X, official campaign LinkedIn). Drop URLs from `urls[]` that are not campaign assets — an employer or government-office page is not an opposition website. Use the verified URL from Step 4; if it redirected, cite `r["source_url"]`. If an opponent has no verifiable campaign or social site, write exactly one bullet: `No campaign or social websites found as of <today's date>.`

If no opponent information is found for a given candidate (`no_info: true`), write: `No public information found as of <today's date>. You should conduct local research.`

**Empty-field handling — evaluate in this order:**
1. **Race uncontested** (merged list has zero opponents — both seed roster and web search found only the candidate): write `No opponents are currently registered for this race as of <today's date>. Continue to monitor, since filing windows may still be open.`
2. **Your primary uncontested** (merged list has opponents, but every one is `crossPrimary == true`): write `No opponents are currently registered in your <party> primary as of <today's date>. Continue to monitor, since filing windows may still be open.` then add the cross-primary closing note below.
3. **Otherwise**: render each opponent where `crossPrimary == false` in the standard format above. Cross-primary candidates get no enriched entry — they appear only in the closing note count.

**Cross-primary closing note** (whenever Step 2 tagged >= 1 cross-primary candidate):
- N = 1: `Note: 1 additional candidate is running in a different partisan primary for this seat and would only become an opponent at the general election.`
- N > 1: `Note: <N> additional candidates are running in different partisan primaries for this seat and would only become opponents at the general election.`

Then build the JSON artifact:
- `markdown` — the exact section above.
- `opponents` — the collected per-opponent return-contract objects (`full_name`, `incumbent`, `summary`, `facts`, `websites`, `no_info`), in order, for same-ballot opponents only.
- `race` — `{office_name, state, partisanType, opponent_count}` where `opponent_count` is the number of researched (same-ballot) opponents.
- `generated_at` — current ISO 8601 timestamp.

Write it to `/workspace/output/opposition_research.json`.

### Step 6 — Validate

```bash
python3 /workspace/validate_output.py
```

## Constraints (must follow)
- Plain, direct U.S. English. No em dashes. No jargon.
- Bullet points are 1-3 sentences each — not fragments, not essays.
- Grounded in what web search actually returned. Do not fabricate names, affiliations, or URLs.
- Produce ONLY the markdown section in `markdown`. No title page, no intro, no summary after.
- Replace the candidate's name with "you" throughout.
- Numbers, not words: "50% + 1", not "half"; "5x projected turnout", not "five times".
- Be mindful of local election rules: North Dakota has no voter registration; Connecticut has no counties; Louisiana uses a jungle primary; California uses a top-two primary (in nonpartisan county offices the primary can decide the seat outright at 50% + 1, otherwise the top two advance to November regardless of party).
- Every cited URL must have returned HTTP 200 in Step 4.

## Spot-check
Validator-passing JSON can still be garbage. Before declaring success:
- **A cited URL doesn't load or doesn't mention the opponent** — don't trust search snippets blindly. You `pmf_runtime.http.get`'d the page in Step 3/4; confirm the body actually references the person and the claim before citing.
- **Every fact's URL returned 200** in Step 4. If any didn't, the citation must be gone from `markdown` AND from the opponent's `facts`/`websites`.
- **`opponent_count` equals the number of same-ballot opponents you rendered** in `markdown` (excludes cross-primary candidates and you).
- **In a nonpartisan race, no opponent entry shows a real party label** — every party line reads `Nonpartisan (race is nonpartisan)`.
- **The candidate's own name never appears** in `markdown`; it always reads "you".
- **A seed opponent who returned `no_info` still appears** in `markdown` with the "No public information found" line — web silence does not delete a real filer.

## Failure modes
| Symptom | Cause | Fix |
|---|---|---|
| `r.status_code` raises `AttributeError` | `pmf_runtime.http.get` returns a plain dict | Use `r["status"]`, not `.status_code` |
| `WebFetch` returns "Unable to verify if domain X is safe" | Quarantined network can't reach claude.ai's safety check | Discover with `WebSearch`, retrieve/verify with `pmf_runtime.http.get` |
| LinkedIn URL returns 999 or 404 | LinkedIn hard-blocks non-authenticated bots | Drop the citation; never cite a LinkedIn URL |
| All opponents show the candidate's party in a nonpartisan race | `party` reflects voter registration, not the contest | Drop party labels; use the nonpartisan party line |
| A web-surfaced "candidate" isn't really in this race | Wrong district, past cycle, or withdrew | Confirm via an official roster before adding; if you can't confirm they're on THIS ballot for THIS election, drop them |
| A seed opponent looks like test/junk data | Non-production rows leaked into the roster | Drop obvious test rows; do not publish them |
| `No artifact files found in /workspace/output` | Ran out of turns or never wrote the file | Write `/workspace/output/opposition_research.json` early and update it; keep research units tight |
