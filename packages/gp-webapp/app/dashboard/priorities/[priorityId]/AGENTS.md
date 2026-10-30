# app/dashboard/priorities/[priorityId]/

One priority, worked forward. The whole detail view is **one conversation for
the life of the priority**, with a persistent rail beside it showing the seven
steps the agent is working through. There are no per-step pages and no "next"
button: the official moves through the work by talking, and the rail is how
they see the whole path rather than only the step they are on.

## Files

| File                                | Role                                                                                |
| ----------------------------------- | ----------------------------------------------------------------------------------- |
| `page.tsx`                          | Server component. Loads the priority and its status, passes `hideChatDock`          |
| `components/PriorityWorkspace.tsx`  | The client orchestrator: conversation, rail, live status, cards                     |
| `components/PriorityStatusRail.tsx` | The seven steps, their states, and a step's detail view                             |
| `components/StatusChangeMarker.tsx` | The quiet inline line a status move leaves in the conversation                      |
| `components/ReadStatus.tsx`         | The good read strip (phone) and rail block (desktop), behind `serve-citizen-panels` |
| `components/CivicPanelStanding.tsx` | Where the managed civic panel stands, under the read, behind `serve-citizen-panels` |
| `readStatusCopy.ts`                 | Good read copy and links, shared with `results/`                                    |
| `data/statusUpdates.ts`             | The `update_priority_status` merge, mirrored from the server, and the marker diff   |
| `data/statusReplay.ts`              | Replays the transcript's status calls so a reloaded thread shows the same markers   |
| `data/chat-api.ts`                  | `createAgentChatClient('priority_flow', ...)`                                       |
| `data/toolLabels.ts`                | Which tools show a pill, and what it says                                           |

## It is the shared chat kit, not a new one

Everything streaming comes from `app/dashboard/shared/agent-chat` — read its
`AGENTS.md` first. This surface is a wrapper: a client, a `toolLabel` map, the
conversation bootstrap, and an `onEvent` handler. `useStreamingTurn` owns the
loop, the reveal, the idle watchdog and the commit poll.

The cards and the clarify question are widget registry entries from the shared
kit (`shared/agent-chat/cards/cardWidgets.tsx`, `shared/agent-chat/clarifyWidget.tsx`),
because Chief of Staff renders the same ones. `PriorityWorkspace` builds its
registry from them and renders through the shared `TurnBlocks`. The status
marker is the one block that is not a registry entry: what it shows comes from
the replay in state, not from the tool args, so it goes in through
`persistedTurnBlocks`' `surfaceWidget` and a hand-built live instance.

The "Thinking..." shimmer covers the wait before anything paints, and comes
back whenever the agent is working with nothing moving on screen: between tool
calls, and while any widget's arguments stream in (`tool_input_start`, the same
signal the ordinance chat uses). It is named for the widget being written
("Looking up who to contact...", "Preparing your question...") or falls back to
the tool's pill label. It stays off while a pill is shimmering, once a
question card is up, and right after a finding card lands until the next tool
starts, since either can end the turn. Contact,
outreach and list work can take a long while, and without it the chat looked
stalled with text already on screen.

The conversation is anchored, not scoped-per-step: `createConversation` gets a
`priority` anchor and the server returns the one thread for that priority. A
brand-new thread gets one hidden kickoff so the official arrives at a
conversation that has already started; it is filtered out of the transcript on
both send and reload.

Leaving mid-turn aborts the stream, but the server finishes the turn and saves
it. A transcript that loads ending on the official's turn (most often the
kickoff, when someone backs out within seconds) is a reply still being written,
so the workspace shows "Thinking..." and polls `listMessages` until it lands,
on the shared engine's doneless commit-poll budget. It never sends a second
kickoff, which would leave two in the thread.

## The rail moves on what the server stored, never on what the agent asked

1. **`tool_result update_priority_status`** — the tool returns the merged
   status it wrote, and the rail moves mid-turn, while the agent is still
   talking. The marker is `statusChanges(before, stored)`: only what really
   moved. The `tool_call` moves nothing. The server refuses a call outright
   (`{ error }`, nothing written), and drawing from the call put "Done with"
   markers in the chat for steps the rail then showed not started.
2. **`onTurnSettle`** — `fetchPriorityStatus` reads what was actually
   persisted, which also picks up a send putting a check out.

The live status is held in a ref as well as state (`statusRef`), because two
status results can land in one tick and the second's marker is measured from
the first.

