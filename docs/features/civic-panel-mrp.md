# Civic panel: two rounds and a model of who thinks what

How a priority's answers become a read of the district, and who the next
text goes to. Pure math lives in
`packages/gp-api/src/priorities/util/mrp.util.ts` (the model) and
`packages/gp-api/src/contacts/utils/civicPanelAllocation.util.ts` (who the
next batch leans toward). Neither is wired to a route, a job or a send yet;
this page says what they are for and what has to land before they are.

## Why

The current read sizes every question for 10 points either way at 95%
confidence (`answersNeeded`, 96 answers). That margin assumes the people who
answer were drawn at random. Nobody who answers a text from their council
member was: they chose to. The figure looks rigorous and holds nothing.

The replacement asks two different questions:

1. **Has every major group been heard?** At least three voices from every
   group holding 3% or more of the district, on each dimension the panel
   steers on (age band, tract, race, gender once published).
2. **What does each group likely think, and how sure are we?** A model of
   opinion by group, reweighted to who lives in the district, with a range
   that says how sure it is.

## Two rounds

**Round 1, mixed.** The panel build plan's first wave as it is today: texts,
calls and doors, drawn from the district. Doors and calls reach people who
never text back, so round 1 seeds the model and gives the only check on the
texters: in the same group, do door answerers and text answerers differ?

**Round 2, texts in batches.** One question at a time. After each batch's
reply window, refit the model, rank the groups (`batchTargets`), lean the
next draw toward them (`batchWeights`, the same `SampleWeights` the census
steering passes to `drawListSample`) and keep 15% of every batch unsteered
(`splitBatch`) so drift outside the lean still shows up. Stop when every
major group has its three voices and its range is narrow enough, or the
budget is spent.

## The model

An additive logistic regression: an intercept plus one effect per value of
each dimension, each dimension's effects drawn from a normal with its own
scale. Small groups borrow from the district (partial pooling). The fit is
reweighted to the district's own cells (poststratification). This is MRP;
Gelman and Hill chapter 14, or Kennedy and Gelman (2021), "Know your
population and know your model", for a readable account.

- **Fit.** Posterior mode by Newton's method, uncertainty by the Laplace
  approximation. About 1 ms for a district.
- **Ranges.** 400 draws of the coefficients pushed through the frame; 5th
  to 95th percentile. On simulated districts the truth falls inside about
  95% of 90% ranges, a little cautious when a dimension's scale is set
  wider than it needs.
- **Scales.** `learnMrpScales` learns how much each dimension splits
  opinion from past questions (empirical Bayes by EM). A dimension that never
  matters shrinks, so its groups pool harder.
- **Ranking.** A group's score is its share of the district times the width
  of its range. Raw width alone would chase the smallest groups forever.

## What the ranges do not hold

- **Responder bias.** If the people who answer differ from neighbors like
  them who do not, no model fixes it. The round 1 door comparison is the
  check, and the unsteered slice keeps it alive in round 2.
- **Interactions.** The model is additive: young residents of one tract are
  assumed to differ from the district by the sum of "young" and "that
  tract".
- **Labels.** Race is L2's modeled value, read from names and places, and
  it misreads some communities wholesale.
- **Doubt about the scales themselves.**

## Before it is live

1. **A coded answer per person.** Today a priority answer only records that
   someone replied (`priorityResults.service.ts`, `responded`). The model
   needs yes, no or mixed per respondent: AI classification of each reply,
   with spot checks.
2. **Shadow run.** Fit the model on existing priorities and compare it with
   the raked read, internally only.
3. **Round 1 sizing.** Size the first wave for three voices per major group
   instead of `answersNeeded`.
4. **Round 2 batches.** A scheduled job that, after each reply window, fits,
   ranks, draws and opens the next send. Each batch is a poll expansion
   today (`sendSeq`), and each expansion needs its own checkout and staff
   review; round 2 needs one approval covering a budget and a message.
5. **Delivery.** Serve texts are sent by a person from a Slack CSV and the
   replies come back by upload (`docs/features/serve-sms.md`, "Layer 1").
   Batches a day apart work with that. Hours apart needs the vendor behind
   `TEXT_DELIVERY_HANDOFF_PORT` and a reply webhook.
6. **The official's view.** Each group's estimate with its range, and
   nothing for a group under three voices.
