---
name: ux-review-options
description: Produce 3 distinct design options for a feature ticket as one clickable wireframe page, published to a private Vercel artifact link. Use when a ticket moves to Committed (the Delegate trigger) or when someone asks for UX options, wireframes or a design review for a ticket, so the team can pick the UX direction before agents build it.
---

Produce three design options for a feature, as one page the team can open, click
through and comment on. The user gives you a ticket (ClickUp URL) or a plain
description, and any docs, meeting notes or transcripts behind it.

## Why this skill exists

Agents build what a ticket says, and a ticket rarely says enough about the
experience. A quick human review of the options catches a wrong direction while it's
still cheap to change. Two rules make that review work:

- **Real options, no recommendation.** AI drifts to the safest option even when it
  isn't good. So the page lays out three options and leaves the call to people.
  Never rank, score, star or pick a winner, anywhere on the page or in the comment
  you post.
- **Three different models.** Each option is a different way to solve the job, not a
  variation of the same screen. Make at least one stay close to today's product
  layout and at least one a different layout paradigm. Two options that differ only
  in their container (a side sheet and a full page) are the same option.
- **The page answers the reviewer's questions before they ask.** Who it's for,
  where they come from, how we'll measure it, and what feedback we want.
  `reference/review-lens.md` has the questions. Read it before you start.

## What the artifact holds (and nothing else)

One static page, `index.html`: the design first, right under the page bar, in
three sections, `#option-a`, `#option-b`, `#option-c`; then the brief. No
ways-in boards, no flow diagrams, no questions page.

The brief (`#brief`) is short. "Decisions needed" stays open; the rest is
collapsed:

1. The elevator summary, one sentence each: user, problem, solution, data and
   measurement. Measurement names the metric, the primary call to action, the
   baseline if there is one, and how soon we'd know.
2. Where users come from and what they expect when they arrive.
3. Where it reaches (`#reach`): the trace from `docs/product-design.md`,
   "Before you design", one line per surface the feature touches, saying what
   changes or why nothing does.
4. The feedback we want today (`#feedback-ask`): one to three specific asks.
5. Open questions (`#questions`): every question for a person, from steps 1 to
   4 and step 9, in two lists: "Decisions needed" and "Rulebook vs code
   (copied, no action)". "None" when a list is empty.

Each option has:

1. A name (two or three words, for example "Review sheet") and one sentence on what
   the user experiences.
2. A "Sends" line: the emails, texts and notifications this option triggers, or
   "Nothing".
3. One clickable wireframe of the full flow, in a 390px phone frame. The first
   screen is the entry point: the screen the user is on before they start, with
   the thing they tap. Then every step to the landing state. The same flow at
   desktop lives in the page but is never embedded in it: a "Desktop preview"
   button beside Restart opens it in a new tab (`?view=desktop`), and a small
   "Phone" link opens the phone flow alone (`?view=phone`). "Phone first" and
   "Phone and desktop views" in `reference/wireframe-build.md`.
4. A collapsed Other states appendix under the frame: the screens off the happy
   path the user will really hit (an error, processing, failed, empty, undo), and
   how they find out later when work happens in the background. The frame stays
   the happy path.
5. A collapsed Built from list under the appendix (`#a-sources`): each element
   and its source, per "Every design shows what it's built from" in
   `docs/product-design.md` §7. A screen is "as shipped" here only when its
   strings and controls are unchanged; name any control left out of the frame
   in Built from, and any it drops in What changes from today.
6. A collapsed What changes from today list next to it (`#a-drops`), per "Say
   what a change drops" in `docs/product-design.md` §7: dropped behavior,
   removed controls, and changed strings with the old and new text, or "None".
7. A collapsed Mutations list next to it (`#a-mutations`): every declared
   restyle of a component and its source or proposal, or "None"
   ("Mutations" in `reference/wireframe-build.md`).
8. A "How it's built" panel under the list: one build shape for this option,
   from the `build-shape` skill in UX mode. The page opens on the prototypes:
   build shapes stay hidden until someone turns on "Show how it's built" at
   the right of the page bar. `build.py` adds that switch. Add `?build` to the
   link to open with them showing.

