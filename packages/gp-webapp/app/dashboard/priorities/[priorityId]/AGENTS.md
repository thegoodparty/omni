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
| `components/turnBlocks.tsx`         | Interleaving prose, tool pills, cards and markers in stream order                         |
| `data/statusUpdates.ts`             | The `update_priority_status` merge, mirrored from the server, plus the marker copy        |
| `data/statusReplay.ts`              | Replays the transcript's status calls so a reloaded thread shows the same markers         |
| `data/cards.ts`                     | Tool call -> `ChatCard`, including the derived `proposalKey` and `deepLinkOnly`           |
| `data/chat-api.ts`                  | `createAgentChatClient('priority_flow', ...)`                                             |
| `data/toolLabels.ts`                | Which tools show a pill, and what it says                                                 |
| `cards/`                            | The card components themselves. Owned separately; reached only through `ChatCardRenderer` |

## It is the shared chat kit, not a new one

Everything streaming comes from `app/dashboard/shared/agent-chat` — read its
`AGENTS.md` first. This surface is a wrapper: a client, a `toolLabel` map, the
conversation bootstrap, and an `onEvent` handler. `useStreamingTurn` owns the
loop, the reveal, the idle watchdog and the commit poll.

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

A card is a tool call rendered inline through `cards/ChatCardRenderer`. Two
values in an outreach proposal are **derived in `data/cards.ts`, never read off
the model's args**:

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
takes that path and shows an ordinary pill; `present_past_outreach` is the
presenter that actually carries a card.

## The chat dock is off here

`DashboardLayout` mounts the Chief of Staff bar at the bottom of every
dashboard page. This page is itself one chat, so it passes `hideChatDock` —
two composers stacked on one screen is the bug that flag exists for. Door
knocking's walk is the other case.

## Narrow screens

The rail is an `aside` from `lg` up. Below that it collapses into a sheet
opened from a button in the page header, next to the title — not a fixed
bottom affordance, which would fight the composer.
