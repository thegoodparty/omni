# Slice 5 — Frontend (dashboard + chat surface)

Parallel against contracts; integrates against real endpoints last.

> Route + tab placement are decided (below). Can build against contracts + mocks now.

## Goal

The Chief of Staff dashboard page and a reusable chat surface, in gp-webapp, styled
to the gp-webapp styleguide (NOT the Lovable prototype's look — the prototype is a
layout reference only).

## Package

`packages/gp-webapp`.

## Navigation & route (decided)

The dashboard lives inside the existing `DashboardLayout` sidebar shell
(`app/dashboard/`, auth-gated). Serve menu items are defined in
`app/dashboard/shared/DashboardMenu.tsx` and shown when the `serve-access` flag is on
**and** the user `isElectedOffice` — the same gating as the existing "Briefing
Assistant" item (→ `/dashboard/briefings`).

- **Route**: new feature dir `app/dashboard/chief-of-staff/` with `page.tsx`
  rendering the dashboard content, inside `DashboardLayout`.
- **Tab**: add a "Chief of Staff" item to the Serve menu group in
  `DashboardMenu.tsx`, placed **first** (it's the primary Serve tab / home), above
  "Briefing Assistant". Gate it with the same `serveAccessEnabled && isElectedOffice`
  predicate.
- **Serve home**: treat Chief of Staff as the Serve landing — default serve users to
  `/dashboard/chief-of-staff`. (The existing `app/dashboard/page.tsx` is the
  Win/candidate home; leave it as-is.)
- **Archive**: a sub-route `app/dashboard/chief-of-staff/archive/page.tsx`
  (deep-linkable; matches the back-arrow UX), reading
  `GET /v1/dashboard/cards?bucket=...`. (A client-side view toggle would also work; a
  sub-route is cleaner.)

Prototype captured via `ui-clone` (`/tmp/ui_clone_6*.png`,
`/tmp/ui_clone_results2.json`). No styleguide gaps.

## Layout (from the prototype, mapped to styleguide)

Two views: the **dashboard** and the **Archive** (a sub-view).

### Dashboard

- **Support hero**: label "Likely supporters" + a `(?)` `Tooltip`, the number
  `likelySupport / districtSize constituents`, and a `Progress` bar. Data from
  `GET /v1/dashboard/support-estimate` (slice 4). (The current prototype no longer
  shows the trend/percent line — keep the hero to label + number + bar + tooltip.)
- **Onboarding cards** (top of list, each with **Skip**):
  - "Meet your virtual chief of staff" → "Meet my Chief of Staff" (opens the chat
    intro/tour).
  - "Tell us more about the most important issues you're facing" → "Personalize my
    Chief of Staff" (opens the chat to gather priorities). Show when the office has
    no priorities (ties to slice 1 / slice 3 onboarding).
- **Task-card list** (`Card`, `Badge`, `Button`): category eyebrow, title,
  date/summary, primary CTA (`ctaLabel` → `ctaHref`), and **"Skip"** →
  `PUT /v1/dashboard/cards/:id/dismiss`. Data from
  `GET /v1/dashboard/cards?bucket=active` (slice 2). A **"See more (N)"** expander
  reveals the rest. Empty/awaiting states handled.
- **"Archive"** link in the list header (top-right) → the Archive view.
- **Persistent footer chat bar + history clock**, opening the chat surface.

### Archive

- Header "Archived" with a back arrow to the dashboard.
- **Filter pills** (`filter-pill`, or `tabs`/`toggle-group`): **This week** (default)
  / **Skipped** / **Missed**, each →
  `GET /v1/dashboard/cards?bucket=this_week|skipped|missed` (slice 2).
- Same card component as the dashboard list (CTAs still present, e.g. "Review bill",
  "View recap"). Per-bucket empty states.

Existing styleguide covers everything (`Card`, `Badge`, `Button`, `Progress`,
`Tooltip`, `filter-pill`/`tabs`/`toggle-group`, `Drawer`/`Sheet`) — **no new
styleguide components needed**. If that changes, gate via styleguide-gap approval.

## Detailed component spec (per-component)

The prototype is built on the same shadcn semantic-token system as the gp-webapp
styleguide (`bg-card`, `text-muted-foreground`, `bg-primary`, `border-border`,
`bg-muted`, `bg-sidebar`, `text-foreground`), so classes translate directly — use
the styleguide components for interactive bits and the semantic tokens for layout.
`primary` resolves to the brand color via the theme; do not hard-code blue. Class
strings below are taken from the captured prototype.

### Page shell + content container

- Page: `flex min-h-screen flex-col bg-muted pb-20 lg:pb-12`. Render inside the
  existing Serve dashboard layout (sidebar + this content column).
- Content container (both views): `mx-auto flex w-full max-w-[608px] flex-col gap-6 p-4 pb-40 lg:p-6 lg:pb-40`. Note `max-w-[608px]` and the large bottom padding (`pb-40`) to clear the fixed chat bar.

### Footer chat bar (fixed, both views)

- Wrapper: `fixed inset-x-0 bottom-0 z-30 border-t border-border bg-sidebar/95 backdrop-blur supports-[backdrop-filter]:bg-sidebar/80`, offset by the sidebar on desktop. The prototype hard-codes `lg:left-[256px]`; instead offset by the **actual** Serve sidebar width from the existing dashboard layout.
- Inner: `mx-auto flex w-full max-w-[608px] items-center px-4 py-4 lg:px-6`.
- Pill: `relative flex h-12 w-full items-center gap-1 rounded-full border border-border bg-card pl-1.5 pr-1.5` containing, left→right: a **history** icon-button (`IconButton`, `lucide-clock`, `h-9 w-9 rounded-full`) opening the chat history; a truncated placeholder `flex-1 truncate text-left text-[15px] font-medium text-muted-foreground` ("Hi, {firstName}, how can I help?"); a **mic** icon-button (`lucide-mic`); and a **send** icon-button (`lucide-sparkles`, `h-9 w-9 rounded-full`, `bg-primary text-primary-foreground`). Tapping the pill opens the chat surface.

### Support hero (dashboard)

- Card: `rounded-2xl border border-border bg-card p-4 lg:p-6`. Use styleguide `Card` (override radius to `rounded-2xl` if needed).
- Header row: `flex items-center justify-between gap-2` → label `text-xs font-bold uppercase tracking-wide text-muted-foreground` ("Likely supporters") + a help `Tooltip` trigger (`lucide-circle-help`, `inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:text-foreground`) explaining the estimate.
- Number row: `mt-1 flex items-baseline gap-2` → `text-3xl font-bold text-foreground tabular-nums` (`likelySupport`) + `text-lg font-medium text-muted-foreground tabular-nums` ("/ {districtSize} constituents").
- Progress: styleguide `Progress` (prototype: `relative mt-4 h-2 w-full overflow-hidden rounded-full bg-muted` with inner `h-full rounded-full bg-primary`), value = `likelySupport / districtSize`.

### Task list section header (dashboard)

- `flex items-center justify-between gap-2` → title `text-base font-semibold text-foreground` ("Your prioritized tasks this week") + **Archive** link `inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground underline-offset-4 hover:underline self-center` with `lucide-archive` and a `hidden sm:inline` label (icon-only on mobile).

### Card (shared by dashboard list, onboarding, and Archive)

- Base: `bg-card text-card-foreground shadow-sm flex flex-col gap-3 rounded-2xl border border-border p-4 lg:p-6 transition-colors`. Use styleguide `Card`.
- **Highlighted variant** (the active onboarding card) adds `border-primary ring-2 ring-primary/40`.
- Top row `flex items-start justify-between gap-2`:
  - Eyebrow `inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground` + a category `lucide` icon (briefing→`calendar`, comms→`message-square`, legislation→`gavel`, CoS→`sparkles`). Map `DashboardCardType`/category to icon + label.
  - **People-count chip** (`users-round` + number, `text-xs ... tabular-nums cursor-help`) — **omit in v1** (no per-item constituent count; see design doc non-goals). Render only if/when that data exists.
- Title `text-lg font-semibold text-card-foreground`.
- Meta (date/location) `flex flex-col gap-0.5 text-sm text-muted-foreground`.
- Summary `text-sm text-muted-foreground line-clamp-2`.
- Actions `flex flex-col gap-3 pt-2`: a full-width primary `Button` (`ctaLabel` → navigate `ctaHref`) and a **Skip** link `text-sm font-medium text-muted-foreground underline-offset-4 hover:underline self-center` (→ `PUT /v1/dashboard/cards/:id/dismiss`). Onboarding cards use the same actions shape ("Meet my Chief of Staff" / "Personalize my Chief of Staff" + Skip).
- A **"See more (N)"** trailing control reveals collapsed cards (local state; `Collapsible` or a simple `useState`).

### Archive view

- Sticky sub-header: `sticky top-0 z-20 border-b border-border bg-sidebar` → inner `mx-auto flex w-full max-w-[608px] items-center justify-between gap-4 px-4 py-4 lg:px-6`, left group `flex min-w-0 items-center gap-2` with a back `IconButton` (`lucide-arrow-left`) → dashboard, and title `text-base font-semibold text-foreground` ("Archive").
- Filter pills row: `flex flex-wrap gap-2`. Each pill `rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors`; **active** = `border-primary bg-primary/10 text-foreground`, **inactive** = `border-border bg-background text-foreground hover:border-primary/50`. Three: This week (default) / Skipped / Missed. Use styleguide `filter-pill` if it matches this toggle shape; otherwise native buttons with these classes. Selecting a pill swaps `GET /v1/dashboard/cards?bucket=this_week|skipped|missed`.
- Below: the same card list, per bucket, with per-bucket empty states.

## Color & tokens

No brand-token table needed — the prototype uses the shadcn semantic tokens the
styleguide theme already defines, and they carry over verbatim:
`bg-card` / `text-card-foreground`, `text-muted-foreground`, `border-border`,
`bg-muted`, `bg-sidebar`, `text-foreground`, and `bg-primary` / `ring-primary`
(the brand color via the theme; never a literal blue). Radii: cards `rounded-2xl`,
pills/buttons/icon-buttons `rounded-full`.

## Responsive behavior

```
Page: single column at all widths, content centered at max-w-[608px].
  mobile  → p-4; sidebar collapses to the app's hamburger (existing layout)
  desktop → lg:p-6; fixed sidebar; chat bar offset by sidebar width

Footer chat bar: fixed bottom at all widths; offset left by sidebar on lg+ only.
  Content keeps pb-40 so the last card clears the bar.

Archive link label: icon-only on mobile (`hidden sm:inline` on the text), icon+text ≥ sm.

Cards: full-width single column at all widths; p-4 → lg:p-6.

Filter pills: `flex flex-wrap gap-2` — wrap on narrow widths.

Sub-header (Archive): sticky top at all widths.
```

No component swaps between breakpoints — purely spacing + the icon-only Archive
label. Everything is the same component tree with responsive prefixes.

## Styleguide mapping

| Element | Use | Notes |
|---|---|---|
| Card container | `Card` from `@styleguide` | override to `rounded-2xl`; eyebrow/title/summary are plain divs |
| Primary CTA | `Button` from `@styleguide` | full-width; brand `primary` |
| Skip / Archive links | native `<button>`/`<Link>` | `text-muted-foreground underline-offset-4 hover:underline` |
| Icon buttons (clock/mic/send/back) | `IconButton` from `@styleguide` | `rounded-full`; send uses `bg-primary` |
| Progress bar | `Progress` from `@styleguide` | value = likelySupport/districtSize |
| Help tooltip | `Tooltip` from `@styleguide` | on the `(?)` trigger |
| Filter pills | `filter-pill` from `@styleguide` (else native) | active `bg-primary/10 border-primary` |
| See-more collapse | `Collapsible` from `@styleguide` or `useState` | local state |
| Icons | `lucide-react` via the styleguide `icons` export | clock, mic, sparkles, circle-help, archive, arrow-left, calendar, message-square, gavel, users-round |

## Styleguide gap report

**No gaps.** Every component above already exists in
`packages/gp-webapp/styleguide/components/ui/` (`card`, `button`, `icon-button`,
`progress`, `tooltip`, `filter-pill`, `collapsible`, `tabs`, `toggle-group`,
`drawer`, `sheet`, `icons`). Nothing to add; no approval gate before building.

## Reusable chat surface

A new component (the general chat's frontend half), separate from the briefing
`AskAiChatBody`, consuming slice 3's `/v1/chats` SSE endpoints:

- `POST /v1/chats` (find-or-create CoS conversation), `POST /:id/messages` (SSE
  stream — parse the `ChatStreamEvent` union), `GET /:id` (replay),
  `GET /v1/chats?scope=chief_of_staff` (history, the clock icon), `DELETE /:id`.
- First open plays the hard-coded intro messages.
- Tool calls render as status lines ("Searching the web", "Reading your
  priorities").
- Defer conversation creation until the first message is sent (mirror the briefing
  chat's deferred-create behavior) so opening + closing an empty chat creates
  nothing.

## Data layer

Mirror the existing briefings pattern: typed client over the contract shapes
(`app/shared/...`), `server.ts` for server fetches where applicable, TanStack Query
for client state. Send the `X-Organization-Slug` header (as briefings do) so the
backend's `@UseElectedOffice` resolves the office.

## Acceptance criteria

- Dashboard renders hero (with tooltip) + the two onboarding cards + task list
  (with "See more") + footer chat bar.
- "Skip" moves a card out of the active list; "Archive" opens the Archive view with
  This week / Skipped / Missed pills, each showing the right bucket.
- Chat streams responses, renders tool-status lines, supports history + delete.
- Styled with brand tokens, responsive (desktop/tablet/mobile).

## Tests

Component/integration tests per the gp-webapp pattern; mock the chat SSE and the
dashboard endpoints (see the briefing `chat-api.test.ts` mocks as a template).

## Standing rules

Build against `@goodparty_org/contracts` types; gp-webapp lint/format/typecheck/test
green. Brand tokens, not Lovable styling.
