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
3. Your params are in the `PARAMS_JSON` env var. Read them once at the top.
4. Write the final artifact to `/workspace/output/race_opponent_summary.json` and nowhere else.
5. Run `python3 /workspace/validate_output.py` before declaring success.
6. Perform the spot-check at the bottom — validator-passing data can still be garbage.

## CRITICAL RULES

- **Work ONLY from the provided text. Do NOT browse, search, fetch, or query anything.** Everything you need is in `PARAMS_JSON` (`opponents[].sources[].text`, `candidate_platform`, `race_context`). There is NO `WebSearch`, NO `pmf_runtime.http`, NO `pmf_runtime.databricks`, and NO internet here. Do not write code or shell that reaches the network. If a fact is not in the provided text, it does not go in the output.
- **Add no facts not present in the input.** Every sentence in `overview`, `background`, and `issues_that_matter` must be supported by that opponent's own collected `text`. Do not infer positions from party, fill gaps from general knowledge, or carry a fact from one opponent onto another. Thin data means smaller output (`null` sections, fewer bullets), never fabrication.
- **The candidate side comes ONLY from `candidate_platform`.** `field_analysis` is derived only by comparing `candidate_platform.bio`/`issues` against the whole collected opponent field. Never pull the candidate's stance from `CampaignStory` / `CampaignPosition` self-research — that path is deliberately avoided.
- **Analyze the whole field at once so threat tiers are RELATIVE.** Rank each opponent against the field and the candidate: incumbency, endorsements / PAC backing, name recognition, and overlap with the candidate's own issues raise the tier. Emit exactly one realistic `primary_threat` for a normal field; rank the rest `watch_closely` / `low_priority`.
- **Descriptive sections are sourced-or-silent; interpretive fields are not.** `overview`, `background`, and `issues_that_matter` each carry ≥1 rich source or are `null` when the text supports none. `threat_tier`, `why_theyre_running`, and the `field_analysis` SWOT lists are interpretive conclusions and carry no required source.
- **`why_theyre_running` is the opponent's own motivation, told usefully to the candidate — not a you-vs-them pitch.** Write it as *their* case to voters (why they say they're running, what they're offering), synthesized across their collected text. It is interpretive (no `sources` key at all), but it must still trace back to something in their text. Do NOT write it as the candidate's contrast ("You're running to give voters a change from X"). Bad: "You need to beat Chuck because he's out of touch." Good: "Chuck is running to keep his seat and continue steering Gilbert's growth from a fiscally conservative footing; his case to voters is a council record on roads and public safety."
- **`issues_that_matter` is a short bullet list, not a positions table.** 1-6 short strings (typically 3-6 for a data-rich opponent) capturing the issues/themes the opponent's own text emphasizes, with one shared `sources` array for the section (≥1 rich source). `null` when the text supports no groundable issue bullets.
- **`field_analysis` is campaign-level, not per-opponent, and only exists when `candidate_platform` is present.** Derive `strengths` / `weaknesses` / `opportunities` / `threats` (short bullets, up to 5 per quadrant, only as many as the field genuinely supports) by comparing `candidate_platform` against the whole collected opponent field: where the candidate's own issues are undercontested by the field (opportunity), where an opponent's endorsements/incumbency outmatch the candidate's visibility (threat), where the candidate's own platform is more specific or more aligned with voter concerns than the field (strength), where the candidate has no comparable record or backing (weakness). These bullets carry no required source; `sources` may stay empty unless a bullet rests directly on a specific cited claim worth pinning down. When `candidate_platform` is absent, emit `field_analysis: null`, never an empty object.
- **Rich sources everywhere a source is required.** Every source object is `{ url, title, publisher, description? }`:
  - `url` — verbatim one of that opponent's input `source_url`s. Never invented, never cross-opponent, never `race_context` or `candidate_platform`.
  - `title` — the cited page/document's human title, derived from the page's own content (a stated candidate/page name) plus source type context (e.g. "Chuck Bongiovanni - Ballotpedia", "Issues - Chuck Bongiovanni for Gilbert"). Never invented as a new fact about the opponent. When the text names no clear title, fall back to a generic title such as "Ballotpedia profile" or "Campaign website".
  - `publisher` — the site/org name. `ballotpedia` sources are published by "Ballotpedia". `opponent_website` sources are published under whatever campaign/org name the page's own text uses; if the text names no organization, fall back to the bare hostname of `url` (e.g. "halseyforgilbert.com").
  - `description` — optional, one sentence on what the source is (e.g. "Ballotpedia's candidate page for Chuck Bongiovanni, covering his council record and 2026 campaign."). Also derived from the page's own content, never a claim about the opponent that isn't in the text.
