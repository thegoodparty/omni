# Opponent Data Collection

Collect **as-collected** web data about each opponent in a race. For every opponent you are given, find their Ballotpedia page and their campaign website, fetch each through the broker, and emit one item per (opponent, source) carrying the page's extracted text and the real URL that was fetched. The artifact is `{ "generated_at": ..., "items": [...] }`. This is the thin, web-only precursor to opponent profiling: **as-collected capture only — no interpretation, scoring, comparison, or contrast.**

## BEFORE YOU START
1. Read this entire instruction end-to-end before executing anything.
2. Maintain a TodoWrite list mirroring the TODO CHECKLIST below.
3. Your params are in the `PARAMS_JSON` env var. Read them once at the top.
4. Write the final artifact to `/workspace/output/race_opponent_collection.json` and nowhere else.
5. Run `python3 /workspace/validate_output.py` before declaring success.
6. Perform the spot-check at the bottom — validator-passing data can still be garbage.

## CRITICAL RULES
- **The container is network-quarantined — there is NO direct egress.** `urllib` / `requests` / `httpx` / `curl` / `wget` / a direct `socket` cannot reach the internet; they do NOT fail fast, they hang ~30s+ each and burn the time budget. **WebSearch (discovery) and `pmf_runtime.http.*` (the broker, retrieval) are the ONLY ways out.** Never make a direct network call from Python or the shell.
- **Fetch every page through the broker with `pmf_runtime.http.get(url)`** — Chromium-rendered. It returns a plain dict: `r["status"]`, `r["headers"]`, `r["body"]`, `r["source_url"]` (never `.status_code` / `.text`). The exact call:
  ```python
  from pmf_runtime import http
  r = http.get("https://ballotpedia.org/Jane_Doe")
  status = r["status"]; body = r["body"]; fetched_url = r["source_url"]
  ```
  **`r["source_url"]` is the page actually served after any redirect — record THAT as `source_url`, not the URL you passed in and not a search-result link.** The broker enforces an SSRF guard + URL allowlist; a blocked third-party sub-resource (tracker) on a real page no longer fails the host page.
- **WebSearch is discovery only.** Use it to FIND the Ballotpedia URL and the campaign-website URL when no hint was supplied. Do NOT use `WebFetch` (the quarantined network can't reach claude.ai's domain-safety check, so it always fails). Snippets are enough to pick the URL; the actual page body comes from `http.get`.
- **Do NOT fabricate a URL or a source.** If you cannot find a source, or `http.get` returns non-200 / an empty body, OMIT that source entirely. A missing source is the correct, expected result for many opponents (especially down-ballot). An invented or unfetched URL is a defect.
- **As-collected capture only — no interpretation.** Do NOT summarize, score, rank, compare opponents, extract structured fields, or write any contrast. Put the page's extracted text/sections into `content` as-is. Normalizing fields is a later-phase decision a human makes after seeing this data.
- **Match the race before trusting a page.** A same-named person in a different state or a past cycle is the wrong source. Confirm office / jurisdiction / cycle against `race_context` before capturing.
- **Do NOT query Databricks or call any internal API.** This experiment is web-only; there is no voter data, no `pmf_runtime.databricks`, no election-api call. Everything you need is in `PARAMS_JSON` (opponents + race_context) plus the web.
- **The only PUBLISHED artifact is `/workspace/output/race_opponent_collection.json`.** Write intermediate files to `/workspace/scratch/` — that directory is never published.
- **Run `python3 /workspace/validate_output.py` before declaring success.**

## TODO CHECKLIST
1. Read `PARAMS_JSON`; pull `opponents[]` and `race_context` (Step 0).
2. For each opponent, fan out one researcher subagent that finds + fetches both sources and writes its items (Step 1). Sequential fallback if fan-out is unavailable.
3. Merge every subagent's items into the artifact and write it (Step 2).
4. Validate (Step 3) and spot-check (Spot-check).

## Inputs (the params in `PARAMS_JSON`)
- `opponents` (array, ≥1): each `{ full_name, ballotpedia_url?, website_url? }`. `full_name` is required and is the `opponent_name` you emit. The two URLs are optional hints — use them directly when present; discover via WebSearch when null/absent.
- `race_context` (object): `{ office_name?, state?, city?, election_date? }`. Used only to disambiguate the right person/page during discovery. Do not reason over it beyond that.

## Steps

### Step 0 — Read params

Read `PARAMS_JSON` once. Extract `opponents` and `race_context`. `mkdir -p /workspace/scratch`. The opponents are independent research units — one per opponent.

### Step 1 — Per opponent: find + fetch both sources (parallel fan-out)

Each opponent is an independent unit. **Templated dispatch:** write the per-opponent researcher brief ONCE to `/workspace/scratch/researcher_brief.md` (the rules below + the exact item contract, with the opponent as the only variable), then dispatch one `researcher` subagent per opponent in a SINGLE turn. For the opponent at zero-based index `i` (0, 1, 2, …) in `PARAMS_JSON` `opponents`, assign a **zero-padded two-digit** index so every subagent gets a UNIQUE destination file — `opp_00.json`, `opp_01.json`, `opp_02.json`, … Tell each: "Read `/workspace/scratch/researcher_brief.md`; your opponent is `<full_name>` (hints: ballotpedia_url=`<...>`, website_url=`<...>`); write your items to `/workspace/scratch/opp_<NN>.json`" — substitute `<NN>` with that opponent's actual zero-padded index (e.g. `opp_00.json` for the first opponent). Two subagents must never share a filename, or the later writer clobbers the earlier one and those items are lost. If the runtime cannot spawn subagents, run the same brief as a sequential loop over the opponents, writing each to its own `opp_<NN>.json`.

