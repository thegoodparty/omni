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
`gp-ui.css` doesn't have (tabs, dialog, stepper, table, avatar, alert), read its
`.tsx`, then add a small `.gp-<name>` rule to the page's own `<style>` block built
only from token variables. Never hard-code a hex value that a token already covers.

## Components in `gp-ui.css`

| Class | Matches | Variants |
|---|---|---|
| `gp-btn` | `Button` | `gp-btn--secondary`, `--outline`, `--ghost`, `--link`, `--neutral`; sizes `gp-btn--sm`, default (medium), `--lg` |
| `gp-input`, `gp-textarea`, `gp-select` | `Input`, `Textarea`, `Select` | `aria-invalid="true"` for errors |
| `gp-label` | `Label` | |
| `gp-field` | label above input, with spacing | |
| `gp-card` (`gp-card__title`, `gp-card__desc`) | `Card` | |
| `gp-badge` | `Badge` | `gp-badge--soft`, `--outline`, `--destructive` |
| `gp-choice` | selectable row with a radio or checkbox | `:has(input:checked)` shows selected |
| `gp-bar` | `Progress` | `<span style="width:40%">` inside |
| `gp-sep` | `Separator` | |
| `gp-box` | gray placeholder for an image, chart or map; put its label inside | |
| `gp-filter-groups`, `gp-filter-group`, `gp-pills`, `gp-pill` | the filter pills (`ToggleGroupItem` with `PILL_TOGGLE_ITEM_CLASSNAME`) | `aria-pressed="true"` for selected |

Buttons use the system's `rounded-full` shape. Inputs are 40px tall, 6px radius.
Cards are 12px radius with a 1px border. Don't change those.

## Wireframe feel

- **Neutral surfaces.** Page background `--brand-surface-secondary`, panels
  `--brand-surface-primary` or `--brand-surface-tertiary`, text from the
  `--brand-text-*` tokens, borders `--brand-border-primary`. Blue
  (`--goodparty-blue-500`) shows only on the main action per screen, links and
  focus rings.
- **No imagery.** A photo, map or chart is a `gp-box` with a plain label ("Map of
  Maplewood"). No stock art or emoji.
- **No decoration.** No gradients, drop shadows, blur or brand flourishes beyond
  what the real component has.
- **Real words.** Real headings, button labels and sample values from
  `docs/design-memory/fixtures.md`. No lorem ipsum, no `[BRACKETS]`.
- **Type.** Open Sans, loaded from Google Fonts, on the system's scale. Sentence
  case everywhere.
- **Phone first.** Every wireframe sits in a 390px phone frame with a 28px radius,
  unless the feature is desktop-only. Then it sits in a 1200px desktop frame with
  `data-desktop-reason="..."` saying why.
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
   pattern, same labels word for word.
3. **Compare.** After building, render today's screen and the page's version side
   by side and fix what differs.
4. **Show only real fields.** Flag any field the feature adds.

## Spacing parity

A frame that mirrors an existing screen must measure the same as the real one.

1. **Copy the real class strings, then convert them.** Read the Tailwind classes on
   the wrapper, the label, the row and the control. Convert each class to px
   (spacing is 4px per step: `gap-2` is 8px, `gap-6` is 24px, `h-9` is 36px,
   `px-4` is 16px; `text-sm` is 14px on a 20px line, `text-xs` is 12px on a 16px
   line). Put the source file and the classes in a comment above your CSS rule.
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
- A way back on every step, and a person to reach (Talk to Jared opens a small
  in-page panel, never a `mailto:` link).
- Real `<button>`, `<input>` and `<label>`, a visible focus ring, and 4.5:1 text
  contrast.
- A landing state inside the frame. Never link to anything outside the page.
- A Sends line above the frame (`#a-sends`): every email, text or notification the
  flow triggers, and when. "Nothing" if it triggers none.
- An Other states appendix below the frame (`#a-appendix`, see below).

## Other states appendix

The frame shows the happy path. Everything else goes in a collapsed
`<details class="appendix" id="a-appendix">` under the frame, so it never crowds
the main flow.

- Up to six states the user will really hit, each a small static screen with a
  one-line label: a bad file, processing, needs your input, failed, empty, undo.
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

## Words

Follow `docs/product-copy.md`, `docs/product-vocabulary.md` and
`docs/design-memory/learned.md`. US English, plain and short. No em dashes, no
exclamation points, no emoji. Never "just", "simply", "seamless" or "chatbot"; say
"agent". On Serve screens, never voters, elections or ballots.

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
  `#brief-solution`, `#brief-data`, `#brief-measure`, `#brief-entry` and
  `#feedback-ask`. One or two sentences each. "Unknown" is a valid answer.

## Keeping `gp-ui.css` in sync

Each `gp-*` class copies a styleguide component. Each block in `gp-ui.css` names
the `.tsx` it copies. When a component's look, variants or sizes change, its class
here changes in the same PR (`packages/styleguide/AGENTS.md` says so). If you find
one out of date while building, fix it here rather than working around it on the
page.