- **Every cited URL is one of THAT opponent's own input `source_url`s, verbatim.** Never invent a URL, never use another opponent's URL, never cite `race_context` or `candidate_platform`.
- **Neutral, fair-line tone. No em dashes.** Plain, direct U.S. English. State opponent positions as the source states them. `why_theyre_running` and `field_analysis` are factual/interpretive syntheses, not attacks.
- **One output entry per input opponent, in input order.** Echo `opponent_name` verbatim. An opponent whose `sources` is empty still gets an entry, with descriptive sections null and `threat_tier` ranked from whatever thin signal is available.
- **None of the dropped fields may appear anywhere in the output**: `key_positions`, `why_they_matter`, `what_you_need_to_know`, `where_soft`, `issue_contrasts`, `salience`. This redesign replaces the old analytical shape wholesale.
- **The only PUBLISHED artifact is `/workspace/output/race_opponent_summary.json`.** Write intermediate notes to `/workspace/scratch/` — never published.
- **Run `python3 /workspace/validate_output.py` before declaring success.**

## TODO CHECKLIST

1. Read `PARAMS_JSON`; pull `opponents[]` (with `sources[]`), `candidate_platform`, and `race_context` (Step 0).
2. Across the whole field, assign each opponent a relative `threat_tier` (Step 1).
3. For each opponent, structure `overview` and `background` (Step 2).
4. For each opponent, write `why_theyre_running` (Step 3).
5. For each opponent, write `issues_that_matter` (Step 4).
6. Only when `candidate_platform` is present, write the single top-level `field_analysis` (Step 5).
7. Assemble one entry per input opponent in input order and write the artifact (Step 6).
8. Validate (Step 7) and spot-check (Spot-check).

## Inputs (the params in `PARAMS_JSON`)

- `opponents` (array, ≥1): each `{ opponent_name, sources: [{ source_type, source_url, text }] }`. The already-collected per-source text (Phase 0). `sources` may be empty.
- `candidate_platform` (object, optional): `{ bio?, issues?: [{ title, description }] }`, the candidate's own platform from their site. Absent when the campaign has no website bio yet — then emit `field_analysis: null`.
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

### Step 1 — Rank the field (relative threat tiers)

Read every opponent's collected text and the candidate platform together. For each
opponent assign `threat_tier` (`primary_threat | watch_closely | low_priority`),
ranked *relative* to the field and the candidate: incumbency, endorsements / PAC
backing, name recognition, and overlap with the candidate's own issues raise the
tier. Exactly one realistic `primary_threat` for a normal field. Interpretive — no
source.

### Step 2 — Structure the descriptive sections (overview, background)

For each opponent, restate their own text into two display sections, each carrying
≥1 rich source drawn from that opponent's input `source_url`s:

- **`overview`** — short, neutral who-they-are paragraph (2-4 sentences), or `null` if the text supports none.
- **`background`** — career, community ties, prior roles the text contains, or `null`.

### Step 3 — Why they're running

