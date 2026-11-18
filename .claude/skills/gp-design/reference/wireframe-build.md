# Drawing a design with the real components

This file is only about drawing. What good design is lives in the design system,
and this skill keeps no copy of it:

- `docs/product-design.md`: flows, pages vs overlays, asking for input, actions
  and what happens next, reusing what exists.
- `packages/styleguide/COMPONENTS.md`: every component and the job it is for.
- `docs/product-copy.md`, `docs/product-vocabulary.md` and
  `docs/design-memory/learned.md`: words and earned rules.

When this file and those disagree, they win. Fix this file in the same PR.

## The flow file

Each option is one file, `<work>/flow/option-a.tsx` (`option-b.tsx`,
`option-c.tsx` on the options page), copied from `assets/flow-template.tsx`. It
imports the real components from `packages/styleguide`
(`@styleguide/components/ui/<name>` or `@styleguide`) and exports:

- `screens`: the clickable flow, one function per screen. `entry` is where the
  user starts. Any element with `data-go="<screen key>"` opens that screen when
  clicked; `useGo()` from `gp-flow` does the same from code (an upload that
  finishes). A choice that lasts across screens (a picked color, a removed
  photo) is `const [color, setColor] = useFlowState('color', 'neutral')` from
  `gp-flow`, never a module-level variable: Restart clears it, and every
  screen of the flow reads the same value. A control may both set it in its
  `onClick` and carry `data-go`: the setter runs first, then the flow moves on.
- `states`: Other states, each `{ label, screen }`, plus `values` to start
  that state's `useFlowState` somewhere other than the defaults
  (`values: { color: 'blue' }`) (below).
