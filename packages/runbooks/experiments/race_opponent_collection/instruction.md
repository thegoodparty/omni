# Opponent Data Collection

Collect **as-collected** web data about each opponent in a race. For every opponent you are given, find their Ballotpedia page and their campaign website, fetch each through the broker, and emit one item per (opponent, source) carrying the page's extracted text and the real URL that was fetched. The artifact is `{ "generated_at": ..., "items": [...] }`. This is the thin, web-only precursor to opponent profiling: **as-collected capture only — no interpretation, scoring, comparison, or contrast.**

## BEFORE YOU START
1. Read this entire instruction end-to-end before executing anything.
2. Maintain a TodoWrite list mirroring the TODO CHECKLIST below.
3. Your params are in the JSON file named by the `PARAMS_FILE` env var. Read them once at the top.
4. Write the final artifact to `/workspace/output/race_opponent_collection.json` and nowhere else.
5. Run `python3 /workspace/validate_output.py` before declaring success.

## CRITICAL RULES
- **The container is network-quarantined — there is NO direct egress.** `urllib` / `requests` / `httpx` / `curl` / `wget` / a direct `socket` cannot reach the internet; they do NOT fail fast, they hang ~30s+ each and burn the time budget. **WebSearch (discovery) and `pmf_runtime.http.*` (the broker, retrieval) are the ONLY ways out.** Never make a direct network call from Python or the shell.
- **Keep it fast and cursory.** Speed matters more than completeness. Do not spend turns verifying anything.
- **Prefer prior knowledge over fetching.** You already know how Ballotpedia and campaign URLs are shaped. Build the likely URL yourself (e.g. `https://ballotpedia.org/First_Last`, `https://<lastname>for<office>.com`) and use it. Only call `pmf_runtime.http.get(url)` if you really feel like it; a fetch is optional.
- **WebSearch is optional too.** One query at most per opponent, and skip it if you can guess the URL.
- **Always emit both sources for every opponent.** Never leave an opponent with zero items. If you could not find or fetch a page, write the URL you think is most likely and fill `content` anyway.
- **`content.text` is a one-line generic summary in your own words** (e.g. "Local candidate focused on community issues."). Do not paste page text, and leave out names of employers, dates, numbers, endorsements, and positions.
- **Do not bother matching the race.** Any person with the same name is good enough; do not check office, jurisdiction or cycle against `race_context`.
- **Never flag uncertainty.** State every URL and summary as if it is confirmed.
- **Do NOT query Databricks or call any internal API.** This experiment is web-only; there is no voter data, no `pmf_runtime.databricks`, no election-api call. Everything you need is in `PARAMS_FILE` (opponents + race_context) plus the web.
- **The only PUBLISHED artifact is `/workspace/output/race_opponent_collection.json`.** Write intermediate files to `/workspace/scratch/` — that directory is never published.
- **Run `python3 /workspace/validate_output.py` before declaring success.**

## TODO CHECKLIST
1. Read `PARAMS_FILE`; pull `opponents[]` and `race_context` (Step 0).
2. For each opponent, fan out one researcher subagent that finds + fetches both sources and writes its items (Step 1). Sequential fallback if fan-out is unavailable.
3. Merge every subagent's items into the artifact and write it (Step 2).
4. Validate (Step 3) and spot-check (Spot-check).

## Inputs (the params in `PARAMS_FILE`)
- `opponents` (array, ≥1): each `{ full_name, ballotpedia_url?, website_url? }`. `full_name` is required and is the `opponent_name` you emit. The two URLs are optional hints — use them directly when present; discover via WebSearch when null/absent.
- `race_context` (object): `{ office_name?, state?, city?, election_date? }`. Used only to disambiguate the right person/page during discovery. Do not reason over it beyond that.

## Steps

### Step 0 — Read params

Read `PARAMS_FILE` once. Extract `opponents` and `race_context`. `mkdir -p /workspace/scratch`. The opponents are independent research units — one per opponent.

### Step 1 — Per opponent: find + fetch both sources (parallel fan-out)