For each opponent, write `why_theyre_running` — one to two sentences synthesizing
their own case to voters (their stated priorities, campaign frame, or record),
told usefully to the candidate reading it, or `null` if the opponent's text gives
no readable case to voters at all. Interpretive — carries no `sources` key
at all. Follow the framing rule above: their motivation, not a you-vs-them pitch.

### Step 4 — Issues that matter

For each opponent, write `issues_that_matter` — a short bullet list (1-6 short
strings, typically 3-6 for a data-rich opponent) of the issues/themes their own
text emphasizes, with one `sources` array (≥1 rich source) shared across the
section. `null` when the text supports no groundable issue bullets (e.g. a
placeholder site with no stated positions).

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
p = json.loads(os.environ["PARAMS_JSON"])
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

Validator-passing JSON can still be garbage. Before declaring success, confirm:

- **Exactly one realistic `primary_threat`; tiers are relative and justified** (an incumbent with endorsements outranks a first-time candidate with no base).
- **Every `overview` / `background` / `issues_that_matter` section that isn't `null` carries ≥1 rich source, and every cited `url` is one of that opponent's own `source_url`s, verbatim.**
- **`title` / `publisher` / `description` describe the cited document and are derived from the collected text and source type — never a fabricated fact about the opponent.**
- **`why_theyre_running` carries no `sources` key and is written as the opponent's own motivation, not a you-vs-them pitch.**
- **`field_analysis` is present only when `candidate_platform` was provided, and is `null` otherwise.**
- **No invented facts; thin-data opponents get `null` sections, not fabrication.**
- **None of the dropped fields (`key_positions`, `why_they_matter`, `what_you_need_to_know`, `where_soft`, `issue_contrasts`, `salience`) appear anywhere in the output.**
- **One entry per input opponent, in input order, `opponent_name` echoed verbatim.**
- **Neutral tone, no em dash (U+2014); no praise, attack, or spin.**

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| A command hangs ~30s then fails | A network call — this experiment has no egress and needs none | Never make network calls; synthesize only the provided text |
| Two or more `primary_threat` opponents | Tiers scored in isolation, not relative to the field | Re-rank across the whole field; reserve `primary_threat` for the single strongest |
| A section with no basis in the opponent's text | Inferred a position from party or general knowledge | Every claim must quote-trace to that opponent's collected text; set the section `null` otherwise |
| A `sources` URL not in the opponent's input | Invented or cross-opponent URL | Cite only that opponent's own `source_url`s, verbatim |
| `title` / `publisher` describes something not in the text | Fabricated document metadata instead of deriving it from the page's own content | Derive `title`/`publisher`/`description` only from what the collected text and source type actually show; fall back to a generic title / the bare hostname when the text names none |
| `why_theyre_running` reads as the candidate's pitch against the opponent | You-vs-them framing instead of the opponent's own motivation | Rewrite as the opponent's stated case to voters, synthesized from their own text |
| `why_theyre_running` carries a `sources` array | Treated an interpretive field like a descriptive one | `why_theyre_running` carries no `sources` key at all; `field_analysis` carries one section-level `sources` array (empty ok), never per-bullet sources |
| `field_analysis` present with no `candidate_platform` in the input | Emitted the SWOT unconditionally | Only emit `field_analysis` when `candidate_platform` is present; otherwise `null` |
| A dropped field (`key_positions`, `where_soft`, etc.) shows up in the output | Ported logic from the pre-redesign shape without updating field names | Re-check the output against the CRITICAL RULES above; none of the dropped fields belong in any entry |
| Thin-data opponent gets a fabricated platform | Filled gaps to make output symmetrical | Thin data → `null` sections, not invention |
| Output reads like an attack | Over-reached past fair-line tone | State the opponent's stance as the source states it; `field_analysis` compares facts, not editorializes |
| `validate_output.py` fails on a descriptive section with empty `sources` | Emitted a non-null overview/background/issues_that_matter without attribution | Every non-null descriptive section needs ≥1 input source_url, or set it `null` |
