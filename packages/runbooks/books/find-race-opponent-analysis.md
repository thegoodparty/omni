Read the already-collected opponent text plus the candidate's own platform (`bio` + `issues`) and synthesize the v2 opponent brief that drives the redesigned `/opponent` page: per opponent a threat tier, `overview`, `why_theyre_running`, `background`, and `issues_that_matter`, plus one campaign-level `field_analysis` (SWOT). This is relaxed, grounded synthesis over text we already have — no web research, no discovery, no fetching, no `verify_quote`.

This is the source runbook for the brief redesign (ENG-10627 Phase 5). It proves the new output shape on real Phase-0 data before ENG-10629 ports it into the existing `race_opponent_summary` PMF experiment, which today still runs the pre-redesign analytical shape (`key_positions` / `why_they_matter` / `what_you_need_to_know` / `where_soft` / `issue_contrasts`). The paired experiment is `experiments/race_opponent_summary/`. See `.claude/skills/build-cap-agent/SKILL.md` for the port.

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
- `candidate_platform` — the candidate's own `{ bio?, issues?: [{ title, description }] }`, shaped exactly like `Website.content.about` (the pre-Pro-upgrade `CandidateProfileStep` capture). May be absent — then `field_analysis` is omitted entirely (not an empty object; `null`).
- `race_context` — `{ office_name?, state?, city?, election_date? }`, phrasing context only.

**Output**: `{ generated_at, opponents: [...], field_analysis }`. Each opponent entry carries `opponent_name`, `threat_tier`, `overview`, `why_theyre_running`, `background`, `issues_that_matter`. `field_analysis` is the one campaign-level SWOT, or `null` when `candidate_platform` is absent. The proven shape is documented under "Proven output shape" below — it becomes the `output_schema` for ENG-10629.

**Dropped from the old (pre-redesign) shape**: `key_positions`, `why_they_matter`, `what_you_need_to_know`, `where_soft`, `issue_contrasts`, `salience`. None of these field names may appear anywhere in the output.

## What you need to know

