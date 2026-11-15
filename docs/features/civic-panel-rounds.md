# Civic panel: two rounds and a read of who has been heard

How a priority's answers become a read of the district, and who the next
text goes to. The read counts coded answers per group
(`packages/gp-api/src/priorities/util/priorityGroupRead.util.ts`, behind
`serve-citizen-panels`); `packages/gp-api/src/contacts/utils/civicPanelAllocation.util.ts`
sizes round 1 and leans the round 2 text. The read drives the priority
results page and the round 2 draw
(`priorities/services/priorityRoundTwoDraw.service.ts`); round 1 sizing is
wired to the priority chat. This page says what they are for and what has
to land before the rest is live.

## Why

The read used to size every question for 10 points either way at 95%
confidence (96 answers). That margin assumes the people who answer were
drawn at random. Nobody who answers a text from their council member was:
they chose to. The figure looked rigorous and held nothing. `answersNeeded`
now sizes for coverage, and the civic panel's goal follows it.

The read asks one question: **has every major group been heard?** At
least three voices from every group holding 3% or more of the district, on
each dimension the panel steers on (age band, gender, tract, race), and the
district's floor of answers in all.

It does not say what each group thinks: the panel selects members of set
groups up to a threshold, and counting is all that needs
(`docs/adr/2026-11-13-priority-read-counts-groups-no-model.md`).

## Two rounds, one setup

Exactly two rounds (Samuel, 2026-10-19). The official sets both up at once,
so the design is iterative without asking them to come back and act twice.

**Round 1, mixed and up front.** Doors, calls and a text, drawn from the
district, sized so every major group is expected to give at least three
answers (below). Doors and calls reach people who never text back, so round
1 gives the only check on the texters: in the same group, do door
answerers and text answerers differ?

**Round 2, the held half of the text.** The official buys one text of N
(Samuel, 2026-10-20): `splitPriorityText` sends `ROUND_ONE_TEXT_SHARE`
(half) at random on the date they pick and holds the rest as a follow-up,
paid for in the same checkout and sent `FOLLOW_UP_BUSINESS_DAYS` (10, two
weeks) later, with whatever answers are in by then. Half keeps round 1
large enough to show which groups lag and round 2 large enough to steer;
the gain is flat across 40 to 60%, so the share is one constant to tune once
answer rates are measured. A purchase too small for both halves to reach
`MIN_TEXTS_PER_ROUND` (25) goes out whole. Its recipients are not chosen
until close to its date: the priority's read of round 1's answers lists the
major groups short of three answers, largest first (`batchTargets`), the
draw leans toward them (`batchWeights`: `MAX_TARGET_WEIGHT`, 4, for a short
group, 1 for every other major group, the same `SampleWeights` the census
steering passes to `drawListSample`), and 15% of the send is drawn
unsteered (`splitBatch`) so drift outside the lean still shows up. There is
no round 3.

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
`priorityRoundTwoDrawDue` schedule (`41 12 * * *` UTC, one
`priorityRoundTwoDraw` job per send) draws each one on the last day a Serve text for its date could still be
booked, `ROUND_TWO_DRAW_LEAD_BUSINESS_DAYS` (3) business days before, so
staff get the usual two clear days. The draw
leans on the priority's read, the one its page shows
(`PriorityReadService.currentRead`: the stored read, computed and stored
first when its answers have moved on), draws the steered 85% with
`batchWeights` of the read's groups and the unsteered rest, then in one
transaction claims the list (stamping `sampledAt`, a CAS on it being null) and writes the
members, and sends the `outreachTextSend` pg-boss job
`{ outreachId, sendSeq: 1 }`. A failed send puts the list back to
undrawn for the job's retry; a send drawn but never enqueued (a crash between
the two) is handed off by a later run; a draw that finds nobody cancels
the send for a hand refund. Its frame, groups and dimensions are the
read's, so it leans toward the groups the page names; in a district read
by areas, each area's factor covers the range of tracts it spans. When the read cannot
be brought up to date at the draw (a warehouse that did not answer), the
last stored read leans it. With no read at all (no district, nothing
stored) the whole send is drawn unsteered. Staff review is the same as any Serve text: the CSV
handoff at enqueue. On dev and previews, `POST
/v1/priorities/round-two/:outreachId/draw` draws one of the office's round 2
texts now (404 on prod).

