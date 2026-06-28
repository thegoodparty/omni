# Opponent Summary

Re-shape the **already-collected** text about each opponent into clean, display-ready sections — an overview, a background, and key positions/themes — each tagged with the input source URL it came from. The artifact is `{ "generated_at": ..., "opponents": [...] }`. This is a single-pass **structuring** job over text handed to you in params: no web research, no discovery, no fetching, no scoring, no contrasts. You restate what the provided text already says, neutrally, and attribute every section to the source it came from.

## BEFORE YOU START
1. Read this entire instruction end-to-end before executing anything.
2. Maintain a TodoWrite list mirroring the TODO CHECKLIST below.
3. Your params are in the `PARAMS_JSON` env var. Read them once at the top.
4. Write the final artifact to `/workspace/output/race_opponent_summary.json` and nowhere else.
5. Run `python3 /workspace/validate_output.py` before declaring success.
6. Perform the spot-check at the bottom — validator-passing data can still be garbage.

## CRITICAL RULES
- **Structure ONLY the provided text. Do NOT browse, search, fetch, or query anything.** Everything you need is in `PARAMS_JSON` (`opponents[].sources[].text` plus `race_context`). There is NO `WebSearch`, NO `pmf_runtime.http`, NO `pmf_runtime.databricks`, and NO internet here for this experiment. Do not write code or shell that reaches the network. If a fact is not in the provided text, it does not go in the output.
- **Add no facts not present in the input.** Every sentence you write must be supported by the opponent's own collected `text`. Do not infer, embellish, fill gaps from general knowledge, or carry a fact from one opponent onto another. When the provided text supports nothing for a section, that section is `null` (overview / background) or an empty `key_positions` array — never invented.
- **Attribute every section to an input source URL.** Each non-null `overview` / `background` and each `key_positions` item carries a `sources` array of one or more URLs. **Every URL in any `sources` array MUST be one of that same opponent's input `sources[].source_url` values, verbatim.** Never invent a URL, never use a URL from a different opponent, never cite `race_context`.
- **Neutral, factual language by construction.** Plain, direct U.S. English. **No em dashes.** No spin, no praise, no criticism, no comparison between opponents, no contrast against the candidate. State positions as the source states them. (The fair-line / contrast tone work is a separate later phase — this experiment stays neutral by only restating provided text.)
- **One output entry per input opponent, in input order.** Echo `opponent_name` verbatim from the input. An opponent whose `sources` is empty (or whose text grounds nothing) still gets an entry: `overview: null`, `background: null`, `key_positions: []`.
- **The only PUBLISHED artifact is `/workspace/output/race_opponent_summary.json`.** Write any intermediate notes to `/workspace/scratch/` — that directory is never published.
- **Run `python3 /workspace/validate_output.py` before declaring success.**

## TODO CHECKLIST
1. Read `PARAMS_JSON`; pull `opponents[]` (with their `sources[]`) and `race_context` (Step 0).
2. For each opponent, structure their provided text into overview / background / key_positions, each attributed to the input source URL(s) it came from (Step 1).
3. Assemble the artifact in input opponent order and write it (Step 2).
4. Validate (Step 3) and spot-check (Spot-check).

## Inputs (the params in `PARAMS_JSON`)
- `opponents` (array, ≥1): each `{ opponent_name, sources: [{ source_type, source_url, text }] }`. `opponent_name` is the name you echo on the matching output entry. `sources` is the already-collected per-source text (from Phase 0); it may be empty.
- `race_context` (object): `{ office_name?, state?, city?, election_date? }`. Light phrasing context only (which office / jurisdiction). Do not reason over it to add facts and never put it in a `sources` array.

## Steps

### Step 0 — Read params

Read `PARAMS_JSON` once. Extract `opponents` and `race_context`. `mkdir -p /workspace/scratch`. Note each opponent's allowed source URLs — the set of `sources[].source_url` for that opponent is the ONLY set of URLs that may appear in that opponent's output `sources` arrays.

