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
- **Never make a direct network call from Python or the shell** — `urllib`/`urllib.request.urlopen`, `requests`, `httpx`, `curl`, `wget`, raw `socket`. The container has NO egress; these do not fail fast, they **HANG ~30s+ each and burn the time budget**. The ONLY way to reach a URL is `pmf_runtime.http.head` / `.get` / `.download` (broker-proxied). If you catch yourself importing `urllib` or `requests`, STOP and use `pmf_runtime.http`.
- **Do NOT call election-api or any other internal API.** The runner has no direct internet egress and cannot reach election-api. The opponent roster is already in `PARAMS.opponents`. Web search + `pmf_runtime.http` are your only outside-world tools.
- **The only PUBLISHED artifact is `/workspace/output/opposition_research.json`.** The runner publishes nothing else. You may write intermediate per-opponent fragments to `/workspace/scratch/` (see Step 3) — that directory is scratch space, never published.
- **Run `python3 /workspace/validate_output.py` before declaring success.** In-loop validation lets you fix violations cheaply; the runner-level validator rejects the artifact post-hoc if you skip it.

## Steps

### Step 1 — Discover late filers via web search and merge

The seed roster in `PARAMS.opponents` is authoritative for known filers but lags reality: late filers, write-ins, and especially independents are often missing. Do discovery in **ONE upfront pass, BEFORE you research anyone** — run AT MOST 2 WebSearch queries, finalize the full opponent list, then never return to discovery. Dispatching researchers, then discovering more, then dispatching again serializes the run and is the #1 cause of slow runs — do not do it.

- `candidates running for <office_name> <state> <electionDate>`
- `<office_name> candidates <election year>` and a ballot-info variant, e.g. `<state> sample ballot <office_name> <year>`

Prefer official sources for the roster: the county / state board of elections, the local clerk's sample ballot, Ballotpedia's race page, recent local news race previews.

**The race MUST line up. A wrong-race candidate is far worse than a missed late filer.** `PARAMS` defines the EXACT race: `office_name` + jurisdiction + `electionDate`. Before adding ANY web-found name, all three must be confirmed:
- **Same office** — must match `office_name`, not just the same city or office *type*. "City Council" ≠ "Government Study Commission" ≠ "Mayor". An office mismatch is the most common error; reject it.
- **Same jurisdiction** (city / district / subarea) and **same `electionDate`**.
- **Found on an authoritative roster** — county/state board of elections, the clerk's sample ballot, or Ballotpedia's race page for THIS office. A stray news mention is not enough.

**Default-drop on ambiguity:** if you cannot positively confirm all three from an authoritative source, DROP the name. Do not add unconfirmed candidates.

**Hard cap:** the final opponent list (seed + confirmed web adds) must not exceed **20**. The seed roster is authoritative — keep ALL seed opponents (a large race can legitimately have 11+ filers; research every one). The cap guards against discovery pollution, not against a genuinely large seed roster: **web search may add AT MOST 3 names beyond the seed**; if you found more web candidates, keep the 3 best-confirmed and stop. If the seed roster ITSELF exceeds 20, research the first 20 in roster order.

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

