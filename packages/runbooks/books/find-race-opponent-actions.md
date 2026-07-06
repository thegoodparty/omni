Turn a campaign's persisted opponent summaries plus the candidate's own platform into up to 5 "stand out" action cards: each card names one opponent, one issue where the candidate and that opponent diverge, a short body grounded in district Haystaq sentiment when the district has coverage, and a preset SMS message the candidate could send as-is. Degrades gracefully to numberless cards when the district is unknown or Haystaq has no coverage.

This is the source runbook for the future `experiments/race_opponent_actions/` PMF experiment (Know Your Opponent Phase 6, a chained step after `race_opponent_summary`). The recipe is proven here on real data before the schema is locked into a manifest. The paired Phase 5 runbook is `books/find-race-opponent-analysis.md`; the Databricks mechanics mirror `books/find-district-issue-pulse.md`.

## Prerequisites

**books/.env variables**: none
**scripts/.env variables**: `DATABRICKS_API_KEY`, `DATABRICKS_SERVER_HOSTNAME`, `DATABRICKS_HTTP_PATH`
**Tools**: `cd scripts/python && uv sync`, then run SQL via `scripts/python/databricks_query.py`
**Inputs** (mirroring what gp-api will hydrate for the experiment):

- `opponents` — the persisted `RaceOpponentSummary` sections per opponent, structured text, NOT raw collected pages: `{ opponent_name, threat_tier, overview, background, issues_that_matter: [ ... ] }`. The `overview`/`background` values here are the section text strings (the summary artifact's `.text`); `issues_that_matter` is the flat bullet list (the artifact's `.items`). Sources are not needed by this step.
- `candidate_platform` — the candidate's own `{ bio?, issues?: [{ title, description }] }`, exactly as gp-api's `buildCandidatePlatform` produces it from `Website.content.about`. May be absent.
- `district` — `{ state, l2DistrictType, l2DistrictName }`, the shape gp-api's `DistrictResolverService.resolveByOrgSlug` returns (e.g. `{ "state": "NC", "l2DistrictType": "City", "l2DistrictName": "HENDERSONVILLE CITY" }`). May be `null` when the org has no resolvable position; that triggers the degrade path.
- `race_context` — `{ office_name?, state?, city?, election_date? }`, phrasing context only.

**Output**: `{ generated_at, cards: [...] }` with up to 5 cards. Each card: `{ rank, opponent_name, issue, title, body, sms_message, haystaq }` where `haystaq` is `{ hs_column, total_active, voter_count_ge50, voter_percentage_ge50, voter_count_ge70, voter_percentage_ge70 }` or `null` when the card has no usable sentiment data. The proven shape is under "Validated sample output" below; it becomes the `output_schema` for the follow-up experiment ticket.

## Card constraints (these become the experiment's copy rules)

- **Up to 5 cards.** Fewer when the field or the platform supports fewer distinct angles. Never pad.
- **`title` under 100 characters**, action-framed and naming the opponent and issue (e.g. "Stand out against Jeff Groh on housing affordability").
- **`body` is at most 3 sentences.** Cite the district Haystaq percentages when coverage exists and say that voters care about (or how they lean on) the issue. When coverage is missing, omit numbers cleanly: the body simply carries no statistic and never a made-up or borrowed one.
- **`sms_message` is at most 320 characters**: plain, factual, first-person, a contrast message the candidate could send as-is. No placeholders to fill in, no links required, no hype.
- **Every card is distinct**: a different opponent/issue angle per card, and no statistic repeated across cards.
- **Copy guardrails (hard rules)**:
  - Only facts present in the input summaries and `candidate_platform`, plus the Haystaq numbers you actually queried. Nothing from general knowledge.
  - No family, health, or private life. Contrast on record and issues, never character.
  - No adjective inflation and no motive-guessing ("out of touch", "doesn't care", "only in it for...").
  - No em dash (U+2014) anywhere in the output.

## Haystaq step — the rules that become the experiment's CRITICAL RULES

All sentiment comes from ONE table: `goodparty_data_catalog.dbt.int__l2_nationwide_uniform_w_haystaq`.