**The researcher's base prompt does NOT know this output contract** — the brief must carry it. Each researcher, for its one opponent:

1. **Find the Ballotpedia URL.** If a `ballotpedia_url` hint was given, use it. Else WebSearch, e.g. `ballotpedia <full_name> <office_name> <state> <election year>`, and pick the candidate page (`ballotpedia.org/<Name>`) or the race page that lists this candidate. Confirm office / jurisdiction / cycle match `race_context`. If none for this person in this race is findable, record no Ballotpedia source.
2. **Find the campaign website.** If a `website_url` hint was given, use it. Else WebSearch, e.g. `<full_name> for <office_name> <city> <state> campaign website`, and pick the candidate's own campaign domain. Skip aggregators, PR-wire pages, and social-media profiles. If none is findable, record no website source.
3. **Fetch each found URL via the broker** (browser render) and capture the real fetched URL:
   ```python
   from pmf_runtime import http
   r = http.get(url)
   if r["status"] == 200 and r["body"]:
       fetched_url = r["source_url"]   # the page actually served (after redirects)
       text = r["body"]                # extract readable text/sections from this
   # else: omit this source — do NOT invent a URL or guess content
   ```
4. **Write items.** For each source that fetched cleanly (200 + non-empty body), emit one item:
   ```json
   {
     "opponent_name": "<full_name>",
     "source_type": "ballotpedia | opponent_website",
     "source_url": "<r['source_url']>",
     "content": { "text": "<extracted page text/sections, as-is>" }
   }
   ```
   Write this opponent's items as a JSON array to the unique zero-padded `/workspace/scratch/opp_<NN>.json` filename you were assigned (e.g. `opp_00.json`) — do not write a literal `opp_NN.json`. An opponent with no fetched source writes `[]`. Return one line (e.g. "opp_03: 2 items").

**Per-opponent caps:** at most 2 WebSearch queries per source-type and fetch each unique URL at most once. If you can't confirm a source in 1-2 searches, bail to "no source" for it rather than escalating — a missing source is fine.

### Step 2 — Merge and write the artifact

Read every `/workspace/scratch/opp_*.json`, concatenate their item arrays in opponent order, and write the artifact. Because the filenames are zero-padded by input index (`opp_00`, `opp_01`, …), `sorted()` orders them by `PARAMS_JSON` opponent position, so the merge below preserves opponent order:

```python
import json, glob, datetime
items = []
for p in sorted(glob.glob("/workspace/scratch/opp_*.json")):
    items.extend(json.load(open(p)))
artifact = {
    "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
    "items": items,
}
json.dump(artifact, open("/workspace/output/race_opponent_collection.json", "w"), indent=2)
```

If no source was fetched for any opponent, `items` is `[]` — that is a valid artifact. Do NOT invent items to fill it.

### Step 3 — Validate

```bash
python3 /workspace/validate_output.py
```

## Spot-check
Validator-passing JSON can still be garbage. Before declaring success, confirm:
- **Every `source_url` is a URL you actually fetched via `http.get`** and came back 200 — not a search-result link, not a guessed `ballotpedia.org/<Name>` you never fetched. If you didn't fetch it, it must not be in `items`.
- **`source_url` is the broker's returned `source_url`** (post-redirect), not the URL you passed in.
- **`content` is page text, not a summary.** If any `content` reads like your own prose, a ranking, or a comparison, you over-reached — replace it with the extracted page text or drop the item.
- **Each `source_type` value is exactly `ballotpedia` or `opponent_website`** and matches where the content actually came from.
- **No fabricated opponents or sources.** Every `opponent_name` matches an input opponent; opponents with no findable/fetchable source simply have zero items.

## Constraints (must follow)
- Plain, direct U.S. English in any prose (there should be almost none). No em dashes.
- Grounded in pages you actually fetched. Do not fabricate names, URLs, or content.
- Emit ONLY the `{ "generated_at": ..., "items": [...] }` artifact — no markdown, no preamble, no extra top-level fields.
- No interpretation, scoring, comparison, or contrast anywhere in the output.

## Failure modes
| Symptom | Cause | Fix |
|---|---|---|
| A Bash/Python command hangs ~30s then fails | A direct network call (`curl`/`requests`/`urllib`) — the container has no egress | Never make direct network calls; fetch only via `pmf_runtime.http.get`, discover via WebSearch |
| `WebFetch` always fails | The quarantined network can't reach claude.ai's domain-safety check | Use WebSearch for discovery + `http.get` for retrieval; never `WebFetch` |
| `source_url` doesn't match the page read | Recorded the search-result link or the passed-in URL, not `r["source_url"]` | Always record the broker's returned `source_url` (post-redirect) |
| A Ballotpedia page is the wrong person | Name collision across states / cycles | Confirm office + jurisdiction + cycle against `race_context` before capturing; else omit |
| `content` looks like a summary or ranking | Over-reached into later-phase analysis | As-collected capture only — store extracted page text/sections, never interpretation |
| An opponent has zero items | No findable/fetchable Ballotpedia page or website | Correct and expected — omit the source, do NOT invent a URL |
| `No artifact files found in /workspace/output` | Never wrote the file | Write `/workspace/scratch/opp_*.json`, run the Step 2 merge, confirm the output file exists |
