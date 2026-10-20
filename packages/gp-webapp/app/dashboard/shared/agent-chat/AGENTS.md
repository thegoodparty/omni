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
| `chatUI.tsx` | **The display kit.** `AssistantRow`, `UserBubble`, `InlineSegments` (text + inline tool pills in stream order), `ThinkingRow`, `ChatComposer` (pill composer; pass `dictation` for the mic variant, `leadingSlot` for a history popover, `ariaLabel` for the input's name; with the attachment props the ghost paperclip opens the file picker directly and pasted http(s) URLs call `onAttachLink` — no URL form; drag-and-drop lives in `ChiefOfStaffChatBody`, not here. Offered only where `supportsAttachments(scope)` (`attachmentScopes.ts`) is true: `chief_of_staff` and `campaign_assistant`, matching gp-api's `ATTACHMENT_SCOPES`), plus `AssistantMarkdown` / `ToolPillRow` for bespoke layouts. |
| `streaming.ts` | `LiveSegment` + `segmentsToLive` (project a persisted turn into segments for rendering) + `useSmoothReveal`. |
| `chatClient.ts` | `createAgentChatClient(scope, sentrySurface)` — the scope-parameterized SSE client. Every scope conforms to the one `ChatClient` interface, and this one also implements the optional `setMessageFeedback` / `clearMessageFeedback` calls. Every message carries `pagePath` (`window.location.pathname` at send time, since a dock stays open across pages); only a scope whose gp-api handler implements `describePage` reads it. |
| `chatTypes.ts` | `ChatMessageDto`, `ChatMessageSegment`, `ChatStreamEvent`, `ChatClient` — the single source of truth for message + stream shapes across every chat. |
| `ClarifyQuestionWidget.tsx` | **The structured question.** Renders an `ask_clarify_question` tool call as option cards, plus an always-present "Or write your own..." card — the bail-out back to free chat, so no surface reimplements one. Its payload is `ChatClarifyQuestionSchema` in `@goodparty_org/contracts`, scope-agnostic on purpose: the ordinance flow and the priority flow both mount it. `SourceLine.tsx` is the cited-source chip its options use. With `multiSelect` the cards are checkboxes and one button sends the set; see "Multi-select answers" below. |
| `widgetRegistry.ts` + `turnBlocks.tsx` | **Tool calls rendered as widgets.** See "Widgets" below. |
| `cards/` | **The outreach cards** (proposal, past outreach, constituents, outside contact) and `cardWidgets.tsx`, their registry entries. Priorities and Chief of Staff both register them. Win's Campaign Manager mounts the Chief of Staff body, and its agent proposes any of the four channels (`present_outreach_proposal`) and offers lists to save (`present_list_proposal`, `ChatListProposal` in `mode` `win`). The proposal and past-outreach cards are mode-keyed (`CardMode`, `win` for the `campaign_assistant` scope): copy, links, and for past outreach the detail and results routes too; the other cards are Serve copy (`SERVE_*`). See "Cards" below. |
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

**A refused call's widget is removed.** A tool that refuses its args returns
`{ error }` (`isToolRefusal` in contracts) so the model can fix them and call
again. gp-api nulls that call's persisted args, so a reload never renders it,
and the live surfaces (PriorityWorkspace, ChiefOfStaffChatBody) drop the
widget keyed `${toolName}-${toolCallId}` on its `tool_result`, so a refused
card and its corrected one never show side by side.

**A question written right above the clarify widget is dropped.** The widget
shows its own question, so prose that also asks it puts it on screen twice.
Both `liveTurnBlocks` and `persistedTurnBlocks` strip the closing question of
the text block directly before an `ask_clarify_question` widget
(`withoutTrailingQuestion`), and the whole block if that was all it held. It
touches nothing else: a pill between the text and the widget, or any other
widget, leaves the prose alone. The prompts forbid the duplicate too; this is
the backstop for when the model slips. On the live turn the question can show
for a beat before the widget lands, since the widget appears only once the
reveal reaches its seam. A surface that renders its live clarify widget below
the turn blocks instead of as one of them (the ordinance flow) applies
`dropTrailingQuestion` to the live blocks while a clarify call is pending. A
short capitalized word or a dotted one before a period ("Dr.", "U.S.") is read
as an abbreviation, not a sentence break, so a cut never leaves a fragment.