A refusal says which steps did not move and why, in words the agent can pass
on (`refusalResult` in gp-api's `PriorityStatusService`), and the prompt
(`STATUS_TOOL_BLOCK`) has it tell the official what the step waits on, never
how the system works.

## A step going backwards is the feature

`stale` means the agent settled a step and then learned something that put it
back in doubt. It is drawn differently from `settled` in the rail, and the
conversation marker says so out loud — `Back to your options`, `What we know
needs another look`. Hiding a backwards move makes the rail look broken, which
is worse than the move itself.

`statusChanges` carries where each step came from, so the marker copy can say
"backwards". A stored patch only says what a step became, so
`replayStatusMarkers` rebuilds the prior state by replaying every status call
in the transcript from an empty status, and diffs each step the same way the
live turn does. The transcript keeps a call's args, not its result, but gp-api
nulls a refused call's args, so every call left to replay is one the server
applied through the same merge. That is why a reloaded thread reads the same
as it did live. Transcripts saved before that nulling can still replay a
refused move.

## Cards are compact, and a card's detail opens over the page

Every card is one row in the stream; see "Cards" in
`shared/agent-chat/AGENTS.md`. The people cards open their detail in the
shared `CardDetailSheetHost`, the same right-side sheet a constituent opens
in on the contacts page and in Chief of Staff; the status rail stays where it
is. `PriorityWorkspace` wraps everything in `CardDetailProvider`, so a panel
opened on the live turn stays open when the turn settles and the persisted
copy of the card replaces it.

Outreach cards never open a panel. A proposal's button opens that channel's
own flow over this conversation (`ProposalFlowsProvider`, mounted here
around the workspace), filled in, and the official finishes it there; the
route never changes. The card carries this priority's id (the widget
context), so the phone banking or social outreach they finish is linked to
the priority and a second completion returns the first. Priorities hands off
to the workflow that owns the job; it does not re-implement it. The agent
counts the audience but does not save it (the card carries the filter), picks
one channel, and says why these people and why that channel in its own
message, so the card never has to.

## A step carries whether its people were asked

`define`, `options`, `method` and `plan` can each carry a check, and none has
to. Before offering one the agent names what the step is missing and matches
it to a source: a fact gets looked up, how it runs comes from staff or groups,
and only what people think, with nothing on hand showing it, earns a check.
A step that settles without one is done; the model otherwise routed every gap
into a texting campaign. When a check is warranted, the agent picks who by the affectedness method in the prompt (`AFFECTEDNESS_BLOCK` in
`gp-api/.../priority-flow/priorityFlow.prompt.ts`, from Samuel's Serve lists
runbook), counts the group without saving it, writes the one question, and offers it as
work already done through `present_outreach_proposal` on whichever channel
those people answer on, door knocking included. Starting a door card opens
the walk on the community input goal with the card's message as the
question (`proposalFlows.tsx`), the way a text opens on its message. A check has two sides,
both always offered: the most affected, and the least affected (exposure
inverted, same gates), each on its own card. Behind `serve-citizen-panels`
every card is side `main`: the round goes to residents across the district.

Behind `serve-citizen-panels` the default is round one instead
(`ROUND_ONE_BLOCK`, "ROUND ONE"): one text card, side `main`, to a random
sample of residents across the district with a cell phone, not reached in
the last 30 days (`notContactedRecently`, `hasCellPhone`).
gp-api's `size_round_one` counts who the text reaches by group and sizes it
so every major group is expected to give at least 3 answers (`sizeRoundOne`;
see the contacts AGENTS.md, "Round 1 sizing"). It carries no
`civicPanelAsk` (only the managed civic panel's invite waves ask people to
join) and is an ordinary proposal card with `sampleSize`. It is
one purchase in two rounds: `roundTwoSize` is the half held for a
follow-up two weeks later, drawn toward the groups heard from least, and
checked by gp-api against the split `size_round_one` made
(`checkFollowUpPart`). Its card reads "Text 2,000 of 58,520: 1,000 now, 1,000
two weeks later" (`proposalSampleLine`), `SmsFlow` forwards it on the create,
the review step quotes both as one count with a Follow-up row
(`SmsReviewStep`), and once paid the read status's `followUp` puts "Follow-up
text to N people on Nov 3" in place of Get answers until it sends. There is no most or least
affected follow-up: more answers come from Get answers (below), aimed at the
groups the read is missing. The handler reads the panel
size per turn (`countCivicPanelMembers`) for the `<priority>` "Civic
panel" line, only with the flag on.