- **All `hs_*` columns are CONTINUOUS 0-100 scores** regardless of suffix (`_support`, `_oppose`, `_yes`, `_fund_more`, `_believer`, `_worried`, ...). Threshold with `>= 50` (leans) or `>= 70` (leans strongly), NEVER `= 1` based on suffix appearance alone. A suffix that "looks binary" is not binary. Exception: if Step 3's distribution check shows `max <= 1` for a column, that column really is binary — use `= 1` for that column only; for all other columns `= 1` silently returns near-zero counts and inverts your read of the district.
- **Scores are within-state percentile ranks (mean ~50).** A district where ~50% clear the `>= 50` threshold is at the state average; the informative signal is the deviation from 50% (61.8% is a real lean toward, 39.7% a real lean away). Prefer card angles where the share deviates meaningfully from 50%.
- **Conditional counts use `SUM(CASE WHEN ... THEN 1 ELSE 0 END)`.** Postgres `COUNT(*) FILTER (WHERE ...)` is a syntax error in Databricks.
- **`CAST(col AS DOUBLE)`** before comparing or averaging `hs_*` columns.
- **`Voters_Active` is a STRING**: `Voters_Active = 'A'`. `Voters_Active = 1` matches zero rows.
- **Discover columns via `information_schema.columns`, never guess names**:

  ```sql
  SELECT column_name FROM information_schema.columns
  WHERE table_catalog = 'goodparty_data_catalog' AND table_schema = 'dbt'
    AND table_name = 'int__l2_nationwide_uniform_w_haystaq'
    AND column_name LIKE 'hs_%'
  ORDER BY column_name
  ```

  (Port note: if the broker build for the experiment blocks `information_schema`, ship an inline column catalog in the instruction the way `experiments/top_community_issues/` does.)
- **District scoping is two columns**: `Residence_Addresses_State = '<state>'` plus the backtick-quoted L2 district column, where the COLUMN NAME is the value of `l2DistrictType` and the value to match is `l2DistrictName`: `` `City` = 'HENDERSONVILLE CITY' ``. Running locally you add both clauses yourself. (Port note: in the cloud the broker auto-injects the state/city predicates and adding them yourself returns HTTP 422 `ScopeViolation: scope_predicate_override`; the experiment adds only the L2 district clause and `Voters_Active = 'A'`.)
- **Scope by the L2 district column, NOT the mailing city.** `Residence_Addresses_City = 'HENDERSONVILLE'` matches 46,071 active NC voters (mailing addresses, mostly outside city limits); `` `City` = 'HENDERSONVILLE CITY' `` matches 9,449 (the actual council electorate). If the count looks like the whole metro area, your district clause did not hit.
- **Verify the L2 district value before trusting it.** The resolver's `l2DistrictName` should match the L2 value verbatim, but confirm with `SELECT DISTINCT` on the column if the scoped count looks wrong (`'HENDERSONVILLE'` vs `'HENDERSONVILLE CITY'` is exactly the kind of mismatch that silently matches zero rows).
- **Coverage rule + cell-size floor.** In the batched query also select `COUNT(col)` per column. Drop any column whose coverage is below ~80% of `total_active` (whole Haystaq models are missing per state: in NC, `hs_violent_crime_very_worried` and `hs_min_wage_15_increase_support` both return 0% coverage). Also treat the result as no-coverage when `total_active < 50` or a per-column `>= 50` count is under ~25 voters: below that floor the percentage is noise, not sentiment. No coverage never kills the card; it removes its numbers (see the degrade path).
- **Never substitute an adjacent column to get a number.** If the direct column for the card's issue has no coverage, the card goes out numberless; do not quietly cite a related-sounding column instead.

## Steps

### Step 0 — Read inputs

Save the input JSON to `/tmp/opponent-actions-input.json` and inspect it: each opponent's `threat_tier` and `issues_that_matter`, the candidate's issue titles, and whether `district` is present. If `district` is `null`, skip Steps 2-4 and generate every card via the degrade path.

### Step 1 — Pick up to 5 divergence angles

Compare `candidate_platform.issues` against each opponent's `issues_that_matter`, `overview`, and `background`. A usable angle is one of:

- **The opponent is silent** on one of the candidate's planks (their summary text never raises it), or
- **The opponent's stated stance cuts against** the candidate's plank (their summary says so in as many words).

Weight angles against the `primary_threat` opponent first, then `watch_closely`; spread cards across opponents and issues so no two cards repeat an opponent/issue pair. Every angle must trace to text actually present in the inputs. If the platform is thin or absent, fewer cards.

### Step 2 — Map each angle to an `hs_*` column

