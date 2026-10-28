# Design rules: wireframe feel, real design system

The page is for checking structure, flow and copy before UI polish. It should look
like a wireframe and be built from our design system, so what reviewers approve is
what gets built.

## Where the system lives

`packages/styleguide` (`@goodparty_org/styleguide`, shadcn/ui based). Read its
`AGENTS.md`, then the source of any component you use in
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
  label ("Map of Maplewood", "Vote count chart"). No stock art, emoji or icon sets
  beyond simple inline stroke SVG.
- **No decoration.** No gradients, drop shadows, blur, animation beyond focus and
  state changes, or brand flourishes. Status is words plus shape (a check, bold
  text, a heavier border), never color alone.
- **Real words.** Real headings, button labels and sample values from
  `docs/design-memory/fixtures.md`. No lorem ipsum, no `[BRACKETS]`, no placeholder
  bars standing in for text.
- **Type.** Open Sans (the webapp's body font), loaded from Google Fonts. Use the
  system's scale: 14px for labels and helper text, 16px for body, 20 to 24px for
  section titles, 30 to 36px for a screen title. Sentence case everywhere.
- **Layout.** A desktop wireframe sits in a 1200px frame, a phone wireframe in a 390
  by 844 frame with a 28px radius. Use the product's real shell (top bar, sidebar,
  page header) for the close-to-today option; use any layout for the others.
- **The logo.** The heart (`packages/gp-webapp/public/images/logo/heart.svg`), never
  the wordmark as text. `assets/heart-logo.svg` is a ready copy to paste inline.

## Existing screens

When an option touches a screen that exists today, replicate it before you change
it. Don't redraw it from memory or from the ticket.

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

## Every option must have

- Working interactions: every button does something, no `href="#"`, no dead ends.
  Drive wireframes with `<button>` and script, not anchor links.
- Restart on the frame, returning to the first screen.
- A way back on every step, and a person to reach (Talk to Jared opens a small
  in-page panel, never a `mailto:` link).
- Any commitment the user makes (a pledge, a consent) is their own deliberate act:
  an unchecked box and its own button, never pre-checked.
- Real `<button>`, `<input>` and `<label>`, 44px minimum touch targets, a visible
  focus ring, and 4.5:1 text contrast.
- A landing state inside the frame. Never link to anything outside the page.

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
