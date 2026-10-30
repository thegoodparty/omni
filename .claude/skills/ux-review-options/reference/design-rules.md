# Design rules: wireframe feel, real design system

The page is for checking structure, flow and copy before UI polish. It should look
like a wireframe and be built from our design system, so what reviewers approve is
what gets built.

## Where the system lives

`packages/styleguide` (`@goodparty_org/styleguide`, shadcn/ui based). Start with
`packages/styleguide/COMPONENTS.md`: every component and when to use it. Choose
from it before you draw anything, so each option is built from parts that exist.
Then read the package's `AGENTS.md` and the source of any component you use in
`packages/styleguide/src/components/ui/<name>.tsx` for its real variants and sizes.
Tokens are in `packages/styleguide/src/design-tokens.css`, the source of truth.

The page is static HTML, so it can't import the React components. `scripts/build.py`
inlines `design-tokens.css` and `assets/gp-ui.css`, which gives you plain-HTML
versions of the common components that match the styleguide's variants. Use the
classes below. When you need a component `gp-ui.css` doesn't have (tabs, dialog,
stepper, progress, table, avatar, alert), read its `.tsx`, then add a small
`.gp-<name>` rule to the page's own `<style>` block built only from token variables.
Never hard-code a hex value that a token already covers.

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

Buttons use the system's `rounded-full` shape. Inputs are 40px tall, 6px radius.
Cards are 12px radius with a 1px border. Don't change those.

## Wireframe feel

- **Neutral surfaces.** Page background `--brand-surface-secondary`, panels
  `--brand-surface-primary` or `--brand-surface-tertiary`, text from the `--brand-text-*`
  tokens, borders `--brand-border-primary`. Blue (`--goodparty-blue-500`, the system's
  primary) shows only on the single main action per screen and on links and focus
  rings. No red, lavender or green except the system's alert and status uses.
- **No imagery.** A photo, avatar picture, map or chart is a `gp-box` with a plain
  label ("Map of Maplewood", "Vote count chart"). No stock art or emoji. Icons follow
  the Icons rules below.
- **No decoration.** No gradients, drop shadows, blur, animation beyond focus and
  state changes, or brand flourishes. Status is words plus shape (a check, bold
  text, a heavier border), never color alone.
- **Real words.** Real headings, button labels and sample values from
  `docs/design-memory/fixtures.md`. No lorem ipsum, no `[BRACKETS]`, no placeholder
  bars standing in for text.
