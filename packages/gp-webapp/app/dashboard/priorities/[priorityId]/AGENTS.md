# app/dashboard/priorities/[priorityId]/

One priority, worked forward. The whole detail view is **one conversation for
the life of the priority**, with a persistent rail beside it showing the seven
steps the agent is working through. There are no per-step pages and no "next"
button: the official moves through the work by talking, and the rail is how
they see the whole path rather than only the step they are on.

## Files

| File                                | Role                                                                                      |
| ----------------------------------- | ----------------------------------------------------------------------------------------- |
| `page.tsx`                          | Server component. Loads the priority and its status, passes `hideChatDock`                |
| `components/PriorityWorkspace.tsx`  | The client orchestrator: conversation, rail, live status, cards                           |
| `components/PriorityStatusRail.tsx` | The seven steps, their states, and a step's detail view                                   |
| `components/StatusChangeMarker.tsx` | The quiet inline line a status move leaves in the conversation                            |
| `data/statusUpdates.ts`             | The `update_priority_status` merge, mirrored from the server, plus the marker copy        |
| `data/statusReplay.ts`              | Replays the transcript's status calls so a reloaded thread shows the same markers         |
| `data/chat-api.ts`                  | `createAgentChatClient('priority_flow', ...)`                                             |
| `data/toolLabels.ts`                | Which tools show a pill, and what it says                                                 |

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

The conversation is anchored, not scoped-per-step: `createConversation` gets a
`priority` anchor and the server returns the one thread for that priority. A
brand-new thread gets one hidden kickoff so the official arrives at a
conversation that has already started; it is filtered out of the transcript on
both send and reload.

## The rail moves in three passes, and the last one is the truth

1. **`tool_call update_priority_status`** — `applyStatusUpdate` runs the
   server's own merge locally and the rail moves mid-turn, while the agent is
   still talking. This is most of the feel.
2. **`tool_result`** — the tool returns the merged status it wrote, so any
   drift in the optimistic guess is corrected a beat later.
3. **`onTurnSettle`** — `fetchPriorityStatus` reads what was actually
   persisted. An interrupted turn cannot leave the rail claiming a move the
   server never stored.

The live status is held in a ref as well as state (`statusRef`), because two
status calls can land in one tick and the second has to merge onto the first.

## A step going backwards is the feature

`stale` means the agent settled a step and then learned something that put it
back in doubt. It is drawn differently from `settled` in the rail, and the
conversation marker says so out loud — `Back to your options`, `What we know
needs another look`. Hiding a backwards move makes the rail look broken, which
is worse than the move itself.

`applyStatusUpdate` returns the changes it made, so the marker copy can say
"backwards". A stored patch only says what a step became, so
`replayStatusMarkers` rebuilds the prior state by replaying every status call
in the transcript from an empty status. That is why a reloaded thread reads the
same as it did live.

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

`define`, `options`, `method` and `plan` always end with a check. The agent
picks who by the affectedness method in the prompt (`AFFECTEDNESS_BLOCK` in
`gp-api/.../priority-flow/priorityFlow.prompt.ts`, from Samuel's Serve lists
runbook), counts the group without saving it, writes the one question, and offers it as
work already done through `present_outreach_proposal` on whichever channel
those people answer on, door knocking included. Every check has two sides,
both always offered: the most affected, and the least affected (exposure
inverted, same gates), each on its own card. The official can take both, one,
or neither. The check is the ask for its stage. `listen_problem` and
`listen_options` never ask again: they are where the answers to the `define`
and `options` checks land.

A model left alone records the check and moves on without showing it, so the
server holds the order. `update_priority_status` refuses to record `asked`
until a card or a question has gone out in that turn (the priority-flow
handler tells it, since tools are built per turn), refuses to open a step past
a settled gate that has no check, and answers a gate settled without one with
`checkDue`: offer it now, before any next-step work. So `asked` means shown,
and the rail reads it as waiting on the official.

Three more holds, because the model also called the official's own agreement
"constituents agreed":

- **Recording `asked` while something was offered stamps `offeredAt` on the
  server** (`mergeStepCheck`'s `offered` argument, which only the server
  passes). Reads heal earlier rows: `parsePriorityStatus` drops an `asked`
  with no `offeredAt`, and any check on a step that is not a gate. The gate
  then counts as bare and asks again.
- **`confirmed` and `revised` need evidence.** The side has to have been `out`,
  or shown in an earlier turn (`offeredAt` before the handler's turn
  `startedAt`), and `heard` has to say what constituents said. A check patch
  on a step that is not a gate is refused, and the client merge ignores one.
- **An unanswered `asked` lets one step open past its gate, and no further.**
  After that, the agent has to ask again or record the answer.
- **A real send puts a side out, not the agent.** A proposal names the check
  it puts out (`stepId`, `side`), and the create that sends it carries them.
  Once the send is real (the phone list built, the post saved, the text paid
  for) `PriorityStatusService.recordOutreachSent` moves that side to `out`
  through the same merge, stamping `sentAt` and `sentProposalKey`; a replay
  of the same proposal records nothing new, and a side constituents already
  answered keeps its answer. The `<status>` block shows `Sent:`, the
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

## A check asks a sample, not everyone

A check is a directional read, so the agent proposes a random sample of each
side's audience rather than the whole of it. Texting 58,520 people, about
$2,050, for a read that needs about 100 replies is what this exists to stop.
The rules live in the prompt (`buildSamplingBlock` and
`buildReadingRepliesBlock` in `priorityFlow.prompt.ts`):

- **Text** is sized from `CHECK_TARGET_REPLIES` (100) over the office's own
  reply rate (`replyRate` on `read_past_outreach` rows), or
  `DEFAULT_TEXT_REPLY_RATE` (2.5%) without one. **Phone banking and door
  knocking** are sized by what the official can actually work, and the agent
  says what it chose. Each side gets its own sample.
- **The proposal carries it** (`OutreachProposalSchema` in contracts):
  `count` stays the whole audience; `sampleSize`, `targetResponses`,
  `assumedReplyRate` and `widensOutreachIds` are optional and append-only, so
  cards persisted before them still parse. A `sampleSize` no smaller than
  `count` means the whole audience everywhere: the card, the tool result
  (`wholeAudience`), and the server's draw.
- **The card says it**: `proposalSampleLine` reads "Text 4,000 of 58,520,
  picked at random" in place of the channel and count. The list saved from
  the proposal is drawn as `proposalListSample` (keyed on the proposal, so
  saving it twice draws the same people; see "Random samples" in
  `gp-api/src/peopleDb/AGENTS.md` and `VoterFileFilterSampleMember` in
  `gp-api/src/contacts/AGENTS.md`).
- **A thin read is not an answer.** Under `CHECK_MIN_REPLIES` (75, the polls
  high-confidence bar) the agent says the read is thin, does not record the
  side confirmed or revised, and offers to widen: a new proposal to the same
  audience with `widensOutreachIds`, whose list leaves out whoever the
  earlier samples drew. Nothing calls a result statistically proven; the 2 or
  3 in 100 who reply choose themselves.

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

## The chat dock is off here

`DashboardLayout` mounts the Chief of Staff bar at the bottom of every
dashboard page. This page is itself one chat, so it passes `hideChatDock` —
two composers stacked on one screen is the bug that flag exists for. Door
knocking's walk is the other case.

## Narrow screens

The rail is an `aside` from `lg` up. Below that it collapses into a sheet
opened from a button in the page header, next to the title — not a fixed
bottom affordance, which would fight the composer. A card's detail follows
the same split, and `useIsMobile` (the `lg` boundary) decides which of the two
mounts the detail, since only one may hold the portal target.