When the ticket names Win and Serve, each option is still one frame, with a
Win / Serve switch that swaps the words and only the screens that really differ.

That is all. If the ticket reaches the feature from more than one place, start on
the most common entry point and name the others in the comment you post back.
Don't build a board per entry point.

## The design system decides, this skill draws

This skill keeps no design rules of its own. It follows the design system and
only knows how to draw it as a static page:

- **Design rules:** `docs/product-design.md` (flows, pages vs overlays, input,
  actions, reusing what exists), `packages/styleguide/COMPONENTS.md` (which
  component for which job), `docs/product-copy.md`, `docs/product-vocabulary.md`
  and `docs/design-memory/learned.md`. Read them before you design.
- **Prior art:** the product's recent features that did the same job (step 2).
- **Drawing:** `reference/wireframe-build.md` turns those into a wireframe: the
  plain-HTML components, frames, the appendix and the page rules. Read it before
  you build.

Designs read as wireframes: structure, flow and copy are under review, so
surfaces are neutral and there's no imagery or decoration. But every existing
screen, including the navigation and the page around the feature, is copied
from its source, never drawn as a gray block.

## People and data

Every person, place and sample value comes from
`docs/design-memory/fixtures.md`, including the sample recipient a merge tag
preview fills in. Never put real constituent, voter or CRM data on the page.

## Process

Work in a scratch folder outside any repo, `<work>/`, and keep the page in
`<work>/page/`.

1. **Read everything.** The ticket and its comments, every linked doc, meeting
   notes. Then the design system docs above. Then the code the feature touches:
   routes, modals, emails, the data it stores. With the code, list `docs/adr/`
   and read every active record whose scope the feature touches, and every
   superseded one whose subject it touches (an approach rejected before goes
   in `#questions`). For a design with no code change, listing them is
   enough; code that implements it follows "Check before you change" in the
   root `AGENTS.md`. Today's behavior is the starting
   point for the close-to-today option, and code facts often kill or reshape an
   option. Then read Part 4 (Components) of `docs/product-design-gaps.md` and
   the rows in `docs/product-design-gaps-locations.md` for the files and zones
   the design touches. They are a list of known hardcode and mutations not to
   copy, not a source of rules: `docs/product-design.md` wins. A new or changed
   screen fixes a listed problem (the component as it ships) and lists the
   difference in `#<x>-drops`; unchanged screens and shared chrome keep it, as
   "Existing screens" item 2 in `reference/wireframe-build.md` says. A component the design uses that
   the audit proposes is named by its C-xx id. Find the entry point: the route and the button or link that starts the
   flow today. Note which products the ticket names (Win, Serve or both).