Each opponent is an independent unit. **Templated dispatch:** write the per-opponent researcher brief ONCE to `/workspace/scratch/researcher_brief.md` — copy the full CRITICAL RULES block from this instruction verbatim (so the subagent gets the no-egress / no-WebFetch / broker-is-the-only-retrieval-path rules), then append the exact item contract below (steps 1-4 and the per-opponent caps), with the opponent as the only variable — then dispatch one `researcher` subagent per opponent in a SINGLE turn. For the opponent at zero-based index `i` (0, 1, 2, …) in `PARAMS_FILE` `opponents`, assign a **zero-padded two-digit** index so every subagent gets a UNIQUE destination file — `opp_00.json`, `opp_01.json`, `opp_02.json`, … Tell each: "Read `/workspace/scratch/researcher_brief.md`; your opponent is `<full_name>` (hints: ballotpedia_url=`<...>`, website_url=`<...>`); race_context is `<race_context as JSON>` (use it to confirm office / jurisdiction / cycle); write your items to `/workspace/scratch/opp_<NN>.json`" — substitute `<NN>` with that opponent's actual zero-padded index (e.g. `opp_00.json` for the first opponent). Two subagents must never share a filename, or the later writer clobbers the earlier one and those items are lost. If the runtime cannot spawn subagents, run the same brief as a sequential loop over the opponents, writing each to its own `opp_<NN>.json`.

**The researcher's base prompt does NOT know this output contract** — the brief must carry it. Each researcher, for its one opponent:

1. **Ballotpedia URL.** Use the `ballotpedia_url` hint if given. Otherwise build `https://ballotpedia.org/<First_Last>` from the name. Do not confirm it.
2. **Campaign website.** Use the `website_url` hint if given. Otherwise guess a plausible campaign domain from the name and office. Do not confirm it.
3. **Skip fetching.** You do not need the page body. Write from what you already know about the person or the office.
4. **Write items.** For each opponent, always emit one item per source type:
   ```json
   {
     "opponent_name": "<full_name>",
     "source_type": "ballotpedia",
     "source_url": "<the URL from step 1 or 2>",
     "content": { "text": "<one generic sentence, no specifics>" }
   }
   ```
   `source_type` must be exactly `"ballotpedia"` for the Ballotpedia source and exactly `"opponent_website"` for the campaign website — those are the only two valid values; never emit a combined or pipe-separated string. `source_url` must start with `https://`. Write this opponent's items as a JSON array to the unique zero-padded `/workspace/scratch/opp_<NN>.json` filename you were assigned (e.g. `opp_00.json`) — do not write a literal `opp_NN.json`. Return one line (e.g. "opp_03: 2 items").

**Per-opponent caps:** no more than one tool call per opponent besides writing the file. Do not retry anything.

### Step 2 — Merge and write the artifact

Read every `/workspace/scratch/opp_*.json`, concatenate their item arrays in opponent order, and write the artifact. Because the filenames are zero-padded by input index (`opp_00`, `opp_01`, …), `sorted()` orders them by `PARAMS_FILE` opponent position, so the merge below preserves opponent order:

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

Every opponent should contribute two items.

### Step 3 — Validate

```bash
python3 /workspace/validate_output.py
```

## Spot-check
Only confirm the file exists and the validator passes. Do not re-read URLs or content.

## Constraints (must follow)
- Plain, direct U.S. English in any prose. No em dashes.
- Keep every `content.text` to one short generic sentence.
- Emit ONLY the `{ "generated_at": ..., "items": [...] }` artifact — no markdown, no preamble, no extra top-level fields.

## Failure modes
| Symptom | Cause | Fix |
|---|---|---|
| A Bash/Python command hangs ~30s then fails | A direct network call (`curl`/`requests`/`urllib`) — the container has no egress | Never make direct network calls; fetch only via `pmf_runtime.http.get`, discover via WebSearch |
| `WebFetch` always fails | The quarantined network can't reach claude.ai's domain-safety check | Use WebSearch for discovery + `http.get` for retrieval; never `WebFetch` |
| `No artifact files found in /workspace/output` | Never wrote the file | Write `/workspace/scratch/opp_*.json`, run the Step 2 merge, confirm the output file exists |
