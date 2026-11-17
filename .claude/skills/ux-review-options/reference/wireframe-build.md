# Wireframe build: drawing the design system in static HTML

This file is only about drawing. What good design is lives in the design system,
and this skill keeps no copy of it:

- `docs/product-design.md`: flows, pages vs overlays, asking for input, actions
  and what happens next, reusing what exists.
- `packages/styleguide/COMPONENTS.md`: every component and the job it is for.
- `docs/product-copy.md`, `docs/product-vocabulary.md` and
  `docs/design-memory/learned.md`: words and earned rules.

When this file and those disagree, they win. Fix this file in the same PR.

## Where the system lives

`packages/styleguide` (`@goodparty_org/styleguide`, shadcn/ui based). Pick from
`COMPONENTS.md` before you draw anything, then read the source of any component you
use in `packages/styleguide/src/components/ui/<name>.tsx` for its real variants and
sizes. Tokens are in `packages/styleguide/src/design-tokens.css`.

The page is static HTML, so it can't import the React components. `scripts/build.py`
inlines `design-tokens.css` and `assets/gp-ui.css`, which gives you plain-HTML
versions of the common components. Use the classes below. When you need a component
`gp-ui.css` doesn't have (dialog, table, avatar), read its `.tsx`,
then add a small rule to the page's own `<style>` block built only from token
variables. A page-local class for a styleguide component always uses the `gp-`
prefix (`.gp-<name>`) and copies its classes from the component source, like the
blocks in `gp-ui.css`. Never hard-code a hex value that a token already covers.

## Components in `gp-ui.css`

| Class | Matches | Variants |
|---|---|---|
| `gp-btn` | `Button` | `gp-btn--secondary`, `--outline`, `--ghost`, `--link`, `--neutral`; sizes `gp-btn--sm`, default (medium), `--lg` |
| `gp-input`, `gp-textarea`, `gp-select` | `Input`, `Textarea`, `Select` | `aria-invalid="true"` for errors |
| `gp-label` | `Label` | |
| `gp-field` | label above input, with spacing | |
| `gp-intro` (`gp-intro__title`, `gp-intro__body`) | a step's title and caption (`Intro.tsx` in `app/dashboard/outreach/v2/social`) | |
| `gp-card` (`gp-card__title`, `gp-card__desc`) | `Card` | |
| `gp-badge` | `Badge` | `gp-badge--soft`, `--outline`, `--destructive` |
| `gp-choice` | selectable row with a radio or checkbox | `:has(input:checked)` shows selected |
| `gp-bar` | `Progress` | `<span style="width:40%">` inside |
| `gp-sep` | `Separator` | |
| `gp-box` | gray placeholder for an image, chart or map; put its label inside | |
| `gp-filter-groups`, `gp-filter-group`, `gp-pills`, `gp-pill` | the contacts filter pills only (`ToggleGroupItem` with `PILL_TOGGLE_ITEM_CLASSNAME`) | `aria-pressed="true"` for selected |
| `gp-filter-pill` (in `gp-pills`) | `FilterPill` in `FilterPillGroup` | `aria-pressed="true"` for selected |
| `gp-switch` (a `<button role="switch">` with a `<span>` thumb) | `Switch` | `aria-checked="true"` for on |
| `gp-tabs`, `gp-tabs__list`, `gp-tabs__trigger` | `Tabs`, `TabsList`, `TabsTrigger` | `aria-selected="true"` for the active tab |
| `gp-collapsible__trigger`, `gp-collapsible__content` | `CollapsibleTrigger`, `CollapsibleContent` | `aria-expanded`; `hidden` on closed content |
| `gp-drawer-overlay`, `gp-drawer` (`__handle`, `__head`, `__title`, `__desc`, `__close`, `__body`, `__foot`) | `Drawer` (`DrawerOverlay`, `DrawerHandle`, `DrawerHeader`, `DrawerBody`, `DrawerFooter`), from the bottom on the phone | `hidden` on both when closed; sits inside its frame |
| `gp-toggle-group`, `gp-toggle-group__item` | `ToggleGroup`, `ToggleGroupItem`, `variant="outline"` | `aria-pressed="true"` for on |
| `gp-toggle-group gp-toggle-group--pills` | `ToggleGroup` `variant="pills"` | `aria-pressed="true"` for on |
| `gp-stepper` (`__head`, `__bars`) | `Stepper` `variant="bar"`, as `OutreachFlowShell.tsx` mounts it | `is-done` on each filled segment |
| `gp-channel-card` (`__tag`, `__icon`, `__text`, `__label`, `__sub`) | `ChannelCard` | `gp-channel-card__tag--info` for an offer tag |
| `gp-alert` (`__title`, `__desc`, `__action`) | `Alert`, `AlertTitle`, `AlertDescription`, `AlertAction` | `gp-alert--info`, `--success`, `--destructive`; `--no-icon`; `data-earned="why"` or `check.py` flags it |