- **Analyze the whole field at once.** Threat tiers are *relative* — exactly one realistic `primary_threat` for a typical small-race field, the rest ranked `watch_closely` / `low_priority`. Rank relative to the candidate: incumbency, party / PAC backing, name recognition, and overlap with the candidate's own issues all raise a tier. This rule is unchanged from the pre-redesign shape.
- **Descriptive sections are sourced-or-silent; interpretive fields are not.** `overview`, `background`, and `issues_that_matter` are descriptive — each carries >=1 rich source or is `null` when the text supports none. `threat_tier`, `why_theyre_running`, and the `field_analysis` SWOT lists are interpretive conclusions and carry no required source.
- **Never invent facts.** Every sentence in `overview` / `background` / `issues_that_matter` must be supported by that opponent's own collected text. Do not infer positions from party, fill gaps from general knowledge, or carry a fact from one opponent onto another. Thin data → smaller output (`null` sections, fewer bullets), not fabrication.
- **The candidate side comes only from `candidate_platform`** (`Website.content.about`). Never pull the candidate's stance from `CampaignStory` / `CampaignPosition` self-research — that path is deliberately avoided.
- **`why_theyre_running` is the opponent's own motivation, told usefully to the candidate — not a you-vs-them pitch.** Write it as *their* case to voters (why they say they're running, what they're offering), synthesized across their collected text. It is interpretive (no source), but it must still trace back to something in their text — a stated priority, a campaign frame, a record they're running on. Do NOT write it as the candidate's contrast ("You're running to give voters a change from X") — that is a different field this schema does not have. Bad: "You need to beat Chuck because he's out of touch." Good: "Chuck is running to keep his seat and continue steering Gilbert's growth from a fiscally conservative footing; his case to voters is a council record on roads and public safety."
- **`issues_that_matter` is a short bullet list, not a positions table.** 3-6 short strings capturing the issues/themes the opponent's own text emphasizes (their platform points, endorsed priorities, campaign themes), with one shared `sources` array for the section (>=1 rich source). This replaces the old per-item `key_positions` (`label`/`detail`/`sources` each) — collapse into short bullet strings, section-level sourcing.
- **`field_analysis` is campaign-level, not per-opponent, and only exists when `candidate_platform` is present.** Derive `strengths` / `weaknesses` / `opportunities` / `threats` (3-5 short bullets each) by comparing `candidate_platform` against the whole collected opponent field: where the candidate's own issues are undercontested by the field (opportunity), where an opponent's endorsements/incumbency outmatch the candidate's visibility (threat), where the candidate's own platform is more specific or more aligned with voter concerns than the field (strength), where the candidate has no comparable record or backing (weakness). These are interpretive syntheses across the whole field — they carry no required source (an optional `sources` array exists in the schema for the rare case where a bullet rests directly on a specific cited claim, but do not force one in).
- **Rich sources everywhere a source is required.** Every source object is `{ url, title, publisher, description }`:
  - `url` — verbatim one of that opponent's input `source_url`s. Never invented, never cross-opponent, never `race_context` or `candidate_platform`.
  - `title` — the cited page/document's human title. Phase 0 does not capture a separate title field, so derive it from the page's own content (a stated candidate/page name, e.g. "Chuck Bongiovanni") plus source type context (e.g. "Chuck Bongiovanni - Ballotpedia", "Issues - Chuck Bongiovanni for Gilbert"). This describes the *document*, not a new fact about the opponent — it is never itself a place to introduce an unsupported claim.
  - `publisher` — the site/org name. `ballotpedia` sources are published by "Ballotpedia". `opponent_website` sources are published under whatever campaign/org name the page's own text uses (e.g. "Chuck Bongiovanni for Gilbert Town Council"); if the text names no organization, fall back to the bare hostname (e.g. "halseyforgilbert.com").
  - `description` — one sentence on what the source is (e.g. "Ballotpedia's candidate page for Chuck Bongiovanni, covering his council record and 2026 campaign."). Also derived from the page's own content, never a claim about the opponent that isn't in the text.
- **Neutral, fair-line tone. No em dashes.** State opponent positions as the source states them; `why_theyre_running` and `field_analysis` are factual/interpretive syntheses, not attacks.

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

### Step 1 — Rank the field (relative threat tiers)

Read every opponent's collected text and the candidate platform together. For each
opponent assign `threat_tier` (`primary_threat | watch_closely | low_priority`),
ranked *relative* to the field and the candidate: incumbency, endorsements / PAC
backing, name recognition, and overlap with the candidate's own issues raise the
tier. Exactly one realistic `primary_threat` for a normal field. Interpretive — no
source.

### Step 2 — Structure the descriptive sections (overview, background)

For each opponent, restate their own text into two display sections, each carrying
>=1 rich source drawn from that opponent's input `source_url`s:
- **`overview`** — short, neutral who-they-are paragraph (2-4 sentences), or `null` if the text supports none.
- **`background`** — career, community ties, prior roles the text contains, or `null`.

### Step 3 — Why they're running

For each opponent, write `why_theyre_running` — one to two sentences synthesizing
their own case to voters (their stated priorities, campaign frame, or record),
told usefully to the candidate reading it. Interpretive — carries no `sources` key
at all. Follow the framing rule above: their motivation, not a you-vs-them pitch.

### Step 4 — Issues that matter

For each opponent, write `issues_that_matter` — a short bullet list (3-6 short
strings) of the issues/themes their own text emphasizes, with one `sources` array
(>=1 rich source) shared across the section. `null` when the text supports no
groundable issue bullets (e.g. a placeholder site with no stated positions).

### Step 5 — Field analysis (campaign-level SWOT)

Only when `candidate_platform` is present: read `candidate_platform` against the
whole collected opponent field and write one `field_analysis` with `strengths` /
`weaknesses` / `opportunities` / `threats` (3-5 short bullets each), comparing the
candidate's own platform to what the field collectively shows (coverage gaps,
endorsement/incumbency asymmetries, issue overlap). Interpretive — bullets carry no
required source; leave `sources` empty unless a bullet rests directly on a specific
cited claim worth pinning down. When `candidate_platform` is absent, omit
`field_analysis` (`null`), not an empty object.

