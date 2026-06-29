Read the already-collected opponent text plus the candidate's own platform (`bio` + `issues`) and synthesize the analytical read that drives the `/opponent` page: a per-opponent threat tier + why-they-matter, "what you need to know", "where they're soft", and per-issue contrasts (opponent stance vs. the candidate's). This is relaxed, grounded synthesis over text we already have — no web research, no discovery, no fetching, no `verify_quote`.

This is the source runbook for the analysis step. It proves the workflow on real Phase-0 data before we port it into the existing `race_opponent_summary` PMF experiment (ENG-10591). The paired experiment is `experiments/race_opponent_summary/` — Phase 2 already runs it as a descriptive structurer (overview / background / key_positions); this runbook proves the analytical extension that the experiment grows into. See `books/convert-runbook-to-experiment.md` for the port.

## Prerequisites

**books/.env variables**: none
**scripts/.env variables**: none
**Tools**: none beyond a JSON-capable shell. There is NO web fetch, NO Databricks, NO `verify_quote` here — the analysis re-reasons over text already collected in Phase 0 (`books/find-race-opponent.md`) plus the candidate platform.
**Inputs**:
- `opponents` — the whole field at once (so threat tiers are relative across it). Each `{ opponent_name, sources: [{ source_type, source_url, text }] }` (`source_type` is `ballotpedia` or `opponent_website`). **This is the grouped shape, not raw Phase-0 output.** Phase 0 (`books/find-race-opponent.md`) emits a flat array of one record per (opponent, source): `{ opponent_name, source_type, source_url, content: { text } }`. Before this runbook, group those records by `opponent_name` into a `sources[]` sub-array and lift `content.text` to a flat `text`. In production gp-api does exactly this grouping (`groupSourcesForSummary`) when it hydrates the dispatch params; the shell below does it for the fixture:

```bash
# group flat Phase-0 records -> the grouped opponents[] this runbook expects
python3 - <<'EOF'
import json
flat = json.load(open("/tmp/phase0-records.json"))  # the flat Phase-0 array
by_name = {}
for r in flat:
    by_name.setdefault(r["opponent_name"], []).append({
        "source_type": r["source_type"],
        "source_url": r["source_url"],
        "text": r.get("content", {}).get("text", ""),
    })
opponents = [{"opponent_name": n, "sources": s} for n, s in by_name.items()]
json.dump(opponents, open("/tmp/grouped-opponents.json", "w"), indent=2)
EOF
```
- `candidate_platform` — the candidate's own `{ bio?, issues?: [{ title, description }] }`, shaped exactly like `Website.content.about` (the pre-Pro-upgrade `CandidateProfileStep` capture). May be absent — then issue contrasts are simply omitted.
- `race_context` — `{ office_name?, state?, city?, election_date? }`, phrasing context only.

**Output**: `{ generated_at, opponents: [...] }`, one entry per input opponent, each extended with `threat_tier` + `why_they_matter`, `what_you_need_to_know[]`, `where_soft[]`, and `issue_contrasts[]`. The proven shape is documented under "Proven output shape" below — it becomes the `output_schema` for ENG-10591.

## What you need to know

- **Analyze the whole field at once.** Threat tiers are *relative* — exactly one realistic `primary_threat` for a typical small-race field, the rest ranked `watch_closely` / `low_priority`. Rank relative to the candidate: incumbency, party / PAC backing, name recognition, and overlap with the candidate's own issues all raise a tier.
- **Relaxed sourcing = grounded, cite where direct.** A factual claim about an opponent (a stated position, a "where soft" gap) traces to that opponent's collected `text` and cites the `source_url`(s) it rests on where there is a direct basis. *Interpretive* fields — `threat_tier`, issue `salience`, `why_they_matter`, `what_you_need_to_know` — are conclusions drawn across the field and need NOT carry a verbatim extract. This is the deliberate difference from the strict `opponent_research` engine: no per-claim sourced-or-silent drop here.
- **Never invent facts.** Every opponent stance and every "where soft" item must be supported by that opponent's own collected text. Do not infer positions from party, fill gaps from general knowledge, or carry a fact from one opponent onto another. Thin data → smaller output, not fabrication.
- **The candidate side comes only from `candidate_platform`** (`Website.content.about`). Never pull the candidate's stance from `CampaignStory` / `CampaignPosition` self-research — that path is deliberately avoided.
- **Issue contrasts pair the candidate's issues against opponent stances.** For each issue the candidate cares about (`candidate_platform.issues[]`), find where the opponent's collected text speaks to it; emit the opponent stance (+ source), a voter-salience read, why it matters to constituents, and the candidate's own stance (from their platform). If an opponent's text says nothing on a candidate issue, omit that contrast for that opponent rather than inventing a stance.
- **Neutral, fair-line tone. No em dashes.** State opponent positions as the source states them; the contrast is factual (their stance vs. yours), not an attack.

