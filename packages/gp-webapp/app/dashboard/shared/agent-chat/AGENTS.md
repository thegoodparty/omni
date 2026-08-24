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
| `chatUI.tsx` | **The display kit.** `AssistantRow`, `UserBubble`, `InlineSegments` (text + inline tool pills in stream order), `ThinkingRow`, `ChatComposer` (pill composer; pass `dictation` for the mic variant, `leadingSlot` for a history popover, `ariaLabel` for the input's name), plus `AssistantMarkdown` / `ToolPillRow` for bespoke layouts. |
| `streaming.ts` | `LiveSegment` + `segmentsToLive` (project a persisted turn into segments for rendering) + `useSmoothReveal`. |
| `chatClient.ts` | `createAgentChatClient(scope, sentrySurface)` — the scope-parameterized SSE client. Every scope conforms to the one `ChatClient` interface. |
| `chatTypes.ts` | `ChatMessageDto`, `ChatMessageSegment`, `ChatStreamEvent`, `ChatClient` — the single source of truth for message + stream shapes across every chat. |
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

## Reference wrappers — copy the closest

| Want | Copy |
|------|------|
| Plain text chat | `ordinances/components/DraftChat.tsx` (~thin) |
| Structured widgets via `onEvent` | `ordinances/components/OrdinanceFlowChat.tsx` |
| Chat inside a drawer, own scroll, no new scope | `contacts/crm/assistant/AssistantDrawer.tsx` |
| Deferred create + intro + suggestions + history popover | `shared/ai-chat/AiChatBody.tsx` |
| Kickoffs, seeded-greeting playback, sentinel filtering | `chief-of-staff/components/chat/ChiefOfStaffChatBody.tsx` |
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
