# Wireframe kit

One neutral look for every board on a review canvas: the overview, the ways in, the
flows, every option and the questions. It's for checking structure, flow and copy
before UI design, so it stays plain on purpose. Reviewers should argue about the
model, not the colors.

Real words everywhere. No placeholder bars, no lorem ipsum, no [BRACKETS]. Where a
fact is unknown, use a realistic sample value from `docs/design-memory/fixtures.md`.

## Type

Open Sans only, for everything, including headings, numbers and captions. Weights
300 to 800, plus italic 400 and 600.

`<link href="https://fonts.googleapis.com/css2?family=Open+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400;1,600&amp;display=swap" rel="stylesheet">`

Inline style: `font-family: Open Sans, system-ui, sans-serif`, unquoted, so it's
safe inside JS strings.

| Role | Size / weight |
|---|---|
| Display | 44 to 64px / 300 or 700, letter-spacing -0.02em |
| Page title | 32 to 40px / 700 |
| Section title | 20 to 24px / 700 |
| Body | 16px / 400, line-height 1.5 to 1.6 |
| Label | 14px / 600 |
| Caption | 12 to 13px / 400 or 600 |

No overlines (small uppercase labels above a title). The title leads.

## Color

Neutral scale, only these:

| Token | Hex | Use |
|---|---|---|
| white | #ffffff | cards, inputs, phone screens |
| n50 | #fafafa | secondary panels |
| page | #f5f5f5 | page background |
| sunken | #ededed | rails, wells, empty and loading states |
| n200 | #e5e5e5 | dividers on gray, filled chips |
| line | #d4d4d4 | borders, input borders |
| n400 | #a3a3a3 | disabled borders, decorative rings |
| n500 | #737373 | placeholder text only (fails as body text on gray) |
| muted | #525252 | secondary text (passes 4.5:1 on page and sunken) |
| n700 | #404040 | body on gray |
| n800 | #262626 | strong body |
| ink | #171717 | headings, primary buttons, selected states |

One accent, used only for links, focus rings and the current selection: **#3d5a80**,
with **#e8edf3** as its soft fill. Never for primary buttons, headings or decoration.

No gradients, textures, photos, drop shadows or blur. An inset box-shadow is allowed
only to draw a ring or a double border. Status (done, needs you, error) is shown with
words and shape (a check icon, bold text, a heavier border), never with color alone.

## Shape

Radius: 8px for inputs, 12px for cards, 16px for large panels, 999px for pills and
buttons. A phone screen is 390 by 844 with a 28 to 32px radius. Borders are 1px
#d4d4d4 by default, 1.5 to 2px #171717 when selected, 1.5px dashed #737373 for
optional or pending.

## Components

- **Primary button:** 48px tall, pill, #171717 fill, white 16px / 600 text. The label
  names the action ("Keep the pledge", not "Submit").
- **Secondary button:** same size, transparent, 1px #171717 border.
- **Text button or link:** accent, underlined, 44px tall target.
- **Disabled:** #e5e5e5 fill, #d4d4d4 border, #525252 text, plus a visible reason.
- **Text input:** 48px tall, 1px #d4d4d4 border, 8px radius, 16px text, with a
  visible `<label>` above at 14px / 600.
- **Choice card:** a `<label>` row, 48px minimum, 12px radius. Selected: 2px #171717.
  Native inputs use `accent-color: #3d5a80`.
- **Chip:** pill, 40px (44 when tappable), 1px #d4d4d4. Selected: #171717 fill.
- **Card:** white, 1px #d4d4d4 or #e5e5e5 border, 12px radius, 20 to 24px padding.
- **Badge:** pill, 12 to 13px / 600, #ededed fill. At most one per card.
- **Progress:** segmented bar, 4 to 6px. Done #171717, current #737373, upcoming #d4d4d4.
- **Agent message:** white, 1px #e5e5e5 border, 12px radius, the agent's name above
  the first message in a group. The user's messages sit on #ededed, aligned right.

## Shared chrome

- **Desktop top bar:** 64px, white, 1px #e5e5e5 bottom border, 24px side padding.
  Left: the heart logo, a 1px divider, the context label at 15px / 600 #404040.
  Right, in order: the person to reach ("Talk to Jared"), "Restart demo" (#525252
  text button), then "Save and exit" (secondary pill) if the concept has it.
- **At 390px:** one row. The label, a compact "Talk to Jared", an icon-only Restart
  with `aria-label="Restart demo"`.
- **Phone top bar:** 56px, the label at 16px / 600, Restart on the right.
- **Talk to a person** opens a small in-page panel, never a mailto link: the
  person, their team, a "Book 20 minutes" button that confirms a sample time, and
  Close, which returns focus to the opener. One way to reach the person per board.

## Logo

Always the heart logo, never the "GoodParty.org" wordmark as text. Paste
`assets/heart-logo.svg` exactly (it's `packages/gp-webapp/public/images/logo/heart.svg`
redrawn in kit ink, 34 by 28; use 28 by 23 in phone top bars). A link around it
gets `aria-label="GoodParty.org home"`. Plain-text mentions of GoodParty.org in a
sentence stay text.

## Every option must have

- A way back on every step, and a person to reach.
- Any commitment the user makes (a pledge, a consent) is their own deliberate act:
  an unchecked box, its own button, never pre-checked.
- Working interactions: every button does something, no dead ends, no `href="#"`,
  and Restart returns to the starting state.
- A start state for each way in it supports (see `flow-spec.md`).
- Touch targets of 44px or more, 4.5:1 contrast, real `<button>`, `<a href>`,
  `<input>` and `<label>`, and `prefers-reduced-motion` support.
- Its own landing state inside the board. Never link to boards that aren't on the
  canvas.

## Words

Follow `docs/product-copy.md`, `docs/product-vocabulary.md` and
`docs/design-memory/learned.md`. US English, sentence case, plain and short. No em
dashes, no exclamation points, no emoji. Never "just", "simply", "seamless",
"chatbot". On Serve boards, never voters, elections or ballots (constituents,
office, term). On a board that mocks a Win screen, Win's nouns are correct.

## Canvas file rules (each fails silently)

Keep `<script src="./support.js"></script>` exactly. Close every element and quote
every attribute. `{{hole}}` is a dotted lookup into `renderVals()` only, no
expressions. Always include the `<script type="text/x-dc" data-dc-script>` block
with `class Component extends DCLogic`. All UI is `<x-dc>` markup, never built from
script. `data-props` `$preview` equals the frame size, and the root element's
`min-height` matches it. No network except the Open Sans link. Icons are inline
stroke SVG.