## The fixture — Gilbert Town Council (real Phase-0 shape)

A three-opponent field that exercises the full range: a data-rich incumbent, a
moderate-data challenger, and a thin website-only challenger (to prove graceful
degradation). The `text` blobs below carry the same per-source page text Phase 0
captures into `race_opponent.content.text`, already grouped into this runbook's
input shape (see the grouping note above). The proof is *internal groundedness* —
every output claim must trace back to this text.

```json
{
  "race_context": {
    "office_name": "Gilbert Town Council",
    "state": "AZ",
    "city": "Gilbert",
    "election_date": "2026-11-03"
  },
  "candidate_platform": {
    "bio": "Small-business owner and parent of two who has lived in Gilbert for 12 years. Volunteer youth-sports coach and former neighborhood HOA board member. Running to keep Gilbert affordable for working families and to make sure infrastructure keeps pace with growth.",
    "issues": [
      { "title": "Water security", "description": "Gilbert's growth has outrun its long-term water planning. I will push for a published 50-year water plan and conservation incentives before approving new large-scale development." },
      { "title": "Housing affordability", "description": "Fixed-income seniors and young families are being priced out. I support zoning that allows more starter homes and accessory dwelling units near transit." },
      { "title": "Road safety and traffic", "description": "Our arterial roads have not kept pace with new rooftops. I will prioritize the backlog of intersection and pedestrian-safety projects over new vanity capital spending." },
      { "title": "Public safety staffing", "description": "I support fully funding police and fire to keep response times low as the town grows, paired with transparent annual staffing reports." }
    ]
  },
  "opponents": [
    {
      "opponent_name": "Chuck Bongiovanni",
      "sources": [
        {
          "source_type": "ballotpedia",
          "source_url": "https://ballotpedia.org/Chuck_Bongiovanni",
          "text": "Chuck Bongiovanni is a member of the Gilbert Town Council, first elected in 2022. He is running for re-election in 2026. Bongiovanni's campaign emphasizes fiscal conservatism and managing Gilbert's rapid growth. On his council record he has voted for expanded road and intersection capital projects and for hiring additional police officers. He has stated that Gilbert must 'grow responsibly' and has supported impact fees on new development to fund infrastructure. Bongiovanni did not complete Ballotpedia's Candidate Connection survey for the 2026 cycle. He has not published a detailed position on long-term water supply."
        },
        {
          "source_type": "opponent_website",
          "source_url": "https://chuckforgilbert.com/issues",
          "text": "Re-elect Chuck Bongiovanni for Gilbert Town Council. Priorities: Public Safety - Chuck has supported every police and fire budget increase and will continue to fully fund first responders. Roads and Traffic - Chuck secured funding for the Higley Road widening and will keep investing in intersection improvements. Fiscal Responsibility - Chuck opposes new taxes and will protect Gilbert's AAA bond rating. Endorsed by the Gilbert Police Officers Association and the East Valley Chamber PAC."
        }
      ]
    },
    {
      "opponent_name": "Maria Delgado",
      "sources": [
        {
          "source_type": "ballotpedia",
          "source_url": "https://ballotpedia.org/Maria_Delgado",
          "text": "Maria Delgado is a candidate for Gilbert Town Council in 2026. She is a high-school teacher and first-time candidate. In her Ballotpedia Candidate Connection survey she listed water sustainability and housing affordability as her top priorities, writing that 'Gilbert needs a real long-term water plan before we approve more master-planned communities' and that she supports 'allowing more starter homes and casitas so teachers and seniors can afford to stay.' She did not list endorsements."
        }
      ]
    },
    {
      "opponent_name": "Greg Halsey",
      "sources": [
        {
          "source_type": "opponent_website",
          "source_url": "https://halseyforgilbert.com",
          "text": "Greg Halsey for Gilbert. A proud Gilbert dad. Common-sense leadership. Coming soon: my full plan for Gilbert's future."
        }
      ]
    }
  ]
}
```

