// Shared semantics for the hs_* modeled-score columns in serve_agent_voters.
// Import this into any tool description that lets the model query them.
// DISTRICT_INSIGHTS_RULES (briefing-chat system prompt) carries only
// suppression/presentation rules today; fix/briefing-score-framing adds a
// deliberately condensed restatement of these semantics there as
// defense-in-depth across prompt layers — once it lands, edit the two
// together.
//
// Basis: scores arrive from the vendor as within-state percentile ranks
// (verified against the mart: per-state means ~50 with SD ~28.9, the SD of a
// uniform 0-100 distribution, verified per state wherever a column has real
// coverage). Two columns have a shifted baseline (~60) and are marked "not
// centered at 50". The vendor ships two column vintages with disjoint sets:
// 12 states carry an older 303-column set, the rest a newer 326-column set,
// so ~106 columns are null outside their vintage — marked "limited
// coverage" in the catalogs that advertise them. The >= 50 / >= 70
// thresholds follow the convention already used by the meeting_briefing and
// district-issue experiment instructions in packages/runbooks.
export const HS_SCORE_SEMANTICS = `SCORE SEMANTICS (misreading these produces false claims):
  - Every hs_* column is a CONTINUOUS 0-100 score regardless of suffix (_support, _oppose, _believer, _worried, etc.). Never treat one as binary; hs_x = 1 matches almost no rows.
  - hs_* columns are WITHIN-STATE PERCENTILE RANKS centered near 50: a voter scoring 60 is more aligned than ~60% of voters in the state, one scoring 50 sits at the state median, and one scoring 35 ranks below ~65% of the state. A score is NOT a percentage, NOT a probability, NOT an observed survey answer, and NOT comparable across states (each state is ranked within itself). For these, the signal is DEVIATION FROM 50 (the average voter in the state): a district average near 50, or ~50% of voters clearing a >= 50 threshold, means "typical for the state" — not a coin flip and not majority support.
  - A LOW score is a lean AWAY from the labeled stance relative to the state, NOT evidence of the opposite stance: the models are one-sided and the negative class often mixes opponents with unsure or out-of-scope respondents (read the label's exact meaning). Where a _support/_oppose style twin exists, query the twin rather than inverting a low score.
  - EXCEPTIONS are marked on catalog entries. "not centered at 50": the column has a shifted statewide baseline (stated in the entry) — read leans against that baseline, not 50. "limited coverage": the column has data for only some states — expect mostly nulls elsewhere and apply the null rules below rather than inventing a lean. Columns with NO catalog entry have unverified baselines: describe them qualitatively only.
  - On centered columns, threshold with >= 50 (moderate lean) or >= 70 (strong lean); mirror low-side segments with < 50 / <= 30 (lean away / strong lean away). Report leans relative to the state average ("your district leans more X than the average voter in your state"), never as "N constituents believe X" or "X% of constituents support Y". Never present a score average as a share of people.
  - Nulls mean UNKNOWN, not "no". Never fold them into a category — and never hide them either: unknowns are a reportable segment. When you break down or filter by any column, also count the unknowns (SUM(CASE WHEN col IS NULL THEN 1 ELSE 0 END) AS unknown_count) and surface them whenever they are a sizable share or behave differently on the metric at hand — unknown-status groups often differ systematically (e.g. lower turnout), which can itself be actionable for the user. Unknown counts follow the same small-cell suppression rule as any other count: report small ones as ranges, never exact numbers. For alignment shares, compute over non-null values (AVG(CASE WHEN col >= 50 THEN 1.0 WHEN col IS NOT NULL THEN 0.0 END)) and state the coverage alongside, rather than silently mixing nulls into the denominator.`