### Step 6 — Assemble and write

Build one opponent entry per input opponent in input order (echo `opponent_name`
verbatim), plus the single top-level `field_analysis`, and write
`{ generated_at, opponents: [...], field_analysis }`.

### Step 7 — Spot-check (validator-passing data can still be garbage)

- Exactly one realistic `primary_threat`; tiers are relative and justified.
- Every `overview` / `background` / `issues_that_matter` section that isn't `null` carries >=1 rich source, and every cited `url` is one of that opponent's own `source_url`s, verbatim.
- `why_theyre_running` carries no `sources` key and is written as the opponent's own motivation, not a you-vs-them pitch.
- `field_analysis` is present only when `candidate_platform` was provided, and is `null` otherwise.
- No invented facts; thin-data opponent (Greg Halsey) yields `null` background and `issues_that_matter`, not fabrication.
- None of the dropped fields (`key_positions`, `why_they_matter`, `what_you_need_to_know`, `where_soft`, `issue_contrasts`, `salience`) appear anywhere in the output.
- Neutral tone, no em dash (U+2014).

## Proven output shape (port this into ENG-10629's `output_schema`)

Running Steps 1-5 on the fixture produces the brief below. It is faithful and
grounded: Chuck (incumbent, two PAC/association endorsements, overlaps the
candidate on roads and public safety) is the lone `primary_threat`; Maria
(overlaps the candidate squarely on the two issues Chuck is silent on — water and
housing) is `watch_closely`; Greg (one thin "coming soon" page) is `low_priority`
with a `null` background and `null` issues. Every descriptive section cites
collected text; `why_theyre_running` and `field_analysis` carry no sources.