## Steps

### Step 0 — Read inputs

Save the fixture to `/tmp/opponent-analysis-input.json` and confirm the field and the
allowed source URLs per opponent (the only URLs that may appear in any `sources` array).

```bash
python3 - <<'EOF'
import json
p = json.load(open("/tmp/opponent-analysis-input.json"))
print("candidate issues:", [i["title"] for i in p.get("candidate_platform", {}).get("issues", [])])
for o in p["opponents"]:
    urls = [s["source_url"] for s in o.get("sources", [])]
    chars = sum(len(s["text"]) for s in o.get("sources", []))
    print(f'{o["opponent_name"]}: {len(urls)} source(s), {chars} chars ->', urls)
EOF
```

### Step 1 — Analyze the whole field, relative to the candidate

Read every opponent's collected text and the candidate platform together, then for
each opponent emit:

- **`threat_tier`** (`primary_threat | watch_closely | low_priority`) **+ `why_they_matter`** (one sentence). Rank *relative* to the field and the candidate: incumbency, endorsements / PAC backing, name recognition, and overlap with the candidate's own issues raise the tier. Exactly one realistic `primary_threat` for a normal field.
- **`what_you_need_to_know`** (string[]) — the few takeaways a candidate must walk in knowing about this opponent. Interpretive; no per-item source required.
- **`where_soft`** (`{ text, sources? }[]`) — openings / gaps grounded in the collected text (an unaddressed issue, a skipped survey, a thin platform). Cite the source where the gap is directly evidenced.
- **`issue_contrasts`** (`{ issue, salience, why_it_matters, opponent_stance, opponent_sources?, candidate_stance }[]`) — for each candidate issue the opponent's text speaks to: the opponent's stance (+ source), a `salience` read (`high | medium | low` voter salience), why it matters to constituents, and the candidate's own stance from `candidate_platform`. Omit a contrast when the opponent's text is silent on that issue.

### Step 2 — Assemble and write

Build one entry per input opponent in input order (echo `opponent_name` verbatim),
keep the Phase-2 fields (`overview` / `background` / `key_positions`) intact, and write
`{ generated_at, opponents: [...] }`.

### Step 3 — Spot-check (validator-passing data can still be garbage)

- Every opponent stance and every `where_soft` item traces to THAT opponent's collected text; every cited URL is one of that opponent's own `source_url`s, verbatim.
- Exactly one realistic `primary_threat`; tiers are relative and justified.
- No invented facts; thin-data opponent (Greg Halsey) yields small output, not fabrication.
- Issue contrasts only where the opponent's text actually speaks to the candidate's issue; candidate stance comes only from `candidate_platform`.
- Neutral tone, no em dash (U+2014).

## Proven output shape (port this into ENG-10591's `output_schema`)

Running Step 1 on the fixture produces the analysis below. It is faithful and grounded:
Chuck (incumbent, two PAC/association endorsements, overlaps the candidate on roads and
public safety) is the lone `primary_threat`; Maria (overlaps the candidate squarely on the
two issues Chuck is silent on — water and housing) is `watch_closely`; Greg (one thin
"coming soon" page) is `low_priority` with near-empty output. Every stance and soft-spot
cites collected text; threat tiers and salience carry no extract.

