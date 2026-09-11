# Chief of Staff conversational home (prototype)

Working note for the conversation-first Serve home, behind
`serve-chief-of-staff-chat-home`. **Delete this file before the prototype merges to
`main`.**

Branch: `claude/campaign-manager-ai-prototype-t4dgn6` (named before the pivot).

Design source: Claude Design project `5718ad9e-b4e7-493e-8cbf-37711fc905c0`,
`Campaign Manager.dc.html` plus `campaign-manager-baseline-prompt.md` in the
same project. Read with `DesignSync get_file` after `/design-login`. The file is
drawn for Win, but the layout, chrome and card anatomy are the spec for both.

**Read the design's computed `renderVals()` styles, not its markup.** The markup
alone carries no metrics, and guessing from it is how the first pass shipped
12px card radii against a spec of 6px.

## What is built

| Thing | Where |
| --- | --- |
| Flag wrapper | `app/shared/experiments/chiefOfStaffChatHomeFlag.ts` |
| Shared home (scope-parameterized) | `chief-of-staff/components/chat/ConversationalHome.tsx` |
| Serve binding | `chief-of-staff/components/ChiefOfStaffChatHome.tsx` |
| Hero | `chief-of-staff/components/ChiefOfStaffHero.tsx` |
| Task rail | `chief-of-staff/components/ChiefOfStaffTaskCards.tsx` |
| The design's wide chip | `chief-of-staff/components/WideChip.tsx` |
| Onboarding step 1 | `chief-of-staff/components/PriorityChoiceStep.tsx` |
| Onboarding step 2 | `chief-of-staff/components/PriorityStageStep.tsx` |
| Next-step push | `chief-of-staff/components/PriorityNextStep.tsx` |
| Branch point | `chief-of-staff/components/DashboardContent.tsx` |
| Turn chrome contract | `chat/chatChrome.tsx` (`ChatChrome`, `DEFAULT_CHAT_CHROME`) |
| Serve-only chrome | `chat/prototypeChrome.tsx` + `prototypeChrome.css` |
| Slots added to the shared body | `chat/ChiefOfStaffChatBody.tsx` (`leadingSlot`, `trailingSlot`) |

`ConversationalHome` takes its scope as a config object, so Win's Campaign
Manager can render it later with no fork. That is what made the pivot off Win
cheap; keep it that way.

## The flag

`serve-chief-of-staff-chat-home` exists in both Amplitude projects, Active.

| Env | Rollout | Flag config |
| --- | --- | --- |
| dev (`703396`) | **100%** (development) | https://app.amplitude.com/experiment/goodparty/703396/config/1434818 |
| prod (`694490`) | 0% (dark) | https://app.amplitude.com/experiment/goodparty/694490/config/1434819 |

Dev is at 100% so local development sees the surface without per-browser
cookie fiddling; **drop it back to 0% before promoting** if dev should mirror
prod. Rollout is changeable through the Amplitude MCP (`use_amp_flags`,
`action: "update"`, `percentage`), not only the UI. GoodParty does not do
partial rollouts: 0 or 100.

**Which local setup you run decides whether the flag resolves at all.**
`npm run dev-dev` (what `.claude/launch.json` uses) points at the remote dev
API, which has a real Amplitude key and honors the dev rollout above.
`npm run dev` points at a local gp-api, which runs the `.env.example`
placeholder key; `getAllVariants` short-circuits that to `{}`, so **every flag
reads off** and the `e2e-flag-overrides` cookie is the only way on. Note the
asymmetry: `isFeatureEnabled` short-circuits the same placeholder to `true`.

**Dev has only a client deployment**, and gp-api resolves flags
server-to-server, so a dev-only server deployment gap would bite any flag read
through `getFlagVariants` in a server component. This one is read from the
client provider, which is seeded by gp-api's resolution, and `serve-crm` works
the same way — but it is the reason to reach for the `e2e-flag-overrides`
cookie rather than the rollout when testing locally.

## The flow, and why it is client-driven

The home derives which step it is on from the official's priorities, not from
stored progress — the same approach `OnboardingCardsService` takes server-side.

| State | What the home shows |
| --- | --- |
| No priorities | Step 1: what are you working on (top 5 community issues + write your own) |
| A priority with `stage === null` | Step 2: where are you with it (four stages) |
| A priority with a stage | The next-step push (draft / call / knock), above the week's cards |
| Priorities read failed | The agent's own starter chips |

