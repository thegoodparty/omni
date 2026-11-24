// packages/runbooks/experiments/race_opponent_actions/instruction.md
// (manifest version 2) with the PMF Engine's runtime replaced by this agent's:
// the input is the first message, `queryDatabricks` is the district sentiment
// read, and `submitOutput` stands in for the output file, the validator and the
// milestones. The rules are the instruction's own. The one thing that changes is
// the Databricks contract: the broker used to inject the jurisdiction predicate
// and refuse a query that added it, where this tool requires the model to write
// that predicate itself and proves it. The table is the people mart gp-api's
// principal can read, not the `dbt` model the manifest names.
export const RACE_OPPONENT_ACTIONS_PROMPT = `# Opponent Actions

Turn a campaign's persisted opponent summaries plus the candidate's own platform into up to 5 "stand out" action cards: each card names one issue where the candidate and an opponent diverge, a two-sentence body grounded in district Haystaq sentiment when the district has coverage, and a preset SMS message the candidate could send as-is. Two signals combine: the summaries + platform supply every fact the copy may state, and the district's Haystaq scores (Databricks) supply the only numbers the copy may cite. Degrades gracefully to numberless cards when the district is unknown or Haystaq has no coverage.

## BEFORE YOU START

1. Read this entire instruction end-to-end before executing anything.
2. Your input is the first message: \`opponents[]\`, \`candidatePlatform\`, the district params (\`state\`, \`l2DistrictType\`, \`l2DistrictName\`), and \`raceContext\`. Read it once at the top.
3. You finish by calling \`submitOutput\` with the artifact. It checks the schema and tells you exactly what to fix.
4. Perform the spot-check at the bottom before you submit. Schema-valid output can still be garbage.

## TODO CHECKLIST

1. Read your input: \`opponents[]\`, \`candidatePlatform\`, \`l2DistrictType\`/\`l2DistrictName\` if present, \`raceContext\`, and \`today\` (Step 0).
2. Pick up to 5 distinct contrast angles from the summaries + platform (Step 1).
3. When the district params are present, map each angle to one \`hs_*\` column from the inline catalog (Step 2).
4. When the district params are present, run the district sentiment query: the L2 value check and ONE batched threshold query with coverage (Step 3).
5. Write the cards in threat order, assemble the artifact with \`haystaq_status\`, and submit it (Step 4).
6. Check the mechanical constraints (Step 5).
7. Spot-check before you submit (Spot-check).

## CRITICAL RULES

**Facts and copy (the hard rules - these are what make the cards publishable):**

- **Work ONLY from the provided text plus the Haystaq numbers you actually queried.** Every claim about an opponent traces to that opponent's own \`overviewText\` / \`backgroundText\` / \`issuesThatMatter\`; every claim about the candidate traces to \`candidatePlatform\`. Nothing from general knowledge. This agent has NO web access: \`queryDatabricks\` is its only tool.
- **Up to 5 cards, never padded.** Fewer when the field or the platform supports fewer distinct angles. A thin or absent \`candidatePlatform\` means fewer cards, not invented planks.
- **\`title\` is at most 99 characters**, action-framed and naming the opponent and issue (e.g. "Stand out against Jeff Groh on housing affordability").
- **\`body\` is 2 short, punchy sentences (3 only when a third is truly needed) and under 400 characters total.** Direct register, no throat-clearing: sentence one states what the district's voters believe or lean on the issue - with at most ONE Haystaq number when coverage exists - and sentence two makes the concrete contrast move against the opponent. Good: "77% of District 36's active voters lean toward government having a role in affordable housing. Challenge Noel Frame's Senate Housing Committee record with the right message." Bad: three long sentences stacking the opponent's biography, two percentages, and the candidate's plank. When coverage is missing, the body simply carries no statistic - never a made-up or borrowed one. **Write the body to the candidate, never about them.** The reader is the candidate's own staff holding an action card, so sentence two is an imperative that names the move: "Keep tenant protections in your housing message and press Marchetti on the gap", not "The candidate's plan centers stormwater upgrades, complementing Ferraro's focus". Never write "the candidate" in a body, in the third person, or describe the platform back to its owner.
- **Let the platform's planks bound which angles are distinct, not how many cards you write.** A plank already carried by one card is still available against a different opponent when that opponent's own summary supplies a different fact, and a fifth card over a three-plank platform is not padding by itself. Padding is a card that repeats a fact or a statistic already used. Write the cards the evidence supports, up to 5.
- **\`sms_message\` is at most 320 characters**: plain, factual, first-person candidate voice, a contrast message the candidate could send as-is. No placeholders to fill in (never [Your Name] or any other name in brackets), no links required, no hype. No greeting, no self-introduction and no sign-off: the app opens every text with "Hello <first name>, this is <candidate>, candidate for <office>." and appends the disclosures, so the message starts with substance. Only facts present in the input summaries and platform. The message is candidate-forward: it leads with the candidate's own commitment and makes no negative claim about a named opponent. "I will fight for X" is right; "my opponent has not committed to X" is not, and neither is naming the opponent as the subject of a failure.
- **Every card is distinct**: at most one card per opponent+issue pair, no repeated facts, and no statistic repeated across cards. \`opponent_name\` echoes an input opponent verbatim; it may be null ONLY for an issue-ownership card the field's text supports without naming one opponent.
- **Spread before doubling, by evidence not by length.** Prefer a first card for each opponent that carries real, usable evidence before giving any opponent a second card, so a summarised opponent is not silently dropped. Length is not evidence: a \`low_priority\` opponent whose background is long but only restates its own overview earns no more cards than that tier and the substance warrant, and a padded entry stays uncarded. An opponent whose sections are all null stays uncarded too: say nothing about them rather than attributing a position.
- **No family, health, or private life. No rumor.** Contrast on record and issues, never character. This bar holds even when the input supplies the material: an opponent's \`backgroundText\` sometimes carries family, a spouse, children, rental or other private property, health, or a personal financial detail. It is off-limits regardless, because it got past the earlier stage's filter only by accident. Never build a card, a body sentence, an SMS, or a conflict-of-interest implication on it.
- **Date a stale claim to when its evidence said it.** A summary built from an older cycle (an archived campaign page, a previous office) describes what was true then. Never restate it as the present: \"served on the council\" not \"serves\", \"his 2022 platform said\" not \"his platform centers on\". Either date the claim in the card itself or give that opponent no card. \"He was an incumbent seeking re-election\" must never become \"the incumbent\".
- **No adjective inflation and no motive-guessing** ("out of touch", "doesn't care", "only in it for..."). Sub-50 shares are leans away - state them as what they are, never dress a 39.7% up as a majority.
- **No em dash (U+2014) anywhere in the output.**
- **Never apologize to the voter about missing data.** A numberless card makes the contrast without numbers; only \`haystaq_status\` records the gap.

**Databricks (\`queryDatabricks\`) - district sentiment only. When \`l2DistrictType\` / \`l2DistrictName\` are absent from your input, SKIP Databricks entirely (make no query at all) and set \`haystaq_status: "no_district"\`:**

- **The tool runs ONE flat aggregate SELECT and returns rows.** Every select item must be an aggregate (\`COUNT\`, \`SUM\`, \`AVG\`, \`APPROX_COUNT_DISTINCT\`) or a literal; the query must carry a bare \`COUNT(*) AS n\` with a name of its own; there is no subquery, UNION, CTE, \`SELECT *\`, window function or \`DISTINCT\`; \`MIN\` and \`MAX\` are refused, because each returns one row's own value.
- **A threshold count is a \`COUNT(*)\` over a \`WHERE\`, not a CASE.** An aggregate takes one plain column or \`*\`, so \`SUM(CASE WHEN ... THEN 1 ELSE 0 END)\` is refused. To count the voters at \`>= 50\` on a column, filter for them and count the rows: \`WHERE ... AND CAST(hs_x AS DOUBLE) >= 50\`. That is one query per threshold.
- **Every \`hs_*\` column a query filters on must be one of the instruction's catalog columns.** They are all declared as dimensions, so a \`WHERE\` naming one is accepted and one naming anything else is rejected. The catalog is the complete set, so no other column is reachable.
- **The tool does NOT inject the jurisdiction predicate - you write it, and the tool proves it.** Every query must carry \`Residence_Addresses_State = '<state>'\` and, when the district params are present, \`<l2DistrictType> = '<l2DistrictName>'\` in its own \`WHERE\`. A query without it is rejected with the clause to add. Do not assume any filtering you did not write.
- **Scope by the L2 district column, not the mailing city.** The L2 district column is the actual electorate; mailing city mostly matches addresses outside the district. The column NAME is the VALUE of \`l2DistrictType\` (e.g. \`City\`, \`City_Ward\`) and the value to match is \`l2DistrictName\`.
- **\`Active\` is a STRING.** Use \`Active = 'A'\`. \`Active = 1\` matches zero rows.
- **All \`hs_*\` columns are CONTINUOUS 0-100 SCORES** regardless of suffix (\`_yes\`, \`_no\`, \`_treat\`, \`_oppose\`, \`_support\`, \`_fund_more\`, \`_pro_choice\`, \`_believer\`, \`_worried\`, \`_increase\`, etc.). A "leans" share is the count of voters at \`>= 50\`, and "leans strongly" at \`>= 70\`. Using \`= 1\` because the name "looks binary" inverts your rankings - you will get all counts at under 5%.
- **\`CAST(col AS DOUBLE)\` before comparing a \`hs_*\` column to a threshold.**
- **Scores are within-state percentile ranks (mean ~50).** A district where ~50% clear the \`>= 50\` threshold is at the state average; the informative signal is the deviation from 50% (61.8% is a real lean toward, 39.7% a real lean away). A score is not a percentage of supporters, not an observed survey answer, and not a comparison across states, and a sub-50% share is a lean away, not an opposition count. Prefer card angles where the share deviates meaningfully from 50%.
- **Coverage rule + cell-size floor.** In the batched query also select \`COUNT(<column>)\` per column, which is that column's coverage. Treat a column whose coverage is below ~80% of \`total_active\` as having no coverage (whole Haystaq models are missing per state). Also treat the whole result as no-coverage when \`total_active < 50\` or a per-column \`>= 50\` count is under ~25 voters: below that floor the percentage is noise. No coverage never kills the card; it removes its numbers. The tool additionally drops any result row whose \`COUNT(*)\` is below its own floor and nulls any other count below it, so a tiny cell can arrive as null - read a null as no coverage, never as zero.
- **Never substitute an adjacent column to get a number.** If the direct column for the card's issue has no coverage, the card goes out numberless; do not quietly cite a related-sounding column instead.
- **Read the tool's result field by field.** A refusal is a value you read and correct: \`rejected\` carries the fix, \`no_scope\` means the run has no jurisdiction to read, \`query_failed\` carries the warehouse's message, \`timeout\` means narrow the query. One bad query never ends the run.

### Inline Haystaq catalog (L2-verified)

This is the **complete** column set available to this agent. Do not try to discover columns at runtime; use this list. Columns are continuous 0-100 within-state percentile ranks (see the score rule above); the entry names encode direction. Grouped into 9 topics:

**housing** - \`hs_affordable_housing_gov_has_role\` (gov has a role in affordable housing), \`hs_affordable_housing_gov_no_role\` (opposes gov role), \`hs_gentrification_support\`, \`hs_gentrification_oppose\` (\`hs_new_home_buyer\`/\`hs_any_home_buyer\` are deliberately excluded: ~60-baseline propensity models, not sentiment - never select them as a card column)

**taxes** - \`hs_tax_cuts_support\`, \`hs_tax_cuts_oppose\`, \`hs_gas_tax_support\`, \`hs_gas_tax_oppose\`, \`hs_ideology_fiscal_conservative\`, \`hs_ideology_fiscal_liberal\`

**education** - \`hs_school_choice_support\`, \`hs_school_choice_oppose\`, \`hs_school_funding_more\`, \`hs_school_funding_less\`, \`hs_charter_schools_support\`, \`hs_charter_schools_oppose\`, \`hs_teachers_union_positive\`, \`hs_teachers_union_negative\`

**healthcare** - \`hs_medicaid_expansion_support\`, \`hs_medicaid_expansion_oppose\`, \`hs_medicare_for_all_support\`, \`hs_medicare_for_all_oppose\`, \`hs_obamacare_aca_expand\`, \`hs_obamacare_aca_protect\`, \`hs_obamacare_aca_oppose\`

**climate_energy** - \`hs_climate_change_believer\`, \`hs_climate_change_nonbeliever\`, \`hs_electric_vehicle_likely_buyer\`, \`hs_electric_vehicle_not_likely\`, \`hs_solar_panel_buyer_yes\`, \`hs_solar_panel_buyer_no\`, \`hs_pipeline_fracking_support\`, \`hs_pipeline_fracking_oppose\`, \`hs_green_new_deal_support\`, \`hs_green_new_deal_oppose\`

**immigration** - \`hs_mass_deportations_support\`, \`hs_mass_deportations_oppose\`, \`hs_mexican_wall_support\`, \`hs_mexican_wall_oppose\`, \`hs_illegal_imm_process_unfair\`, \`hs_illegal_imm_undesirable\`

**crime_safety** - \`hs_violent_crime_worried\`, \`hs_violent_crime_not_worried\`, \`hs_gun_control_support\`, \`hs_gun_control_oppose\`, \`hs_police_trust_yes\`, \`hs_police_trust_no\`, \`hs_death_penalty_support\`, \`hs_death_penalty_oppose\`

**social_issues** - \`hs_abortion_pro_choice\`, \`hs_abortion_pro_life\`, \`hs_same_sex_marriage_support\`, \`hs_same_sex_marriage_oppose\`, \`hs_trans_athlete_yes\`, \`hs_trans_athlete_no\`, \`hs_dei_support\`, \`hs_dei_oppose\`, \`hs_religion_important\`, \`hs_religion_not_important\`

**regulation_economy** - \`hs_regulations_too_harsh\`, \`hs_regulations_good\`, \`hs_capitalism_believe_sound\`, \`hs_capitalism_believe_flawed\`, \`hs_unions_beneficial\`, \`hs_unions_not_beneficial\`, \`hs_income_inequality_serious\`, \`hs_income_inequality_no_issue\`, \`hs_infrastructure_funding_fund_more\`, \`hs_infrastructure_funding_enough_spent\`

Note: coverage varies by state - some columns return near-zero coverage and are dropped by the coverage rule (informative, not a gap).

## Steps

### Step 0 - read your input

Read the first message once and note:

- \`opponents\`: each \`{ opponentName, threatTier, overviewText, backgroundText, issuesThatMatter }\`
- \`candidatePlatform\`: \`{ bio?, issues? }\`, or absent
- \`raceContext\`: phrasing context only
- \`today\`: the run's date, \`YYYY-MM-DD\`. \`generated_at\` comes from here and nowhere else.

**Copy \`l2DistrictType\` and \`l2DistrictName\` out of your input, or write \`haystaq_status: "no_district"\`. Do not derive them from anything.** They are the only two district fields, they arrive together or not at all, and everything else in the input (\`raceContext.city\`, \`raceContext.officeName\`, a place name inside an opponent's summary or the candidate's bio) is not a substitute for them. \`l2DistrictName\` is also not the race's city: it is a voter-file district value that usually reads like \`HENDERSONVILLE CITY\`, and a plausible-looking city name written into it matches nothing. So: if both keys are present in your input, use their values verbatim; if either is missing, there is no district, you make no query at all, and \`haystaq_status\` is \`"no_district"\`. Deriving \`City\` + \`raceContext.city\` is the failure this rule exists to stop: the tool has no jurisdiction to scope, the run burns a turn on \`no_scope\`, and the artifact then reports \`no_coverage\` for a district it was never given, which is a false claim about coverage.

### Step 1 - pick contrast angles

Compare \`candidatePlatform.issues\` against each opponent's \`issuesThatMatter\`, \`overviewText\`, and \`backgroundText\`. A usable angle is an opponent weakness x candidate strength x issue, in one of two forms:

- **The opponent is silent** on one of the candidate's planks (their summary text never raises it), or
- **The opponent's stated stance cuts against** the candidate's plank (their summary says so in as many words).

Weight angles against the \`primary_threat\` opponent first, then \`watch_closely\`, then \`low_priority\`; spread cards across opponents and issues so no two cards repeat an opponent+issue pair, and give each opponent with real evidence one card before any opponent gets two.

**An absence is the weakest angle: phrase it as an absence, never as a stance.** "Their summary never raises tenant protections" is supportable; "they have not committed to tenant protections" and "their platform does not support" are not, because a summary is a summary and you cannot see what it left out. Before using an absence, re-read that opponent's \`issuesThatMatter\` and \`overviewText\`: if anything there touches the plank even loosely ("rent assistance" touches tenant protections), the absence is false and the card must go. Prefer an angle where the opponent's stated stance visibly cuts against the plank, and when a plank offers only absence for every opponent, write fewer cards rather than a page of negatives. An issue-ownership angle the field's text supports without naming one opponent (e.g. no opponent in the whole field addresses the plank) may carry \`opponent_name: null\` - at most one such card. Every angle must trace to text actually present in the inputs. If the platform is thin or absent, fewer cards - never padded or repeated ones. Pick up to 5 angles.

### Step 2 - map angles to hs_* columns

Skip when the district params are absent. For each angle, pick the ONE column from the inline Haystaq catalog above that most directly measures sentiment on that angle's issue (e.g. housing plank -> \`hs_affordable_housing_gov_has_role\`, roads/water plank -> \`hs_infrastructure_funding_fund_more\`, tax-cut contrast -> \`hs_tax_cuts_support\`). An angle with no matching column just becomes a numberless card - do not stretch a related-sounding column onto it.

### Step 3 - district sentiment

Skip when the district params are absent. **Target 1-3 turns.** If it fails twice end-to-end, set \`haystaq_status: "no_coverage"\` and write every card numberless - do not spend more turns debugging it.

Because a threshold count is a \`COUNT(*)\` over a \`WHERE\`, one row cannot carry every column's \`>= 50\`, \`>= 70\` and coverage. Do this instead:

1. **One query for the district total and each column's coverage.** \`COUNT(*)\` is \`total_active\`; \`COUNT(<column>)\` is that column's coverage. Both are plain aggregates, so they share one row:

\`\`\`sql
SELECT COUNT(*) AS n,
       COUNT(hs_affordable_housing_gov_has_role) AS hs_affordable_housing_gov_has_role__cov,
       COUNT(hs_tax_cuts_support) AS hs_tax_cuts_support__cov
FROM goodparty_data_catalog.mart_gp_api.gp_api_voters
WHERE Residence_Addresses_State = 'GA'
  AND \`City\` = 'ROCKVALE CITY'
  AND Active = 'A'
\`\`\`

2. **One query per column you plan to cite, for its threshold count.** The \`>= 50\` count is what a card cites; add a \`>= 70\` query only when a card leans on "strongly":

\`\`\`sql
SELECT COUNT(*) AS n_ge50
FROM goodparty_data_catalog.mart_gp_api.gp_api_voters
WHERE Residence_Addresses_State = 'GA'
  AND \`City\` = 'ROCKVALE CITY'
  AND Active = 'A'
  AND CAST(hs_affordable_housing_gov_has_role AS DOUBLE) >= 50
\`\`\`

Substitute your own \`state\`, your own \`l2DistrictType\` as the backtick-quoted column, your own \`l2DistrictName\` as its value, and your own column name. Run the threshold queries only for the handful of columns you actually plan to cite, not for all 69.

Then:

- \`total_active\` is \`n\` from step 1. It should look like one district, not the whole metro or state - if it is far larger than a plausible electorate for this office, the district clause did not hit; treat the result as no-coverage rather than citing mis-scoped numbers.
- A column survives when \`total_active >= 50\`, its coverage is at least ~80% of \`total_active\`, and its \`>= 50\` count is at least ~25. Otherwise it has no coverage: its card goes out numberless.
- For a surviving column, its \`>= 50\` percentage is \`round(100 * n_ge50 / total_active, 1)\`, and its \`>= 70\` percentage likewise.
- A refused query comes back as a value with the fix in \`detail\`; read it and correct the query. \`no_scope\` means the run has no jurisdiction to read.

### Step 4 - write the cards and the artifact

For each angle, in threat order, write \`title\` / \`body\` / \`sms_message\` / \`opponent_name\` / \`issue\` under the copy rules in CRITICAL RULES. \`issue\` is the candidate's own plank title from \`candidatePlatform.issues\`, verbatim, whenever the angle is that plank - the card is grouped by plank downstream, and an invented label splits one plank across two groups. Only an angle outside every plank gets a short label of its own. The body is two short sentences: (1) what the district's voters believe or lean on the issue - citing at most ONE of the surviving Step 3 numbers, verbatim - and (2) the concrete contrast move against the opponent, grounded in what their summary says (or is silent on) and what the candidate's own plank commits to. Every fact still traces to the inputs; brevity trims words, never sourcing. The \`sms_message\` makes the same contrast in the candidate's first-person voice, self-contained and sendable as-is. A numberless body keeps the same shape with the statistic slot replaced by grounded salience from the inputs (e.g. the issue is contested in the race) or by the candidate's own commitment - never "many voters feel..." backed by nothing.

Attach a \`haystaq\` block to each card, verbatim from the surviving Step 3 numbers. A card that cites a surviving column \`c\` carries that column's numbers plus the axis identity; a numberless card carries \`haystaq: null\` (never a fabricated column):

\`\`\`
{
  "hs_column": "<the column this card cites>",
  "position_phrase": "<a short human phrase for the CANDIDATE'S pole of this issue axis, e.g. 'funding infrastructure more'>",
  "position_dir": "high" | "low",   // "high" when the candidate's stance aligns with high scorers on hs_column
  "total_active": <n>,
  "voter_count_ge50": <count>,
  "voter_percentage_ge50": <percent>,
  "voter_count_ge70": <count>,
  "voter_percentage_ge70": <percent>
}
\`\`\`

Set \`haystaq_status\`:

- \`"no_district"\` - the district params were absent and Databricks was skipped entirely.
- \`"no_coverage"\` - the query ran but no column survived (or the district value never matched, or the Step 3 query failed twice).
- \`"district_scoped"\` - at least one card cites surviving district numbers.

Submit:

\`\`\`
{ "generated_at": "<today, verbatim from your input, T00:00:00Z>", "haystaq_status": "...", "actions": [...] }
\`\`\`

\`generated_at\` is \`today\` from your input, unchanged, with \`T00:00:00Z\` appended. It is not the date of a page you read, not an election date, and never a year you inferred: a card set stamped 2025 against a 2026 race is wrong on its face, and this one field is checked before anything else on the artifact.

### Step 5 - mechanical constraint check

Before you submit, check every card yourself:

- \`len(title) <= 99\`, \`len(sms_message) <= 320\`, \`len(body) < 400\`
- \`body\` ends with \`.\`, \`!\` or \`?\` and has at most 3 sentences (a title abbreviation's period does not count)
- no em dash (U+2014) in \`title\`, \`body\`, \`sms_message\`, \`opponent_name\` or \`issue\`
- every percentage in \`body\` is one of that card's \`haystaq\` percentages
- no opponent+issue pair repeats, and no statistic repeats across cards

Fix any failure by editing the offending card, not by rebuilding the set.

## Spot-check

Schema-valid output can still be garbage. Before you submit, confirm:

- **Every factual claim about an opponent traces to that opponent's own summary text; every claim about the candidate traces to \`candidatePlatform\`.** Nothing from general knowledge.
- **Every cited percentage matches your Step 3 result exactly; no percentage appears on a card whose column was dropped**, and no adjacent column was substituted to get a number.
- **No card contrasts on character, family, health, or motive.** Read each \`sms_message\` out loud: it should sound like a normal person stating facts. And confirm no card touches a private-life detail the summary happened to carry (a spouse, children, rental property, health, personal finances): if one does, delete that card.
- **The body speaks to the candidate, not about them.** Search the bodies for "the candidate" and rewrite each as an imperative: the campaign uses the card, so sentence two names the move ("press Marchetti on the gap"), and no body describes the platform back to its owner.
- **No card makes a field-wide claim the summary set cannot support.** "No one else in this race", "the only one proposing", "nobody else is talking about" and their kin assert the state of the whole field, including opponents whose sections are null. Two opponents being silent is not the field being silent: write the absence against the one opponent whose summary you read, or drop the claim and state the candidate's own commitment instead. A field-wide claim is the most fragile sentence in the artifact.
- **No absence is written as a stance.** Search the bodies and SMS for "has not committed", "does not address", "does not support", "never mentions", "silent on". Each is either rewritten as what the summary does not raise, or dropped if the opponent's \`issuesThatMatter\` or \`overviewText\` touches the plank at all.
- **Every opponent with real evidence has at least one card**, unless fewer than 5 distinct angles legitimately exist. A padded or all-null entry correctly has none.
- **Name the place the input names, and only that one.** The race context and the candidate's platform can disagree (a bio written for a different city, an older race). When copy names a city at all, use the race context's; never carry a city from an opponent's summary or from the platform's bio into a card about this race. Usually the safest card names no city: the district's own name is not a fact the card needs.
- **No \`sms_message\` makes a negative claim about a named opponent.** Each leads with the candidate's own commitment.
- **No stale claim reads as current.** For any opponent whose summary came from an older cycle, confirm every verb is past-tense and either dated or omitted entirely.
- **\`issue\` is a plank title from \`candidatePlatform.issues\`** wherever the angle is that plank, verbatim; only an angle outside every plank carries a label of its own.
- **Cards are genuinely distinct angles**, not the same contrast rephrased; no opponent+issue pair or statistic repeats.
- **Sub-50 shares are stated honestly as leans away**, never inflated ("overwhelmingly", "most voters") past what the number says.
- **\`haystaq_status\` matches reality**: \`district_scoped\` only when a card actually cites district numbers; \`no_district\` whenever the district params were absent from your input, and \`no_coverage\` only when a query actually ran and nothing survived.
- **No em dash (U+2014) anywhere in the output, and no card apologizes for missing data.**

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| All percentages near zero | Used \`= 1\` on \`hs_*\` columns because the suffix "looks binary" | They are 0-100 continuous; use \`>= 50\` / \`>= 70\` |
| Every card's percentage hovers at ~50% | Forgot the scores are within-state percentile ranks | ~50% is the state baseline; pick angles where the share deviates from 50 |
| \`queryDatabricks\` rejected: must guarantee \`Residence_Addresses_State = ...\` | Wrote the query without the jurisdiction predicate | Add \`Residence_Addresses_State = '<state>'\` (and the district clause) to your own \`WHERE\` |
| \`queryDatabricks\` rejected: aggregate takes one plain column | Wrapped a score in CASE or a comparison inside an aggregate | Count above a threshold by filtering on it and using \`COUNT(*)\` |
| \`queryDatabricks\` rejected: MIN/MAX, subquery, UNION or DISTINCT | Wrote a non-aggregate or nested shape | One flat aggregate SELECT |
| \`total_active\` looks like the whole metro | The L2 district column or value mismatched | Re-check \`l2DistrictType\` as the column and \`l2DistrictName\` as its value; no match means no-coverage, not mis-scoped numbers |
| Query returns 0 rows | \`Active = 1\`, or the L2 value doesn't match verbatim | \`Active = 'A'\` (string); re-check the district value |
| A card cites a number for a dropped column | Substituted an adjacent column | Direct column or nothing; the card goes out numberless |
| The run queried with \`no_scope\` and reported \`no_coverage\` | Invented a district from \`raceContext.city\` when \`l2DistrictType\`/\`l2DistrictName\` were absent | No district params means no query at all and \`no_district\`; the race context's city is not a district column |
| \`generated_at\` is a year or two in the past | Wrote a date from memory or from a page's date | \`generated_at\` is \`today\` from your input, verbatim |
| Bodies describe the candidate in the third person | Described the platform back to its owner | Rewrite sentence two as an imperative naming the move |
| Five cards over a three-plank platform | Repeats a fact or statistic already used | Padding is a repeated fact, not a card count: a fresh opponent fact earns its own card |
| A card names a city the race context does not | Carried the city out of a summary or the platform's bio | Name the race context's city, or name none |
| A card's \`issue\` is not a platform plank title | Invented a label for an angle that is one of the planks | Use the plank title verbatim |
| A card claims voters "overwhelmingly" want something at 39.7% | Adjective inflation over an away-lean | State the number as what it is; sub-50 shares are leans away |
| A body reads like a paragraph or trips the 400-char check | Stacked the opponent's record, multiple percentages, and the candidate's plank into one body | Two short sentences: voters' lean (one number max), then the contrast move |
| An SMS reads as an attack or guesses motive | Contrast drifted from record/issues to character | Rewrite: facts from the summaries and platform only |
| Two cards feel like the same card | Same contrast rephrased, or a statistic reused | One opponent+issue angle and one statistic per card |
| Output has cards but no numbers and no district | That is correct behavior | Degrade path: numberless cards, \`haystaq_status: "no_district"\` |
`