- `products` (optional): `['serve', 'win']` when the ticket names both ("Win
  and Serve").

A flow imports only `react`, `gp-flow` and the styleguide. Pick from
`COMPONENTS.md` before you draw anything, then read the source of each component
you use in `packages/styleguide/src/components/ui/<name>.tsx` for its real
variants and sizes, and use them through their props. Product screens
(`DashboardLayout`, `OutreachFlowShell`, `Intro`) can't be imported: they read
the session, the API and Next. Copy their markup into the flow with their class
strings as they are, under `data-source` ("Existing screens").

`scripts/build.py` bundles the flows, compiles gp-webapp's own
`app/globals.css` with Tailwind for the classes they use, inlines the product's
Open Sans, and writes one self-contained `index.html`. It needs node and the
repo's `node_modules` (`npm ci` in the checkout). `scripts/check.py` runs
`scripts/flow/lint.mjs` on each flow file.

## The frame

The frame is the screen a flow lives in, and it stands in for the browser
window. On the page it is a 375 x 812 phone. Desktop preview (beside Restart;
both are drawn by `build.py` with the real `Button`) opens the same flow at the
window's width in a new tab, `?view=desktop` (`&option=b` on the options page).
For screenshots, `?view=phone` or `?view=desktop` with `&step=<screen key>` or
`&state=<state key>` opens one screen alone at the window's size. That page has
no review page around it and no `data-gp-flow` mount: the screen sits in
`#gp-view > [data-gp-frame]`, so a script that clicks through it looks there.
`scripts/flow/shoot.mjs` shoots every screen and state this way, waits for an
open overlay to finish sliding in, adds a `-full.png` at the screen's full
height when something in the frame scrolls, and reports two keys that shoot
identically (a state that opens the wrong screen).

So one flow draws both widths, as the product does:

- Tailwind's width media queries (`lg:`, `md:`, `sm:`) become container queries
  on the frame, and viewport units (`h-dvh`, `min-h-dvh`) become the frame's
  height. Copy a screen's classes as they are and it lays out at 375 the way it
  does on a phone.
- `useIsMobile` (`@styleguide/hooks/use-mobile`) reads the frame's width, so a
  Dialog that becomes a Drawer below 1024px does so in the frame.
- Overlays (Dialog, Drawer, Sheet, Select, Popover, Tooltip) open inside the
  frame, and a modal neither locks the review page nor hides it from screen
  readers.
- A component's own breakpoints switch at the frame's width too: Textarea's
  `md:text-sm` sets 14px from 768px, so at 1280 it overrides a size you give it.
  Inside rendered content, override it with `!` under `data-content-source`.

The runtime that does this is `scripts/flow/runtime/`. If a component reads the
window some other way, fix the runtime, not the flow.

## Look

- **Wireframe content, real components.** Structure, flow and copy are under
  review. Surfaces, type and color are whatever the components and the copied
  screens have.
- **Except the content a look-and-feel ticket is about.** When the ticket is
  about how content looks (themes, colors, a header, a template), the content
  under review shows its real colors, taken from the product's own theme
  constants (for email, `EMAIL_THEMES` in
  `packages/contracts/src/outreach/EmailTemplate.const.ts`; type and radii from
  `packages/gp-api/src/emailOutreach/templates/components.tsx`). Mark the
  rendered content `data-content="<what>"`, and give each element inside it
  that uses a literal value `data-content-source="<path>:<line>"` naming the
  line that holds the value ("Mutations"). A part of the content drawn as its
  own component (`const EmailHeader = () => ...`) is content wherever it is
  used inside `data-content`, with the cites of where it is used; per-theme
  values can be one cite expression (`data-content-source={THEME_SRC[color]}`
  with `THEME_SRC` a const of `"<path>:<line>"` strings, an array of them, or
  a template like `` `${FILE}:38` ``) instead of one branch per theme;
  `THEME_SRC.blue` or `THEME_SRC['blue']` reads that one entry. Editor
  controls that sit over the content (a row of buttons on the email) go in a
  wrapper marked `data-editor`: inside it the usual rules apply, not the
  content's. The product chrome around it stays
  as the product draws it. Never put labels or theme names inside the rendered
  content.
- **No imagery.** A photo, map or chart is a plain placeholder with a label
  ("Map of Maplewood"), drawn as the product's own placeholder or as a gap
  ("Mutations"). No stock art or emoji.
- **No decoration.** No gradients, shadows, blur or brand flourishes beyond
  what the real component has.
- **Real words.** Real headings, button labels and sample values from
  `docs/design-memory/fixtures.md`. No lorem ipsum, no `[BRACKETS]`. A message
  preview that fills a merge tag uses the sample recipient there.
- **Phone first.** Design the 375 frame first; the desktop is the same flow at 1280. Same content, same order, same actions (`docs/product-design.md` §10).
- **Flow steps vs dashboard screens.** A full-screen flow step has no dashboard
  top bar: it has the flow's own header, and its footer with the actions stays
  at the bottom (`h-dvh` and a scrolling body, as `assets/flow-template.tsx`
  shows). A dashboard screen keeps its top bar and grows with its content.
- **Draw the real page around the feature.** The navigation, title bar and the
  rest of an existing page are copied from source like any other existing
  screen, not drawn as gray blocks. A reviewer judges the change in its real
  context.
- **The logo.** `GoodPartyOrgLogo` from the styleguide, never the wordmark as
  text.

## Existing screens

`docs/product-design.md` says to reuse what exists and never invent a screen. To do
that in a flow:

1. **List first.** Write down every existing screen the flow touches and its source
   file. Start from the route (`packages/gp-webapp/app/dashboard/<area>` and its
   `AGENTS.md`), then the page component, its sheets and drawers, and the copy
   file (`contactsLabels.ts`, `navLabels.ts` and similar).
2. **Copy the structure and words.** Same shell (sidebar items and order from
   `DashboardMenu.tsx`), same title bar, same cards, same row layout, same sheet
   pattern, same labels word for word. Copy each element's classes from its
   source and put `data-source="<path>:<line>"` on the outermost element you
   copied, naming the line of that element; it covers everything inside it.
   The lint reads the cited file: the lines around the cite (3 up, 8 down)
   must hold that element's component tag, one of its classes, or its text,
   so an import line or a nearby line that only looks right fails.
   Classes copied as they are keep the visual order: the `OutreachFlowShell.tsx`
   footer is `flex-row-reverse` with the main action first in the DOM, so Back
   shows on the left. Secondary text the source ships (a muted caption, a price line) is earned by
   that `data-source`. When the sibling you copy breaks a rulebook rule (a
   disabled button for missing input), or the audit
   (`docs/product-design-gaps.md`) lists a problem on a screen you copy, this
   is the one rule for where it goes:
   - In a new or changed screen, follow the rule, not the sibling
     (`docs/product-design.md` §7), and fix a listed audit problem. That is a
     change from today: list it in `#<x>-drops`.
   - Unchanged screens, and shared shell and chrome the ticket doesn't change
     (the flow footer, the header), are copied as shipped, audit problems
     included, even on a changed step, and listed under "Rulebook vs code
     (copied, no action)".
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

## Mutations

The rules are gp-webapp's `check:design-system` (`packages/gp-webapp/AGENTS.md`,
"Styleguide"), and `scripts/flow/lint.mjs` applies them to the flow:

- **No raw controls.** No `<button>`, `<input>`, `<select>`, `<textarea>`,
  `<svg>` or `<img>`, and a link is `Button asChild` around an `<a>`. Icons come
  from `@styleguide/components/ui/icons`, never `lucide-react`.