- **Type.** Open Sans (the webapp's body font), loaded from Google Fonts. Use the
  system's scale: 14px for labels and helper text, 16px for body, 20 to 24px for
  section titles, 30 to 36px for a screen title. Sentence case everywhere.
- **Phone first.** Every wireframe sits in a 390px phone frame with a 28px radius,
  unless the feature is desktop-only. Then it sits in a 1200px desktop frame with
  `data-desktop-reason="..."` saying why.
- **The fold.** Every frame carries a `<div class="fold">`, the dashed line where
  the first screen ends: 660px down in a phone frame (Safari's visible height on a
  390 by 844 phone) and 720px in a desktop frame. Decide what goes above it
  first.
- **Out of scope is a block.** Navigation, sidebars and any UI the feature doesn't
  change are `gp-box` blocks labeled with what they are ("App navigation"). Only
  the feature gets drawn. The close-to-today option keeps the real page around the
  feature as blocks, so the reviewer sees where it sits.
- **Entry point first.** The first screen in every option is where the user is
  before they start (`#a-entry`), with the button or link that starts the flow.
  Where the feature changes an existing screen, show today's version there and the
  change on the next step.
- **Buttons on the right** of their row, unless long content or a branded image
  displaces them. Short, consistent flows use a horizontal stepper. Flows whose
  steps need explaining use a vertical one. A long or demanding flow opens with a
  prep screen that says what the user needs before they begin.
- **The logo.** The heart (`packages/gp-webapp/public/images/logo/heart.svg`), never
  the wordmark as text. `assets/heart-logo.svg` is a ready copy to paste inline.

## Existing screens

When an option touches a screen that exists today, replicate it before you change
it. Don't redraw it from memory or from the ticket.

0. **List first.** Write down every existing screen the flow touches and its source
   file. Never invent one (a contact panel, a Constituents page, a "Back to uploads"
   link, a table where the product uses cards). After building, render today's
   screen and the page's version side by side and compare.
1. **Find the source.** Start from the route (`packages/gp-webapp/app/dashboard/<area>`
   and its `AGENTS.md`), then the page component, its sheets and drawers, and the
   copy file (`contactsLabels.ts`, `navLabels.ts` and similar). Today's headings,
   labels and empty states come from there, word for word.
2. **Copy the structure.** Same shell (sidebar items and order from
   `DashboardMenu.tsx`, page title bar, top bar), same column widths, same cards,
   same row layout, same sheet pattern. If the product shows a list as cards, don't
   show it as a table. Drill-in screens use the product's own pattern, such as a
   `CrmSheet` drawer with a Back control at its top-left, not a new link in the
   page body.
3. **Mark what is new.** Show only the new parts as new, and say in the comment you
   post back which parts are today's and which are added.
4. **Check the data.** Show only fields the product has today (for example the
   person panel's real sections), and flag any field the feature adds.

## Spacing parity

A frame that mirrors an existing screen must measure the same as the real one. The
reviewer judges the change, and wrong gaps make the whole screen look off. A v2
filter prototype shipped with groups 16px too far apart and pills 8px too tall
because of two mistakes below.

1. **Copy the real class strings, then convert them.** Open the component and read
   the Tailwind classes on the wrapper, the label, the row and the control (for the
   filter pills: `PILL_TOGGLE_ITEM_CLASSNAME` in
   `contacts/crm/shared/constants.ts`, the `flex flex-col gap-2` group and the
   `flex flex-wrap gap-2` row in `VoterFileStep.tsx`). Convert each class to px
   (spacing is 4px per step: `gap-2` is 8px, `gap-6` is 24px, `h-9` is 36px,
   `px-4` is 16px; `text-sm` is 14px on a 20px line, `text-xs` is 12px on a 16px
   line). Put the source file and the classes in a comment above your CSS rule.
2. **Check every constraint on size.** A fixed height (`h-9`) beats the padding
   and line height around it. The pill is 36px because of `h-9`, not 38px from
   `py-2`. Read the base variant too (`toggleVariants`, `ToggleGroup`) before you
   decide a size.
3. **Reset like Tailwind does.** Tailwind's preflight zeroes the margin on every
   heading, paragraph and list. `gp-ui.css` does this for you under `.gp`. If you
   write your own wrapper, do the same. An unreset `h4` adds about 16px above and
   below each label.
4. **Don't enlarge for touch targets.** The 44px rule is for controls you invent. A
   mirrored control keeps the product's size. Say so in the post-back if the
   product's size is under 44px.
5. **Use the ready components.** `gp-filter-groups`, `gp-filter-group`, `gp-pills`
   and `gp-pill` in `gp-ui.css` are the real filter pill look. Add a rule of your
   own only for a shape the product doesn't have, and build it from the same
   spacing steps.
6. **Measure.** After rendering, read `getBoundingClientRect()` for the mirrored
   rows (label to pills, group to group, pill height) and compare them with the
   px you computed from the classes. `check.py` flags off-scale spacing values and
   oversized pill rules, but only the measurement catches an unreset heading.

## Information architecture

Think about the information architecture before any screen. It is guidance, not a
mandate: not every set of records needs its own list and detail page.

- Prefer the product's standard list UI and its top-level pages over modals and
  sheets.
- Put stats where the product puts them, not in a new summary strip.

| The job | Container |
|---|---|
| Something people return to, browse or manage | Top-level page |
| Look at or edit one record while keeping the list in view | Drawer |
| A multi-step task with a start and an end | Wizard, with a stepper, inside the nav shell |
| A short confirmation or one blocking choice | Modal, as a last resort |

## Earn every element

No helper text, banner or summary number unless the product has it today or the
ticket asks for it. `check.py` flags `.muted` paragraphs and banner or alert
elements; add `data-earned="why"` to one you can defend.

## Icons

Use only inline SVGs from the styleguide's lucide set, with `stroke="currentColor"`
and a viewBox. Never an emoji, an icon font or a hand-drawn path. Screenshot every
screen in review and confirm no icon is blank.

## Every option must have

- Working interactions: every button does something, no `href="#"`, no dead ends.
  Drive wireframes with `<button>` and script, not anchor links.
- Restart on the frame, returning to the first screen.
- A way back on every step, and a person to reach (Talk to Jared opens a small
  in-page panel, never a `mailto:` link).
- Any commitment the user makes (a pledge, a consent) is their own deliberate act:
  an unchecked box and its own button, never pre-checked.
- Real `<button>`, `<input>` and `<label>`, a visible focus ring, and 4.5:1 text
  contrast. New controls the feature invents get 44px minimum touch targets. A
  control that mirrors one in the product keeps the product's size (see "Spacing
  parity").
- A landing state inside the frame. Never link to anything outside the page.
- A Sends line above the frame (`#a-sends`): every email, text or notification the
  flow triggers, and when. "Nothing" if it triggers none.
- Where the user decides to pay or commit, the value in dollars or outcomes, on
  the screen where they decide.

## Words

Follow `docs/product-copy.md`, `docs/product-vocabulary.md` and
`docs/design-memory/learned.md`. US English, plain and short. No em dashes, no
exclamation points, no emoji. Never "just", "simply", "seamless" or "chatbot"; say
"agent". On Serve screens, never voters, elections or ballots (constituents, office,
term). On a screen that mocks a Win screen, Win's nouns are correct.

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