```json
{
  "generated_at": "2026-07-01T00:00:00Z",
  "opponents": [
    {
      "opponent_name": "Chuck Bongiovanni",
      "threat_tier": "primary_threat",
      "overview": {
        "text": "Chuck Bongiovanni is the incumbent on the Gilbert Town Council, first elected in 2022, running for re-election in 2026 on a fiscal-conservatism and managed-growth platform. His campaign emphasizes continuing the record he already has in office.",
        "sources": [
          {
            "url": "https://ballotpedia.org/Chuck_Bongiovanni",
            "title": "Chuck Bongiovanni - Ballotpedia",
            "publisher": "Ballotpedia",
            "description": "Ballotpedia's candidate page for Chuck Bongiovanni, covering his council record and 2026 campaign."
          }
        ]
      },
      "why_theyre_running": {
        "text": "Bongiovanni is running to keep his seat and continue steering Gilbert's growth from a fiscally conservative footing; his case to voters is a council record on roads and public safety, not a newcomer's promises."
      },
      "background": {
        "text": "A sitting council member since 2022, Bongiovanni's record includes votes for expanded road and intersection capital projects and for hiring additional police officers. He has not published a detailed long-term water position and did not complete Ballotpedia's 2026 Candidate Connection survey.",
        "sources": [
          {
            "url": "https://ballotpedia.org/Chuck_Bongiovanni",
            "title": "Chuck Bongiovanni - Ballotpedia",
            "publisher": "Ballotpedia",
            "description": "Ballotpedia's candidate page for Chuck Bongiovanni, covering his council record and 2026 campaign."
          }
        ]
      },
      "issues_that_matter": {
        "items": [
          "Public safety funding: has supported every police and fire budget increase and pledges to keep fully funding first responders.",
          "Roads and traffic: points to securing the Higley Road widening and ongoing intersection-improvement funding.",
          "Fiscal responsibility: opposes new taxes, backs impact fees on new development, and points to Gilbert's AAA bond rating.",
          "Growth management: says Gilbert must 'grow responsibly' and has supported impact fees to fund infrastructure as the town grows."
        ],
        "sources": [
          {
            "url": "https://chuckforgilbert.com/issues",
            "title": "Issues - Chuck Bongiovanni for Gilbert",
            "publisher": "Chuck Bongiovanni for Gilbert Town Council",
            "description": "Chuck Bongiovanni's campaign website issues page listing his public-safety, roads, and fiscal-responsibility priorities."
          },
          {
            "url": "https://ballotpedia.org/Chuck_Bongiovanni",
            "title": "Chuck Bongiovanni - Ballotpedia",
            "publisher": "Ballotpedia",
            "description": "Ballotpedia's candidate page for Chuck Bongiovanni, covering his council record and 2026 campaign."
          }
        ]
      }
    },
    {
      "opponent_name": "Maria Delgado",
      "threat_tier": "watch_closely",
      "overview": {
        "text": "Maria Delgado is a first-time candidate for Gilbert Town Council in 2026 and works as a high-school teacher.",
        "sources": [
          {
            "url": "https://ballotpedia.org/Maria_Delgado",
            "title": "Maria Delgado - Ballotpedia",
            "publisher": "Ballotpedia",
            "description": "Ballotpedia's candidate page for Maria Delgado, including her 2026 Candidate Connection survey responses."
          }
        ]
      },
      "why_theyre_running": {
        "text": "Delgado is running because she sees Gilbert's growth outpacing its water planning and pricing teachers and seniors out of housing; her case to voters is a real long-term water plan and more starter-home zoning before approving more large developments."
      },
      "background": {
        "text": "A high-school teacher with no prior elected experience, Delgado is running her first campaign for local office and listed no endorsements in her candidate survey.",
        "sources": [
          {
            "url": "https://ballotpedia.org/Maria_Delgado",
            "title": "Maria Delgado - Ballotpedia",
            "publisher": "Ballotpedia",
            "description": "Ballotpedia's candidate page for Maria Delgado, including her 2026 Candidate Connection survey responses."
          }
        ]
      },
      "issues_that_matter": {
        "items": [
          "Water sustainability: wants a real long-term water plan in place before approving more master-planned communities.",
          "Housing affordability: supports allowing more starter homes and casitas so teachers and seniors can afford to stay."
        ],
        "sources": [
          {
            "url": "https://ballotpedia.org/Maria_Delgado",
            "title": "Maria Delgado - Ballotpedia",
            "publisher": "Ballotpedia",
            "description": "Ballotpedia's candidate page for Maria Delgado, including her 2026 Candidate Connection survey responses."
          }
        ]
      }
    },
    {
      "opponent_name": "Greg Halsey",
      "threat_tier": "low_priority",
      "overview": {
        "text": "Greg Halsey is a candidate for Gilbert Town Council whose campaign presence is limited to a single placeholder website describing him as a Gilbert parent.",
        "sources": [
          {
            "url": "https://halseyforgilbert.com",
            "title": "Greg Halsey for Gilbert",
            "publisher": "Greg Halsey for Gilbert",
            "description": "Greg Halsey's campaign homepage, a placeholder page with no detailed platform yet."
          }
        ]
      },
      "why_theyre_running": {
        "text": "Halsey's campaign frames itself around being a Gilbert parent offering common-sense leadership, but he has not yet published a specific platform, so his case to voters is general rather than built on particular issues."
      },
      "background": null,
      "issues_that_matter": null
    }
  ],
  "field_analysis": {
    "strengths": [
      "Only candidate in the field with a concrete, dated commitment (a published 50-year water plan) on the issue neither leading opponent has addressed in detail.",
      "Housing and road-safety positions are more specific than either opponent's collected platform, naming zoning and intersection-project mechanisms rather than general priorities.",
      "12 years of Gilbert residency plus HOA-board and youth-coaching ties match or exceed the local-roots signal either opponent's collected text shows."
    ],
    "weaknesses": [
      "No incumbency or council voting record to point to, unlike Bongiovanni's two years in office.",
      "No published endorsements on file, the same exposure Delgado's collected text shows."
    ],
    "opportunities": [
      "Bongiovanni has not published a detailed water position and skipped the 2026 Ballotpedia survey, an opening to lead on water specifically against the field's strongest opponent.",
      "Delgado's water and housing message overlaps the candidate's closely; differentiating on roads and public-safety specifics, where she has no stated position, is open ground."
    ],
    "threats": [
      "Bongiovanni's police-association and chamber-PAC endorsements give him organized turnout support the candidate's platform has no equivalent for.",
      "Bongiovanni's incumbency and existing name recognition on roads and public safety compete directly with the candidate's own top two issues."
    ],
    "sources": []
  }
}
```

