# Serve Nav Kit — new / missing components

Running list of components the port needed that the `@goodparty_org/styleguide`
does **not** currently export. Each is built locally in
`app/p/serve-nav-kit/components/` as a prototype-only approximation, composed
from styleguide primitives + tokens where possible. This list is the candidate
backlog for real styleguide contributions (each would be a separate, design-
reviewed PR).

Legend: **Gap** = nothing in styleguide covers it · **Composition** = could be a
named styleguide pattern but today is hand-composed from primitives.

| Local component | Type | Why it's not in styleguide | Built from |
| --- | --- | --- | --- |
| `AiPromptBar` | Gap | Shows in Storybook as **Patterns/AiChat**, but its source lives in `gp-webapp/app/dashboard/shared/ai-chat` (that's where the Storybook config resolves it) — `@goodparty_org/styleguide` does **not** export it, so prototypes can't import it. Rebuilt faithfully from styleguide primitives (`IconButton`, `AiIcon`, `MicIcon`) + the `ChatPill` gradient (tokens `--ai-gradient-*`, `animate-spin-gradient` live in styleguide CSS). | `IconButton` + `AiIcon` + `MicIcon` + gradient pill |
| `PathToVictoryMeter` | Gap | `Progress` is a single-value bar. The tracker needs a two-segment "so far / to win" meter with a threshold marker and labels. | `div`s + tokens |
| `StatTile` | Gap | No KPI/metric tile (big number + label). `BarList`/charts exist but not a plain stat tile. | `Card` + tokens |
| `StatRows` | Composition | Voter-universe "label → big number" list rows. | `Card` + `Separator` |
| `ChannelCard` | Composition | Icon-in-circle selectable tile with optional Pro lock. `ContentCard` is text-first, not this centered-icon tile. | `Card` + `ProBadge` + lucide icons |
| `ImageUploadField` | Gap | No image/cover/avatar upload control in styleguide (Public Profile cover + photo). | `Button` + `AspectRatio` placeholder |
| `ChannelBadge` | Composition | Single source of truth for the channel chip, reused in the table, mobile cards, and drawer. Ready DS `Badge` (variant + `shape="pill"`), **no overrides**. | `Badge` |
| `StatusIndicator` | Composition | Single source of truth for the outreach status (blue icon + label), reused in the table, mobile cards, and drawer header. | `span` + tokens + lucide icon |
| `Metric` | Composition | Icon + label + value card used in the drawer's Overview/Progress/Payment grids. Distinct from the KPI `StatTile` (big number, no icon). | `Card` + tokens |
| `SectionLabel` | Composition | Section eyebrow, reused across the drawer + screens. The DS ships no standalone eyebrow, so this mirrors `ContentCard`'s built-in eyebrow 1:1 (`text-primary text-xs font-bold uppercase`) — see the typography rule below. | `p` + tokens |

## SMS campaign flow (ported feature)

Clicking the **SMS** channel card opens `SmsCampaignFlow` — the full 5-step campaign
builder ported from the Lovable source (`SmsCampaignFlow.tsx`), rebuilt entirely on
DS components (`Drawer`, `Calendar`, `Select`, `Popover`, `Accordion`, `Textarea`,
`Button`, `Input`, `Label`, `Alert`, `Badge`):

1. **Purpose** → 2. **Who** (audience picker + a simplified filter-chip list builder)
→ 3. **When** (name + `Calendar` date + `Select` time + 48h-notice `Alert`)
→ 4. **What** (tone pills, mock draft, char/segment count, compliance intro)
→ 5. **Review & pay** (`Accordion` summary + mock payment) → success.

On pay it prepends a `scheduled` SMS row to the outreach history (openable in the
details drawer). Data/helpers live in `outreach/smsData.ts`.

**Backend-free adaptations** (the source is Supabase-backed): AI drafting
(`sms-compose`) is mocked with canned, purpose+tone copy in `generateDraft`; the
"build a new list" step is a simplified `FILTER_POOLS` chip picker with an estimated
count (not the full 3,545-line `Voters.tsx` filter subsystem); image upload and voice
dictation are omitted; payment is a read-only mock. Everything else — steps, state,
48h validation, cost math, auto-naming, compliance intro — matches the source.

## Deviations from the Lovable original (intentional — "concept on our DS")

- **Channel colors**: Lovable color-codes channels. We reproduce a colour code using
  **only styleguide auxiliary colour tokens** — `ChannelBadge` is a DS `Badge`
  (`shape="pill"`) with a soft tint `bg-{family}-light` + a single consistent
  `text-foreground` across every pill
  (`CHANNEL_TINT` in `outreach/data.ts`): email → `primary`, sms → `info`, social →
  `tertiary`, polls → `secondary`, door + phone-bank → `success`, robocall →
  `warning`. No raw hex, no base-system-only palette. **Caveat / DS gap:** `Badge`
  ships no `info` / `success` / `warning` variant (only `Alert` uses those families,
  via its own cva variants), so this tint is a prototype-local className layer, not a
  shipped variant — see the DS-change note below. The channel-card icon circles use
  the **same colour family** as each channel's badge (`CHANNEL_ICON_TINT`:
  `bg-{family}-light` + `text-{family}-dark`), so the picker card and the history pill
  read as one channel colour.