- **A restyled component is a mutation.** A styleguide component whose
  `className` changes how it looks (color, border, radius, shadow, type, a
  sized control's height and padding; layout is free) carries one of, in the
  order of `docs/product-design.md` §7, "Pick in this order":
  1. `data-mutation="product <path>:<line>"`: the product already restyles it
     this way for this job. Copy it exactly; no new look-alike. The cite is
     read like a `data-source` ("Existing screens" item 2).
  2. `data-mutation="no-component <closest>; proposes <what>"`: no component
     does the job. `<closest>` is the closest component; `<what>` is a
     variant, a new component, or an audit C-xx id. Only after the step 2
     prior art search (`options-workflow.md`) finds no product solution for the same
     job; when it finds one, that is item 1. A proposal is not a decision:
     `check.py` fails unless `<what>` is an audit C-xx id that exists in
     `docs/product-design-gaps.md`, or the same words appear under Decisions
     needed (`#questions`) as a question for #tmp-design-agent
     (`docs/product-design.md` §7). The same holds for a `data-gap`'s proposal.
- **A hand-drawn look is a gap.** A plain element (`div`, `span`, `p`) with a
  visual class sits under a `data-source` (copied from the product) or carries
  `data-gap="<what>; proposes <component or C-xx>"`: nothing in the product or
  the styleguide draws it.
- **Never hardcoded.** No hex or `rgb()` in a class, no raw palette color
  (`bg-blue-600`, `bg-white`) and no literal type size, line height or radius
  (`text-[13px]`, `leading-[inherit]`, `rounded-[10px]`) outside copied markup,
  where a bracketed value is the product's only when the source holds it (the
  cited lines on the element that carries the cite, the cited file below it), no `style={}`,
  nothing shrunk below 0.75 (`scale-`, `zoom`), no odd px spacing
  (`p-[13px]`). New markup switches layout at `lg:` only, never `sm:`, `md:`
  or `max-*:` (`docs/product-design.md` §10); copied markup keeps its own. An
  icon from `icons.tsx` takes its color and size classes as the product does.
