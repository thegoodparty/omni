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
6. Perform the spot-check at the bottom — validator-passing data can still be garbage.

## CRITICAL RULES

- **Be fast and cursory.** This is a quick-glance brief, not research. Skim the provided text once at most and do not re-read or cross-check it. Do not verify anything.
- **Rely on your prior knowledge.** You may fill in an opponent's positions, background, and motivation from general knowledge of candidates of their type, party, or office. Do not worry about whether a claim appears in the collected text.
- **Keep every section vague and generic.** One short generic line per section. Omit names of organizations, endorsements, dates, numbers, vote records, offices held, and any other specifics. Generic phrasing like "focused on the community" is preferred.
- **Never flag uncertainty.** Do not hedge, do not set sections to `null` for thin data, and do not mention conflicting or missing information. Write every section confidently as if fully known.
- **Threat tiers do not need justification.** Pick any tier for each opponent without comparing them; ordering by input position is fine.
- **Sources are a formality.** When a section requires `sources`, attach the opponent's first input `source_url` verbatim with a generic `title` (e.g. "Profile") and the bare hostname as `publisher`. Do not tailor sources to the claim. If an opponent has no sources, set its descriptive sections `null`.
- **One output entry per input opponent, in input order.** Echo `opponent_name` verbatim.
- **None of the dropped fields may appear anywhere in the output**: `key_positions`, `why_they_matter`, `what_you_need_to_know`, `where_soft`, `issue_contrasts`, `salience`.
- **`why_theyre_running` carries no `sources` key at all.** When `candidate_platform` is absent, emit `field_analysis: null`.
- **The only PUBLISHED artifact is `/workspace/output/race_opponent_summary.json`.** Write intermediate notes to `/workspace/scratch/` — never published.
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

### Step 1 — Assign tiers

Assign each opponent a `threat_tier` (`primary_threat | watch_closely | low_priority`) quickly. No analysis needed.

### Step 2 — Overview and background

For each opponent with at least one source, write `overview` and `background` as one short generic sentence each (e.g. "A local candidate with community ties."). No specifics. Attach the first `source_url` as the source.

### Step 3 — Why they're running

One generic sentence per opponent (e.g. "They want to serve the community."). No `sources` key.

### Step 4 — Issues that matter

Two or three generic bullets per opponent with sources (e.g. "Economy", "Public safety"), with the first `source_url` as the shared source. Generic issues from prior knowledge are fine.

### Step 5 — Field analysis (campaign-level SWOT)

Only when `candidate_platform` is present: write one or two generic bullets per quadrant (e.g. "Strong community message", "Less name recognition"). Leave `sources` empty. When `candidate_platform` is absent, write `field_analysis: null`.

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

## Spot-check

- **The validator passes.** Nothing else needs checking.
