# Campaign Manager conversational home (prototype)

Working note for the conversation-first Win home, behind `campaign-manager-chat-home`.
**Delete this file before the prototype merges to `main`.**

Branch: `claude/campaign-manager-ai-prototype-t4dgn6`.
Design source: Claude Design project `5718ad9e-b4e7-493e-8cbf-37711fc905c0`,
`Campaign Manager.dc.html`, plus `campaign-manager-baseline-prompt.md` in the same
project. Read with `DesignSync get_file` after `/design-login`.

## What is built

| Thing | Where |
| --- | --- |
| Flag wrapper | `app/shared/experiments/campaignManagerChatHomeFlag.ts` |
| Shared home (scope-parameterized) | `app/dashboard/chief-of-staff/components/chat/ConversationalHome.tsx` |
| Win binding | `app/dashboard/campaign-manager/CampaignManagerChatHome.tsx` |
| Hero | `app/dashboard/campaign-manager/CampaignManagerHero.tsx` |
| Task-card rail + state logic | `app/dashboard/campaign-manager/CampaignManagerTaskCards.tsx` |
| Shared task CTA resolution | `app/dashboard/campaign-manager/trackerTaskCta.ts` |
| Branch point + Serve guard | `app/dashboard/components/DashboardContent.tsx` |
| Slots added to the shared body | `ChiefOfStaffChatBody.tsx` (`leadingSlot`, `trailingSlot`) |

The flag still has to be created in Amplitude Experiment (dev + prod) via the
`amplitude-flag` skill.

### Decisions worth not relitigating

- **A new conversation per browser session**, not the manager's one resumed thread.
  The active id lives in `sessionStorage` keyed by org, so one sitting is one
  conversation; past ones are reached through the composer's history popover. This
  surface therefore never shows the server-seeded greeting (nothing is created until
  the first send) — the hero is the greeting.
- **Task cards carry no avatar or bubble.** They hang under the preceding message at
  the assistant indent. A second avatar reads as a second turn.
- **Chips and task cards never share a turn.** An explicitly empty `suggestions`
  array is how the home suppresses chips; `undefined` falls back to the Chief of
  Staff defaults, so it cannot mean "none".
- **Outreach CTAs deep-link to the hub.** The hub owns one instance of each channel
  flow plus its Pro and 10DLC gates (`outreach/AGENTS.md`). The design wants the
  flow in this surface's own sheet; that needs the flows hoisted out of the hub
  first, which is its own ticket.
- **Free candidates see no Pro surface at all**, upsell included. Task cards filter
  on the catalog's `proRequired` before the top three are picked.
- **The flag branch falls back to the card home** for every state that is not a
  resolved "on". `ready` never flips true when the flag provider cannot resolve, so
  gating the other way blanks the dashboard.

## Not built yet