```json
{
  "generated_at": "2026-06-29T00:00:00Z",
  "opponents": [
    {
      "opponent_name": "Chuck Bongiovanni",
      "overview": {
        "text": "Incumbent Gilbert Town Council member, first elected in 2022 and running for re-election in 2026 on a fiscal-conservatism and managed-growth platform.",
        "sources": ["https://ballotpedia.org/Chuck_Bongiovanni"]
      },
      "background": {
        "text": "Sitting council member whose record includes votes for road and intersection capital projects and for hiring additional police officers.",
        "sources": ["https://ballotpedia.org/Chuck_Bongiovanni"]
      },
      "key_positions": [
        { "label": "Public safety", "detail": "Has supported every police and fire budget increase and pledges to fully fund first responders.", "sources": ["https://chuckforgilbert.com/issues"] },
        { "label": "Roads and traffic", "detail": "Secured funding for the Higley Road widening and supports continued intersection improvements.", "sources": ["https://chuckforgilbert.com/issues", "https://ballotpedia.org/Chuck_Bongiovanni"] },
        { "label": "Fiscal responsibility", "detail": "Opposes new taxes, backs impact fees on new development, and points to Gilbert's AAA bond rating.", "sources": ["https://chuckforgilbert.com/issues", "https://ballotpedia.org/Chuck_Bongiovanni"] }
      ],
      "threat_tier": "primary_threat",
      "why_they_matter": "The only incumbent in the field, he carries name recognition plus police-association and chamber-PAC backing and competes directly on roads and public safety.",
      "what_you_need_to_know": [
        "First-term incumbent (elected 2022) seeking re-election, with an infrastructure-and-public-safety record voters already associate with the office.",
        "Endorsed by the Gilbert Police Officers Association and the East Valley Chamber PAC, so he will be resourced and have an organized base.",
        "He has no published long-term water position and skipped the 2026 Ballotpedia survey, leaving water and detailed platform openings."
      ],
      "where_soft": [
        { "text": "Has not published a detailed long-term water-supply position despite Gilbert's growth pressures.", "sources": ["https://ballotpedia.org/Chuck_Bongiovanni"] },
        { "text": "Did not complete the 2026 Ballotpedia Candidate Connection survey, so his current-cycle positions are thinly documented.", "sources": ["https://ballotpedia.org/Chuck_Bongiovanni"] }
      ],
      "issue_contrasts": [
        {
          "issue": "Road safety and traffic",
          "salience": "high",
          "why_it_matters": "Arterial congestion and intersection safety are top day-to-day concerns for Gilbert households as new rooftops outpace road capacity.",
          "opponent_stance": "Touts securing the Higley Road widening and continued intersection-improvement funding as part of his record.",
          "opponent_sources": ["https://chuckforgilbert.com/issues"],
          "candidate_stance": "Prioritize the backlog of intersection and pedestrian-safety projects over new vanity capital spending."
        },
        {
          "issue": "Public safety staffing",
          "salience": "high",
          "why_it_matters": "Response times and first-responder staffing track directly with resident safety as the town grows.",
          "opponent_stance": "Has supported every police and fire budget increase and pledges to continue fully funding first responders.",
          "opponent_sources": ["https://chuckforgilbert.com/issues"],
          "candidate_stance": "Fully fund police and fire to keep response times low, paired with transparent annual staffing reports."
        }
      ]
    },
    {
      "opponent_name": "Maria Delgado",
      "overview": {
        "text": "First-time candidate for Gilbert Town Council in 2026 and a high-school teacher.",
        "sources": ["https://ballotpedia.org/Maria_Delgado"]
      },
      "background": {
        "text": "High-school teacher running for office for the first time.",
        "sources": ["https://ballotpedia.org/Maria_Delgado"]
      },
      "key_positions": [
        { "label": "Water sustainability", "detail": "Says Gilbert needs a real long-term water plan before approving more master-planned communities.", "sources": ["https://ballotpedia.org/Maria_Delgado"] },
        { "label": "Housing affordability", "detail": "Supports allowing more starter homes and casitas so teachers and seniors can afford to stay.", "sources": ["https://ballotpedia.org/Maria_Delgado"] }
      ],
      "threat_tier": "watch_closely",
      "why_they_matter": "She competes directly for the water and housing-affordability voters at the center of the candidate's platform, even without an organized base.",
      "what_you_need_to_know": [
        "First-time candidate with no listed endorsements, so likely under-resourced relative to the incumbent.",
        "Her two headline issues, water and housing, overlap the candidate's almost exactly, so she contests the same lane."
      ],
      "where_soft": [
        { "text": "Listed no endorsements and is a first-time candidate, indicating a thin organizational and fundraising base.", "sources": ["https://ballotpedia.org/Maria_Delgado"] }
      ],
      "issue_contrasts": [
        {
          "issue": "Water security",
          "salience": "high",
          "why_it_matters": "Long-term water supply is an existential growth question for Gilbert voters and is unaddressed by the incumbent.",
          "opponent_stance": "Wants a real long-term water plan in place before approving more master-planned communities.",
          "opponent_sources": ["https://ballotpedia.org/Maria_Delgado"],
          "candidate_stance": "Push for a published 50-year water plan and conservation incentives before approving new large-scale development."
        },
        {
          "issue": "Housing affordability",
          "salience": "medium",
          "why_it_matters": "Teachers, young families, and fixed-income seniors are being priced out of Gilbert.",
          "opponent_stance": "Supports allowing more starter homes and casitas so teachers and seniors can afford to stay.",
          "opponent_sources": ["https://ballotpedia.org/Maria_Delgado"],
          "candidate_stance": "Support zoning that allows more starter homes and accessory dwelling units near transit."
        }
      ]
    },
    {
      "opponent_name": "Greg Halsey",
      "overview": {
        "text": "Candidate for Gilbert Town Council whose campaign site presents him as a Gilbert parent promising common-sense leadership.",
        "sources": ["https://halseyforgilbert.com"]
      },
      "background": null,
      "key_positions": [],
      "threat_tier": "low_priority",
      "why_they_matter": "His only public presence is a placeholder site with no stated positions, so he poses little near-term competitive threat.",
      "what_you_need_to_know": [
        "Campaign platform is still 'coming soon', so there is no documented position to engage yet."
      ],
      "where_soft": [
        { "text": "Campaign website states a full plan is 'coming soon' and lists no issue positions.", "sources": ["https://halseyforgilbert.com"] }
      ],
      "issue_contrasts": []
    }
  ]
}
```