A block whose data is not in the tool args (the Priorities status marker reads
a replay held in state) is not a registry entry. Hand it to
`persistedTurnBlocks` as `surfaceWidget` and build its live instance yourself.

**`compose_handoff` is a registry entry, so a surface that does not register it
must return null for it from `toolLabel`.** `InlineSegments` treats it like any
other tool, and a label map that falls back to the raw tool name would put
`compose_handoff` on a pill. `AiChatBody` and `AskAiChatBody` do this.

**`ChiefOfStaffChatBody` is the one surface that registers it, and it is
shared by both products** — Serve's Chief of Staff and Win's Campaign Manager
both mount this body, so its `handleComposeHandoff` routes on the payload's
own `channel` rather than on which product opened the chat. Either way the
payload is written to `sessionStorage` under `cos-handoff-<nonce>` (never the
URL, which would expose the draft text) and the nonce rides a `?handoff=`
query param. `serve_social` pushes
`/dashboard/constituent-outreach?compose=social&handoff=<nonce>`;
`win_social` (ENG-11218) pushes
`/dashboard/outreach?compose=social&source=campaign_manager&handoff=<nonce>`.
Each hub's own consumer resolves the nonce back into a prefill once, on
arrival — `ConstituentOutreachPage.tsx` for Serve,
`outreach/components/OutreachComposeDeepLink.tsx` for Win — and a payload
whose channel doesn't match that hub (or a missing/expired/malformed nonce)
is silently ignored rather than erroring.

`ordinances/components/stepWidgets.tsx` is the reference registry. Chief of
Staff's `show_list_map` is deliberately not on one: its map renders after the
turn's prose and only once per turn, and a registry entry would move it to
where the tool fired. `present_list_proposal` is off the registry for the same
reason, because once its list is created the card becomes that map.

## Cards — one row each, the detail somewhere else

A card is never the full thing in the stream. Each one renders as a row in
the clarify question's own option-card style (`optionCard.ts`, which
`ClarifyQuestionWidget` uses too, so an answer and a contact read as one
family): a title, one short line, and whatever it leads to. Why a card is
there is the agent's to say, once, in its message; no card repeats it.

- **People open a panel here.** `OutsideContactCard` is one row (name, role)
  and its panel is laid out the way the contacts page lays out a person
  (`PersonOverlay`): the name as the heading, one line under it, then one
  `InfoSection` per thing to know (why reach out, who to ask for, what to say
  with copy) and call / email / site. `ConstituentsCard` is one row per
  person, and each opens that constituent's actual record, rendered by
  `PersonRecord`, the presentational half of `PersonOverlay` extracted for
  this. The three parts of the record that read the contacts table's own
  queries (the Win status row, top issues, the activity feed) come in as
  slots, and the chat omits them, along with the map (`showMap={false}`;
  the address already says where they live); the person query uses the contacts page's
  own key (`['person', org, id]`) so the follow-up switch updates both. Both
  render through `CardDetail` (`cards/cardDetail.tsx`), which portals the
  detail into the surface's `CardDetailSheetHost`, so it stays in the card's
  React tree. Every surface mounts that one host: a sheet flying in from the
  right over the page in `PersonOverlay`'s shell, with its X, closed by the X
  or Escape, handing focus back to the chip that opened it. Nothing on the
  page is replaced. A card outside any `CardDetailProvider` falls back to its
  own sheet. The detail key is the tool call id (`cardWidgets.tsx`),
  which the live and persisted copies of one call share, so a panel opened
  mid-turn survives the turn settling. Each card registers its key with the
  provider, and the panel closes once no mounted card owns the open key (a
  conversation switch). It checks a microtask later, so the live-to-persisted
  swap of one card does not count as the card going away.
