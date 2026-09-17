// Shared semantics for the hs_* modeled-score columns in serve_agent_voters.
// Import this into any tool description that lets the model query them.
// DISTRICT_INSIGHTS_RULES (briefing-chat system prompt,
// chats/briefing-chats/services/systemPromptBuilder.ts) carries a
// deliberately condensed restatement of these semantics as defense-in-depth
// across prompt layers — edit the two together.
//
// Basis: scores arrive from the vendor as within-state percentile ranks
// (verified against the mart: per-state means ~50 with SD ~28.9, the SD of a
// uniform 0-100 distribution, verified per state wherever a column has real
// coverage). Two columns have a shifted baseline (~60) and are marked "not
// centered at 50". 12 states also carry an older 303-column set: 51 of those
// columns don't exist in the newer, nationwide 326-column set and are null
// in the other states — marked "limited coverage" in the catalogs that
// advertise them. (A load bug had also left the columns unique to the
// newer set null in those same 12 states, making the two sets look fully
// disjoint; fixed 2026-08-14 — the newer set now has real coverage
// nationwide, so those columns carry no coverage mark. Texas ~72% and
// Utah ~82% scored on the newer set vs 90%+ everywhere else — confirmed
// vendor-side 2026-08-24, not expected to self-heal.) The >= 50 / >= 70
// thresholds follow the convention already used by the meeting_briefing and
// district-issue experiment instructions in packages/runbooks.
//
// The audience noun is a parameter because the model echoes this block's
// vocabulary straight into its prose: Serve (elected officials) must read
// "constituents" — they govern everyone in the district, not an electorate —
// while Win (campaigns) must read "voters".
export const hsScoreSemantics = (
  noun: 'constituent' | 'voter',
): string => `SCORE SEMANTICS (misreading these produces false claims):
  - Every hs_* column is a CONTINUOUS 0-100 score regardless of suffix (_support, _oppose, _believer, _worried, etc.). Never treat one as binary; hs_x = 1 matches almost no rows.
  - hs_* columns are WITHIN-STATE PERCENTILE RANKS centered near 50: a ${noun} scoring 60 is more aligned than ~60% of ${noun}s in the state, one scoring 50 sits at the state median, and one scoring 35 ranks below ~65% of the state. A score is NOT a percentage, NOT a probability, NOT an observed survey answer, and NOT comparable across states (each state is ranked within itself). For these, the signal is DEVIATION FROM 50 (the average ${noun} in the state): a district average near 50, or ~50% of ${noun}s clearing a >= 50 threshold, means "typical for the state" — not a coin flip and not majority support.
  - A LOW score is a lean AWAY from the labeled stance relative to the state, NOT evidence of the opposite stance: the models are one-sided and the negative class often mixes opponents with unsure or out-of-scope respondents (read the label's exact meaning). Where a _support/_oppose style twin exists, query the twin rather than inverting a low score.
  - EXCEPTIONS are marked on catalog entries. "not centered at 50": the column has a shifted statewide baseline (stated in the entry) — read leans against that baseline, not 50. "limited coverage": the column has data for only some states — expect mostly nulls elsewhere and apply the null rules below rather than inventing a lean. Columns with NO catalog entry have unverified baselines: describe them qualitatively only.
  - On centered columns, threshold with >= 50 (moderate lean) or >= 70 (strong lean); mirror low-side segments with < 50 / <= 30 (lean away / strong lean away). Report leans relative to the state average ("your district leans more X than the average ${noun} in your state"), never as "N ${noun}s believe X" or "X% of ${noun}s support Y". Never present a score average as a share of people. These bans cover EVERY hs_ column, centered or not: a threshold count on a shifted-baseline column is NOT a count of people with that trait (a >= 50 count on a ~60-baseline column runs ~60-65% by construction), so never report one as a headcount — describe non-centered columns only as leans against their stated baseline.
  - Nulls mean UNKNOWN, not "no". Every column has some: ${noun}s registered after the vendor's spring snapshot are unscored everywhere, and Texas (~72% scored) and Utah (~82%) trail every other state (90%+) on the nationwide column set (columns without a "limited coverage" mark; vendor-side) — nulls are unscored ${noun}s, not errors. Never fold them into a category — and never hide them either: unknowns are a reportable segment. When you break down or filter by any column, also count the unknowns (SUM(CASE WHEN col IS NULL THEN 1 ELSE 0 END) AS unknown_count) and surface them whenever they are a sizable share or behave differently on the metric at hand — unknown-status groups often differ systematically (e.g. lower turnout), which can itself be actionable for the user. Unknown counts follow the same small-cell suppression rule as any other count: report small ones as ranges, never exact numbers. For alignment shares, compute over SCORED rows only (AVG(CASE WHEN col >= 50 THEN 1.0 WHEN col IS NOT NULL THEN 0.0 END)) rather than silently mixing nulls into the denominator, and say how many were scored. That result is the share of SCORED ${noun.toUpperCase()}S whose modeled score clears the threshold — name it that way. It is NOT a share who hold the view, and the denominator is a set of scored records, never answers, responses, replies, or people who were asked: never describe it with survey language.`