- **Outreach status**: rendered as text + a blue (`text-primary`) icon at `text-xs`
  via the shared `StatusIndicator` (not a badge) — the DS `Badge` has no status/
  success color set, and colored status badges would need a `Badge` variant
  extension. Reused verbatim in the table, mobile cards, and drawer header.
- **Path-to-Victory green "to win" segment**: rendered with neutral + `primary`
  tokens; DS has no confirmed success/positive token for the goal segment. Refine
  in the depth pass if a token exists.

### Design-system working rule (reinforced in the audit pass)

Follow the **ready** components. Do not layer new modifications on top of a DS
component (no custom colors, no `outline`+tone, no arbitrary `rounded-*`/`px`/`py`
on badges). Use the documented variants/props as-is (`variant`, `shape="pill"`,
`size`). If a ready variant doesn't cover the need, write it down here as a DS gap
instead of hand-rolling a variant.

**Typography — uppercase only for eyebrows, matched 1:1 to ContentCard.** The one
place the DS uppercases is `ContentCard`'s built-in eyebrow: `text-primary text-xs
font-bold uppercase` (it defaults `eyebrowEmphasis` to `true` → `text-primary`).
So: standalone section eyebrows use the shared `SectionLabel`, which mirrors that
exact treatment — don't invent a different uppercase style (no `tracking-wide`, no
`font-semibold` variant, no muted colour). Every non-eyebrow label/heading stays
**sentence case** (matches org style). Prefer `ContentCard`'s `eyebrow` prop for
card eyebrows.

**DS-native affordances (fixed in the deep audit — check these before hand-rolling):**
`Input` has an `icon` prop (leading icon) — don't wrap `<Search>`+`<Input pl-9>`.
`Alert` takes the icon via the `icon` prop (not as a child) or the grid collapses.
`Button` is `rounded-full` by default and `size="medium"` is `h-10` — don't re-add
those. Destructive actions use `Button variant="destructive"`, not an `outline`
button hand-tinted red. Text links use `Button variant="link"`, not `<a href="#">`.
`Badge` has a `shape="pill"` prop — don't add `rounded-full`. Toasts use the DS
`Toaster` (`sonner`) mounted once at the prototype root + `toast(...)`.

**Full-audit resolutions (senior eng + designer pass):**

- **Type weight:** headings/values use `font-semibold` (the DS idiom — `CardTitle`,
  `DrawerTitle`, `ContentCard`), never `font-bold`.
- **Heading hierarchy:** drawer title = `text-lg font-semibold` (DS `DrawerTitle`
  size); section eyebrows (`SectionLabel`) = ContentCard eyebrow style
  (`text-primary text-xs font-bold uppercase`); field/group sub-labels =
  `text-xs text-muted-foreground`. Clean title → eyebrow → sub-label steps.
- **Colour tints:** decorative circles/bands use `bg-{family}-light` tokens, not
  `bg-primary/NN` opacity (only genuinely-opacity cases like the P2V progress marker
  keep a raw token).
- **Clickable rows/cards are keyboard-operable** (`role="button"`, `tabIndex={0}`,
  Enter/Space) — the DS `Table`/`Card` are non-interactive by default, so a clickable
  one must add this itself.
- **Kept distinct on purpose (WET over premature DRY):** `StatTile` / `StatRows` /
  `Metric` are three different layouts (KPI tile, list rows, icon metric), not one
  variant component.
- **Two headings per screen is intentional:** `PageHeader` gives the nav-context
  title; a screen's content `<h2>` is the page's own subject line — not a duplicate.

## Shell notes (shared `AppShell`, rebuilt on the Product Navigation pattern)

- `AppShell` follows the DS **Patterns/ProductNavigation** shape: `OrgSwitcher`
  (heart logo + org radio group), `NavList`, and a desktop-only `UserFooter`
  dropdown. On mobile the account items live inline in the drawer.
- The mobile drawer now **closes on tab select** (`NavList.handleSelect` calls
  `useSidebar().setOpenMobile(false)` when `isMobile`).
- The persistent AI bar is per-screen (`ScreenLayout`), not part of `AppShell`, so
  the shared shell stays generic for other prototypes.

## Working rule (design system)

- **Never modify existing styleguide components.** If one is missing something the
  port needs, write the needed change down here instead. Only *build* components that
  don't exist in the DS at all (the table above) — and build them locally in the
  prototype, never in `packages/styleguide`.

## Header — uses the DS `PageHeader` (not custom)

- `ScreenLayout` renders the styleguide **`PageHeader`** (sticky, main bar + optional
  sub-bar) for **both** breakpoints — no hand-rolled header, no separate MobileHeader.
  The mobile burger is a DS **`IconButton`** (`variant="ghost"`) in the `trailing`
  slot that opens the AppShell rail; the sub-bar shows on both breakpoints and is sticky.
- Screen action strips go in the DS sub-bar: Voter Data's search → `subBarContent`,
  "Create new list" → `subBarTrailing`; Tracker/Opponent download → `subBarTrailing`.
- `AppShell` content wrapper padding was dropped (prototype infra, not a DS component)
  so `PageHeader` can sit flush; screens own their padding.

### DS change needed (write-down, not a local build)

- **Export the AiChat pattern from `@goodparty_org/styleguide`.** It's documented in
  Storybook (Patterns/AiChat) but its code sits in `gp-webapp`, so it can't be reused
  by prototypes (or any other package). Promoting `AiChatBar`/`ChatPill`/`AiChatSurface`
  into the styleguide package would make the footer a true DS component instead of a
  local rebuild. Until then, `AiPromptBar` mirrors it from DS primitives + tokens.
- `PageHeader`'s **main bar has no desktop-visible trailing/actions slot** (`trailing`
  is `lg:hidden`). Desktop actions (Tracker/Opponent download) currently fall to the
  sub-bar. A first-class desktop actions slot on the main bar would match the Lovable
  header layout. → propose as a styleguide change, do not patch the component here.
- **Add `info` / `success` / `warning` variants to the `Badge` component.** The
  colour families exist as tokens and `Alert` already exposes them as cva variants;
  `Badge` does not. The channel pills tint via a prototype-local className
  (`CHANNEL_TINT`) as a stand-in. Promoting these into `badgeVariants` (mirroring
  `alertVariants`) would let the pills use `variant="info"` etc. with no className
  layer. → styleguide PR, not a local patch.

## Scroll-focus task cards (local behavior, not a component)

- Campaign Manager task cards highlight the card crossing the viewport center as you
  scroll (`IntersectionObserver`, `-45%/-45%` root inset), replacing the previous
  single hardcoded active card. Pure behavior on top of `ContentCard` — no new component.

## Content width

- `ScreenLayout` body width is per-screen via a `width` prop:
  - `default` = **`max-w-[720px]`** — the gp-webapp dashboard content-column standard
    (prod uses 560–720px columns: race-opponent `max-w-[720px]`, community-issues
    `max-w-[640px]`). Used by the reading/dashboard screens. Cards never span full width.
  - `wide` = `max-w-7xl` — the broader hub layout for channel grids + data tables.
    Used by Voter Outreach.

## Card context menu (removed)

- The Lovable task cards + recommended-list cards show a kebab (⋮) menu. styleguide
  `ContentCard` has **no built-in context menu**; the only DS-legal way to add one is
  its `helper` slot + a `DropdownMenu`. Per design decision the kebab was **removed**
  from the port (cards render as plain `ContentCard`, no `helper`). If reinstated, wire
  a real styleguide `DropdownMenu` rather than a decorative icon.
- Caveat: `PageHeader`'s main-bar `trailing` slot holds the mobile burger, so screen
  `actions` go in the DS **sub-bar** (`subBarTrailing`) on both breakpoints. Fine for
  the box; a first-class main-bar actions slot is written up as a DS gap above.