```bash
python3 - <<'EOF'
import json, os
p = json.loads(os.environ["PARAMS_JSON"])
for o in p["opponents"]:
    urls = [s["source_url"] for s in o.get("sources", [])]
    print(o["opponent_name"], "->", len(urls), "source(s):", urls)
EOF
```

### Step 1 — Structure each opponent's provided text

For each opponent, read every `sources[].text` and restate what it says into three display sections. Work only from that opponent's own text.

- **`overview`** — a short, neutral who-they-are paragraph (who the opponent is, what they are running for, current role if the text states it). Drawn only from the provided text. If the text supports nothing, set `overview: null`.
- **`background`** — career, community ties, prior public roles, education — whatever biographical detail the provided text actually contains. Drawn only from the provided text. If none, set `background: null`.
- **`key_positions`** — issue positions / themes the provided text attributes to this opponent. Each item is `{ label, detail, sources }`: `label` is a short topic (e.g. "Housing"), `detail` is a neutral one-to-two-sentence statement of the position as the source states it. Drawn only from the provided text. If the text states no positions, use an empty array `[]`.

For every non-null section and every position item, set `sources` to the input `source_url`(s) the content came from — drawn verbatim from THIS opponent's `sources[].source_url`. A section synthesized from two of the opponent's sources lists both URLs. Do **not** normalize into finance, fundraising, or vote-record fields — that data is not in the Phase-0 text; only overview / background / positions are groundable.

### Step 2 — Assemble and write the artifact

Build one entry per input opponent, preserving input order, and write the artifact:

```python
import json, os, datetime
p = json.loads(os.environ["PARAMS_JSON"])
opponents_out = []  # build one entry per p["opponents"], in order, per Step 1
artifact = {
    "generated_at": datetime.datetime.now(datetime.timezone.utc)
        .isoformat(timespec="seconds").replace("+00:00", "Z"),
    "opponents": opponents_out,
}
json.dump(artifact, open("/workspace/output/race_opponent_summary.json", "w"), indent=2)
```

Every output opponent's `opponent_name` must match an input opponent verbatim, and the array length must equal the input opponent count.

### Step 3 — Validate

```bash
python3 /workspace/validate_output.py
```

Fix any schema error before declaring success.

## Spot-check
Validator-passing JSON can still be garbage. Before declaring success, confirm:
- **Every URL in every `sources` array is one of THAT opponent's input `source_url` values, verbatim.** No invented URLs, no cross-opponent URLs, no `race_context`.
- **Every section restates the provided text — nothing added.** If any `text` / `detail` contains a fact you cannot point to in that opponent's input text, remove it or drop the section.
- **Sections with no grounding are `null` (overview/background) or `[]` (key_positions), not invented.**
- **One entry per input opponent, in input order, `opponent_name` echoed verbatim.**
- **Neutral language; no em dash (U+2014); no spin, comparison, or contrast.**
- **No finance / fundraising / vote-record fields** — that data is not in the Phase-0 text.

## Failure modes
| Symptom | Cause | Fix |
|---|---|---|
| A command hangs ~30s then fails | A network call (`curl`/`requests`/`urllib`) — this experiment has no egress and needs none | Never make network calls; structure only the provided text |
| A `sources` URL isn't in the input | Invented a URL or used another opponent's | Every URL must be that opponent's own input `source_url`, verbatim; else drop the section |
| A section states a fact not in the text | Filled a gap from general knowledge | Restate only what the provided text says; omit/`null` what it doesn't support |
| Output reads like praise, criticism, or a contrast | Over-reached into editorial / Phase-1 tone | Keep it neutral and factual — restate the source's own framing |
| An opponent entry is missing | Dropped an opponent with empty sources | Every input opponent gets an entry: `overview: null`, `background: null`, `key_positions: []` |
| `validate_output.py` fails on a section with empty `sources` | Emitted a non-null section without attribution | Every non-null section needs ≥1 input source_url, or set it null / drop the item |