Per-opponent web research is the slow part, and opponents are independent. **Treat each same-ballot opponent (`crossPrimary == false`) as one independent research unit.** The harness gives you a `researcher` subagent and lets you dispatch several concurrently via the `Agent` tool — dispatch up to 20 at once (one research unit per opponent; dispatch ALL same-ballot opponents in a single turn per Step 3's dispatch rule), then collect. Cross-primary candidates get no research unit and no enriched entry; they appear only in the Step 5 closing note.

**Write the shared researcher brief ONCE, then dispatch SHORT pointers — do NOT re-author a full prompt per opponent (that is the single biggest wall-clock waste).** Write the entire per-unit brief below (the bullets in this step, verbatim, with `<OPPONENT>`/`<SEED>` as placeholders) ONE time to `/workspace/scratch/researcher_brief.md`. Then dispatch each same-ballot researcher with a TINY `Agent` prompt — only the per-opponent slot, not the rules:

```
Read /workspace/scratch/researcher_brief.md — that is your full brief, follow it exactly.
Your assigned opponent: <full name>. Seed data: <the opponent's seed JSON>. Your index: NN.
Write your result to /workspace/scratch/opp_NN.json and return only the line "opp_NN written".
```

Emit ALL N of these short `Agent` calls in a SINGLE assistant turn, back to back, with no reasoning between them. Authoring N short pointers costs a fraction of authoring N full prompts, and the brief file means every researcher still gets the complete rules. The researcher's own base prompt already tells it to verify URLs with `pmf_runtime.http.head` — the brief adds the opposition-research specifics (output contract, format).

**Each research unit (whether dispatched as a subagent or run inline) does exactly this, self-contained:**

- **Identity + context:** the opponent's full name, plus `office_name` (the readable one, NOT a BallotReady normalization), `state`, election date.
- **Seed data for this opponent:** `party`, `isIncumbent`, `websiteUrl`, `urls[]`, `about`, `source`. Facts already in the seed (party, incumbency, the `about` bio) are citeable as "GoodParty.org Data".
- **Job (keep it tight — this is per-opponent and runs N-way, so wasted calls multiply):** run **AT MOST 2 `WebSearch` queries** for this one person (`"<full name>" <office_name> <state>` and a `campaign`/`candidate` variant). **If the discovery pass (Step 1) already surfaced this person with concrete facts (e.g. vote count, incumbency, role) in its snippets, pass those facts into the research unit and have it run just ONE confirming `WebSearch`** — a second query on someone already well-characterized is wasted time on the critical path, since the slowest research unit gates the whole fan-out. Reserve the second query for thinly-sourced opponents. **Pull the 2-3 sentence profile and 2-3 facts from the SEARCH-RESULT SNIPPETS themselves — do NOT fetch or render pages just to extract facts.** Only escalate to fetching a page body (`http.get`, browser, last resort) if a specific claim genuinely cannot be confirmed from snippets. Capture the campaign/social/news URLs worth citing from the results.
- **The research unit must NEVER name the candidate you write for (`PARAMS.candidate_name`).** Each unit describes ONLY its one opponent. If a search snippet mentions the candidate alongside the opponent, do not carry that name into the `summary` or `facts`. Naming the candidate forces a costly clean-up round-trip during assembly — prevent it at the source by telling each research unit, in its prompt, that the candidate's name must not appear in its output at all.
- **Source rules (enforce):**
  - Prefer: official government pages (city/county/state), major news outlets (AP, Reuters, local NPR, regional papers of record), the candidate's own campaign site, Wikipedia only as a secondary source.
  - Avoid / never cite: aggregator sites with stale data; opinion blogs with no named author; LLM-generated summary pages and auto-generated fact-check/aggregator stubs (they return 200 but are machine-generated); PR-wire and self-published press-release sites (`pr.com`, PRNewswire, EIN Presswire — paid placements, not reporting). If a platform claim only appears on a PR wire, attribute it as "according to the candidate's own announcements" rather than citing the wire as fact.
  - Ground every fact in a real result. Do not infer or invent. If nothing is findable beyond the name, return `no_info: true`.
- **Verify URLs inside the research unit with `pmf_runtime.http.head(url)`** (the cheap, non-browser check — see the escalation ladder in CRITICAL RULES): drop any URL whose `r["status"] != 200`; if it redirected, cite `r["final_url"]`. Only if `head` returns 403/405 on a site you believe is real should you escalate to `http.get(url)` (browser). **NEVER verify with `curl`, `wget`, `requests`, `httpx`, or `urllib`** — the container has no egress and each HANGS ~30s+ before failing, multiplied across every URL in every unit. `pmf_runtime.http.head` is the ONLY verification call. LinkedIn URLs almost never verify for non-authenticated bots — drop them. The URLs you return are now considered verified; the parent will NOT re-verify them.
- **When you author each subagent's prompt, COPY the verification rule into it verbatim:** "Verify URLs with `pmf_runtime.http.head(url)` only. Never use curl/wget/requests/urllib — they hang in this container." A subagent that improvises `curl` is the #1 cause of a research unit running for minutes instead of seconds.
- **If you cannot confirm an opponent in your 1-2 searches, return `no_info: true` immediately — do NOT keep searching or escalate to browser/curl to chase a name that may not exist.** A mismatched or low-coverage name (e.g. a seed name not found on the ballot) must bail fast; a research unit that flails on an unconfirmable name gates the entire fan-out.
- **Each research unit also formats its OWN markdown block.** This is the single biggest assembly speedup: per-opponent formatting is the slow serial step when the parent does it for all N at the end, so push it into the parallel units. The unit returns a `markdown_block` string — the fully-formatted, final bullet for THIS opponent, following the exact template in Step 5, with every global rule already applied (refer to the campaign owner as "you" and NEVER name `PARAMS.candidate_name`; no em dashes; for a nonpartisan race the party line reads `Nonpartisan (race is nonpartisan)`; only 200-verified URLs; if `no_info`, the block is the single "No public information found as of <today's date>." line under the opponent's name). The parent will concatenate these blocks verbatim — it will NOT re-format, re-summarize, or re-verify them, so the block must be publish-ready.
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
    "no_info": false,
    "markdown_block": "- Jane Doe\n  - Party affiliation: ...\n  - Incumbent: ...\n  - Political summary: ...\n    - fact ([source](url))\n  - Websites found:\n    - https://..."
  }
  ```
  An opponent with nothing found returns `{"full_name": "...", "incumbent": "Unknown", "summary": null, "facts": [], "websites": [], "no_info": true, "markdown_block": "- <full name>\n  - No public information found as of <today's date>. You should conduct local research."}`. Map `isIncumbent`: `true` -> "Yes", `false` -> "No", `null` -> "Unknown".
- **The brief (`researcher_brief.md`) must include the exact Step 5 per-opponent template and the global format rules**, and require `markdown_block` in the written fragment. A block that is already publish-ready is what lets assembly be a pure concatenation.
- **Each research unit WRITES ITS RESULT TO A FILE instead of returning it inline.** Before dispatching, `mkdir -p /workspace/scratch` and assign each same-ballot opponent a zero-padded index NN in original opponent order (01, 02, 03, ...). Each unit writes its complete return-contract JSON object (all fields incl. `markdown_block`) to `/workspace/scratch/opp_<NN>.json` and returns ONLY the line `opp_<NN> written` — NOT the JSON. This keeps the parent's context lean (it never re-reads N full blobs) and lets assembly be a single deterministic merge over the files.

After all units return, the fragments are on disk at `/workspace/scratch/opp_*.json`, one per same-ballot opponent. You will merge them in Step 5 with ONE script — do not read them turn-by-turn.

**Sequential fallback:** if no subagent dispatch is available, run the exact same per-opponent brief sequentially — loop over the same-ballot opponents, doing one's `WebSearch` + `pmf_runtime.http` URL verification before the next, producing the same return-contract JSON per opponent. The output is identical; only the wall-clock time differs.

### Step 4 — Final verification audit

**TRUST the research units — do NOT re-verify what they already checked.** Each unit verified its own URLs with `http.head` and returned only 200 URLs. The default audit is a pure **in-memory** dedupe/sanity pass: collect every cited URL into a set, drop exact duplicates, confirm each came from a unit that returned it as 200. Do NOT loop a network check over all cited URLs as a matter of course — that adds a full round-trip batch on the critical path for URLs already known-200.

**Verify each unique URL AT MOST ONCE.** Within a research unit and across the whole run, never run `http.head` twice on the same URL — dedupe your URL set first, then check each once. Re-checking the same batch (e.g. verifying an opponent's URLs, then verifying an overlapping set again) is wasted time on the critical path and a common slow-down.

If you DO have a concrete reason to re-check a specific URL (a unit's return looked malformed, or you gathered a new URL yourself during assembly), verify it with **`pmf_runtime.http.head(url)` and NOTHING ELSE.** Verification is ALWAYS `http.head`. **NEVER use `curl`, `wget`, `requests`, `httpx`, or `urllib` to check a URL** — the container has no egress, so each of those HANGS ~30s+ before failing and torches the time budget. If you catch yourself typing `curl` in a Bash command to check a status code, STOP and use `pmf_runtime.http.head` instead. Never `http.get` (browser) here. Drop any URL that is not 200 before assembling Step 5. The published section contains only 200-verified URLs.

### Step 5 — Assemble the output

**Assembly is ONE command — do NOT write a merge script, regenerate, re-summarize, re-verify, or hand-compose.** A ready-made merge script `/workspace/assemble.py` is provided for you. The research units already wrote publish-ready fragments to `/workspace/scratch/opp_*.json`. To assemble:

1. (Only if a cross-primary closing note applies — see glue rules below) write the note text to `/workspace/scratch/_closing_note.txt`. For a nonpartisan race there is no closing note; skip this.
2. Run **`python3 /workspace/assemble.py`** once. It reads the fragments + `PARAMS_JSON`, concatenates each fragment's `markdown_block` under the `### Opposition Research` header (plus the closing note if present), builds `opponents` (without `markdown_block`), sets `race.{office_name,state,partisanType,opponent_count}` and `generated_at`, writes `/workspace/output/opposition_research.json`, and runs the spot-checks (candidate name absent, no em dash, opponent_count matches, nonpartisan party lines) — printing a PASS/FAIL block and exiting non-zero on FAIL.
3. Run **`python3 /workspace/validate_output.py`** once.

Do NOT run WebSearch, `http.head`, or `http.get` here, and do NOT read the fragments turn-by-turn. If `assemble.py` reports a FAILED spot-check, open the offending `/workspace/scratch/opp_<NN>.json` fragment, fix its text in place (no network, no regeneration), and re-run `assemble.py`.

For the empty/uncontested cases (zero fragments, or your-primary-uncontested), `assemble.py` emits the standard uncontested line automatically when there are no same-ballot fragments. The cross-primary closing note (rare; only partisan primaries) is the one piece you supply via `_closing_note.txt`.

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

**Websites found line:** include only campaign and social URLs (campaign site, Facebook, Instagram, X, official campaign LinkedIn). Drop URLs from `urls[]` that are not campaign assets — an employer or government-office page is not an opposition website. Use the verified URL from Step 4; if it redirected, cite `r["final_url"]` (the `http.head` redirect key — `source_url` only exists on `http.get`/browser results). If an opponent has no verifiable campaign or social site, write exactly one bullet: `No campaign or social websites found as of <today's date>.`

If no opponent information is found for a given candidate (`no_info: true`), write: `No public information found as of <today's date>. You should conduct local research.`

**Empty-field handling — evaluate in this order:**
1. **Race uncontested** (merged list has zero opponents — both seed roster and web search found only the candidate): write `No opponents are currently registered for this race as of <today's date>. Continue to monitor, since filing windows may still be open.`
2. **Your primary uncontested** (merged list has opponents, but every one is `crossPrimary == true`): write `No opponents are currently registered in your <party> primary as of <today's date>. Continue to monitor, since filing windows may still be open.` then add the cross-primary closing note below.
3. **Otherwise**: render each opponent where `crossPrimary == false` in the standard format above. Cross-primary candidates get no enriched entry — they appear only in the closing note count.

**Cross-primary closing note** (whenever Step 2 tagged >= 1 cross-primary candidate):
- N = 1: `Note: 1 additional candidate is running in a different partisan primary for this seat and would only become an opponent at the general election.`
- N > 1: `Note: <N> additional candidates are running in different partisan primaries for this seat and would only become opponents at the general election.`

Then build the JSON artifact:
- `markdown` — the header + concatenated same-ballot `markdown_block`s (in order) + any closing note. Built by joining, not regenerating.
- `opponents` — the collected per-opponent return-contract objects (`full_name`, `incumbent`, `summary`, `facts`, `websites`, `no_info`), in order, for same-ballot opponents only. Drop the `markdown_block` field from each object here (it lives in the assembled `markdown`, not duplicated per opponent).
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
Validator-passing JSON can still be garbage. Run the spot-check as ONE script that loads the artifact a single time and prints every check at once — do NOT issue a separate `python3 -c` per check (each is a turn with inference between it, and the round-trips dominate the assembly phase). Load once, assert all of the following, print a single PASS/FAIL block, then fix and re-run only if something failed:
- **A cited URL doesn't load or doesn't mention the opponent** — don't trust search snippets blindly. If you fetched the body with `pmf_runtime.http.get` during Step 3 (the last-resort case, when snippets were insufficient), confirm the body actually references the person and the claim. If you did NOT fetch the body (the common case — facts came from search snippets), confirm the snippet text you used is reflected in `facts[].text` with a matching source. Do NOT call `http.get` here — Steps 4 and 5 forbid network calls at assembly time.
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