**The managed civic panel.** With the flag on the handler also reads the
civic panel GoodParty builds (`ManagedCivicPanelService.read`, as
`managedCivicPanel`: status, members of goal, the next send day and the
ready week; null for none or stopped; a failed read leaves it out, so the
agent never says there is none). It changes at most daily, so it is read
once per open: `resolveConversation` (the page's `createConversation`)
drops the conversation's entry from an in-memory map on the handler, the
next turn reads it, and later turns reuse it. A failed read is not kept, so
the next turn tries again. The "Civic panel"
line says where it stands. `THEIR CIVIC PANEL ON THIS PRIORITY`
(`buildCivicPanelBlock`) steers by status. Building or paused (paused
fills again only after Resume invites): the agent never sells a text as the
way to build or fill it, offers
to ask the civic panel once it is ready, and offers the round one text only
as a way to hear from residents sooner. Ready: asking it is the default
first round of a check. When a check is warranted the agent asks which way
with one `ask_clarify_question`, in this order, each with a one-line
rationale: Ask my civic panel (one text card to its members,
`civicPanelMember` and `hasCellPhone`, no sample, no `civicPanelAsk`),
Text residents across the district (round one as
ever), or Use another kind of outreach (calls or doors, built as BUILD THE
CHECK). The pick is the ask: it never asks again on that step
(`docs/adr/2026-10-29-ready-civic-panel-is-a-prioritys-default-first-round.md`).
No priority text asks anyone to join, and in every state the agent never
brings joining up in chat (`ROUND_ONE_JOIN_RULE`). Every priority text ends
with the question, then its own last line on how to reply ("Reply YES or
NO."), and the flow adds only the opt-out under it
(`PRIORITY_TEXT_LAYOUT_RULE`).
Exhausted: says so, round one is the way in, and its members can still be
asked. None: Build my civic panel on the home sets one up. The agent told
an official whose civic panel was filling that the paid round one text was
how to build it.

**Nothing is out until the record says so.** `WHAT HAS GONE OUT`
(`SENT_RECORD_BLOCK`, every turn, flag or not): only a side's Set up on, a
`<thread>` line that says sent or scheduled, or `Check out with residents:
yes` count. A card the official opened and closed leaves an unpaid draft,
so the `<thread>` line for a send in `pending_payment`, `draft`,
`canceled`, `denied` or `failed` reads "never sent", never "scheduled", and
`read_past_outreach` says the same. The agent once told an official the
check was out with residents through a text they discarded. Judge case
`no-send-claimed-from-a-card` pins it.

**The civic panel on the page.** `CivicPanelStanding` sits under the read
until it is good (the desktop rail, and the top of the phone's Where this
stands sheet): the civic panel page's title for its status and "82 of 240
residents have joined", or once ready the page's ready line naming the
place from `useServePlace` (`civicPanelStanding` in `readStatusCopy.ts`),
linked to the civic panel page. It reads `managedCivicPanelQueryOptions`
once with the page (not on turn settle), and shows nothing for none or
stopped.

The official can take both, one,
or neither, from the cards' own buttons: the agent asks no follow-up question
about them and never rebuilds a card already in the thread, because a second
ask and a second set of cards read as redundant. The check is the ask for its stage. `listen_problem` and
`listen_options` never ask again: they are where the answers to the `define`
and `options` checks land, and with no check on their gate they close on what
the official and the record already show (`isCheckAnswered` reads no check as
nothing to wait on).

A model left alone records the check and moves on without showing it, so the
server holds the order once a check exists, and never forces one.
`update_priority_status` refuses to record `asked` until a card or a question
has gone out in that turn (the priority-flow handler tells it, since tools are
built per turn), and answers a gate settled without one with `checkDue`: say
what is still missing, offer a check only for a gap in what people think, and
otherwise move on. So `asked` means shown, and the rail reads it as waiting on
the official.

Three more holds, because the model also called the official's own agreement
"constituents agreed":

- **Recording `asked` while something was offered stamps `offeredAt` on the
  server** (`mergeStepCheck`'s `offered` argument, which only the server
  passes). Reads heal earlier rows: `parsePriorityStatus` drops an `asked`
  with no `offeredAt`, and any check on a step that is not a gate.
- **`confirmed` and `revised` need evidence.** The side has to have been `out`,
  or shown in an earlier turn (`offeredAt` before the handler's turn
  `startedAt`), and `heard` has to say what constituents said. A check patch
  on a step that is not a gate is refused, and the client merge ignores one.
- **A real send puts a side out, not the agent.** A proposal names the check
  it puts out (`stepId`, `side`), and the create that sends it carries them.
  Once the send is real (the phone list built, the post saved, the text paid
  for, the walk drawn) `PriorityStatusService.recordOutreachSent` moves that side to `out`
  through the same merge, stamping `sentAt` and `sentProposalKey`; a side
  already out on a send keeps it, and a side constituents already answered
  keeps its answer. A deferred or declined side does move: the send is what
  happened. A status write that fails after the send committed is logged,
  and `healSends` puts it out before the next turn reads the status. The
  `<status>` block shows `Set up on <day>` (the day of `sentAt` in the
  office's zone), never "Sent": a paid text is out on its side days before it
  reaches anyone, and the agent reads when it goes out from
  `read_past_outreach` (`scheduledFor`, `sentOn`). The
  proposal tool refuses to offer a sent side again, and the workspace tells
  the agent with one hidden `PROPOSAL_SENT_MARKER` turn (see "Cards" in
  `shared/agent-chat/AGENTS.md`).

Listening is not a gate. The answer lives on the step as `check`
(`PriorityStepCheckSchema` in contracts): `asked`, `out`, `confirmed`,
`revised`, `deferred`, `declined`, with the least-affected side nested as
`check.contrast` with its own state. It is nested rather than a second check
because it is offered, answered and raised together; it has its own state
because the official can take one side and not the other. A check patch may
omit `state` to move only the contrast. A deferral comes back at most
`MAX_CHECK_RAISES` times, and the count is derived (and capped) in
`mergeStepCheck`: recording `deferred` over `deferred` is a raise. It is
shared by the server and `applyStatusUpdate` so the two never count
differently. A malformed check, or contrast, drops on its own, in the stored
status, in a live patch and in the server's tool input, so it never stops the
step itself from moving. The rail prints one line per step,
not one per side (`STEP_CHECK_LABELS`): anything waiting on the official wins,
then anything out, then how the main side landed. Who each side is lives in
the conversation, not the rail.

Chief of Staff reads the same state (current step, next action, checks)
through its priorities context and points into this flow without running it.
When a put-off check's moment arrives it raises it once, in one line, and
records it with `record_check_reminder`, a narrow write in
`PriorityStatusService.recordCheckReminder` that touches only that step's
check and spends the same raise counter, so the two surfaces never nag
separately.

## Reporting back

Behind `serve-citizen-panels`, once a priority text's replies are in (gp-api
`OutreachReportBackService`: the results upload has landed and no summary of
them is still running) and someone has answered, the Chief of Staff home shows
one report back card for the priority ("Show people their voice counted on"
the priority), to everyone who answered on any channel, each counted once. A
new card shows each time the priority's read status changes, and its summary
says where the read stands and what to do. It links here with
`?reportBack=<outreachId>`. `page.tsx` reads the param and the workspace sends `reportBackMessage(id)` (contracts,
`REPORT_BACK_MARKER`) as one hidden turn: the opener on a fresh thread instead
of the kickoff, otherwise queued behind any turn in flight, never twice for a
send already in the transcript, and the param is dropped from the address
with `window.history.replaceState`, never `router.replace`: a navigation
re-renders the page under a new search-param key and remounted the workspace
while the open was still settling, which reopened a report back on the error
screen.

The agent (`REPORT_BACK_BLOCK` in `priorityFlow.prompt.ts`) reads the send
with `read_report_back`, walks the official through who it went to, how many
answered and the top themes, asks what they will do next (it never writes a
next step they did not give), drafts the text with themes and counts and no
quote or identifying detail, gets their review, and presents it with
`reportBackForOutreachId`. The handler refuses that card unless its audience
line and count are the ones the read gave, and with anything else about who
gets it. The card's list is everyone the send reached minus opt-outs since
(see `outreach/AGENTS.md`). `<report_backs>` tells the agent, every turn,
which sends are reported back on already, and the Chief of Staff reads the
same list so neither asks what the record answers.

## A good read

Behind `serve-citizen-panels`, a priority has a good read once every large
group in the district has answered on it, pooled across texts, calls and
doors, and a model of the coded answers is sure enough of each. gp-api
decides it in one place, `mrpReadStatus`
(`gp-api/src/priorities/util/mrpReadStatus.util.ts`), returning
`{ answers, needed, groupsHeard, groupsTotal, groupsNext, representativeAnswers, representativeNeeded, good, status, underrepresented, unheard }`. A major group holds
3% or more of the district on age band, tract, gender, or race when
`raceNameable` holds (10 coded answers with a known race, 70% of all); the
pooled `other` never counts.

| `status`               | Label                               | Rule                                                                                                     |
| ---------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `tooEarly`             | Waiting to hear back                | a major group has no coded answer                                                                        |
| `notYetRepresentative` | A few groups need more answers      | a major group has fewer than 3, or answers are under the district's `answersNeeded` (the floor)          |
| `gettingClose`         | Still unsure what some groups think | a major group's 90% range is wider than 20 points                                                        |
| `representative`       | Every group heard                   | none of the above; `good` is exactly this                                                                |
| `enoughAnswers`        | Enough people have answered         | the district could not be read and answers meet `answersNeeded`; `good`, but no claim about who answered |

The model is MRP (`gp-api/src/priorities/util/mrp.util.ts`,
`docs/features/civic-panel-mrp.md`): each person's coded answers to the
priority (`PriorityAnswer`; yes 1, no 0, mixed half, not an answer left out,
averaged when a person answered twice) fit by age band, gender, tract and
race, reweighted to the district's own voter-file cells. Race is L2's
modeled ethnicity folded as the panel's steering folds it; it shapes
the model either way and counts as a group only when nameable. Scales are
the model's defaults; nothing learns them from past priorities yet.
`groupsHeard` of `groupsTotal` are the major groups with at least 3 coded
answers; both are 0 when the district could not be read. `groupsNext` is
how many of the rest belong to a group named in `underrepresented` (every
short tract, once `unreachedAreas` is named); absent on older reads, read
as 0. `answers` is the
people heard (the results page's count); `needed` is the larger of the
district's floor (`answersNeeded` of its smallest major group, the target
round 1 is sized to) and `answers` plus the fewest more that could give
every major group 3 (the dimension furthest short). One answer counts in
every dimension, so the groups can all have 3 before the total reaches the
floor; the read is then `notYetRepresentative` with every group heard
(`groupsHeard` equals `groupsTotal`), and the copy says "Need a few more
answers overall" (`READ_STATUS_COPY`), even when a group still too unsure is
in `underrepresented`, since the total is what holds it back. It is a floor, not a promise, and no screen shows it: only analytics
(`answersFloor`) and sizing read it. What the seats and bar show is
`representativeAnswers` of `representativeNeeded`: the district's floor
(at least `answersNeeded` of the smallest major group), and the answers that
count toward a balanced read of it. On each dimension the major groups
share the floor by their part of the district (small groups and the pooled
`other` hold no seats), a major group's answers count up to its share, the
dimension furthest behind sets the count, and it never passes the people
heard. So a group heard from plenty fills no extra seats, every group at its
share means every major group has its three, and a good read fills every
seat. Uncoded answers
fill no seat yet. When the district cannot be read it is `answers` of
`needed`. A read served before the fields existed falls back the same way
(`representativeCount`).
`underrepresented` names, in `batchTargets` order (`civicPanelAllocation.util.ts`),
the one or two groups holding the read back: short of voices, or with a
range still too wide; every tract reads as `unreachedAreas`
(`underrepresentedGroupName` in contracts: "people in some parts of your
district", or "people in a few neighborhoods" once every neighborhood has
answered and the model is only unsure). Every name reads whole in a list,
and `joinGroupNames` joins them. `unheard` is the named groups nobody in has
answered yet (for `unreachedAreas`, any of its tracts), so the line can tell
"Still need to hear from" apart from "Need a few more answers from". When the district
cannot be read, `needed` is `answersNeeded()` from contracts (100, enough for
the smallest major group any district can have), enough answers are a good
read labeled "Enough people have answered", never "Every group heard", and
fewer are too early. A read is kept in process for 15 minutes per priority and its coded
answers (`PriorityResultsService`), so a new or recoded answer reads again
and a failure is never kept. **The official never sees a share, a range or
a model**: only the status, the groups and actions.
`PriorityResultsService.readStatuses` serves `GET /v1/priorities/:id/read-status`
(404 with the flag off), `readStatus` on the results response, the
`<priority>` context of the priority flow and the Chief of Staff's
`<priorities>`.

- **Phone** (below `lg`): a short bar outside the scroll: back, the title on
  one line, and a list button that opens "Where this stands" in the steps
  sheet. Under it, while a check is out and the read is short, the count
  ("34 of the 100 answers we need", `READ_STATUS_COPY.progress`), then a
  row of its own with a thin red bar (`bg-destructive`, whatever the
  status: the red is the signal the read isn't done) and Get answers. It
  names no groups: `READ_STATUS_COPY.statusLine` ("Still need to hear from
  men", "Need a few more answers from women and people 65 and over", "Still
  unsure what people 65 and over think") is the results page's. A good read
  is a check, "You've heard from every group" (or "Enough people have
  answered") with See what we heard beside it. Before a check is out with residents (`readStatus.checkOut`) the row
  reads "No one asked yet" with no bar and no button, and while a follow-up
  text is scheduled "Follow-up text to N people on Nov 3" stands in for the
  button (`READ_STATUS_COPY.canGetAnswers`). The text links to the results page; the button is the one action.
- **Desktop**: a 56px bar across the chat and the rail holds back and the
  title, so there is no title in the scroll with the flag on. The rail opens
  with the status label and dot, the answer seats (below), "34 of the 100
  answers we need" with a key (Heard, Still needed), and below `lg` the
  same red bar as the phone; like the phone it names no groups. Then Get
  answers, a quiet "What we heard" link, then "Where
  this stands". With a good read the rail has See what we heard and
  no second link to the same page.
- **The answer seats** (`components/AnswerSeats.tsx`) are the civic panel's
  100-seat arc (`seatSpots` from `citizens-panel/components/panelCharts.ts`,
  reused, never changed for this), people, not groups: the share of
  `representativeNeeded` that `representativeAnswers` fills, left to right,
  in primary blue, the rest in a light grey ring. The arc is never full while
  an answer is still needed, nor empty once one counts. They show from `lg`
  up only; below it the rail block and the results held card keep the bar,
  and the phone strip its thin bar, with the same numbers.
  The switch is CSS (`hidden lg:block` / `lg:hidden`), never a width check,
  so nothing jumps on load.
- **Get answers** queues one hidden `GET_ANSWERS_MESSAGE` turn (contracts,
  `GET_ANSWERS_MARKER`) behind any turn in flight, filtered from the
  transcript like the other app turns. It is a detour that returns: the agent
  proposes the outreach aimed at the groups still missing, a text, calls and
  doors together when more than a text is needed, as cards
  (`GET_ANSWERS_BLOCK` in `priorityFlow.prompt.ts`), never starts the civic
  panel, offers no text while the follow-up is scheduled or after it went
  out, and ends on one line back to the step it was on without changing any
  step. Nothing sends from the button. The results page's Get answers shows on
  the same terms and links back with `?getAnswers=1`, which `page.tsx` reads
  and the workspace turns into the same turn once, then drops from the
  address. Because it queues, the button is held only while its own turn is
  queued or streaming, never for other turns, the load or an awaited reply:
  holding it for every open turn made it look disabled while the chat looked
  idle.
- The read is re-read on every turn settle, since answers land while the
  official is on the page.
- **Before a good read the agent shares no results**: no themes, splits,
  quotes or "most said"; it names the status and the group to hear more
  from and offers outreach aimed at it, and a direct "what have people said"
  gets one or two honest sentences and "too early to act on". It never
  mentions weights, models or counts of answers. The prompt alone did not
  hold: `read_outreach_feedback` handed it the themes and replies and said
  to lead with them, so it listed what residents raised. Before a good read
  the tool returns only who each send went to and how many answered
  (`goodRead: false` from the handler), and judge case
  `themes-before-good-read` pins it.
- **Parts not reached yet**: a proposal on a priority can carry
  `areaTarget: 'unreached'`. Saving its list sends `unreachedAreaOfPriorityId`
  to `POST /v1/voters/voter-file/filter`, and gp-api draws the area and saves
  it as the list's boundary, named "Not reached yet", which the list's map
  shows and edits like a drawn one. The model never sees coordinates; the
  tool checks its count against the audience inside the area. The Chief of Staff follows the same rule from `<priorities>`
  (`PRIORITY_READ_RULES`). Reporting back to the people a text asked is not
  held back.

## What we heard (`results/`)

`/dashboard/priorities/[priorityId]/results`, titled "What we heard on" the
priority to match each send's own "What we heard" report, and reached from
the good read row and the "What we heard" link in the rail, pools every send linked to the
priority (`Outreach.priorityId`) through `GET /v1/priorities/:id/results`
(gp-api `PriorityResultsService`): who answered (with the channels that
brought answers under the count), how many of those people are now civic
panel members, a heat grid of where they live, and who you're hearing from
against the district. The response also carries reach and answers per send; the page
does not list sends, since the tiles already give those counts.

Before a good read it shows the answered tiles, then a card with the status,
the answer seats, larger and centered, with their key and "34 of the 100
answers we need." (the bar instead below `lg`), one line (`READ_STATUS_COPY.heldBack`) holding back the themes, the
map and who you're hearing from, "Still need: men and people 65 and over."
(`READ_STATUS_COPY.stillNeed`; the status line instead while the read is
getting close), and a Get answers button. It never says nobody
answered. After, it shows everything below.

- **Behind `serve-citizen-panels`.** The link renders only with the flag on,
  the page reads the flag server-side (`getFlagVariants`) and 404s when off,
  and gp-api 404s the endpoint the same way.
- **Who counts as answering:** a text with `respondedAt`, a call or a knock
  with outcome `answered`. A knock counts toward the walk whose envelope it
  was logged under (`ContactInteractionDoorKnock.outreachId`), never by the
  turf's stops, since a person can sit in two turfs.
- **The map never pins a house.** Coordinates arrive rounded to about 100 m
  with no ids, and `respondentGrid.ts` bins them into fixed ~400 m squares on
  the contact map's tile style, so no new map dependency.
- **Who you're hearing from is the read's own groups**, drawn as petals
  (`CivicPanelBloom`, from the civic panel's components, reused with `showNext` off and a
  `summary` that speaks of answers). `groups` on the response is each major
  group the read counts by age band, gender, and race when it may be named
  (no neighborhoods, no housing): its share of the district and of the coded
  answers on that dimension (gp-api `answerGroups`). It is empty when the
  district could not be read, and the page says the figures are not
  available. The results carry no places, so there are no seats.
- **Themes are pooled across every send.** "Top themes" reads the
  priority's latest completed `priority`-scope synthesis run (gp-api
  `FeedbackSynthesisService.requestPriorityRun`): text replies, door notes
  and call notes grouped together. Any send on the priority finishing (a
  results upload, a turf's Done, a list's last call) starts a new run that
  replaces the last, so a door walk after a text feeds the same themes.
  `people` counts distinct people. `summarizing` is a run in flight, or
  enough answers for themes (5) with no run completed or failed yet, since a
  send's run starts only after it commits. With themes up it adds "Updating
  with the latest answers."; with none it says "We're reading what people
  said. Themes show up here soon." instead of asking for more answers. Each send's own report keeps its
  own themes and tags; a pooled run tags nothing.
- **Themes are ranked.** gp-api sorts them by `people`, most first, the
  run's own `rank` breaking ties (the run ranks by notes, before
  unconfirmed ones are dropped), and the page numbers them in that order
  with a round "#1" badge (`aria-label` "Rank 1"), the poll synthesis
  card's look on the `info-background` token.
- **Signal.** Each theme's `voices` is `strong` when every group in
  `groups` (the same "who you're hearing from" groups, so no
  neighborhoods) has at least `THEME_VOICES_PER_GROUP` (3) of the theme's
  people, `fair` when at least half do, `thin` when fewer. gp-api counts it
  from the theme's members in the read's cells (`themeVoices` in
  `mrpReadStatus.util.ts`). Absent when the district could not be read,
  and the page then shows no label. The page shows it as a `Badge` on the
  status tokens: Strong signal (`success`), Some signal (`warning`), Low
  signal (`error`), each `-background` tint with `-dark` text for AA
  contrast. The info button beside it opens a `Tooltip` with `openOnClick`,
  so a tap works on a phone, saying that level in one sentence with the
  place (`RESULTS_COPY.signalMeaning`, `useServePlace`, else "your
  district"). It is the only representativeness
  measure on a theme; nothing shows a share or a range.

## A check asks a sample, not everyone

A check is a directional read, so the agent proposes a random sample of each
side's audience rather than the whole of it. Texting 58,520 people, about
$2,050, for a read that needs 83 replies is what this exists to stop.
The rules live in the prompt (`buildSamplingBlock` and
`buildReadingRepliesBlock` in `priorityFlow.prompt.ts`). The sizing lines in
them are `buildSampleSizingRules`
(`gp-api/src/chats/general/chat-tools/outreachSampling.prompt.ts`), which the
Chief of Staff shares, and every number is the polls methodology, read from
`outreach/SampleSizing.const.ts` in contracts. Change a number there, never in
a prompt.

- **Text** is sized like a poll: `SAMPLE_TARGET_REPLIES` (83) over the
  office's own reply rate (`replyRate` on `read_past_outreach` rows), or
  `DEFAULT_TEXT_REPLY_RATE` (3%) without one. The agent never does this
  arithmetic: it calls `size_outreach_sample`
  (`gp-api/src/chats/general/chat-tools/sizeOutreachSample.tool.ts`), which
  returns the sample, whether it is the whole audience, and what the sample
  and the whole audience would cost. A widen passes `repliesAlready`. **Phone banking and door
  knocking** are sized by what the official can actually work, and the agent
  says what it chose. Each side gets its own sample.
- **The proposal carries it** (`OutreachProposalSchema` in contracts):
  `count` stays the whole audience; `sampleSize`, `targetResponses`,
  `assumedReplyRate` and `widensOutreachIds` are optional and append-only, so
  cards persisted before them still parse. A `sampleSize` no smaller than
  `count` means the whole audience everywhere: the card, the tool result
  (`wholeAudience`), and the server's draw.
- **The card says it**: `proposalSampleLine` reads "Text 2,767 of 58,520"
  in place of the channel and count, never "at random". The list saved from
  the proposal is drawn as `proposalListSample` (keyed on the proposal, so
  saving it twice draws the same people; see "Random samples" in
  `gp-api/src/peopleDb/AGENTS.md` and `VoterFileFilterSampleMember` in
  `gp-api/src/contacts/AGENTS.md`).
- **A thin read is not an answer.** Short of the polls high-confidence bar
  (`isHighConfidence`: more than 75 replies, or replies from 10% of that
  side's audience) the agent says the read is thin, does not record the
  side confirmed or revised, and offers to widen: a new proposal to the same
  audience with `widensOutreachIds`, whose list leaves out whoever the
  earlier samples drew. A side already sent is otherwise never offered again
  (`checkProposalRefusal`); a widen gets through only when the server finds
  every named send put out that same side of this priority's check
  (`PriorityFlowOutreachService.allPutOutCheck`). A proposal whose audience
  counted nobody is refused outright. Nothing calls a result statistically
  proven; the 3 in 100 who reply choose themselves.

## The agent previews the path before the work

The rail already shows the steps, so once the problem is defined the agent
goes through the steps ahead by those names and says what each would take:
research, staff, constituents, or a workflow it can start here (an outreach
or contact card). The official picks the work as one multi-select question
(`ROUTE_BLOCK` in `priorityFlow.prompt.ts`). Before starting a workflow the
agent names the step it serves and that it was picked, and asks first if it
was not. It previews again when a step goes back or something new changes
what is ahead. Jumping straight into a texting campaign read as the agent
deciding for them.

## What it brings in carries its source

Programs, grants, organizations, contacts, laws and figures the agent finds
outside the conversation are things the official may repeat in public, so the
prompt (`SOURCES_BLOCK` in `priorityFlow.prompt.ts`) asks for the publisher,
the link and how current it is. On a card or a clarify option that goes in
`ChatSource`, whose optional `date` the shared `SourceLine` shows beside the
chip; anywhere else it is one clause in the message. The prompt carries
today's date so the agent can call a source stale. This is guidance, not a
gate. Numbers in prose come from a tool
call or a named source, and a text sample's size from `size_outreach_sample`.

## Research goes on the ordinance finding cards

Peer cities, the current code or program, and whether the office can act are
not written up in prose. They go on the ordinance chat's own cards
(`findingWidgetTools` in `ordinances/components/stepWidgets.tsx`, registered
here unchanged): `present_comparables`, `present_current_law_summary` and
`present_authority_finding`, each with its source line. The priority handler
offers them display-only, with the ordinance schemas, because a priority has
no ordinance to save them to. People to contact go on outside contact cards,
never as a phone number in prose. The model otherwise wrote a long unsourced
"here's the picture" and ended on a phone number.

## How sure it sounds is shared with ordinances

The agent strengthened what officials told it into causal conclusions and
read the law too confidently. The confidence rules live once, in
`gp-api/src/chats/general/services/claimConfidence.ts`, and both the priority
and ordinance prompts include them: `CLAIM_STRENGTH_RULE` (what they said,
what a source shows and what is inferred stay apart; a legal question gets a
likely reading, the provision, what could change it, and the attorney) and
`LEGAL_VALUES_RULE` (no legal figure unless a source read this conversation
gave it). The priority and ordinance handlers also use Chief of
Staff's `professionalAdviceDisclaimer` backstop through `finalizeAssistantText`.
Change the wording there, not in either prompt.

## Cards are keyed, not trusted

A card is a tool call rendered inline through `shared/agent-chat/cards/ChatCardRenderer`.
`proposalKey` is **derived in `shared/agent-chat/cards/toChatCard.ts`, never
read off the model's args**: `mintProposalKey(conversationId, toolCallId)`
from `@goodparty_org/contracts`. Deterministic uuidv5, so the browser and the
server arrive at the same key and the card can resolve the outreach sent
under it, which is how a proposal reads as sent. This needs `toolCallId`,
which the SSE event and the persisted segment both carry; a proposal without
one drops rather than minting a key the server would not agree with.

Args that fail to parse drop the card and leave the turn's prose alone.
`read_past_outreach` is a data read whose args are `{ channel? }`, so it always
takes that path and shows an ordinary pill (its registry entry is
`onParseFailure: 'inline'`); `present_past_outreach` is the presenter that
actually carries a card.

Two cards are about people, and they are not interchangeable:

- `constituents` (`present_constituents`) — contact ids from the office's own
  CRM, resolved live. `present_contacts` is the name it shipped under; the
  tool name is persisted on `chat_message_segment.tool_name`, so
  `cardWidgets.tsx` registers both, forever. The card `kind` is derived client-side
  and never stored, so it can be renamed freely.
- `outside_contact` (`present_outside_contact`) — one person or office outside our data, built
  from what the agent researched. Nothing resolves, so it is a snapshot. The
  mailto carries the script as its body, so the email opens written.

## A clarify question is input, not a status write

When a step needs a specific decision, the agent asks it with
`ask_clarify_question` and the shared `ClarifyQuestionWidget`
(`shared/agent-chat/`) renders the options inline. Answering sends the label
back as an **ordinary user turn**, so it reads back as the official's own
message and the agent decides for itself whether it settles anything and calls
`update_priority_status`. The widget is deliberately not coupled to the seven
steps.

Only the question still waiting on an answer takes input. `activeClarifyId`
walks the transcript backwards and stops at the first user turn, so anything
said after a question locks it. There is no separate answer record: the next
thing the official said is the answer (`clarifyAnswerById`), so a question
answered in an earlier session reloads with that choice checked, or with a
written-in answer shown as written. The widget always adds its own "Or write your
own..." option, which is the bail-out back to free chat, so the agent never
writes one.

The widget shows its own question, so the agent never writes it as chat text
and never ends a message with an either/or in prose (a "Yes" back to "this, or
that?" answers nothing). The prompt says so, and the shared `turnBlocks`
backstops it: a question closing the text right above the widget is dropped
(see `shared/agent-chat/AGENTS.md`).

A question where more than one answer can be true sets `multiSelect`. The
options step always does: each option is a checkbox with its tradeoff as the
rationale, never a list in prose. The answer is one line of the chosen labels
("A and B"), and a reload checks that set again. The format lives in
`shared/agent-chat/AGENTS.md`.

## The chat dock is off here

`DashboardLayout` mounts the Chief of Staff bar at the bottom of every
dashboard page. This page is itself one chat, so it passes `hideChatDock` —
two composers stacked on one screen is the bug that flag exists for. Door
knocking's walk is the other case.

## Narrow screens

The rail is an `aside` from `lg` up. Below that it collapses into a sheet
opened from a button in the page header, next to the title (with the flag
on, the list button in the phone bar; see "A good read") — not a fixed
bottom affordance, which would fight the composer. A card's detail follows
the same split, and `useIsMobile` (the `lg` boundary) decides which of the two
mounts the detail, since only one may hold the portal target.