**The agent does not run this flow, and that is the load-bearing decision.**
Steps 1 and 2 read and write through REST endpoints that already existed, and
the agent picks the answers up on its next turn through `crud_priorities`,
which it already has. So there is no new tool, no prompt rule, and — the
expensive one avoided — no `onEvent` widget seam threaded through
`ChiefOfStaffChatBody`, which is shared with Win.

If a later step does need agent-driven widgets, `OrdinanceFlowChat` +
`ClarifyQuestionWidget` are the reference, and four of their details are worth
copying rather than reinventing: the `revealDone` gate so a widget waits for
the lead-in text, an `answeringRef` double-submit guard, saving the answer keyed
by `questionId` rather than question text, and hiding the answer's user turn by
position rather than by content match.

## Decisions worth not relitigating

- **A new conversation per browser session**, not the agent's one resumed
  thread. The active id lives in `sessionStorage` keyed by org, so one sitting
  is one conversation; past ones are reached through the composer's history
  popover. This surface therefore never shows the server-seeded greeting
  (nothing is created until the first send) — the hero is the greeting.
- **No "you're all caught up".** The card home ends there and leaves an
  official on a dead-end page. A chief of staff with a quiet week should still
  say what changed and what to move forward on.
- **The `meet` get-started card is dropped here.** Its job is to get an official
  into the chat and they are already in it, and its completion test is "has a
  chief-of-staff conversation" — which this home defers to the first send, so
  the card would never clear.
- **Cards carry no avatar or bubble.** They hang under the preceding message at
  the assistant indent; a second avatar reads as a second turn.
- **Chips and cards never share a turn.** An explicitly empty `suggestions`
  array is how the home suppresses chips — `undefined` falls back to the Chief
  of Staff defaults, so it cannot mean "none".
- **`stage`'s two null checks differ on purpose.** Strict (`=== null`) for
  asking, loose (`!= null`) for recommending. An API without the column returns
  the field absent, and that must read as unknown on both sides, or the home
  suppresses its chips for a turn that renders nothing.
- **Phone banking mounts inline; door knocking navigates.**
  `PhoneBankingFlow` is fully controlled with no outreach-provider dependency.
  Door knocking's create wizard draws over the district map, which is a route,
  so it hands off with `?create=1` like the Serve outreach hub's own tile.
- **No Pro gate anywhere on Serve.** The `ElectedOffice` row is the entitlement,
  enforced by `@UseElectedOffice()` on the API and by the door-knocking gate
  treating an `eo-` org as license-equivalent.

## The turn chrome is forked, deliberately

The design's chat chrome is Serve-only and **must not reach Win**. The pieces it
restyles live in `shared/agent-chat/chatUI.tsx`, which Win's campaign manager,
the ordinance flow and dock, the briefing Ask-AI panel and the CRM assistant all
render through, so editing them there would have redesigned four products by
accident.

So `ChiefOfStaffChatBody` takes its chrome as data (`ChatChrome`). Omitting the
prop gives `DEFAULT_CHAT_CHROME`, which is the shared look; `ConversationalHome`
passes `PROTOTYPE_CHAT_CHROME`. Every other consumer passes nothing and is
unchanged — there are tests on both halves of that, and they are the point of
the indirection rather than decoration.

This was chosen over forking the 800-line body: the streaming, deferred create,
history handoff and pinned autoscroll in there are not things to keep in two
places.

Values verified against the running app, not read off the markup:

| Spec | Design | Rendered |
| --- | --- | --- |
| Avatar | 34px, cream | 34px, `#fcf8f3` |
| Row gap | 10px | 10px |
| Assistant bubble | `#f7fafb`, 1px border, 16/16/16/4 | same |
| User bubble | mirrored asymmetry | 16/16/4/16 |
| Quick reply | pill | fully rounded, 13px, 8/14 padding |

Two things to know about that bubble colour. `--muted` is **unset at `:root`** in
this app, so Tailwind's `bg-muted` falls back to `#f8fafc` — close enough to pass
a glance, wrong against the spec. The exact value is already live as
`--semantic-surface-subtle`, so `.proto-bubble` reads it from there; `bg-muted`
stays as a fallback if that stylesheet ever fails to load. The same root cause
makes `border-border` resolve to slate-200 rather than the brand `#d1d8df`
app-wide, which is worth fixing properly but is not this branch's job.

Bubble padding and type scale are inherited from the shared bubble: those were
not in the measured set, so they are not yet the design's.