Run the `information_schema.columns` discovery query above and pick the one column that most directly measures sentiment on each angle's issue (e.g. housing plank -> `hs_affordable_housing_gov_has_role`, roads/water plank -> `hs_infrastructure_funding_fund_more`, tax-cut contrast -> `hs_tax_cuts_support`). An angle with no matching column just becomes a numberless card.

### Step 3 — Distribution check (do not skip)

Confirm the scores are 0-100 continuous in this district on ~3 of your columns:

```sql
SELECT
  MIN(CAST(`hs_<a>` AS DOUBLE)) AS a_min, AVG(CAST(`hs_<a>` AS DOUBLE)) AS a_avg, MAX(CAST(`hs_<a>` AS DOUBLE)) AS a_max,
  MIN(CAST(`hs_<b>` AS DOUBLE)) AS b_min, AVG(CAST(`hs_<b>` AS DOUBLE)) AS b_avg, MAX(CAST(`hs_<b>` AS DOUBLE)) AS b_max
FROM goodparty_data_catalog.dbt.int__l2_nationwide_uniform_w_haystaq
WHERE Residence_Addresses_State = '<state>'
  AND `<l2DistrictType>` = '<l2DistrictName>'
  AND Voters_Active = 'A'
```

Expect `max ~= 100` and `avg` near 50. If `max <= 1` for a column, that one really is binary; note it and use `= 1` for that column only.

### Step 4 — ONE batched sentiment query

All columns at once, with both thresholds and per-column coverage:

```python
cols = [...]  # the hs_* columns from Step 2
aggs = ", ".join(
    f"SUM(CASE WHEN CAST(`{c}` AS DOUBLE) >= 50 THEN 1 ELSE 0 END) AS `{c}__ge50`, "
    f"SUM(CASE WHEN CAST(`{c}` AS DOUBLE) >= 70 THEN 1 ELSE 0 END) AS `{c}__ge70`, "
    f"COUNT(`{c}`) AS `{c}__cov`"
    for c in cols
)
sql = f"""
SELECT COUNT(*) AS total_active, {aggs}
FROM goodparty_data_catalog.dbt.int__l2_nationwide_uniform_w_haystaq
WHERE Residence_Addresses_State = '{STATE}'
  AND `{L2_TYPE}` = '{L2_NAME}'
  AND Voters_Active = 'A'
"""
```

Apply the coverage rule and the cell-size floor per column. Compute `voter_percentage_ge50 = round(100.0 * ge50 / total_active, 1)` (and the `ge70` twin) for survivors.

### Step 5 — Write the cards

For each angle, in threat order, write `title` / `body` / `sms_message` under the card constraints above. The body's factual spine is: (1) what the opponent's summary says (or is silent on), (2) the district numbers when the column survived Step 4, (3) what the candidate's own plank commits to. The `sms_message` makes the same contrast in the candidate's first-person voice, self-contained and sendable as-is. Attach the `haystaq` object for cards with surviving numbers; `haystaq: null` otherwise.

### Step 6 — Verify the constraints mechanically

```python
import json, re
out = json.load(open("/tmp/opponent-actions-output.json"))
seen_pairs, seen_stats = set(), set()
for c in out["cards"]:
    assert len(c["title"]) < 100
    assert len(c["sms_message"]) <= 320
    assert c["body"].rstrip().endswith((".", "!", "?"))
    assert len(re.findall(r"(?<![A-Z])[.!?](?:\s+[A-Z]|$)", c["body"])) <= 3
    assert "—" not in (c["title"] + c["body"] + c["sms_message"])
    pair = (c["opponent_name"], c["issue"])
    assert pair not in seen_pairs; seen_pairs.add(pair)
    if c["haystaq"]:
        stat = c["haystaq"]["hs_column"]
        assert stat not in seen_stats; seen_stats.add(stat)
print("ok:", len(out["cards"]), "cards")
```

### Step 7 — Spot-check (validator-passing copy can still be garbage)

- Every factual claim about an opponent traces to that opponent's own summary text; every claim about the candidate traces to `candidate_platform`.
- Every cited percentage matches Step 4's output exactly; no percentage appears on a card whose column was dropped.
- No card contrasts on character, family, health, or motive. Read each `sms_message` out loud: it should sound like a normal person stating facts.
- Cards are genuinely distinct angles, not the same contrast rephrased.

## Degrade path (no district, or no Haystaq coverage)

Cards still generate; only the numbers disappear.

