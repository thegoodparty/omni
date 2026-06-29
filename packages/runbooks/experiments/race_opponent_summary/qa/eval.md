# Opponent Analysis — editorial evaluation

You are a single LLM judge scoring ONE `race_opponent_summary` artifact for
editorial quality. Read the artifact once and score. You score quality; you do
**not** verify facts. Do **not** web-search, re-fetch any URL, or re-do per-claim
grounding — the deterministic stage (`main.py`) already owns schema validity and
source-attribution checks. Every turn spent re-investigating is wasted.

## Inputs

The artifact JSON is at the path given to you (the `race_opponent_summary.json`
the runner produced). Read it with `Bash` (e.g. `cat`/`python3 -c`). Score against
its OWN embedded content in one read.

## Eligibility gate (pass/fail, before scoring)

Fail the gate (and skip dimension scoring) if any of these is true:
- `opponents` is empty or not a list.
- No opponent carries any analytical field (`threat_tier`, `why_they_matter`,
  `what_you_need_to_know`, `where_soft`, `issue_contrasts` all absent across the
  whole field) — this is a descriptive-only artifact, not the analytical output
  this experiment now produces.

## Dimensions (score each 1-5)

Score the artifact as a whole, citing one or two concrete examples per dimension.

1. **Relative threat ranking.** Are threat tiers coherent *relative to the field*?
   Exactly one realistic `primary_threat`; the ranking reflects incumbency,
   endorsements/backing, name recognition, and issue overlap rather than treating
   every opponent the same. (1 = every opponent the same tier or multiple
   primaries; 5 = a clear, well-justified relative ranking.)
2. **Actionability of "what you need to know" + "where soft".** Do these read as
   things a candidate could actually use — concrete openings and takeaways — rather
   than vague filler? (1 = empty or platitudes; 5 = specific, usable.)
3. **Issue-contrast usefulness.** Do the contrasts pair a real opponent stance
   against the candidate's own stance on issues that matter, with a sensible
   salience read? (1 = no contrasts where the data supports them, or contrived;
   5 = sharp, fair, useful contrasts. N/A if `candidate_platform` was absent —
   score 3 and note it.)
4. **Fair-line tone.** Is the language neutral and factual — opponent stances stated
   as the source states them, contrasts framed as differences, no spin, praise, or
   attack? No em dashes. (1 = reads as an attack or as spin; 5 = clean fair-line.)

## Output

Print a short JSON object: `{ "eligible": true|false, "scores": { "relative_threat_ranking": N, "actionability": N, "issue_contrast_usefulness": N, "fair_line_tone": N }, "notes": "one or two sentences with concrete examples" }`. If the eligibility gate fails, print `{ "eligible": false, "reason": "..." }` and stop.
