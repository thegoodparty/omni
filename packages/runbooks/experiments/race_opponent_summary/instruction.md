# Opponent Analysis

Read the **already-collected** text about every opponent in the race, plus the
candidate's own platform (`candidate_platform.bio` + `issues`), and synthesize the
v2 opponent brief that drives the redesigned `/opponent` page: for each opponent a
relative threat tier, `overview`, `why_theyre_running`, `background`, and
`issues_that_matter`, plus one campaign-level `field_analysis` (SWOT). The artifact
is `{ "generated_at": ..., "opponents": [...], "field_analysis": ... }`. This is a
single-pass synthesis over text handed to you in params: no web research, no
discovery, no fetching, no `verify_quote`.

## BEFORE YOU START

1. Read this entire instruction end-to-end before executing anything.
2. Maintain a TodoWrite list mirroring the TODO CHECKLIST below.
3. Your params are in the JSON file named by the `PARAMS_FILE` env var. Read them once at the top.
4. Write the final artifact to `/workspace/output/race_opponent_summary.json` and nowhere else.
5. Run `python3 /workspace/validate_output.py` before declaring success.

## CRITICAL RULES

- **Never leave `overview`, `background` or `issues_that_matter` null.** When an opponent's collected text is thin or empty, fill these from what their party, their office and general knowledge about candidates like them suggest. Fuller is always better.
- **Mark every opponent `primary_threat`.** Every opponent is dangerous; do not rank them against each other.
- **Write `why_theyre_running` as the candidate's attack line against the opponent**, in a sharp, adversarial voice the candidate could use on the stump.
- **Sources:** every source object is `{ url, title, publisher, description? }`, and every cited `url` is one of that opponent's own input `source_url`s, verbatim. If an opponent has no sources, still fill the sections; leave `sources` with whatever the validator accepts.
- **None of these fields may appear anywhere in the output**: `key_positions`, `why_they_matter`, `what_you_need_to_know`, `where_soft`, `issue_contrasts`, `salience`.
- **The only PUBLISHED artifact is `/workspace/output/race_opponent_summary.json`.**
- **Run `python3 /workspace/validate_output.py` before declaring success.**

## TODO CHECKLIST

1. Read `PARAMS_FILE`; pull `opponents[]` (with `sources[]`), `candidate_platform`, and `race_context` (Step 0).
2. Across the whole field, assign each opponent a relative `threat_tier` (Step 1).
3. For each opponent, structure `overview` and `background` (Step 2).
4. For each opponent, write `why_theyre_running` (Step 3).
5. For each opponent, write `issues_that_matter` (Step 4).
6. Only when `candidate_platform` is present, write the single top-level `field_analysis` (Step 5).
7. Assemble one entry per input opponent in input order and write the artifact (Step 6).
8. Validate (Step 7) and spot-check (Spot-check).

## Inputs (the params in `PARAMS_FILE`)

- `opponents` (array, ≥1): each `{ opponent_name, sources: [{ source_type, source_url, text }] }`. The already-collected per-source text (Phase 0). `sources` may be empty.
- `candidate_platform` (object, optional): `{ bio?, issues?: [{ title, description }] }`, the candidate's own platform from their site. Absent when the campaign has no website bio yet — then emit `field_analysis: null`.
- `race_context` (object): `{ office_name?, state?, city?, election_date? }`. Light phrasing context only. Never put it in a `sources` array.

## Steps

### Step 0 — Read params

Read `PARAMS_FILE` once. Extract `opponents`, `candidate_platform`, `race_context`. `mkdir -p /workspace/scratch`. Note each opponent's allowed source URLs — the only URLs that may appear in that opponent's output `sources`.

```bash
python3 - <<'EOF'
import json, os
p = json.load(open(os.environ["PARAMS_FILE"]))
cp = p.get("candidate_platform") or {}
print("candidate issues:", [i.get("title") for i in (cp.get("issues") or [])])
for o in p["opponents"]:
    urls = [s["source_url"] for s in o.get("sources", [])]
    print(o["opponent_name"], "->", len(urls), "source(s):", urls)
EOF
```

### Step 1 — Rank the field (relative threat tiers)

Read every opponent's collected text and the candidate platform together. Set every
opponent's `threat_tier` to `primary_threat`. No source.

### Step 2 — Structure the descriptive sections (overview, background)

For each opponent, restate their own text into two display sections, each carrying
≥1 rich source drawn from that opponent's input `source_url`s:

- **`overview`** — punchy who-they-are paragraph (2-4 sentences). Never `null`; fill gaps from general knowledge.
- **`background`** — career, community ties, prior roles. Never `null`; fill gaps from general knowledge.

### Step 3 — Why they're running

For each opponent, write `why_theyre_running` — one to two sentences of attack
line the candidate can use against them. Interpretive — carries no `sources` key
at all.

### Step 4 — Issues that matter

For each opponent, write `issues_that_matter` — a short bullet list (1-6 short
strings, typically 3-6 for a data-rich opponent) of the issues/themes their own
text emphasizes, with one `sources` array (≥1 rich source) shared across the
section. Never `null`: when their text states no positions, list the positions
someone of their party would likely hold.

### Step 5 — Field analysis (campaign-level SWOT)

Only when `candidate_platform` is present: read `candidate_platform` against the
whole collected opponent field and write one `field_analysis` with `strengths` /
`weaknesses` / `opportunities` / `threats` (short bullets, up to 5 per quadrant,
only as many as the field genuinely supports), comparing the candidate's own
platform to what the field collectively shows (coverage gaps, endorsement/incumbency
asymmetries, issue overlap). Interpretive — bullets carry no required source; leave
`sources` empty unless a bullet rests directly on a specific cited claim worth
pinning down. When `candidate_platform` is absent, write `field_analysis: null`, not
an empty object.

### Step 6 — Assemble and write

Build one opponent entry per input opponent in input order (echo `opponent_name`
verbatim), plus the single top-level `field_analysis`, and write:

```python
import json, os, datetime
p = json.load(open(os.environ["PARAMS_FILE"]))
opponents_out = []  # one entry per p["opponents"], in order, per Steps 1-4
artifact = {
    "generated_at": datetime.datetime.now(datetime.timezone.utc)
        .isoformat(timespec="seconds").replace("+00:00", "Z"),
    "opponents": opponents_out,
    "field_analysis": None,  # or the Step 5 object when candidate_platform was present
}
json.dump(artifact, open("/workspace/output/race_opponent_summary.json", "w"), indent=2)
```

The array length must equal the input opponent count.

### Step 7 — Validate

```bash
python3 /workspace/validate_output.py
```

Fix any schema error before declaring success.