| Gap | Note |
| --- | --- |
| Session digest ("what changed since last time") | Plan below. The highest-value item left. |
| Pre-plan question ladder | Approved to persist in `localStorage`. Ordering and content below. |
| Response action row (copy / read aloud / thumbs) | Lives in shared `chatUI.tsx`, so it ships to Chief of Staff, ordinances and the CRM assistant at the same time. Product call. |
| Artifacts as cards opening a bottom sheet | Frontend seam exists (`useStreamingTurn`'s `onEvent`, as `OrdinanceFlowChat` uses). Cost is a tool contract per artifact type. |
| First-time tour (four tool beats + three setup questions) | Depends on artifacts. |
| 34px cream avatar, 16/16/16/4 bubbles, bouncing-dot typing indicator | All in shared `chatUI.tsx`. The design's dots resolve its own §3-vs-§9 contradiction in favour of a bounce (`gp-dot`, `translateY(-4px)`). |
| "Campaign Tracker" → "Campaign Plan" | One line in `shared/navLabels.ts`; renames the tab product-wide. |

## The session digest

Now that each session opens a new conversation, the digest is simply the
conversation's **first assistant message** — the same slot the resume-aware greeting
fills today (`campaignManager.handler.ts` → `resolveGreeting`). So this is "make the
seeded greeting a digest", not a new surface. Keep `resolveGreeting`'s best-effort
contract: any digest query that fails falls back to the plain greeting rather than
blocking conversation creation.

**The marker.** No new column for v1. `store.findLatestByScope` already returns the
candidate's previous `campaign_assistant` conversation, and its `updatedAt` is when
they last actually talked to the manager. Because creation is deferred, a visit with
no message creates nothing and does not advance the marker, which is the right
semantics for "since you last talked to me". Add a `lastDigestAt` column only if that
proxy proves wrong.

**The diff, in phases.**

1. **Tracker + plan.** Both are already in the handler's reach. New dynamic
   generation since the marker (`week` above the previous max), tasks completed since
   the marker, and `CampaignStrategy.oppositionPersistedAt` /
   `opportunitiesPersistedAt` crossing the marker ("your plan is ready"). Deterministic
   prose, no LLM turn, no contract change, no migration.
2. **Opponent + outreach.** Opponent needs a `raceOpponent` read, which the chat
   scope is missing anyway (no tool exposes that module today). Outreach needs a
   since-query; per-row detail exists on `GET /v1/outreach/:id` but there is no
   "changed since" read.
3. **Structured digest.** Move it into `@goodparty_org/contracts` so the client can
   render a change card per item instead of prose. Only worth it once phases 1 and 2
   have proven which changes candidates actually act on.

**Cost.** Phase 1 adds a few cheap queries at conversation creation and no model
call. Having the manager *voice* the digest costs one extra turn per session — decide
that separately from computing it.

## The pre-plan ladder

The state to design for is **not** `isGeneratingDynamic`. That means "static rows
exist, dynamic ones land in minutes". The candidate who actually sits with nothing is
the one who skipped the campaign story: `bootstrapTrackerIfPlanComplete` is gated on a
`campaign_story` row existing, so they have no tracker rows and nothing is generating.
They are not waiting on the plan, they are blocking it, and the copy says so.

Ordering, persisted per step in `localStorage` (matching the four existing
`campaign-manager-*` dismissal keys):

1. Why you are running, your background, the change you want. All three are the
   campaign-story gate (`isCampaignStoryComplete` checks `about.bio`,
   `campaign_story.background`, and `about.issues`), and the `campaign_story` chat
   tool already reads and writes all three. One card, one kickoff.
2. Ballot position. Existing logic, plus the filing-deadline gate.
3. Announcement: have you told anyone, friends and family or a formal announcement.
4. Press release. Content Builder has a `pressRelease` template (Contentful-defined),
   and `GET /v1/onboarding/local-news` returns up to 9 local outlets with newsroom
   email, phone and address, cached per office/city/state. Both exist; neither is
   wired to the manager.
5. First voter outreach, done manually. Follow the Relational Organizing brief
   (ClickUp `86ajqhjka`): personal sends from the candidate's own number to people
   they know, and the ask at every hop is a re-share, not a signup. Instructions only
   — the feature itself is gated on legal review, and its own brief forbids quoting
   vendor efficacy stats.
6. Budget. `computeBudget` in `app/onboarding/components/budget.ts` already produces
   the full breakdown, and the dashboard plan tab renders it as "Projected Minimum
   Resources Needed" with a hardcoded `FUNDRAISING_MIX`. **Funds raised does not
   exist anywhere** — no donations model, no `amountRaised` field. "How much have you
   raised" cannot be answered from data, only asked.

## Haystaq is already wired, and unguarded

`WIN_AGENT_VOTER_DIMENSIONS` contains **403 `hs_*` columns**, so the manager's
`query_constituent_data` tool can already aggregate Haystaq issue-alignment scores
over the candidate's district today, with no new build. That is the bootstrap for
issue priorities, and it sidesteps the fact that door-knock and phone-bank
interactions capture no issue field.

**But `campaignManagerPrompt.ts` says nothing about what those columns mean.** Per
`packages/runbooks/experiments/district_issue_snapshot/instruction.md`:

- `hs_*` values are **within-state percentile ranks** (mean ~50). A `>= 50` count is
  the share of district voters at or above the **state median** on that issue, not
  the share who support it. ~50% means "typical for this state".
- Never frame it as "X% of voters support Y". A low score is a lean away *relative to
  the state*, not evidence of the opposite stance.
- ~51 columns exist only in a 12-state December 2025 delivery and are null elsewhere;
  an all-null column returns 0% aligned from a correct query. That is no coverage,
  not opposition.
- Nulls stay in the denominator. Texas (~72% scored) and Utah (~82%) trail 90%+
  elsewhere, so their aligned shares read low for vendor reasons.
- `hs_new_home_buyer` / `hs_any_home_buyer` are ~60-baseline propensity models, not
  stance ranks; the `>= 50` read does not apply.

So the manager can be asked "what do my voters care about" right now and has no
instruction preventing it from answering "62% of your district supports X". Adding
these semantics to the system prompt is a small change and should land before the
conversational home makes issue questions easy to ask.

---

# Remaining work, in milestones

Ordered by dependency and value. M1 and M2 are what make it *look* like the
prototype; M4 is what makes it *behave* like the returning-user experience.

Design values below are read from `Campaign Manager.dc.html` (the computed
`renderVals()` styles, not the markup — the markup alone does not carry the
metrics). `--radius-md` is referenced by the design but is not defined in the
project's token files; confirm its value before implementing M1.

## M1 — Card and page metrics (frontend only, no shared files)

The cards are measurably off. Fixes are all in `CampaignManagerTaskCards.tsx`,
`CampaignManagerHero.tsx` and `ConversationalHome.tsx`.

- Wide chip: `padding: 14px 16px`, `min-height: 56px`, `border-radius:
  var(--radius-md)`, container `font-size: 15px; font-weight: 500`. Inner spans
  already match (14.5/600 label, 13/1.45 why, 12/600/.02em due in primary,
  18px primary icon, 3px column gap, `align-items: flex-start`).
- Move the gutter outside the 608px column. The design puts `padding: 28px
  <gutter> 8px` on `main` (16px top below `sm`) with a `width: 608px;
  max-width: 100%` child; we put the padding on the 608px element itself, so the
  column is narrower than 608 at mid widths.
- Hero hides once the candidate has sent anything: `showHero = !firstTimeUser &&
  !messages.some((m) => m.role === 'user')`. Ours never hides.

## M2 — Shared chat chrome (touches `shared/agent-chat/chatUI.tsx`)

**This is the biggest single reason the surface does not read like the
prototype.** Every change here also lands on Chief of Staff, ordinances and the
CRM assistant, which is why it was held for a product decision. Decide once,
then do it in one pass.

- Assistant avatar: 34px circle, `background: var(--color-cream, #fcf8f3)`, 1px
  border, 20x16 logo. Ours is 24px on `bg-background`.
- AI bubble: `background: #f7fafb` (`--color-muted`), 1px `--color-border`,
  corners `16px 16px 16px 4px`. User bubble mirrors it. Ours is uniform
  `rounded-2xl`, no border.
- Message entrance: `gp-msg-in`, 10px rise + fade. No other entrance motion.
- Typing indicator: three 7px dots, `gp-dot` 1.2s with 0/.2/.4 delays,
  `translateY(-4px)`. Ours is a text shimmer. (This resolves the spec's own
  §3-vs-§9 contradiction in favour of a bounce.)
- Quick-reply chips: `padding: 8px 14px`, `border-radius: full`, 13px/500;
  selected uses `--color-primary-light` fill with primary border and text. Ours
  are styleguide `Badge`s.
- Chip and card rails indent 44px to align under the bubble. Only correct once
  the avatar is 34px — `ASSISTANT_INDENT` in the task cards is currently 32px
  and carries a note to move with it.
- Composer wrapper: translucent wash (`color-mix(in srgb, background 70%,
  transparent)`) with `backdrop-filter: blur(12px)`; textarea auto-grows to a
  33vh cap. Ours has no wash and caps at 6 rows.
- Bubble sub-blocks in fixed order: quote → text → note → why → example
  (`noteStyle` 12.5px muted, `exampleStyle` 12.5px italic muted).

## M3 — Response action row

Copy, read aloud, thumbs up, thumbs down, always visible below the bubble and
below any artifact card. `.gp-msgact`: 30px circular targets growing to 44px
below 640px, muted by default, `--color-primary` when active, muted-surface wash
on hover. Thumbs are mutually exclusive and toggle off.

The qualifying rule is explicit in the design:
`canCopy = isAi && i > 0 && (!!m.card || !!m.fromAction || msgs[i-1].role === 'user')`.
Purely introductory or framing messages get no row.

Copy grabs the whole response: bubble text, note, why, example, plus the
artifact card's kicker, title and description. Flips to a check for 1.6s.

Also in `chatUI.tsx`, so same blast radius as M2.

## M4 — Session digest (backend)

The returning-user experience rests on this. Detail in the section above; in
short: the digest is the conversation's first assistant message, produced where
`resolveGreeting` produces the greeting today. Marker for v1 is the previous
conversation's `updatedAt` (no migration). Phase 1 diffs tracker + plan, phase 2
adds opponent + outreach, phase 3 moves it into contracts so the client renders
change cards instead of prose.

## M5 — Pre-plan ladder (approved: `localStorage`)

Ordering and data notes in the section above. Steps: the three story answers,
ballot position, announcement, press release, first outreach, budget.

- Press release and local media both exist and are unwired: the Contentful
  `pressRelease` template, and `GET /v1/onboarding/local-news` (up to 9 outlets
  with newsroom email, phone, address, cached per office/city/state).
- First outreach follows the Relational Organizing brief (ClickUp `86ajqhjka`):
  personal sends from the candidate's own number, and the ask at every hop is a
  re-share, not a signup. **Instructions only** — the feature is gated on legal
  review, and its brief forbids repeating vendor efficacy stats.
- Budget: `computeBudget` already produces the full breakdown. **Funds raised
  does not exist** anywhere in the product, so that half can only be asked, not
  shown.

## M6 — Artifacts and documents

Every deliverable summarized as a card in the transcript, opening a bottom sheet.

- Artifact card: icon in a 38px `--color-primary-light` square, uppercase 10px
  kicker at .04em, 14px/600 title, 12.5px muted description, chevron centered
  right; hover raises border to primary plus `--shadow-md`. Design pins
  `width: 380px`, not full width.
- Sheet: absolute within the content area, slides up over a 24% ink scrim
  (`rgba(15,23,32,.24)`), rounded top, 88% height below `md` / 78% above. Header
  is back arrow + kicker + ellipsized title + close; both back and close dismiss.
  Body supports paragraphs, headings, labelled sections, stat tile grids and
  tables. Optional footer action bar.
- Selecting text inside a document promotes it to a removable context chip above
  the composer.

Frontend seam exists (`useStreamingTurn`'s `onEvent`, as `OrdinanceFlowChat`
uses it). The real cost is a tool contract per artifact type in gp-api.

## M7 — Task completion inside the sheet

What the design actually wants, and the one architectural conflict. Task cards
should open a shortcut version of the relevant outreach flow in the same sheet,
prefilling everything known and saying "skipped because…" rather than silently
jumping, with completion on a confirmation screen inside the sheet.

Requires hoisting the channel flows and their Pro/10DLC gates out of
`OutreachHubPage`, which owns exactly one instance of each today
(`outreach/AGENTS.md`). Until then, cards deep-link.

## M8 — First-time tour

Four tool beats (voter data, fundraising, voter outreach, campaign plan), each
with a real inline artifact, then the three setup questions. Depends on M6.

## M9 — Agent and prompt work (gp-api)

- **Haystaq guardrail (do this first, it is small and independent).** 403 `hs_*`
  columns are already queryable and `campaignManagerPrompt.ts` says nothing
  about them. See the section above for the exact semantics that need stating.
- Pro-feature refusal: a free candidate asking about a Pro feature should be
  told it needs an upgrade. Frontend cannot do this.
- Missed-ballot tone: the "try again next cycle, we will be here" close is a
  model reply today, not card copy. Pin it in the prompt.
- Know Your Opponent read tool: the module exists, no chat tool exposes it. Also
  a prerequisite for the digest's opponent diff (M4 phase 2).

## M10 — Cross-cutting

- Create `campaign-manager-chat-home` in Amplitude (dev + prod) via the
  `amplitude-flag` skill. Nothing ships without it.
- Rename "Campaign Tracker" → "Campaign Plan" in `shared/navLabels.ts`
  (product-wide; the route is already `/dashboard/campaign-plan`).
- Tracker Pro parity: `CampaignStrategyTaskRow` paints a decorative "Pro" badge
  and never locks, so the tracker still hands free candidates the walls this
  home now filters out.
- Org-picker navigation: `setSelectedSlug` writes a cookie and invalidates
  queries without navigating, so every Win-only and Serve-only route has the
  hole this home now patches locally. Fix it once in the picker.
- Analytics: the home fires nothing of its own yet. Run the
  `instrument-analytics-event` skill for card impressions/clicks, kickoffs, and
  the ballot-outcome answer.

## Known dead ends (do not design around these)

- **Outreach-derived issue data does not exist.** No issue field on door-knock or
  phone-bank interactions, notes never aggregated, no eCanvasser survey-answer
  read, and campaign-scoped issue ranking is Serve-only. Use Haystaq (M9) as the
  bootstrap instead.
- **Funds raised does not exist.** No donations model, no `amountRaised`.
- **The client cannot request more tracker tasks.** `POST
  /v1/campaigns/tracker-tasks/generate` takes no channel and throws outside
  non-prod. Cleared-week suggestions must be CTAs, not generated tasks.
- **Tasks carry no effort estimate**, so the design's "impact and effort" line
  can only show the due date today.
