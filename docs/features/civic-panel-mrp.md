# Civic panel: two rounds and a model of who thinks what

How a priority's answers become a read of the district, and who the next
text goes to. Pure math lives in
`packages/gp-api/src/priorities/util/mrp.util.ts` (the model) and
`packages/gp-api/src/contacts/utils/civicPanelAllocation.util.ts` (how big
round 1 is, and who the round 2 text leans toward). The model is the
priority results page's read (`mrpReadStatus.util.ts`, behind
`serve-citizen-panels`) and drives the round 2 draw
(`priorities/services/priorityRoundTwoDraw.service.ts`); round 1 sizing is
wired to the priority chat. This page says what they are for and what has
to land before the rest is live.

## Why

The read used to size every question for 10 points either way at 95%
confidence (96 answers). That margin assumes the people who answer were
drawn at random. Nobody who answers a text from their council member was:
they chose to. The figure looked rigorous and held nothing. `answersNeeded`
now sizes for coverage, and the civic panel's goal follows it.

The replacement asks two different questions:

1. **Has every major group been heard?** At least three voices from every
   group holding 3% or more of the district, on each dimension the panel
   steers on (age band, gender, tract, race).
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

**Round 2, the held half of the text.** The official buys one text of N
(Samuel, 2026-10-20): `splitPriorityText` sends `ROUND_ONE_TEXT_SHARE`
(half) at random on the date they pick and holds the rest as a follow-up,
paid for in the same checkout and sent `FOLLOW_UP_BUSINESS_DAYS` (10, two
weeks) later, with whatever answers are in by then. Half keeps round 1
large enough to show which groups lag and round 2 large enough to steer;
the gain is flat across 40 to 60%, so the share is one constant to tune once
answer rates are measured. A purchase too small for both halves to reach
`MIN_TEXTS_PER_ROUND` (25) goes out whole. Its recipients are not chosen
until close to its date: the model is fit to round 1's answers, the groups are ranked
(`batchTargets`), the draw leans toward them (`batchWeights`, the same
`SampleWeights` the census steering passes to `drawListSample`), and 15% of
the send is drawn unsteered (`splitBatch`) so drift outside the lean still
shows up. There is no round 3.

**How round 2 is built.** The text card carries the first half as
`sampleSize` and the follow-up as `roundTwoSize`. The Serve SMS create for
the first send takes `roundTwoSize` with its priority link and writes a
second row in the same transaction: `roundOneOutreachId` pointing at the
first, the date 10 business days later, and `min(roundTwoSize, 90% of (pool -
first send))`, where the 10% left unsold covers people who opt out or are
reached another way before the draw, and the pool is the list's whole criteria (never its sample) on
cell phones less everyone the priority's other sends texted, called,
knocked or drew and everyone opted out (`roundTwoExclusions`). Too few left
for a text of its own is no follow-up. The follow-up sits on a copy of the
list's criteria with `sampleSize` set and nothing drawn. That state is the
round 2 marker: no other path saves a sample undrawn, and such a list
resolves to nobody. Checkout prices both rows, and payment claims both in
one transaction: the first is enqueued and puts the priority's check out,
the follow-up is held. The
`priorityRoundTwoDraw` job (`41 7 * * *` ET, `CronLockService` daily slot)
draws each one on the last day a Serve text for its date could still be
booked, `ROUND_TWO_DRAW_LEAD_BUSINESS_DAYS` (3) business days before, so
staff get the usual two clear days. The draw
fits the model to the priority's coded answers so far (`PriorityAnswer`:
yes 1, no 0, mixed 0.5, not an answer left out), draws the steered 85%
with `batchWeights` and the unsteered rest, then in one transaction claims
the list (stamping `sampledAt`, a CAS on it being null) and writes the
members, and enqueues `outreachTextSend { outreachId, sendSeq: 1 }`. A failed
enqueue puts the list back to
undrawn for the next run; a send drawn but never enqueued (a crash between
the two) is handed off by a later run; a draw that finds nobody cancels
the send for a hand refund. The frame is the census shares multiplied across dimensions (age,
gender, tract, and race when `raceNameable` holds for the
answerers): the census publishes no joint counts. If the census, the
answerers or the district cannot be read, or the fit throws, the whole send
is drawn unsteered. Staff review is the same as any Serve text: the CSV
handoff at enqueue. On dev and previews, `POST
/v1/priorities/round-two/:outreachId/draw` draws one of the office's round 2
texts now (404 on prod).

