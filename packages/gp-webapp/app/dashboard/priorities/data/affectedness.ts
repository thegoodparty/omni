/**
 * How to choose who is worth hearing from, ported from the Serve lists
 * runbook (Samuel, 2026-09-10) and the Milton affectedness framework behind
 * it. The runbook lives outside this repo and builds its lists in SQL against
 * the L2 file; this is the same method expressed in the dimensions the CRM
 * tools actually expose.
 *
 * The one correction it makes to what this flow did before: it was picking
 * "highest-engagement constituents" and "super-voters", which the framework is
 * explicit about being a GATE and not a driver. Engagement says who will
 * answer the phone, not who the decision lands on, and ranking by it hands an
 * official the people already talking to them.
 */

export const AFFECTEDNESS_METHOD = [
  'HOW TO CHOOSE WHO TO HEAR FROM. This is a method, not a preference. Follow',
  'it rather than reaching for whoever is easiest to reach.',
  '',
  'PICK FOR EXPOSURE, NOT FOR ATTITUDE OR ENGAGEMENT. The question is who is',
  'materially affected by what we just settled: their housing, their income,',
  'their household, where they live. NEVER rank by turnout, voter score,',
  '"high engagement" or "super-voters". That is a gate on who answers, not a',
  'measure of who this lands on, and ranking by it hands me the people already',
  'talking to me. The one exception is an issue that is itself about voting or',
  'representation (a ward redraw, an at-large conversion), where how much',
  'someone uses their city vote IS the exposure. Say out loud when you take',
  'that exception.',
  '',
  'TWO GATES, IN THIS ORDER, BEFORE ANY RANKING.',
  '1. Representation: everyone on the list has to be someone I actually',
  'represent. If my seat is a district or ward seat rather than at-large and',
  'you cannot scope the filter to my district, say so plainly rather than',
  'quietly handing me the whole city.',
  '2. Contact: they need a phone for a call and to be reachable for anything',
  'else. Apply it before you count, because gating after ranking changes who',
  'is on the list rather than just how many.',
  '',
  'FACTORS ARE PER ISSUE. Never reuse the last set. The same dimension points',
  'in opposite directions on different issues: renters are the beneficiaries',
  'of new housing and homeowners carry the risk of an industrial neighbour, so',
  'tenure flips between those two. Work out what this priority does to people',
  'first, then pick the two or three dimensions that capture it. Two is fine.',
  'Do not invent a third to look thorough.',
  '',
  'CHECK COVERAGE BEFORE YOU LEAN ON A DIMENSION. Call',
  'describe_filter_dimensions, then count_contacts, and see how many fall into',
  '"unknown" on the dimension you are about to use. A dimension that is half',
  'unknown does not target, it just drops people quietly. Prefer the',
  'better-covered dimension, and if the best one is thin, say so.',
  '',
  'NEVER FILTER ON ETHNICITY. It can frame a finding when I am talking about a',
  'neighbourhood or a ward in aggregate. It never decides who gets a call.',
  '',
  'SAY WHO IS MISSING. Every filter excludes someone, and the people most',
  'affected are often the ones a contact file holds least well: renters who',
  'move, people without a landline, anyone who does not vote. Name them in one',
  'line. If the people most affected are not people I represent at all, say',
  'that outright rather than letting the list look like it missed the point.',
  '',
  'THE REASON IS ABOUT THEM, NOT ABOUT THE DATA. One line on what this does to',
  'these people, in their terms. Not "they are likely to respond", not the',
  'columns you filtered on.',
].join('\n')
