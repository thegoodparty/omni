# Civic panel: two rounds and a model of who thinks what

How a priority's answers become a read of the district, and who the next
text goes to. Pure math lives in
`packages/gp-api/src/priorities/util/mrp.util.ts` (the model) and
`packages/gp-api/src/contacts/utils/civicPanelAllocation.util.ts` (who the
round 2 text leans toward). Neither is wired to a route, a job or a send yet;
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

## Two rounds, one setup

Exactly two rounds (Samuel, 2026-10-19). The official sets both up at once,
so the design is iterative without asking them to come back and act twice.

**Round 1, mixed and up front.** Doors, calls and a text, drawn from the
district, sized so every major group is expected to give at least three
answers (below). Doors and calls reach people who never text back, so round
1 seeds the model and gives the only check on the texters: in the same
group, do door answerers and text answerers differ?

**Round 2, one scheduled text.** Approved and paid for during setup, with
its size and message (the official always approves the budget). It sends
on the date the official picks (two weeks after round 1 starts by default),
with whatever answers are in by then. Its recipients are not chosen until
that date: the model is fit to round 1's answers, the groups are ranked
(`batchTargets`), the draw leans toward them (`batchWeights`, the same
`SampleWeights` the census steering passes to `drawListSample`), and 15% of
the send is drawn unsteered (`splitBatch`) so drift outside the lean still
shows up. There is no round 3.

**Sizing round 1.** Replaces `answersNeeded` and `panelGoalMembers` for
this flow (Samuel, 2026-10-19, superseding the 2026-10-15 sizing). A major
group holds 3% or more of the district on a steered dimension. Each needs
three expected answers: invites to the group times the channel's assumed
rate. Doors and calls take the official's hours as `sizePanelWave` splits
them today; the text covers whatever groups the hours leave short.

**Coding answers.** Replies stay free text. An AI classifier reads each
reply against the question and records yes, no or mixed, plus "not an
answer" (Samuel, 2026-10-19: a fixed YES or NO reply would narrow what
residents can say). Staff spot check a sample.

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

## What the official sees

The priority results page as it is (Samuel, 2026-10-19: no new UI). The
model feeds the shapes the page already reads:

- **Status** (`priorityReadStatus`'s labels): `tooEarly` while a major
  group has no answer, `notYetRepresentative` while one has fewer than
  three, `gettingClose` while a major group's 90% range is wider than 20
  points, `representative` once none is.
- **Hear from more** (`underrepresented`): the groups `batchTargets` ranks
  first, in the page's existing group names.
- **Shares** the page shows weighted come from the model instead of raking.
- **Representation bars** stay as they are: who answered against the
  district.

## Before it is live

1. **Coding answers.** The classifier above; today a priority answer only
   records that someone replied (`priorityResults.service.ts`,
   `responded`).
2. **Shadow run.** Fit the model on existing priorities and compare it with
   the raked read, internally only.
3. **Round 1 sizing** by coverage, above.
4. **Round 2 scheduling.** A send created and paid for at setup with no
   list, and a job on its date that fits, ranks, draws and hands it off.
   Today a Serve send freezes its list at checkout and goes to staff review
   on payment; round 2 needs the review to cover the message at setup and
   the list drawn later.
5. **The results page** reading the model, above.

Delivery stays the Slack handoff (`docs/features/serve-sms.md`, "Layer
1"): with one scheduled send there is no reply loop to speed up.