- **Outreach opens the channel's own flow, over the conversation.**
  `OutreachProposalCard` is the audience, the count, the one channel the
  agent chose, and a button ("Start the text", "Start the calls"...). No
  channel switcher, no why, no cost note. The button calls
  `ProposalFlowsProvider` (`cards/proposalFlows.tsx`), which both surfaces
  mount and which mounts the outreach page's own `SocialFlow`,
  `PhoneBankingFlow` and `SmsFlow` (Serve surfaces, SMS behind the same
  `serve-sms-outreach` flag) only while one is open, the way Bryan's priority
  prototype mounted them (`feat/serve-priorities-flow`). The route never
  changes, so closing or finishing it leaves the official in the thread where
  they were. The flow is filled in with what the card carries: the message
  (`initialScript`, as written: `SmsFlow` signs any seed itself with
  `ensureSmsIdentification`, which persisted cards from before the server
  guard need, since they still carry "Hi, this is [Your Name]..."), phone
  banking's name, and the audience. A card from before `audienceFilters` points at a saved list; a
  current one carries the filter the agent counted with. On Win and Serve,
  text and phone banking open the standard flow at the step the card's
  context calls for (`outreach/v2/landingStep.ts`): usually the message or
  script, since the provider saves the card's audience as a list at the click
  (`saveProposalList`: the proposal's sample, panel part or report back
  draw, named from `listName`), once per card key (kept in the provider and
  in localStorage under `proposal-list:<key>`, checked against the org's
  lists before reuse), and opens the flow with `preselectedListId` (and
  `audienceSettled` on `SmsFlow`); a card with no audience to save opens on
  the audience step with its message held. Every step is in the stepper
  with the purpose and the list done; Back goes to the list, picked, then
  the purpose, and Continue goes on to the date or sheets and payment. A
  text runs the same order from a card as from anywhere else, the message
  before the date (`outreach/AGENTS.md`). The civic panel invite always saves its district
  draw, never a `savedFilterId`. Win's text gate still runs before the flow
  opens, and Win text derives its Peerly phone list for the saved list as
  the flow opens.
  Door knocking is the exception: its
  create flow is drawn on its own map page and takes only a saved list, so the
  card saves the list at the click, the latest point it can, and goes there,
  carrying the card's link on the URL (`?proposalKey=&priorityId=&stepId=&side=`)
  to that page's create. Every channel carries the card's link on its create
  (`{ proposalKey, priorityId, stepId, side }`, the check fields only on a
  priority), so the send is linked to the priority, a second completion
  returns the first, and the server moves that side of the check to out once
  the send is real. The card resolves by that key, so a sent proposal reads
  as sent and links to its row on the outreach page; a text reads as sent
  only once paid for. When a flow finishes, the provider calls the surface's
  `useOnProposalSent` listeners: the chip re-resolves, and the priority
  workspace refetches its rail and sends one hidden turn that opens with
  `PROPOSAL_SENT_MARKER` and ends on the proposal key, filtered from the
  transcript like the kickoff, so the agent hears about the send once. A
  walk is finished on another page, so no listener hears it; the server has
  already put the check out, and the agent reads it in `<status>` on the next
  turn. Chief of Staff has no check to move and sends no such turn. While the
  SMS flag reads off, a text
  proposal says texting is not available instead of offering a button.
  A Serve text proposal may carry `purpose` (contracts' Serve SMS purposes;
  only Chief of Staff cards from before the panel plan carry one,
  `build_citizens_panel`, the old single invite text; the chat now builds the
  panel from the plan and proposes no invite). `SmsFlow` then opens on it as `initialPurpose`, past the
  picker, with the seeded message kept (a script otherwise opens on
  `custom`) and the JOIN line locked on, the way the outreach page's panel
  deep link opens it.
  `PastOutreachCard` is one row per send, linking to its row's drawer on the
  hub. It reads its mode from the provider like the proposal card: Win reads
  the campaign's send (`GET /v1/outreach/:id`) and links to
  `/dashboard/outreach`, Serve reads the office's (`GET /v1/outreach/serve/:id`)
  and links to `/dashboard/constituent-outreach`. No compose, edit or send UI lives in a card: the flows own it.