### Why this is the right shape for ENG-10591

- **Additive over Phase 2.** `overview` / `background` / `key_positions` are unchanged from the Phase-2 schema, so the Phase-2 page keeps rendering mid-rollout; the analytical fields sit alongside them. This is not a transparent superset of the *current* manifest: the `race_opponent_summary` `output_schema` declares `additionalProperties: false` on the opponent item, so emitting these five fields requires ENG-10591 to add them to that schema's `properties` (and `required`) first. "Additive" means it preserves the descriptive fields, not that the live validator already accepts the new ones.
- **Relaxed sourcing is encoded by which fields carry sources.** `where_soft[].sources` and `issue_contrasts[].opponent_sources` are optional (cite where direct); `threat_tier`, `why_they_matter`, `what_you_need_to_know`, and `salience` are interpretive and sourceless by design.
- **Empty `candidate_platform` degrades cleanly.** Drop `issue_contrasts` (empty array) and every other field still computes — proven by the Greg Halsey entry, which has no contrasts even with a platform present because his text is silent on every candidate issue.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Two or more `primary_threat` opponents | Tiers scored in isolation, not relative to the field | Re-rank across the whole field; reserve `primary_threat` for the single strongest |
| An opponent stance with no basis in their text | Inferred a position from party or general knowledge | Every stance must quote-trace to that opponent's collected text; omit the contrast otherwise |
| A `sources` URL not in the opponent's input | Invented or cross-opponent URL | Cite only that opponent's own `source_url`s, verbatim |
| Candidate stance pulled from somewhere other than the platform | Reached into `CampaignStory` / general knowledge | Candidate stance comes only from `candidate_platform.issues[]` |
| Thin-data opponent gets a fabricated platform | Filled gaps to make output symmetrical | Thin data → small output (`key_positions: []`, `issue_contrasts: []`); never invent |
| Output reads like an attack | Over-reached past fair-line tone | State the opponent's stance as the source states it; the contrast is factual, not editorial |