Buttons use the system's `rounded-full` shape. Inputs are 40px tall, 6px radius.
Cards are 12px radius with a 1px border. Don't change those.

## Wireframe feel

- **Neutral surfaces.** Page background `--brand-surface-secondary`, panels
  `--brand-surface-primary` or `--brand-surface-tertiary`, text from the
  `--brand-text-*` tokens, borders `--brand-border-primary`. Blue
  (`--goodparty-blue-500`) shows only on the main action per screen, links and
  focus rings.
- **Except the content a look-and-feel ticket is about.** When the ticket is
  about how content looks (themes, colors, a header, a template), the content
  under review shows its real colors, taken from the product's own theme
  constants (the component's theme or constants file). The product chrome
  around it stays neutral. Never put labels or theme names inside the rendered
  content.
- **No imagery.** A photo, map or chart is a `gp-box` with a plain label ("Map of
  Maplewood"). No stock art or emoji.
- **No decoration.** No gradients, drop shadows, blur or brand flourishes beyond
  what the real component has.
- **Real words.** Real headings, button labels and sample values from
  `docs/design-memory/fixtures.md`. No lorem ipsum, no `[BRACKETS]`. A message
  preview that fills a merge tag uses the sample recipient there.
- **Type.** Open Sans, loaded from Google Fonts, on the system's scale. Sentence
  case everywhere.
- **Phone first.** Every wireframe sits in a 390px phone frame with a 28px radius,
  unless the feature is desktop-only. Then it sits in a 1280px desktop frame with
  `data-desktop-reason="..."` saying why. In a flow that also runs on the
  phone, keep the phone flow and add static desktop frames under it when the
  ask is a side-by-side layout (a side panel next to a preview) or the brief's
  data shows desktop as a large share. Draw every step the desktop ask covers,
  one frame each, with `data-desktop-reason` saying which layout it shows.
  Their controls don't need to work.
- **Desktop frames.** A desktop frame sits in `<div class="frame-scroll">` at a
  fixed 1280px, so on a phone it scrolls sideways instead of clipping. 1280 is
  the narrowest width where layouts that start at 1280 (a side panel) show. It keeps
  the phone's flow chrome (the header, and the footer with its actions) and
  the same content and actions as the phone, per `docs/product-design.md`
  §10.
- **Flow steps vs dashboard screens.** A full-screen flow step has no dashboard
  top bar: it has the flow's own header, and its footer with the actions is
  pinned to the bottom of the screen. Draw it in `frame--phone frame--flow`,
  which fixes the phone at 844px tall and pins `.flow-foot` to the bottom. A
  dashboard screen keeps the `.topbar` and grows with its content.
- **The fold.** Every frame carries a `<div class="fold">` where the first screen
  ends: 660px down in a phone frame and 720px in a desktop frame.
- **Draw the real page around the feature.** The navigation, title bar and the
  rest of an existing page are copied from source like any other existing screen,
  not drawn as gray blocks. A reviewer judges the change in its real context.
- **The logo.** The heart (`packages/gp-webapp/public/images/logo/heart.svg`), never
  the wordmark as text. `assets/heart-logo.svg` is a ready copy to paste inline.

## Existing screens

`docs/product-design.md` says to reuse what exists and never invent a screen. To do
that in a wireframe:

1. **List first.** Write down every existing screen the flow touches and its source
   file. Start from the route (`packages/gp-webapp/app/dashboard/<area>` and its
   `AGENTS.md`), then the page component, its sheets and drawers, and the copy
   file (`contactsLabels.ts`, `navLabels.ts` and similar).
2. **Copy the structure and words.** Same shell (sidebar items and order from
   `DashboardMenu.tsx`), same title bar, same cards, same row layout, same sheet
   pattern, same labels word for word. Copy the visual order, not the DOM order:
   the `OutreachFlowShell.tsx` footer is `flex-row-reverse` with the main action
   first in the DOM, so it shows Back on the left. When the sibling you copy
   breaks a rulebook rule (a disabled button for missing input), this is the
   one rule for where the conflict goes:
   - In a part the design changes, follow the rule, not the sibling
     (`docs/product-design.md` §7). That is a change from today: list it in
     `#<x>-drops`.
   - Shared shell and chrome the ticket doesn't change (the flow footer, the
     header) are copied as shipped, even on a changed step, and listed under
     "Rulebook vs code (copied, no action)".
   - When the rule conflicts with the designer's direction, or the rulebook
     ties fixing the gap to this change (`docs/product-design.md` §3, "move it
     to a page"), list it under "Decisions needed" with both sources.
3. **Compare.** After building, render today's screen and the page's version side
   by side and fix what differs. After each navigation, assert the URL is still
   the route you asked for and wait for a label copied from the source before
   you screenshot. If it redirected (sign-in, onboarding, another step), discard
   the screenshot and say so on the page.
4. **Show only real fields.** Flag any field the feature adds. Before you call a
   screen "as shipped", list every conditional string and control in its source
   component (rendered under `&&` or a ternary) and say whether the fixture
   state shows it. Anything the frame drops goes in `#<x>-drops`. A summary you
   copy keeps its real rows and numbers: no invented rows or numbers.
5. **Sub-steps copy the sibling flow.** A sub-step reached from a step (a crop
   opened from an upload step) copies how the sibling flow does it. Count it
   as a segment in the progress bar only when it sits in the forward sequence
   the way the sibling's does; a sub-step that returns to the step that opened
   it adds no segment. When the sibling breaks a rulebook rule, item 2 says
   what to do and where to list it. That includes the container: when the
   sibling makes the sub-step a full step (a crop as its own step) and the
   container table in `docs/product-design.md` §3 makes it a Drawer (a short,
   focused input), a changed step follows the table.

## Spacing parity

A frame that mirrors an existing screen must measure the same as the real one.

1. **Copy the real class strings, then convert them.** Read the Tailwind classes on
   the wrapper, the label, the row and the control. Convert each class to px
   (spacing is 4px per step: `gap-2` is 8px, `gap-6` is 24px, `h-9` is 36px,
   `px-4` is 16px; `text-sm` is 14px on a 20px line, `text-xs` is 12px on a 16px
   line). Put the source file and the classes in a comment above your CSS rule.
   For an arbitrary value (`p-[3px]`), put `/* tw: p-[3px] */` in the rule so
   `check.py`'s spacing check skips it.
2. **Check every constraint on size.** A fixed height (`h-9`) beats the padding
   and line height around it. Read the base variant too (`toggleVariants`,
   `ToggleGroup`) before you decide a size.
3. **Reset like Tailwind does.** `gp-ui.css` zeroes heading, paragraph and list
   margins under `.gp`. If you write your own wrapper, do the same.
4. **Keep the product's size.** A mirrored control keeps the product's size, even
   under 44px. The 44px minimum is for controls the feature invents.
5. **Measure.** After rendering, read `getBoundingClientRect()` for the mirrored
   rows and compare them with the px you computed. `check.py` flags off-scale
   spacing and oversized pill rules, but only measuring catches an unreset heading.

## Icons

Use only inline SVGs of icons in the styleguide's approved set (`Icons` in
`COMPONENTS.md`, lucide), with `stroke="currentColor"` and a viewBox. Never an
emoji, an icon font or a hand-drawn path. Screenshot every screen and confirm no
icon is blank.

## Every option must have

- Working interactions: every button does something, no `href="#"`, no dead ends.
  Drive wireframes with `<button>` and script, not anchor links.
- Restart on the frame, returning to the first screen.
- A way back on every step. A person to reach only where the product already
  has one on that screen, copied from its source (an in-page panel, never a
  `mailto:` link). Never add one: "Invent nothing" in `docs/product-design.md`
  §7.
- Real `<button>`, `<input>` and `<label>`, a visible focus ring, and 4.5:1 text
  contrast.
- A landing state inside the frame. Never link to anything outside the page.
- A Sends line above the frame (`#a-sends`): every email, text or notification the
  flow triggers, and when. "Nothing" if it triggers none.
- An Other states appendix below the frame (`#a-appendix`, see below).
- A Built from list below the appendix (`<details class="sources" id="a-sources">`):
  one row per element and its source, per "Every design shows what it's built
  from" in `docs/product-design.md` §7. A row with no source starts "Gap:".
  Label a screen "as shipped" only when its strings and controls are
  unchanged; name any control left out of the frame in Built from, and any it
  drops in What changes from today.
- A What changes from today list next to it
  (`<details class="drops" id="a-drops">`), per "Say what a change drops" in
  `docs/product-design.md` §7: dropped behavior, removed controls, and changed
  strings with the old and new text. "None" when nothing changes. When shipped
  copy you copy fails a `docs/product-copy.md` rule, the design rewrites it and
  lists the old and new text here. When the sibling whose copy you follow
  breaks a rulebook rule, "Existing screens" item 2 says where it goes.
  `check.py` doesn't scan `#a-drops`,
  `#questions` or `<code>` for banned words, so old strings can be quoted there
  and real prop names (`<code>variant="seamless"</code>`) can be quoted in
  Built from.
- A static desktop frame is exempt from working interactions and Restart.
- Controls a copied screen brings that the change doesn't touch, and controls
  inside a changed step whose behavior the ticket doesn't touch: draw them as
  they ship, with no dimming or other special style, and add one Built from
  row, "Not part of this change", naming them. They do nothing in the
  wireframe, and the click-through and the review don't count them as dead.
  If the step's content or layout changes, what those controls produce
  (loading, filled, undo, failure) is a state of this change and goes in
  Other states.

## Other states appendix

The frame shows the happy path. Everything else goes in a collapsed
`<details class="appendix" id="a-appendix">` under the frame, so it never crowds
the main flow.

- In three-option mode, up to six states the user will really hit, each a
  small static screen with a one-line label: a bad file, processing, needs
  your input, failed, empty, undo. One design has no cap (SKILL.md, "One
  design").
- Pick them from the rules in `docs/product-design.md` (success view, leaving
  with unsaved input, long jobs, errors next to the field, undo vs confirm), not
  from imagination.
- Include the return trip when the feature does work in the background: what the
  user sees on the page they come back to (an alert, a status) and how they fix or
  undo the result.
- In the first round, two or three states per option are enough. Once a direction
  is picked, the appendix covers every state the build will need.

## Win and Serve

When the ticket names both products, draw one frame with a Win / Serve switch
(`#a-product`) above it. Keep one copy object per product in the script, the way
the product does (`importContactsCopy.ts`): the HTML holds the Serve copy and the
switch swaps in Win's words. Draw a second version of a screen only where the
products really differ, such as a count that means voters on Win, and put
`data-product="win"` on it so `check.py` doesn't read its Win words as Serve
copy. Never duplicate a whole flow.

For a Win-only ticket, mark `<main class="page" data-product="win">`, so
`check.py` reads the whole page as Win copy. For a Serve-only ticket, mark
`data-product="serve"`; the Serve vocabulary check then covers the whole page.

## Words

Words follow `docs/product-copy.md`, and Win vs Serve words
`docs/product-vocabulary.md`. `check.py` reads the banned list from "Words we
do not use" in `docs/product-copy.md` each run.

## Page rules

- One `index.html`, self-contained: inline CSS and JS, inline SVG. The Open Sans link
  is the only external request. No iframes.
- Give every block a stable, readable id (`#option-a`, `#a-step-2`, `#a-save`):
  Vercel comments record the CSS selector they pin to.
- Keep each option's state in one object, and make Restart reset it. Prefix script
  names per option (`a`, `b`, `c`) so they can't collide on the shared page.
- No recommendation anywhere: no stars, "best", "recommended", ranking or order
  that implies one beyond A, B, C.
- The brief (`#brief`) comes first, with `#brief-user`, `#brief-problem`,
  `#brief-solution`, `#brief-data`, `#brief-measure`, `#brief-entry`,
  `#reach`, `#feedback-ask` and `#questions`. One or two sentences each. "Unknown" is a
  valid answer, and each one is also a line in `#questions`. `#questions` holds two
  lists: "Decisions needed" and "Rulebook vs code (copied, no action)".

## Keeping `gp-ui.css` in sync

Each `gp-*` class copies a styleguide component. Each block in `gp-ui.css` names
the `.tsx` it copies. When a component's look, variants or sizes change, its class
here changes in the same PR (`packages/styleguide/AGENTS.md` says so). If you find
one out of date while building, fix it here rather than working around it on the
page: that means a PR to the skill's assets. When the run must not edit the
repo, add page-local `gp-` rules built from the component source instead, and
list the asset gap in the hand-back.