- **Campaign Manager's cards are Win's.** `ChiefOfStaffChatBody` hands
  `ProposalFlowsProvider` a `mode` off its `scope` (`campaign_assistant` is
  `win`; priorities and a card outside any provider are `serve`), and the
  card reads it from the provider. In Win mode the card counts voters
  (`peopleCount`), a sent card links to `/dashboard/outreach?outreachId=`
  (`outreachDetailHref`), and the button opens Win's `SmsFlow` (its default
  surface, the campaign's texting registration as `tcrCompliance`) rather
  than the Serve one, with no `serve-sms-outreach` flag. Before it opens,
  the provider runs the text gate: a free campaign (the Campaign Manager
  shows it the card too) gets the Pro pitch (`ProPitchDialog`, source
  `campaign_manager`, channel `sms`) in place of the flow, and a Pro one
  passes only with an approved registration (`useTextOutreachGate`'s
  compliance modal). Phone banking and door knocking take a free campaign
  to their own pitch (`phone-bank`, `door`); social is free and opens for
  anyone. Once gp-api reports the campaign's SMS compliance window closed
  (`useSmsCompliance`), `textAvailable` is false on Win and an unsent text
  card renders nothing. Outreach Pro gating is fully rolled out, so the card
  does not read the `outreach-pro-gating-v2` flag. A text's button waits
  until the campaign and registration have loaded; the other channels wait
  for the campaign alone (`winResolved`). The card's
  `proposalKey` rides Win's `POST /v1/outreach` create, and
  `GET /v1/outreach/by-proposal-key/:proposalKey` resolves it once paid.
  The key rides a fresh draft only, never a resume: a draft built in build
  mode and resumed later does not carry it, so that card never reads as
  sent. A create refused while carrying the key (a 409: already sent) has
  the provider re-read the card, and a card that resolves as sent closes
  the flow. The other channels open Win's own flows with no `surface`:
  `PhoneBankingFlow` and `SocialFlow` over the chat, and door knocking on
  its map page (`?create=1&listId=&proposalKey=`), the way Serve's does.
  Each Win create takes the key alone (`proposalKey` on
  `POST /v1/phone-banking/lists`, `POST /v1/outreach/social` and
  `POST /v1/door-knocking/turfs`), since a Campaign Manager card puts out no
  priority check, so the card reads as sent once the list, post or walk
  exists.

Chief of Staff renders inside a vaul drawer, and React bubbles a portal's
pointer events up the React tree into it, which is why the detail sheet
carries `data-vaul-no-drag`.

## Multi-select answers

`multiSelect` on the question (default false, so older threads parse as single
choice) is for questions where more than one answer can be true: options to
pursue together, symptoms of one problem. Single choice still answers on the
first click and renders exactly as before.

The answer is still one ordinary user turn, so no surface needed a change. The
widget sends the checked labels in option order, not click order, as one line:
`A`, `A and B`, `A, B, and C` (`formatClarifyChoices`). On reload
`parseClarifyChoices` maps that line back to the set by matching whole labels in
option order, so a label holding a comma or an "and" still parses. Anything
that is not exactly such a line is a written-in answer. The ordinance flow
hides the answer's user turn, so the widget echoes a written-in answer under
its options there. The registry entry (`clarifyWidget.tsx`, Priorities and
Chief of Staff) passes `showWrittenAnswer={false}`, because those surfaces
already show the answer as the user's own message and an echo put it on
screen twice. The ordinance flow's stored `clarifyAnswers[].answer` holds the
same line.