- **Rendered content.** The one exception is the rendered content of a
  look-and-feel ticket, inside `data-content`: a plain element with
  `data-content-source="<path>:<line>"` may use `style={}` and bracketed
  classes, and every literal value in them must be on the lines it cites.
  `style={}` anywhere else is allowed only in markup copied under
  `data-source`, with its values in the 40 lines from the cite. A styleguide
  component restyled through `style` is a mutation like one restyled through
  `className`. A value the source computes (`` `${lineHeight}px` ``) goes in a
  const in the flow with the cite beside it. A
  look or spacing class without brackets (`px-6`, `text-sm`, `border-border`)
  must be on those lines by name; when the source is an inline-styled template,
  write its value as a bracket (`px-[24px]`) instead. Styleguide
  components inside it (the editor's controls) follow every rule above.
- **Seamless fields.** A `Textarea` or `TokenField` with
  `variant="seamless"` sits in a card that takes `seamlessFieldHost`
  (`@styleguide/components/ui/textarea`), or its focus never shows.
- **Earned elements.** A muted paragraph (`<p>` with `text-muted-foreground`),
  an `Alert`, and a new plain element that needs its own look (a helper line)
  carry `data-earned="<why>"` unless they're copied under `data-source`. A
  `data-gap` covers the element's subtree, like `data-source`.

Each `data-mutation` and `data-gap` marker gets a row in the option's Mutations
list (`<details class="mutations" id="a-mutations">`): the element, the kind
(product, no-component or gap), and the marker's text after its kind.
`check.py` fails on a marker with no row. "None" when there are none.

## Spacing parity

A flow that mirrors an existing screen must measure the same as the real one.

1. **Copy the real class strings.** Put them on the same elements, with the same
   wrappers, and read the base variant too (`toggleVariants`, `ToggleGroup`)
   before you change a size.
2. **Keep the product's size.** A mirrored control keeps the product's size, even
   under 44px. The 44px minimum is for controls the feature invents.
3. **Measure.** After rendering, read `getBoundingClientRect()` for the mirrored
   rows in `?view=phone&step=<key>` and compare them with today's screen.

## Every option must have

- Working interactions: every button does something (`data-go`, or state the
  screen keeps with `useState`), no dead ends. Restart, drawn by `build.py`,
  returns to `entry`. `data-go` to the screen already showing starts it over.
  A component used on several screens takes its `data-go` targets as props,
  so each screen sends it to the right place.
- A way back on every step. A person to reach only where the product already
  has one on that screen, copied from its source (an in-page panel, never a
  `mailto:` link). Never add one: "Invent nothing" in `docs/product-design.md`
  §7.
- A landing state inside the flow. Never link to anything outside the page.
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
  `check.py` doesn't scan `#a-drops`, `#questions` or `<code>` for banned
  words, so old strings can be quoted there and real prop names
  (`<code>variant="seamless"</code>`) can be quoted in Built from.
- A Mutations list next to it (`<details class="mutations" id="a-mutations">`):
  one row per marker, per "Mutations" above.
- Controls a copied screen brings that the change doesn't touch, and controls
  inside a changed step whose behavior the ticket doesn't touch: draw them as
  they ship, with no dimming or other special style, and add one Built from
  row, "Not part of this change", naming them. Each carries
  `data-inert="<its name in that row>"`; `check.py` fails on one the row
  doesn't name. They do nothing in the flow, and the click-through and the
  review don't count them as dead. If the step's content or layout changes,
  what those controls produce (loading, filled, undo, failure) is a state of
  this change and goes in Other states.

## Other states appendix

The frame shows the happy path. Everything else is the flow file's `states`,
drawn in a collapsed `<details class="appendix" id="a-appendix">` under the
frame, each in its own phone frame with its label above it.

- In three-option mode, up to six states the user will really hit, each one
  screen with a one-line label: a bad file, processing, needs your input,
  failed, empty, undo. One design has no cap (`options-workflow.md`, "One design").
- Pick them from the rules in `docs/product-design.md` (success view, leaving
  with unsaved input, long jobs, errors next to the field, undo vs confirm), not
  from imagination.
- Include the return trip when the feature does work in the background: what the
  user sees on the page they come back to (an alert, a status) and how they fix or
  undo the result.
- A state with an open overlay renders it open (`<Dialog open>`); it opens inside
  its own frame.
- To show today's screen before the change, add it as a state labeled "Today:
  <screen>", copied from its source as shipped.
- In the first round, two or three states per option are enough. Once a direction
  is picked, the appendix covers every state the build will need.

## Win and Serve

A flow for one product exports no `products`: `useProduct()` returns the
page's `data-product`. When the ticket names both products, export
`products = ['serve', 'win']`. The
page shows a Serve / Win switch above the frame, and `useProduct()` from
`gp-flow` says which one is showing. Keep one copy object per product, the way
the product does (`importContactsCopy.ts`), and pick from it with
`useProduct()`. Draw a second version of a screen only where the products really
differ, such as a count that means voters on Win. Never duplicate a whole flow.
The check reads the Win copy apart, so its Win words aren't read as Serve copy.

`<main>` always carries `data-product`: the template's `{{PRODUCT}}` becomes
`"win"`, `"serve"` or `"both"`, the answer to "Win, Serve or both?" in
`gp-design` §1. `check.py` fails on any other value. With `"win"` it reads the
whole page as Win copy; with `"serve"` or `"both"` the Serve vocabulary check
covers everything outside the Win copy.

## Words

Words follow `docs/product-copy.md`, and Win vs Serve words
`docs/product-vocabulary.md`. `check.py` reads the banned list from "Words we
do not use" in `docs/product-copy.md` each run, over the page and every screen
and state of every flow, copied product strings included: a shipped string
that breaks the list is not a false alarm. Rewrite it and list the old and new
text in What changes from today ("Every option must have").

## Page rules

- One `index.html`, self-contained: `build.py` inlines the CSS, the script and
  the font. No external requests. No iframes: the Vercel comment toolbar can't
  see inside one, which is why the frame is a container, not an iframe.
- The page's own `<style>` lays out the page around the design only. It never
  reaches into a frame; the design is drawn in the flow file. The scaffold
  stays as the template has it.
- Give every block a stable, readable id (`#option-a`, `#a-save`): Vercel
  comments record the CSS selector they pin to. Ids in a flow start with the
  option's letter (`a-office`) and never repeat within a screen.
- No recommendation anywhere: no stars, "best", "recommended", ranking or order
  that implies one beyond A, B, C.
- The design comes first, right under the page bar. The brief (`#brief`)
  follows the options, with `#brief-user`, `#brief-problem`,
  `#brief-solution`, `#brief-data`, `#brief-measure`, `#brief-entry`,
  `#reach`, `#feedback-ask` and `#questions`. One or two sentences each. "Unknown" is a
  valid answer, and each one is also a line in `#questions`. `#questions` holds two
  lists: "Decisions needed", open, and "Rulebook vs code (copied, no action)",
  collapsed. The rest of the brief and `#reach` are collapsed too.