**Sizing round 1.** Replaces `answersNeeded` and `panelGoalMembers` for
this flow (Samuel, 2026-10-19, superseding the 2026-10-15 sizing). A major
group holds 3% or more of the district on a steered dimension. Each needs
three expected answers: texts to the group times the assumed cold text rate
(3%, a placeholder until measured). Round 1 is one text, sized for the
smallest major group a cell phone reaches and capped by the reachable cell
phones. The priority chat proposes it as one card (`size_round_one`,
`sizeRoundOne`; detail in the contacts AGENTS.md, "Round 1 sizing").

**Coding answers.** Replies stay free text. An AI classifier reads each
reply against the question and records yes, no or mixed, plus "not an
answer" (Samuel, 2026-10-19: a fixed YES or NO reply would narrow what
residents can say). Staff spot check a sample.

## The read

For each value of each dimension, its share of the district (from the
frame below) and how many people with a coded answer are in it
(`countGroups`). An answer counts once on every dimension it is known on.
The counting is cheap; the read is computed in the background because the
frame and the answer cells are two warehouse reads (`PriorityReadService`,
`packages/gp-api/src/priorities/AGENTS.md`, "The read").

A large district reads by areas, not tracts: a tract would need 3% of the
district to be a major group, which no tract reaches past about 33 equal
ones. Past 60 tracts (`MAX_TRACTS_READ_ALONE`) the frame groups tracts into
areas (`tractAreas`): counties, a county over 1/30 of the district's adults
split into runs of tracts about 1/30 each, and counties under 1% pooled
into `other`, which counts but is never named. A statewide district is
about 25 areas (Swain, 2026-11-13;
`docs/adr/2026-11-13-large-district-reads-use-county-areas.md`).

## What the counts do not hold

- **Responder bias.** If the people who answer differ from neighbors like
  them who do not, three voices from a group do not speak for it. The round
  1 door comparison is the check, and the unsteered slice keeps it alive in
  round 2.
- **Labels.** Race is L2's modeled value, read from names and places, and
  it misreads some communities wholesale.
- **What anyone thinks.** Every group heard says who answered, not what
  each group thinks or how sure that is.

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
follow-up is closed with calls and doors, never a third text. The read feeds the
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
  `buildAnswerCellsSql` counts the people with a coded answer (yes, no or
  mixed; not an answer left out) in the same cells; an answer in a tract
  the frame does not hold sits tract out. In a district read by areas (see
  The read), every tract in the frame, the answers and the adults per
  tract stands for its area. Race folds into `other` as the
  steering folds it (under 2% of the district), and sits out when the
  census has no race figures. Both are counts, never a person
  (`CensusCompositionSource.readInputs`; the district's cells are shared for
  15 minutes per task). A priority's read is computed in the background and
  stored (`PriorityReadService`, `packages/gp-api/src/priorities/AGENTS.md`,
  "The read").
  Age and sex margins are the district's, not each tract's: the district
  row is the block groups allocated by population share, and the voter
  file supplies the pattern within it.
- **Major groups** (`groupReadStatus` and `districtAnswersNeeded`) are read
  off this same frame, so the groups named on screen and the answers
  sized for them are the same groups.
- **Status** (`groupReadStatus`, in the page's existing labels): `tooEarly`
  while a major group has no answer, `notYetRepresentative` while one has
  fewer than three or the answers are under the district's floor (the
  `answersNeeded` round 1 is sized to, `frameAnswersNeeded` of this frame),
  `representative` once neither holds. Major groups are on age, tract,
  gender, and race only when `raceNameable` holds. `enoughAnswers` stays
  for a district that cannot be read. `gettingClose` stays in the
  contract's enum, but nothing reports it.
- **Answers needed** (`needed`): the larger of the floor and the people
  heard plus the fewest more answers that could give every major group
  three.
- **Hear from more** (`underrepresented`): the first two groups short of
  three answers, largest first (`batchTargets`), in the page's existing
  group names; every tract reads as the parts not reached. `unheard` marks the
  named ones with no answer at all (for the parts not reached, any of their
  tracts), so the page says "Still need to hear from men" for those and
  "Need a few more answers from women" for the rest.
- **Who you're hearing from** on the results page is the read's own major
  groups (age band, gender, race when nameable), each one's share of the
  district against its share of the coded answers, unweighted, drawn as the
  panel page's petals (`answerGroups`). Nothing says what a group thinks.

## Not yet

- **A follow-up that draws nobody is refunded by hand.** One that draws
  fewer than it was paid for sends what it drew, which the 90% sizing makes
  rare; one that draws nobody is canceled and logged for a hand refund, and
  its history row says "Nobody left to text, so this was canceled. We'll
  refund it."

Delivery stays the Slack handoff (`docs/features/serve-sms.md`, "Layer
1"): with one scheduled send there is no reply loop to speed up.
