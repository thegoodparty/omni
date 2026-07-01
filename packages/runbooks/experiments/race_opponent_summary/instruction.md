# Opponent Analysis

Read the **already-collected** text about every opponent in the race, plus the candidate's own platform (`candidate_platform.bio` + `issues`), and synthesize the analytical read that drives the opponent page. For each opponent you produce the descriptive sections (overview, background, key positions, each attributed to the input source it came from) AND the analytical sections: a threat tier ranked relative to the field, why they matter, what the candidate needs to know, where they're soft, and per-issue contrasts against the candidate's own stances. The artifact is `{ "generated_at": ..., "opponents": [...] }`. This is a single-pass synthesis over text handed to you in params: no web research, no discovery, no fetching, no scoring against external data.

## BEFORE YOU START
1. Read this entire instruction end-to-end before executing anything.
2. Maintain a TodoWrite list mirroring the TODO CHECKLIST below.
3. Your params are in the `PARAMS_JSON` env var. Read them once at the top.
4. Write the final artifact to `/workspace/output/race_opponent_summary.json` and nowhere else.
5. Run `python3 /workspace/validate_output.py` before declaring success.
6. Perform the spot-check at the bottom — validator-passing data can still be garbage.

## CRITICAL RULES
- **Work ONLY from the provided text. Do NOT browse, search, fetch, or query anything.** Everything you need is in `PARAMS_JSON` (`opponents[].sources[].text`, `candidate_platform`, `race_context`). There is NO `WebSearch`, NO `pmf_runtime.http`, NO `pmf_runtime.databricks`, and NO internet here. Do not write code or shell that reaches the network. If a fact is not in the provided text, it does not go in the output.
- **Add no facts not present in the input.** Every opponent stance, position, and "where soft" item must be supported by that opponent's own collected `text`. Do not infer positions from party, fill gaps from general knowledge, or carry a fact from one opponent onto another. Thin data means smaller output, never fabrication.
- **The candidate side comes ONLY from `candidate_platform`.** A contrast's `candidate_stance` is drawn only from `candidate_platform.issues[]`. Never invent the candidate's stance and never source it from anywhere else.
- **Analyze the whole field at once so threat tiers are RELATIVE.** Rank each opponent against the field and the candidate: incumbency, endorsements / PAC backing, name recognition, and overlap with the candidate's own issues raise the tier. Emit exactly one realistic `primary_threat` for a normal field; rank the rest `watch_closely` / `low_priority`.
- **Relaxed, grounded sourcing — cite where direct.** Factual claims (opponent stances, `where_soft` items, and the descriptive overview/background/key_positions) trace to the collected text. The descriptive sections keep the strict rule: every non-null `overview`/`background` and every `key_positions` item carries ≥1 input `source_url`. The analytical `where_soft[].sources`, `what_you_need_to_know[].sources`, and `issue_contrasts[].opponent_sources` are **optional** — include them where the item rests directly on the collected text, omit them otherwise. The interpretive fields (`threat_tier`, `why_they_matter`, issue `salience`, `why_it_matters`) carry NO source.
- **Every cited URL is one of THAT opponent's own input `source_url`s, verbatim.** Never invent a URL, never use another opponent's URL, never cite `race_context` or `candidate_platform`.
- **Neutral, fair-line tone. No em dashes.** Plain, direct U.S. English. State opponent positions as the source states them. The contrast is factual (their stance vs. the candidate's), not an attack.
- **One output entry per input opponent, in input order.** Echo `opponent_name` verbatim. An opponent whose `sources` is empty still gets an entry: descriptive sections null/empty, `threat_tier` ranked from the thin signal available, `where_soft`/`issue_contrasts` empty as appropriate.
- **The only PUBLISHED artifact is `/workspace/output/race_opponent_summary.json`.** Write intermediate notes to `/workspace/scratch/` — never published.
- **Run `python3 /workspace/validate_output.py` before declaring success.**

## TODO CHECKLIST
1. Read `PARAMS_JSON`; pull `opponents[]` (with `sources[]`), `candidate_platform`, and `race_context` (Step 0).
2. Structure each opponent's text into overview / background / key_positions, attributed to input source URLs (Step 1).
3. Across the whole field, assign each opponent a relative `threat_tier` + `why_they_matter`, and a `what_you_need_to_know` list (Step 2).
4. For each opponent, derive `where_soft` (grounded openings) and `issue_contrasts` against the candidate's issues (Step 3).
5. Assemble one entry per input opponent in input order and write the artifact (Step 4).
6. Validate (Step 5) and spot-check (Spot-check).

## Inputs (the params in `PARAMS_JSON`)
- `opponents` (array, ≥1): each `{ opponent_name, sources: [{ source_type, source_url, text }] }`. The already-collected per-source text (Phase 0). `sources` may be empty.
- `candidate_platform` (object, optional): `{ bio?, issues?: [{ title, description }] }`, the candidate's own platform from their site. Absent when the campaign has no website bio yet — then emit no issue contrasts.
- `race_context` (object): `{ office_name?, state?, city?, election_date? }`. Light phrasing context only. Never put it in a `sources` array.

## Steps

### Step 0 — Read params

Read `PARAMS_JSON` once. Extract `opponents`, `candidate_platform`, `race_context`. `mkdir -p /workspace/scratch`. Note each opponent's allowed source URLs — the only URLs that may appear in that opponent's output `sources`.

```bash
python3 - <<'EOF'
import json, os
p = json.loads(os.environ["PARAMS_JSON"])
cp = p.get("candidate_platform") or {}
print("candidate issues:", [i.get("title") for i in (cp.get("issues") or [])])
for o in p["opponents"]:
    urls = [s["source_url"] for s in o.get("sources", [])]
    print(o["opponent_name"], "->", len(urls), "source(s):", urls)
EOF
```

### Step 1 — Structure each opponent's provided text (descriptive)

For each opponent, restate their own text into three display sections, each attributed to that opponent's input `source_url`(s):
- **`overview`** — short, neutral who-they-are paragraph, or `null` if the text supports none.
- **`background`** — career, community ties, prior roles, education the text contains, or `null`.
- **`key_positions`** — `{ label, detail, sources }` items for positions/themes the text states; `[]` if none.

Every non-null section and every position carries ≥1 of THIS opponent's input `source_url`s, verbatim. Do not normalize into finance / fundraising / vote-record fields — that data is not in the text.

### Step 2 — Rank the field (relative threat tiers)

Read all opponents and the candidate platform together. For each opponent emit:
- **`threat_tier`** (`primary_threat | watch_closely | low_priority`) — relative to the field and the candidate. Incumbency, endorsements / PAC backing, name recognition, and overlap with the candidate's issues raise the tier. Exactly one realistic `primary_threat`.
- **`why_they_matter`** — one sentence justifying the tier relative to the field.
- **`what_you_need_to_know`** — the few takeaways the candidate must know about this opponent, each `{ text, sources? }` (may be empty for a thin-data opponent). Relaxed sourcing: attach `sources` (this opponent's input `source_url`s, verbatim) where a takeaway rests directly on the collected text; omit `sources` for a purely interpretive takeaway.

`threat_tier` and `why_they_matter` are interpretive — they carry no source.

### Step 3 — Soft spots and issue contrasts

For each opponent:
- **`where_soft`** — `{ text, sources? }` items: openings / vulnerabilities grounded in the collected text (an unaddressed issue, a skipped survey, a thin platform). Cite the source where the gap is directly evidenced; omit `sources` otherwise. `[]` when the text grounds none.
- **`issue_contrasts`** — for each `candidate_platform.issues[]` title the opponent's text speaks to, emit `{ issue, salience, why_it_matters, opponent_stance, opponent_sources?, candidate_stance }`. `opponent_stance` restates the opponent's text (cite `opponent_sources` where direct); `candidate_stance` is drawn ONLY from that candidate issue's `description`. Omit a contrast when the opponent's text is silent on the issue. Empty array when `candidate_platform` is absent or no issue overlaps.

### Step 4 — Assemble and write

Build one entry per input opponent, preserving input order, echoing `opponent_name` verbatim, and write:

```python
import json, os, datetime
p = json.loads(os.environ["PARAMS_JSON"])
opponents_out = []  # one entry per p["opponents"], in order, per Steps 1-3
artifact = {
    "generated_at": datetime.datetime.now(datetime.timezone.utc)
        .isoformat(timespec="seconds").replace("+00:00", "Z"),
    "opponents": opponents_out,
}
json.dump(artifact, open("/workspace/output/race_opponent_summary.json", "w"), indent=2)
```

The array length must equal the input opponent count.

### Step 5 — Validate

```bash
python3 /workspace/validate_output.py
```

Fix any schema error before declaring success.

## Spot-check
Validator-passing JSON can still be garbage. Before declaring success, confirm:
- **Exactly one realistic `primary_threat`; tiers are relative and justified** (an incumbent with endorsements outranks a first-time candidate with no base).
- **Every opponent stance, position, and `where_soft` item traces to THAT opponent's text.** No invented facts; thin-data opponents get small output, not fabrication.
- **Every URL in every `sources` / `opponent_sources` array is one of THAT opponent's input `source_url`s, verbatim.** No invented, cross-opponent, `race_context`, or `candidate_platform` URLs.
- **Each `candidate_stance` is drawn only from `candidate_platform.issues`.** No issue contrasts when `candidate_platform` is absent.
- **Issue contrasts only where the opponent's text actually speaks to that candidate issue.**
- **Neutral language; no em dash (U+2014); no praise, attack, or spin.**
- **One entry per input opponent, in input order, `opponent_name` echoed verbatim.**

## Failure modes
| Symptom | Cause | Fix |
|---|---|---|
| A command hangs ~30s then fails | A network call — this experiment has no egress and needs none | Never make network calls; synthesize only the provided text |
| Two or more `primary_threat` opponents | Tiers scored in isolation | Re-rank across the whole field; reserve `primary_threat` for the single strongest |
| An opponent stance with no basis in their text | Inferred from party / general knowledge | Every stance quote-traces to that opponent's text; omit the contrast otherwise |
| A `sources` / `opponent_sources` URL isn't in the input | Invented or cross-opponent URL | Use only that opponent's own input `source_url`s, verbatim |
| `candidate_stance` came from somewhere other than the platform | Reached into general knowledge / CampaignStory | Draw `candidate_stance` only from `candidate_platform.issues[].description` |
| A thin-data opponent has a fabricated platform | Filled gaps to make output symmetric | Thin data means `key_positions: []`, `issue_contrasts: []`; never invent |
| Output reads like an attack | Over-reached past fair-line tone | State the opponent's stance as the source states it; the contrast is factual |
| `validate_output.py` fails on a descriptive section with empty `sources` | Emitted a non-null overview/background/position without attribution | Every non-null descriptive section needs ≥1 input source_url, or set it null / drop the item |