## Next steps — an intro ends on cards, not prose

An assistant's intro ends on a question, answered by tappable cards
(`ChiefOfStaffChatBody`'s `suggestions`, a `ChatSuggestion` each). Both
products use this one mechanism: the Campaign Manager's starter cards
(`CampaignManagerChatProvider`) and the Chief of Staff's next steps
(`buildChiefOfStaffNextSteps` in `chief-of-staff/components/chat/chatConstants.ts`,
passed by the Serve home's `DashboardContent` under the meet card's intro and
on a new chat). A card does one of three things: `message` sends a question
as the user's own turn, `kickoff` sends a hidden turn (a sentinel or app
message, as Build your civic panel sends `BUILD_CITIZENS_PANEL_MESSAGE`), and
`onSelect` runs anything else (open a flow or a page). A card label with a `description` renders as a card, without
one as a pill. Tapping a card never completes a get-started card; only that
card's own button does.

`showSuggestionsAfterKickoff` moves the cards from the empty transcript to
under the reply to `pendingKickoff`, until anything else is sent. The Serve
home uses it for What's a civic panel?: with no panel yet the answer ends on
Build my panel, and with members on Grow your civic panel, each sending the
same hidden build turn, which the Chief of Staff answers with the plan's next
step card.

## The civic panel in the Chief of Staff chat

The chat builds the panel on the panel page's plan (gp-api's contacts
AGENTS.md, "Building the panel starts on the Chief of Staff home"). Two
no-arg tools are widgets in `chief-of-staff/components/chat/civicPanelWidgets.tsx`,
registered on `ChiefOfStaffChatBody`'s registry:

- **`ask_panel_weekly_time`** renders `ClarifyQuestionWidget` with the panel
  page's own question and answers (`citizensPanelCopy`: "How much time can
  you give each week?", 1, 2, 3, or 4 or more hours a week, plus the usual
  write-your-own). `isQuestionTool` (`clarifyWidget.tsx`) counts it as a
  clarify question, so only the open one takes input, an answered one
  reloads checked, and prose asking it right above is dropped.
- **`present_panel_next_step`** renders `CivicPanelNextStepCard`, which reads
  the plan itself (`civicPanelPlanQueryOptions`, `GET …/civic-panel/plan`) and
  holds no state of its own: the Next line, members of the goal, the panel
  page's status and who to invite next (`CivicPanelBalanceStatus`), the
  panel page's button for that step (none while waiting on replies), and See
  your plan. The button opens the step's own flow through the panel page's
  `useCivicPanelStepFlow` (`contacts/citizens-panel/components/`): texts and
  calls over the chat, doors on the door knocking page, calls or walks
  underway on their caller page or walk. A refused call's null args render
  nothing.

A `save_panel_weekly_time` result drops the plan query and the home's cards,
so the card and the People first card follow the new plan at once.

## Analytics — one event per message sent

Every message a user sends to an agent is `AI Chat - Message Sent`, fired
through `trackChatMessageSent` (`chatAnalytics.ts`) with `agent` (the
`ChatScope`), `surface`, `via` (`composer`, `clarify`, `assistant_bar`),
`product`, and `priorityId` / `ordinanceId` where there is one. The Chief of
Staff body fires it on its visible send path for every host, each of which
passes `analyticsSurface`; `PriorityWorkspace` and the ordinance `DraftChat`
fire it themselves. Hidden kickoffs, markers and Get answers turns never fire
it. A new chat surface adds a `ChatSurface` value rather than a new event.

An outreach card's flow carries `launchSource` on the `Outreach -` events.
`ProposalFlowsProvider` defaults it from the surface (`campaign_manager` on
Win, `priorities` with a priority, else `chief_of_staff`); a widget context's
`launchSource` overrides it (`expand_panel`). It stays out of `ProposalLink`.

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
