# shared/agent-chat — the one chat kit

Every streaming AI chat in the app runs on this kit. **Build a new chat by
wrapping it — do not fork a new inline stream loop.** Four near-identical
orchestrators once diverged (each hand-rolling its own SSE loop, reveal, and
composer) because there was no shared kit and no note like this. There is now
exactly one engine and one display; keep it that way.

If you're adding or changing a chat surface, read this first, then copy the
nearest reference wrapper.

## The pieces

| File | What it is |
|------|------------|
| `useStreamingTurn.ts` | **The engine.** Drives one turn: optimistic user push, the `streamMessage` event loop, interleaved text/tool `liveSegments`, smooth reveal, the idle watchdog, the late-persistence commit poll, and abort-on-unmount. This is the only streaming loop — there is no second one. |
| `chatUI.tsx` | **The display kit.** `AssistantRow`, `UserBubble`, `InlineSegments` (text + inline tool pills in stream order), `ThinkingRow`, `ChatComposer` (pill composer; pass `dictation` for the mic variant, `leadingSlot` for a history popover, `ariaLabel` for the input's name; with the attachment props the ghost paperclip opens the file picker directly and pasted http(s) URLs call `onAttachLink` — no URL form; drag-and-drop lives in `ChiefOfStaffChatBody`, not here), plus `AssistantMarkdown` / `ToolPillRow` for bespoke layouts. |
| `streaming.ts` | `LiveSegment` + `segmentsToLive` (project a persisted turn into segments for rendering) + `useSmoothReveal`. |
| `chatClient.ts` | `createAgentChatClient(scope, sentrySurface)` — the scope-parameterized SSE client. Every scope conforms to the one `ChatClient` interface, and this one also implements the optional `setMessageFeedback` / `clearMessageFeedback` calls. |
| `chatTypes.ts` | `ChatMessageDto`, `ChatMessageSegment`, `ChatStreamEvent`, `ChatClient` — the single source of truth for message + stream shapes across every chat. |
| `ClarifyQuestionWidget.tsx` | **The structured question.** Renders an `ask_clarify_question` tool call as option cards, plus an always-present "Or write your own..." card — the bail-out back to free chat, so no surface reimplements one. Its payload is `ChatClarifyQuestionSchema` in `@goodparty_org/contracts`, scope-agnostic on purpose: the ordinance flow and the priority flow both mount it. `SourceLine.tsx` is the cited-source chip its options use. |
| `widgetRegistry.ts` + `turnBlocks.tsx` | **Tool calls rendered as widgets.** See "Widgets" below. |
| `cards/` | **The outreach cards** (proposal, past outreach, constituents, outside contact) and `cardWidgets.tsx`, their registry entries. Priorities and Chief of Staff both register them. The copy is Serve copy (`SERVE_*`); Win's Campaign Manager mounts the Chief of Staff body but its agent has none of these tools. See "Cards" below. |
| `clarifyWidget.tsx` / `composeHandoffWidget.tsx` | Registry entries for `ask_clarify_question` and `compose_handoff`. |
| `MessageActionBar.tsx` | **The per-message bar.** Copy + thumbs up/down under one assistant turn, with the optional-note bubble a rating opens. Opt-in per surface (`showMessageActions`), and it renders the thumbs only when the client implements the feedback calls. |
| `chatHelpers.ts` | `newClientMessageId`, `friendlyError`. |
| `usePinnedAutoScroll.ts` | Stick-to-bottom scroll (releases on scroll-up). Optional — a chat inside a vaul drawer may roll its own scroll instead. |

## The recipe (what a wrapper owns)

The kit provides all streaming and rendering. A wrapper owns only: a client, a
`toolLabel` map, the conversation bootstrap, any domain widgets, and callbacks.

1. **Client** — a module-level `createAgentChatClient('<scope>', '<sentry-surface>')`
   singleton (see `ordinances/data/chat-api.ts`), or an existing surface's client
   passed in. Never build streaming by hand.
2. **Engine** — `const { messages, setMessages, visibleSegments, sending, send, isStreaming } =
   useStreamingTurn(chatApi, { toolLabel, onTurnStart, onTurnSettle, onTurnSuccess, onError, onEvent })`.
   `toolLabel(name) => string | null` (null hides a tool). `onEvent` returns `true`
   to consume an event (drive a structured widget) or `false` to only side-effect.
   `onError(message, retryable)` — gate a Retry affordance on `retryable`.
   `onTurnSuccess` fires at stream-done, before the late-persistence commit poll —
   use it for a prompt post-turn handoff (e.g. a deferred create's
   cache-invalidation) that shouldn't wait out the poll. `sending` drops at
   stream-done (so the composer re-enables and a follow-up send supersedes a
   still-settling turn); use the synchronous `isStreaming()` — not `sending` — if
   a wrapper pushes its own optimistic bubble and must drop a same-tick
   double-submit without blocking that legitimate follow-up.
3. **Render** — scroll container → `messages.map`: `UserBubble` for `role==='user'`,
   else `AssistantRow` + `InlineSegments segments={segmentsToLive(m.segments ?? [], m.content)}`.
   Then the live turn: `visibleSegments.length ? <AssistantRow><InlineSegments …/></AssistantRow> : null`,
   and `sending && visibleSegments.length === 0 ? <ThinkingRow/> : null`. Then `ChatComposer`.
4. **Send** — the wrapper resolves-or-creates the conversation id, optimistically
   pushes the user message via `setMessages`, and calls `send(id, text, { hidden: true })`.
   Deferred create, error/retry, and history live in the wrapper, not the engine.
5. **Hidden turns** — a kickoff/sentinel sent with `{ hidden: true }` still persists a
   user turn server-side, and the engine reconciles against that transcript on commit.
   Filter such turns out at render time (`visibleMessages = messages.filter(…)`) — see
   `OrdinanceFlowChat`/`ChiefOfStaffChatBody`.

## Widgets — register, do not dispatch

When an agent calls a tool so a widget renders from its args (the no-op
`present_*` pattern), register it; do not add another `if (toolName === …)`
branch. Four surfaces each grew their own copy of this dispatch before the
registry existed, and they had started to drift.

1. **Register.** `createWidgetRegistry<Ctx>([defineWidgetTool({ toolName, parse, render })])`.
   `parse(args, call)` returns the data or null. Null drops the widget, so args
   that fail to parse never render broken. `call` carries `conversationId`,
   `toolCallId`, `messageId` and `segmentIndex`, which is enough to derive an id.
   `render(data, ctx, call)` gets the surface's `Ctx` (route ids, callbacks) at
   render time. An unknown tool name resolves to null, so a thread written by a
   newer build still opens. `onParseFailure: 'inline'` keeps an unparsed call as
   an ordinary pill instead of hiding it, for a tool that is only sometimes a
   widget.
2. **Live turn.** In `onEvent`, on `tool_call`: `registry.has(name)` decides
   whether to consume the event, `registry.resolve(call, args)` builds the
   instance (pass the `conversationId` from `onEvent`'s second argument when a
   widget derives an id from it), and you store `{ instance, appearAfter: textLength() }`.
   An `'inline'` entry that fails to parse is not consumed, so it gets its pill.
3. **Render.** `liveTurnBlocks(visibleSegments, widgets, revealedTextLength)`
   for the live turn and `persistedTurnBlocks({ registry, segments, content, messageId, conversationId })`
   for history, both into `<TurnBlocks blocks toolLabel context />` (plus
   `onCitationClick` if the surface has citations). The widget lands at the
   point in the text where its tool fired, with prose above and below it, and a
   reload renders the same order it streamed in.

A block whose data is not in the tool args (the Priorities status marker reads
a replay held in state) is not a registry entry. Hand it to
`persistedTurnBlocks` as `surfaceWidget` and build its live instance yourself.

**`compose_handoff` is a registry entry, so a surface that does not register it
must return null for it from `toolLabel`.** `InlineSegments` treats it like any
other tool, and a label map that falls back to the raw tool name would put
`compose_handoff` on a pill. `AiChatBody` and `AskAiChatBody` do this.

`ordinances/components/stepWidgets.tsx` is the reference registry. Chief of
Staff's `show_list_map` is deliberately not on one: its map renders after the
turn's prose and only once per turn, and a registry entry would move it to
where the tool fired.

## Cards — one compact chip each, the detail somewhere else

A card is never the full thing in the stream. Each one renders as a compact
chip from `cards/cardShell.tsx` (a mark, a title, one line, a chevron), the
way an attachment or a contact sits in a messages thread, so a turn with
three cards still reads as a conversation. Where the chip goes depends on
who owns the detail:

- **People open a panel here.** `OutsideContactCard` (who they are, why reach
  out, who to ask for, the script with copy, call/email/site) and
  `ConstituentsCard` (the people, each row linking to
  `/dashboard/contacts/<id>`, which opens the contacts page's own person
  panel) render through `CardDetail` (`cards/cardDetail.tsx`). The card
  portals its detail into whatever host the surface mounted, so the detail
  stays in the card's React tree. Hosts: `CardDetailSheetHost` (a right-side
  sheet in the contacts page's `PersonOverlay` shell; Chief of Staff uses it)
  or a surface's own (Priorities takes over its right rail). A card outside
  any `CardDetailProvider` falls back to its own sheet, so it is never
  unopenable. The detail key is the tool call id (`cardWidgets.tsx`), which
  the live and persisted copies of one call share, so a panel opened
  mid-turn survives the turn settling.
- **Outreach hands off and never sends.** `OutreachProposalCard` links into
  the channel's own flow on the Serve outreach hub with the list and message
  carried in sessionStorage (`proposalPresentation.ts`, read back by
  `constituent-outreach/proposalHandoff.ts`), or into door knocking's create
  flow with `?listId=`. It still resolves by `proposalKey`, so a proposal
  already sent under its key reads as sent and links to that send.
  `PastOutreachCard` is one chip per send, linking to its row's drawer on the
  hub. No compose, edit or send UI lives in a card: those flows own it.

Chief of Staff renders inside a vaul drawer, and React bubbles a portal's
pointer events up the React tree into it, which is why the detail sheet
carries `data-vaul-no-drag`.

## Reference wrappers — copy the closest

| Want | Copy |
|------|------|
| Plain text chat | `ordinances/components/DraftChat.tsx` (~thin) |
| Structured widgets via `onEvent` | `ordinances/components/OrdinanceFlowChat.tsx` |
| Deferred create + intro + suggestions + history popover | `shared/ai-chat/AiChatBody.tsx` |
| Kickoffs, seeded-greeting playback, sentinel filtering | `chief-of-staff/components/chat/ChiefOfStaffChatBody.tsx` |
| An entry point that collected the first message before the chat opened | `contacts/crm/assistant/CrmAssistant.tsx` (the surface's `pendingMessage`) |
| A different (non-conversationId) client behind an adapter | `briefings/components/annotations/AskAiChatBody.tsx` |

## Gotchas

- **`ChatPill` lives in `shared/ai-chat/ChatPill.tsx`**, not here — `ChatComposer`
  imports it across the folder boundary. Don't duplicate it.
- **`check:use-client` ratchet:** engine/helper modules here deliberately carry no
  `'use client'` directive — they inherit it from their client-component consumers.
  Adding a stray directive bumps the CI baseline count. Run `npm run check:use-client`
  before pushing.
- **The composer has no built-in accessible name** beyond `ariaLabel`/placeholder —
  pass `ariaLabel` when a test or a11y needs a stable label.
- **The action bar needs a persisted message id**, so it appears on committed
  turns only — never on the live `visibleSegments` turn, the typed intro, or the
  seeded-greeting playback, none of which have a server row to hang a rating on.
  Ratings key on `(user, message)` and also carry the conversation id, so a read
  of the table can reconstruct the thread that earned one. Rating routes and
  their replay field: `packages/gp-api/src/chats/CLIENT_HOOKUP.md`.