2. **Find the prior art.** For each job a screen does (a multi-step task, a list
   of records, one record's details, counts, a confirmation), find the most
   recent shipped feature that does the same job: search the product map
   (`packages/gp-api/src/chats/general/product-knowledge/productMap.ts`) and
   merged PRs from the last two months in `packages/gp-webapp/app/dashboard`, and
   read its code. Copy it, unless `docs/product-design.md` names it as a known
   gap; then follow the rule and say so in the post-back. When two recent
   features do the same job two ways and the docs don't settle it, pick one and
   ask in the post-back.
3. **Pass the source gate.** List every existing screen the flow touches and the
   source file of each. Build today's version of each from that source, render it
   next to the version on the page, and compare layout, labels and navigation.
   Never invent a screen. How, in `reference/wireframe-build.md`, "Existing
   screens". To see today's screen, in this order: run the local app or dev
   with Playwright, if you can; else use screenshots from an existing capture;
   else compare against the code only, and say so in the brief and the
   post-back. Never sign in by creating a user: no test users, and no
   testing tokens or sign-in tickets that make one. Sign in only with a
   session the person already has and gives you (a Playwright `storageState`
   file); never type a password. With no session, skip sign-in, compare
   against existing captures and the code, and say so on the page. A
   signed-in session is read-only: stop at the first step whose Continue
   writes data (creates a list, a draft, a payment), compare the later steps
   against the code, and say so on the page. Never use a real account to
   submit anything. If the session's active org is the wrong product,
   switching org (the `organization-slug` cookie) is allowed (it's session
   state, not data). Never create, edit or delete anything; reopening an
   existing draft and pressing Back only is fine. Delete any copy of the
   session you made afterwards.
4. **Write the brief.** Answer the questions in `reference/review-lens.md` from the
   ticket, the code and, if you have it, Amplitude (device split, baseline). Write
   "Unknown" where you can't answer, never a guess. Every Unknown, every
   conflict between the rulebook and the code, every ticket claim the code
   doesn't match, every ADR from step 1 an option would reverse or weaken (its
   title and `decided_by`), and every decision for a person goes in
   `#questions` on the page and in the post-back, under "Decisions needed".
   Which list a rulebook vs code conflict goes in: "Existing screens" item 2
   in `reference/wireframe-build.md`. For the baseline, try the
   `query-analytics-data` skill (`amp` CLI), then the Amplitude MCP; if
   neither is reachable, write "Unknown". Don't ask the person for it; list
   it under "Decisions needed" with the query someone should run. When the
   feature has no traffic yet, use the nearest sibling flow's numbers as a
   proxy, labelled as a proxy, and put "Unknown" for the feature itself in
   `#questions`. Before
   you list a decision, answer it yourself if the rulebook, `learned.md` or
   the designer's direction already does, and name the rule. When the
   designer's direction and a rule disagree, neither answers it: list it with
   both sources. Rank "Decisions
   needed" with the ones that block the build first, and keep only what a
   person must decide. If this turns out to be a
   product or marketing problem rather than a design one, say so in the post-back.
5. **Pick three options.** Think about how other products solve the same job (form,
   one question at a time, conversation, human-led, calendar, checklist,
   invitation, agent workspace, search). Pick three that are each a different
   model. Write the one-sentence description and the Sends line for each before
   you build. Then list what each option is built from, per "Every design
   shows what it's built from" in `docs/product-design.md` §7: each element and
   its source (a component from `packages/styleguide/COMPONENTS.md`, or the
   file of the screen whose solution it copies). A part with no source is a
   gap: build it from the closest fit and list it. A new component is only
   ever a proposal for the team, per §7. The list goes on the page in
   `#a-sources`. Every restyled component is a declared mutation
   ("Mutations" in `reference/wireframe-build.md`) with a row in
   `#a-mutations`. Before you mark one "no-component", search the product
   for the same job as step 2 does; if it already solves it, copy that and
   mark it "product". Then list what each option changes from today for
   `#a-drops`. When a designer gave a direction, map each clause of it to the
   screen that delivers it; a clause not delivered as written goes in
   `#<x>-drops` or "Decisions needed".
6. **Build the page.** Copy `assets/page-template.html` to
   `<work>/page/src.html`, fill in the three options, then run
   `python3 scripts/build.py <work>/page/src.html <work>/page`. It inlines the
   design tokens and component CSS and writes `index.html`.
7. **Check.** `python3 scripts/check.py --skip-build-shape <work>/page/index.html`
   catches banned words, dead links, external requests and a missing brief,
   open questions list, entry point, Sends line, appendix, Built from,
   What changes from today or Mutations list, template sample text left on
   the page, undeclared mutations, hardcoded values, unapproved icons and raw
   controls, and flags unearned muted text, banners, blank icons and
   off-scale spacing. Then render
   it with `agent-browser` (headless Chromium), or Playwright (channel
   `chromium`) when `agent-browser` isn't installed. Playwright lives in the
   repo root `node_modules`, or the main checkout's when a worktree has none.
   Render at the widths in `docs/product-design.md` §10: 375px and 1280px,
   once at 1023px and 1024px for layouts that change at the breakpoint, and
   320px. Check the page shows only the phone flow, with the Desktop preview
   button beside Restart. Open `?view=phone` and `?view=desktop`, and click
   through each; the window scrolls, not the frame. Click every path in every option. Move the mouse off the page
   before each screenshot, so no hover state shows. Screenshot every screen
   and confirm no icon is blank. Fix anything clipped,
   overlapping, dead or off-system. A static desktop frame's controls, and
   controls marked `data-inert` (not part of this change), are exempt from
   clicking.