**Sizing round 1.** Replaces `answersNeeded` and `panelGoalMembers` for
this flow (Samuel, 2026-10-19, superseding the 2026-10-15 sizing). A major
group holds 3% or more of the district on a steered dimension. Each needs
three expected answers: invites to the group times the channel's assumed
rate (doors 10%, calls 5%, a cold text 3%, placeholders until measured).
Doors and calls take the official's hours as `sizePanelWave` splits them;
the doors are one walkable area, so they count toward the groups living
there. The text covers whatever groups the area and the calls leave short,
capped by the reachable cell phones. The priority chat proposes all three as cards at
once (`size_round_one`, `sizeRoundOne`; detail in the contacts AGENTS.md,
"Round 1 sizing").

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
  matters shrinks, so its groups pool harder. The results read does not call
  it yet: every dimension takes `DEFAULT_MRP_SCALE`, because learning needs
  each past priority's answer cells, a warehouse read apiece.
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

The priority results page as it is (Samuel, 2026-10-19: no new UI), plus
the follow-up, which the official has to be able to see is coming (Samuel,
2026-10-20). The text card reads "Text 2,000 of 58,520: 1,000 now, 1,000
two weeks later", the chat says it in one line, the review step shows a
Follow-up row and why it goes later, and the priority's read status carries
`followUp` (date and texts) while it is paid and unsent, shown as "Follow-up
text to N people on <date>" in place of Get answers and in the agent's
`<priority>` block, and `followUpSent` once it has gone out. `checkOut` says a
check is out with residents on any channel; before it the status reads "No one
asked yet" and there is no Get answers. In Outreach history the follow-up reads
Draft until its recipients are picked and Scheduled after, with "Recipients
picked <date>, from the groups you've heard least from"; its undrawn list stays
off Constituents lists and cannot be edited or deleted. A short read after the
follow-up is closed with calls and doors, never a third text. The model feeds the
shapes the page already reads, through `PriorityResultsService`
(`resultsFor`, `readStatuses`):

- **The frame and the answers.** The frame is the district's people
  from the voter file (`buildDistrictCellsSql`: age band, gender, tract,
  race counts) reweighted so age band, sex and tract take the census's
  adult shares (`censusFrame`, iterative proportional fitting): ACS
  B01001 sex by age band from the district's census row, and adults per
  tract summed from the block groups the district's people live in. The
  voter file keeps how the dimensions overlap, its unknowns (they sit out
  a dimension) and race, which stays the voter file's because the census
  publishes race over everyone, children included. A dimension the census
  cannot give (a suppressed figure, no district row, no tract adults)
  keeps the voter file's counts for it, logged at warn. Samuel decided
  this on 2026-10-20 (`docs/adr/2026-10-20-civic-panel-frame-from-census-sex-age.md`).
  `buildAnswerCellsSql` sums the coded answers (yes 1, no 0, mixed half,
  a person's answers averaged) in the same cells; an answer in a tract the
  frame does not hold sits tract out. Race folds into `other` as the
  steering folds it (under 2% of the district), and sits out when the
  census has no race figures. Both are counts, never a person
  (`CensusCompositionSource.mrpInputs`; the district's cells are shared for
  15 minutes, a priority's read is kept 15 minutes per its coded answers).
  Age and sex margins are the district's, not each tract's: the district
  row is the block groups allocated by population share, and the voter
  file supplies the pattern within it.
- **Major groups** (`mrpReadStatus` and `districtAnswersNeeded`) are read
  off this same frame, so the groups named on screen and the answers
  sized for them are the groups the model has.
- **Status** (`mrpReadStatus`, in the page's existing labels): `tooEarly`
  while a major group has no answer, `notYetRepresentative` while one has
  fewer than three, `gettingClose` while a major group's 90% range is wider
  than 20 points, `representative` once none is. Major groups are on age,
  tract, gender, and race only when `raceNameable` holds. `enoughAnswers`
  stays for a district that cannot be read.
- **Answers needed** (`needed`): the people heard plus the fewest more
  answers that could give every major group three.
- **Hear from more** (`underrepresented`): of the groups holding the read
  back, the first two `batchTargets` ranks, in the page's existing group
  names; every tract reads as the parts not reached. `unheard` marks the
  named ones with no answer at all (for the parts not reached, any of their
  tracts), so the page says "Still need to hear from men" for those and
  "Need a few more answers from women" for the rest.
- **Who you're hearing from** on the results page is the read's own major
  groups (age band, gender, race when nameable), each one's share of the
  district against its share of the coded answers, unweighted, drawn as the
  panel page's petals (`answerGroups`). The model's estimates are not shown
  anywhere yet.

## Not yet

- **A follow-up that draws nobody is refunded by hand.** One that draws
  fewer than it was paid for sends what it drew, which the 90% sizing makes
  rare; one that draws nobody is canceled and logged for a hand refund, and
  its history row says "Nobody left to text, so this was canceled. We'll
  refund it."

Delivery stays the Slack handoff (`docs/features/serve-sms.md`, "Layer
1"): with one scheduled send there is no reply loop to speed up.
