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

## Cards are keyed, not trusted

A card is a tool call rendered inline through `shared/agent-chat/cards/ChatCardRenderer`.
Two values in an outreach proposal are **derived in
`shared/agent-chat/cards/toChatCard.ts`, never read off the model's args**:

- `proposalKey` — `mintProposalKey(conversationId, toolCallId)` from
  `@goodparty_org/contracts`. Deterministic uuidv5, so the browser and the
  server arrive at the same key and the card can resolve the outreach it would
  create. This needs `toolCallId`, which the SSE event and the persisted
  segment both carry; a proposal without one drops rather than minting a key
  the server would not agree with.
- `deepLinkOnly` — `channel !== 'phoneBanking'`. Only phone banking can be
  completed from a card. Social carries no platform in the proposal contract,
  and text lands `pending_payment` behind Stripe, so a Send button there would
  leave an unpaid draft. The API's 400 is the backstop; the guard is that the
  button never renders.

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

## The chat dock is off here

`DashboardLayout` mounts the Chief of Staff bar at the bottom of every
dashboard page. This page is itself one chat, so it passes `hideChatDock` —
two composers stacked on one screen is the bug that flag exists for. Door
knocking's walk is the other case.

## Narrow screens

The rail is an `aside` from `lg` up. Below that it collapses into a sheet
opened from a button in the page header, next to the title — not a fixed
bottom affordance, which would fight the composer.