8. **Review.** One round with a subagent that reads only the page, the ticket,
   `reference/review-lens.md`, `reference/wireframe-build.md`,
   `docs/product-design.md`, `docs/product-copy.md`,
   `docs/product-vocabulary.md`, `docs/design-memory/learned.md`,
   `docs/design-memory/fixtures.md`, `packages/styleguide/COMPONENTS.md` and,
   for one design, `gp-design` §3. It clicks every path, answers every
   question in the review lens against the page, checks the options are
   distinct, that every element has a source, that copy passes the copy docs,
   that people and data come from `fixtures.md` and that every `learned.md`
   rule holds, and fixes what it finds. It may fix layout, structure and rule
   breaks. Any copy it changes goes in `#<x>-drops` when it differs from
   shipped, and it never changes copy the ticket specifies without listing it
   there. It flags any option that changes an
   existing system (lists, filters, outreach) the ticket doesn't ask to change.
   Don't let it pull the options toward each other. It keeps backups and any
   tools it writes outside `<work>/build/`, which holds only build-shape
   fragments. It edits `<work>/page/src.html`; if the page is generated from
   other files, it edits those and rebuilds. Rerun `build.py` and step 7's
   check after its fixes.
9. **Add how it's built, then the final check.** Build shapes come last because
   any edit to an option makes its build shape stale. Run the `build-shape`
   skill (`.claude/skills/build-shape/SKILL.md`) in UX mode on
   `<work>/page/src.html`. It writes one fragment per option to `<work>/build/`,
   which is reserved for those fragments: backups and tools go elsewhere.
   Its notes go to `<work>/build-shape-notes.md`. A risk it reports about an
   ADR goes under "Decisions needed"; one about feature loss goes in
   `#<x>-drops`. Editing `#<x>-drops` changes the option's hash, so rerun this
   step after it.
   Rerun `build.py`, which inlines each fragment at the end of its option. This
   step is required. Skip it only when no option touches the system (copy or
   layout only): then write one line on why to `<work>/no-build-shape.txt`.
   Then run `python3 scripts/check.py <work>/page/index.html` with no flag: it
   also fails when build shapes are missing (with no skip note), stale, or
   showing by default. Render at the step 7 widths, confirm the build
   shapes are hidden on load, then turn on "Show how it's built" and screenshot
   them. Any later edit to an option means rerunning this step.
10. **Publish** with the `artifacts` skill (`.claude/skills/artifacts/SKILL.md`):
    `.claude/skills/artifacts/scripts/publish.sh <work>/page <feature>-options`, for
    example `import-contacts-options`.
    Pass `--update` when you republish.
11. **Post back.** Comment on the ticket (with no ticket, reply in chat; and reply
    in the Slack thread, if one asked) with the artifact link, the same link with `?build` for engineers,
    one line per option, the feedback we want, the new
    components each option needs (or "None"), the skip line from
    `no-build-shape.txt` if there is one, every line under "Decisions needed"
    as a question for a person, and the "Rulebook vs code" lines as FYI. Add any cheap
    variants worth testing later. Say that viewing needs a Good Party Vercel
    sign-in.

## One design

`gp-design` runs this pipeline for one design instead of three options. Copy
`assets/page-template-one.html` instead of `assets/page-template.html` in step
6: it has no B and C, and its `<main data-design="one">` tells `check.py` to
check `#option-a` only and to fail on any other option. Steps 1 to 4 and 6 to
11 run as written; step 5 writes the description, Sends line, Built from list,
What changes from today list and Mutations list for the one design. The design is the picked
direction: the appendix covers every state the build will need (Revision
rounds step 4), with no six-state cap. These parts of this skill do not apply:

- "Real options, no recommendation" and "Three different models".
- Step 5's "pick three" and the list of other models.
- The review lens questions on distinct options and "which option worked", and
  step 8's distinctness and convergence checks.
- "One line per option" in the post-back: write one line on the design.
- `check.py`'s banned "recommended", "best option" and star words.

## Revision rounds

When people comment after the first publish:

1. Once a direction is picked, drop the other options. Keep only the chosen one,
   and mark it on the page (`<main class="page" data-picked="a">`) so `check.py`
   checks one option.
2. Read every open thread, on Vercel (see the `artifacts` skill) and on the
   ticket. Reply to each and resolve it.
3. Ambiguity: apply a comment's fix everywhere the same pattern appears and say so
   in the reply, or ask. Never take the narrowest reading.
4. Rebuild the appendix to cover every state the build will need, and add the
   Win / Serve switch if the ticket names both products and it isn't there yet.
5. Every republish runs steps 7 to 9 again, in order: check, review, then
   `build-shape` in UX mode for each changed option and the final check.
   `check.py` fails on a stale build shape, so it can't be published. A
   revision that skips them drifts: the phone frame and desktop flow go missing. Say in
   the post-back that they ran.
6. Post which screens are today's and which are new, and ping the Slack thread.

## Staying in sync with the design system

The prototype has to look like what will be built, so it follows the design
system and never forks it.

- **A lesson from a review goes to the design system, not this skill.** When a
  comment settles how something should work or look (a pattern, a container, a
  word), fix the source: `docs/product-design.md`, the component's `@summary`
  (which regenerates `COMPONENTS.md`), `docs/product-copy.md` or
  `docs/design-memory/learned.md`. Open that PR, or say in the post-back which
  doc needs it. Only drawing mechanics belong in `reference/wireframe-build.md`.
- **Never restate a rule here.** Point to the doc that owns it, so a change there
  reaches the next prototype with no edit to this skill.
- **Keep `assets/gp-ui.css` matched to the styleguide.** If a `gp-*` class no
  longer matches its component, fix the class in the same PR as the prototype
  work. See "Keeping `gp-ui.css` in sync" in `reference/wireframe-build.md`.

## Pitfalls

- **Invented screens.** When a design shows something that exists in the product
  (a page, a panel, the navigation, a wizard), replicate it faithfully from its
  source: same layout, same components, same labels, same navigation pattern. A
  reviewer who can't recognize today's screen can't judge the change. Never add a
  navigation pattern the product doesn't have (a "Back to X" link in a page body, a
  tab strip, a side sheet where the product uses a full-height drawer).

- **Unearned elements.** Helper text, banners and summary numbers break "Earn
  every element" in `docs/product-design.md`. `check.py` flags them.
- **Convergence.** Rounds of fixing pull options toward the same safe middle. Each
  option should become the best version of itself, not more like the others.
- **Dead interactions.** Every button does something, Restart returns to the first
  screen, and there's a way back on every step. A static desktop frame's
  controls are exempt, and so are controls a copied screen brings that the
  change doesn't touch (`reference/wireframe-build.md`, "Every option must
  have").
- **Starting mid-flow.** A wireframe that opens on the feature's first screen
  leaves the reviewer asking how they got there. Open on the entry point.
- **Gray blocks for real UI.** Navigation, sidebars and the page around the
  feature are copied from source. A gray block hides the context the reviewer
  needs to judge the change. Gray boxes are only for images, maps and charts.
- **Touching systems the ticket didn't ask for.** Showing imports as list cards
  implied a change to how lists work. If an option changes an existing system,
  ask in the post-back before anyone builds it.
- **Unbuildable claims.** Don't show a prefill or an entry the code can't support
  without saying what has to change, in the comment you post back.
- **Iframes.** The Vercel comment toolbar can't see inside an iframe. Put the
  wireframes directly in the page.
- **Public repo.** This repo is public. Ticket text, meeting notes and the built
  page stay in the scratch folder and on Vercel, never committed here.