**When `candidate_platform` is absent**, every opponent entry above is unchanged
(threat tiers, descriptive sections, and `why_theyre_running` never depend on the
candidate's platform) and the top-level `field_analysis` key is `null`.

### Why this is the right shape for ENG-10629

- **Field name changes are a hard break, not additive.** Unlike the prior analytical extension (which sat alongside the untouched Phase-2 descriptive fields), this redesign drops `key_positions`, `why_they_matter`, `what_you_need_to_know`, `where_soft`, `issue_contrasts`, and `salience` outright and renames the sourced-text shape to rich `{ url, title, publisher, description }` objects. ENG-10629 replaces the manifest's `output_schema` `properties` for the opponent item wholesale rather than adding to it, and the contracts schema (ENG-10630) needs a legacy-row union-normalization path for existing persisted rows (old `{sourceType, sourceUrl}` refs), not just new optional fields.
- **The input side is unchanged.** `opponents[].sources[]`, `candidate_platform`, and `race_context` keep the same shape as today's live manifest — only the `output_schema` moves. No `input_schema` change is needed in ENG-10629.
- **Rich source metadata is synthesized, not collected.** Phase 0 never captures a title/publisher/description alongside `source_url` — the agent derives them from the page's own text plus source type at analysis time. ENG-10629's instruction must carry this derivation rule explicitly (see "Deriving rich source metadata" above) since it's new agent behavior, not a schema-only change.
- **`field_analysis` is one object at the top level of the artifact, not per-opponent.** It needs its own top-level key alongside `opponents`, present only when `candidate_platform` was supplied.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Two or more `primary_threat` opponents | Tiers scored in isolation, not relative to the field | Re-rank across the whole field; reserve `primary_threat` for the single strongest |
| A section with no basis in the opponent's text | Inferred a position from party or general knowledge | Every claim must quote-trace to that opponent's collected text; set the section `null` otherwise |
| A `sources` URL not in the opponent's input | Invented or cross-opponent URL | Cite only that opponent's own `source_url`s, verbatim |
| `title` / `publisher` describes something not in the text | Fabricated document metadata instead of deriving it from the page's own content | Derive `title`/`publisher`/`description` only from what the collected text and source type actually show; fall back to the bare hostname if the text names no organization |
| `why_theyre_running` reads as the candidate's pitch against the opponent | You-vs-them framing instead of the opponent's own motivation | Rewrite as the opponent's stated case to voters, synthesized from their own text |
| `why_theyre_running` carries a `sources` array | Treated an interpretive field like a descriptive one | Interpretive fields (`threat_tier`, `why_theyre_running`, `field_analysis` lists) carry no `sources` key |
| `field_analysis` present with no `candidate_platform` in the input | Emitted the SWOT unconditionally | Only emit `field_analysis` when `candidate_platform` is present; otherwise `null` |
| A dropped field (`key_positions`, `where_soft`, etc.) shows up in the output | Ported logic from the pre-redesign shape without updating field names | Re-check the output against the "Proven output shape" above; none of the dropped fields belong in any entry |
| Thin-data opponent gets a fabricated platform | Filled gaps to make output symmetrical | Thin data → `null` sections, not invention (Greg Halsey's `background`/`issues_that_matter` are `null`) |
| Output reads like an attack | Over-reached past fair-line tone | State the opponent's stance as the source states it; `field_analysis` compares facts, not editorializes |