The keyframes live in `prototypeChrome.css` rather than `globals.css` or the
styleguide, so deleting the two prototype files removes the experiment whole.
Both animations are disabled under `prefers-reduced-motion`.

## Schema added

Two nullable, additive columns. Nothing needs backfilling.

- `Priority.stage` (`PriorityStage`: `exploring` / `gathering_input` /
  `shaping` / `ready_for_vote`). Null means never asked, which is what the home
  keys step 2 on. Rides the existing `PUT /v1/priorities/:id`. Persisted rather
  than local so the agent reads it back and stops asking.
- `Ordinance.sourcePriorityId` → `Priority`, `SetNull`, not unique (one
  priority can produce several ordinances over a term; archiving a priority must
  not delete a draft written under it).

Both migrations are hand-written — there is no Docker on the dev machine, so
`prisma migrate dev` could not generate them. Both were verified by replaying
every migration into a real shadow Postgres and diffing against the schema
(`prisma migrate diff --from-migrations ... --exit-code`): no difference
detected. **gp-api's own test suite has never run locally** for the same reason.

## Deploy order matters

Steps 2 and 3 stay invisible until gp-api ships the `stage` column, because
dev's API returns the field absent and the home treats that as unknown. That
degrades on purpose rather than by accident. Step 1 works today, but only for an
org with no priorities.

## Not built

| Gap | Note |
| --- | --- |
| Session digest ("what changed since last time") | The highest-value item left. Plan below. |
| Composer blur wash on scroll-under | The bar has its own ground, but the transcript still stops above it rather than scrolling under. |
| Response action row | Copy / read aloud / thumbs. Same shared file. The design's rule: an AI message qualifies if it has an artifact card, came from an action, or directly follows a user message. |
| Artifacts as cards opening a bottom sheet | Frontend seam exists (`onEvent`); the cost is a tool contract per artifact type. Artifact card is pinned at 380px, not full width. |
| Constituent list for an issue | Step 4, skipped. See dead ends. |
| Analytics | The home fires no events of its own yet. Run `instrument-analytics-event`. |

### The session digest

Now that each session opens a new conversation, the digest is the
conversation's **first assistant message** — the slot `resolveGreeting` already
fills. Keep its best-effort contract: a failed digest query falls back to the
plain greeting rather than blocking conversation creation.

Marker for v1 needs no new column: the previous conversation's `updatedAt` is
when the official last actually talked to the agent, and deferred creation means
a visit with no message does not advance it. Phase 1 diffs the dashboard cards
and priorities (both already in reach, deterministic prose, no model call);
phase 2 adds briefings and ordinances; phase 3 moves it into contracts so the
client renders a change card per item.

## Dead ends — do not design around these

- **No outreach-derived issue data.** Neither door knocking nor phone banking
  captures an issue field; notes are never aggregated; there is no eCanvasser
  survey-answer read. The Haystaq `hs_*` columns are the bootstrap instead.
- **`recommended-lists` refuses `eo-` orgs by permanent product decision**, not
  a rollout flag, and is issue-blind anyway.
- **No funds-raised field** anywhere in the product.
- **Nothing links a priority to outreach**, so there is no "already did this"
  for the call/knock CTAs. That is why the next-step push is a standing
  recommendation rather than a step that completes. The ordinance CTA is the
  exception, now that `sourcePriorityId` exists.

## Related bugs found, not fixed

- `MyPriorityIssuesSection`'s "Work on this" mints a new ordinance on every
  click. It is a list you visit deliberately rather than a standing rail, so it
  bites less, but `sourcePriorityId` now makes the same fix available.
- The Win tracker paints a decorative "Pro" badge on `proRequired` rows and
  never locks them, so it still hands free candidates walls.
- The org picker switches product client-side without navigating
  (`setSelectedSlug` writes a cookie and invalidates queries), so every Win-only
  and Serve-only route can be left mounted under the wrong org. Fixing it once
  in the picker beats patching each route.
- **403 Haystaq `hs_*` columns are already queryable by the Campaign Manager
  and `campaignManagerPrompt.ts` says nothing about their semantics.** They are
  within-state percentile ranks, so a `>= 50` count is the share of voters at or
  above the state median, not the share who support something — and the runbook
  is explicit that it must never be framed as "X% support Y". Small, independent
  of this branch, and worth doing before any surface makes issue questions easy
  to ask.