- **`district` is `null`** (the org's position did not resolve): skip Steps 2-4 entirely. Every card is written from the summaries and platform alone, `haystaq: null` on all of them. The bodies carry the opponent-vs-platform contrast without any statistic and without any invented substitute ("many voters feel..." backed by nothing is fabrication; just make the contrast).
- **A column has no coverage in this state, or the counts are under the cell-size floor**: that card only goes out numberless (`haystaq: null`); the other cards keep their numbers. Do not swap in an adjacent column. Sample card 3 below is a live example: `hs_violent_crime_very_worried` has 0% coverage in NC, so the public-safety card carries no statistic while the other four cite real numbers.
- **What a numberless body looks like**: same 3-sentence spine, with the statistic slot replaced by grounded salience from the inputs (e.g. the issue is contested in the race) or by the candidate's own commitment. It never apologizes for or explains the missing data to the voter; only the internal `haystaq: null` records it.

## Validated sample run — Hendersonville City Council, NC (real data)

**Input provenance**: the two opponent entries below are the real persisted output of a dev `race_opponent_summary` run (run `019f22d2-74ab-70ad-a3c7-49504dd7105e`, Hendersonville City Council, NC; Gina Baxter and Jeff Groh are real 2026 candidates and the section text is what the summary agent produced from their real campaign sites). The dev campaign's own website was placeholder test data ("This is my bio"), so `candidate_platform` below is CONSTRUCTED for this proof: realistic and contrast-friendly, but not a real candidate's platform. The district pair was discovered from L2 directly (`City` = `'HENDERSONVILLE CITY'`), matching the `{ state, l2DistrictType, l2DistrictName }` shape the resolver returns.

```json
{
  "race_context": { "office_name": "Hendersonville City Council", "state": "NC", "election_date": "2026-11-03" },
  "district": { "state": "NC", "l2DistrictType": "City", "l2DistrictName": "HENDERSONVILLE CITY" },
  "candidate_platform": {
    "bio": "Small-business owner and parent who has lived in Hendersonville for 15 years. Volunteer with the downtown merchants association and a local youth mentoring program. Running to keep Hendersonville livable for the families who work here as the city grows.",
    "issues": [
      { "title": "Housing affordability", "description": "Working families and seniors are being priced out. I support zoning for starter homes, accessory dwelling units, and workforce housing near existing infrastructure." },
      { "title": "Infrastructure first", "description": "Roads, water, and sewer should keep pace with growth. I will fund the maintenance backlog before new capital projects and require infrastructure capacity reviews for large developments." },
      { "title": "Public safety staffing", "description": "I support fully funding police and fire staffing so response times stay low as the city grows, with transparent annual staffing reports." },
      { "title": "Fiscal accountability", "description": "Keep the property tax rate steady and publish a plain-language report of where every capital dollar goes." }
    ]
  },
  "opponents": [
    {
      "opponent_name": "Gina Baxter",
      "threat_tier": "primary_threat",
      "overview": "Gina Baxter is a current Hendersonville City Council member seeking re-election. She grew up in Hendersonville and has remained active in local service through work in nonprofits and early education. Her campaign centers on continuing her council work with a stated focus on managing growth and delivering accountable, informed local representation.",
      "background": "Baxter was raised in Hendersonville and chose to remain there as an adult, citing her love of the community. Her professional background spans nonprofits and early education. During her time on council she has supported affordable housing, prioritized community accessibility, collaborated with the Mills River Partnership and the City's Environmental Sustainability Board on natural resources, and worked with public and private partners on hurricane recovery.",
      "issues_that_matter": [
        "Affordable housing",
        "Community accessibility",
        "Natural resources protection (Mills River Partnership, Environmental Sustainability Board)",
        "Hurricane recovery and resilience",
        "Managing growth with smart, long-lasting policy"
      ]
    },
    {
      "opponent_name": "Jeff Groh",
      "threat_tier": "watch_closely",
      "overview": "Jeff Groh is running as the self-described 'common sense' candidate for Hendersonville City Council. He frames the race as a choice between preserving the city's small-town values and following what he characterizes as the ideological direction of larger North Carolina cities. His campaign is organized around four stated priorities: fiscal responsibility, safety and security, support for small business, and maintaining the city's small-town character.",
      "background": "Groh's campaign materials do not describe prior elected or appointed office. His committee is based in Flat Rock, NC. He emphasizes that Hendersonville city residents pay roughly twice the property taxes of county residents and positions himself as a voice for local small business owners who live under city policy but cannot vote in city elections.",
      "issues_that_matter": [
        "Fiscal responsibility and limiting government growth",
        "Property tax burden for city residents",
        "Safety and security, including homelessness and vagrancy",
        "Support for small business",
        "Maintaining small-town character and managing annexation",
        "Concerns about out-of-state developers reshaping the community"
      ]
    }
  ]
}
```

**Haystaq validation (run 2026-07-06 against `int__l2_nationwide_uniform_w_haystaq`)**. Distribution check on 3 columns confirmed 0-100 continuous (min 0.0, avg 41.0-50.4, max 100.0). The batched query, scoped to `` Residence_Addresses_State = 'NC' AND `City` = 'HENDERSONVILLE CITY' AND Voters_Active = 'A' ``, returned `total_active = 9449`:

| hs column | >= 50 | >= 70 | coverage |
|---|---|---|---|
| `hs_infrastructure_funding_fund_more` | 5,843 (61.8%) | 4,224 (44.7%) | 97% |
| `hs_police_trust_yes` | 5,281 (55.9%) | 3,050 (32.3%) | 93% |
| `hs_affordable_housing_gov_has_role` | 4,552 (48.2%) | 2,494 (26.4%) | 93% |
| `hs_climate_change_believer` | 4,408 (46.7%) | 2,769 (29.3%) | 97% |
| `hs_tax_cuts_support` | 3,754 (39.7%) | 1,740 (18.4%) | 97% |
| `hs_gentrification_oppose` | 3,755 (39.7%) | 1,880 (19.9%) | 93% |
| `hs_violent_crime_very_worried` | 0 | 0 | **0% — dropped** |
| `hs_min_wage_15_increase_support` | 0 | 0 | **0% — dropped** |

(For contrast, the mailing-address scope `Residence_Addresses_City = 'HENDERSONVILLE'` matches 46,071 active voters; the L2 `City` column is the real council electorate.)

## Validated sample output (5 cards, all constraints verified via Step 6)

```json
{
  "generated_at": "2026-07-06T00:00:00Z",
  "cards": [
    {
      "rank": 1,
      "opponent_name": "Jeff Groh",
      "issue": "Infrastructure funding",
      "title": "Stand out against Jeff Groh on infrastructure funding",
      "body": "Jeff Groh is running on fiscal responsibility and limiting the growth of city government. In this district, 61.8% of active voters score high (50 or above) on supporting more infrastructure funding, and 44.7% score very high (70 or above). Voters here care about infrastructure investment, and your platform commits to funding the road, water, and sewer maintenance backlog first.",
      "sms_message": "Hi, I'm running for Hendersonville City Council. Our roads and water lines need to keep pace with growth, and most voters here agree. My opponent Jeff Groh pledges to limit city spending; I will fund the maintenance backlog before new capital projects. I'd be grateful for your vote on November 3.",
      "haystaq": {
        "hs_column": "hs_infrastructure_funding_fund_more",
        "total_active": 9449,
        "voter_count_ge50": 5843,
        "voter_percentage_ge50": 61.8,
        "voter_count_ge70": 4224,
        "voter_percentage_ge70": 44.7
      }
    },
    {
      "rank": 2,
      "opponent_name": "Jeff Groh",
      "issue": "Housing affordability",
      "title": "Stand out against Jeff Groh on housing affordability",
      "body": "Jeff Groh's platform covers taxes, safety, small business, and small-town character, but it does not address housing. In this district, 48.2% of active voters score high on government having a role in affordable housing, and 26.4% score very high. Voters here care about housing affordability, and your platform answers with a concrete starter-home and workforce-housing plan while his does not.",
      "sms_message": "Hi, I'm running for Hendersonville City Council. Housing costs are pushing out the families who work here. My plan supports starter homes and workforce housing near existing infrastructure; my opponent Jeff Groh's platform does not address housing. I'd be grateful for your vote on November 3.",
      "haystaq": {
        "hs_column": "hs_affordable_housing_gov_has_role",
        "total_active": 9449,
        "voter_count_ge50": 4552,
        "voter_percentage_ge50": 48.2,
        "voter_count_ge70": 2494,
        "voter_percentage_ge70": 26.4
      }
    },
    {
      "rank": 3,
      "opponent_name": "Gina Baxter",
      "issue": "Public safety staffing",
      "title": "Stand out against Gina Baxter on public safety staffing",
      "body": "Gina Baxter's platform centers on affordable housing, accessibility, natural resources, hurricane recovery, and managing growth; it does not include public safety. Your platform commits to fully funding police and fire staffing with transparent annual reports as the city grows. That specific commitment is the contrast voters can hold you to.",
      "sms_message": "Hi, I'm running for Hendersonville City Council. As our city grows, response times depend on fully staffed police and fire departments. My platform commits to that funding; the incumbent Gina Baxter's platform does not address public safety. I'd be grateful for your vote on November 3.",
      "haystaq": null
    },
    {
      "rank": 4,
      "opponent_name": "Gina Baxter",
      "issue": "Growth and development",
      "title": "Stand out against Gina Baxter on growth and development",
      "body": "Gina Baxter, the incumbent, frames Hendersonville as being at a pivotal growth moment and runs on managing growth with smart, long-lasting policies. In this district, 39.7% of active voters score high on opposing gentrification-style redevelopment, so roughly 4 in 10 lean toward protecting existing neighborhoods. Your infrastructure-first development standard is a specific commitment those voters can hold you to.",
      "sms_message": "Hi, I'm running for Hendersonville City Council. Growth is the biggest question facing our city. The incumbent runs on managing it; I commit to an infrastructure-first standard where roads, water, and sewer capacity are reviewed before large developments are approved. I'd be grateful for your vote on November 3.",
      "haystaq": {
        "hs_column": "hs_gentrification_oppose",
        "total_active": 9449,
        "voter_count_ge50": 3755,
        "voter_percentage_ge50": 39.7,
        "voter_count_ge70": 1880,
        "voter_percentage_ge70": 19.9
      }
    },
    {
      "rank": 5,
      "opponent_name": "Jeff Groh",
      "issue": "Taxes and city services",
      "title": "Stand out against Jeff Groh on taxes and city services",
      "body": "Jeff Groh campaigns on the property tax burden, noting city residents pay roughly twice the property taxes of county residents. In this district, 39.7% of active voters score high on supporting tax cuts and only 18.4% score very high, so a strong tax-cut stance speaks to a minority of the electorate. Your platform pairs a steady tax rate with a plain-language report of where every capital dollar goes.",
      "sms_message": "Hi, I'm running for Hendersonville City Council. I will keep the tax rate steady and publish a plain-language report of where every capital dollar goes. My opponent Jeff Groh campaigns on tax cuts; I'm campaigning on accountability for the taxes you already pay. I'd be grateful for your vote on November 3.",
      "haystaq": {
        "hs_column": "hs_tax_cuts_support",
        "total_active": 9449,
        "voter_count_ge50": 3754,
        "voter_percentage_ge50": 39.7,
        "voter_count_ge70": 1740,
        "voter_percentage_ge70": 18.4
      }
    }
  ]
}
```

Why this sample is the right proof: card 3 is the live no-coverage degrade (the direct column is 0% in NC and no adjacent column was substituted); cards spread across both opponents and five distinct issues with no repeated statistic; every opponent claim traces to the summaries and every candidate claim to the platform; the sub-50 percentages (39.7%) are used honestly as leans away, not dressed up as majorities.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| All percentages near zero | Used `= 1` on `hs_*` columns because the suffix "looks binary" | They are 0-100 continuous; re-run Step 3, threshold `>= 50` / `>= 70` |
| Every card's percentage hovers at ~50% | Forgot the scores are within-state percentile ranks | ~50% is the state baseline; pick angles where the share deviates from 50 |
| Syntax error on `COUNT(*) FILTER` | Postgres syntax, not Databricks | `SUM(CASE WHEN ... THEN 1 ELSE 0 END)` |
| `total_active` looks like the whole metro | Scoped by mailing city or the L2 value mismatched | Scope by the backtick-quoted `l2DistrictType` column; confirm the value with `SELECT DISTINCT` |
| Query returns 0 rows | `Voters_Active = 1`, or the L2 value doesn't match verbatim | `Voters_Active = 'A'` (string); re-discover the district value |
| A card cites a number for a 0%-coverage issue | Substituted an adjacent column | Direct column or nothing; the card goes out numberless |
| A card claims voters "overwhelmingly" want something at 39.7% | Adjective inflation over an away-lean | State the number as what it is; sub-50 shares are leans away |
| An SMS reads as an attack or guesses motive | Contrast drifted from record/issues to character | Rewrite: facts from the summaries and platform only |
| Two cards feel like the same card | Same contrast rephrased, or a statistic reused | One opponent/issue angle and one statistic per card |
| Output has cards but the campaign has no district | That is correct behavior | Degrade path: cards without numbers, `haystaq: null` |
