# Design workflow

How `gp-design` (`../SKILL.md`) makes a design: three options, or one design
("One design" below). Paths are relative to `.claude/skills/gp-design/`. This
is gp-design's own copy of the `ux-review-options` pipeline, drawn with the
real styleguide components; `ux-review-options` itself is a separate skill and
is not changed by this one.

Produce three design options for a feature, as one page the team can open, click
through and comment on. The user gives you a ticket (ClickUp URL) or a plain
description, and any docs, meeting notes or transcripts behind it.

## Why options

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

One page, `index.html`: the design first, at the top of the page, in
three sections, `#option-a`, `#option-b`, `#option-c`; then How we read the task. No
ways-in boards, no flow diagrams, no questions page.

How we read the task (`#brief`) is short. "Decisions needed" stays open; the rest is
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
3. One clickable flow, drawn in `<work>/flow/option-a.tsx` with the real
   styleguide components and shown in a 375 x 812 phone frame. The first
   screen is the entry point: the screen the user is on before they start, with
   the thing they tap. Then every step to the landing state. The same flow is
   the desktop: "Desktop preview", beside Restart, opens it at the window's
   width in a new tab (`?view=desktop`), and `lg:` and `useIsMobile` switch at
   the frame's width. "The frame" in `reference/wireframe-build.md`.
4. A collapsed Other states appendix under the frame, from the flow file's
   `states`: the screens off the happy
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
   from the `build-shape` skill in UX mode. The page shows only the prototypes:
   "Show how it's built", next to Desktop preview above the option's frame,
   opens its build shape alone in a new tab (`?view=build`, with
   `&option=b` for B and C).

When the ticket names Win and Serve, each option is still one flow, with a
Serve / Win switch that swaps the words and only the screens that really differ.

That is all. If the ticket reaches the feature from more than one place, start on
the most common entry point and name the others in the comment you post back.
Don't build a board per entry point.

## The design system decides, this workflow draws

This skill keeps no design rules of its own. It follows the design system and
draws with the design system's own components:

- **Design rules:** `docs/product-design.md` (flows, pages vs overlays, input,
  actions, reusing what exists), `packages/styleguide/COMPONENTS.md` (which
  component for which job), `docs/product-copy.md`, `docs/product-vocabulary.md`
  and `docs/design-memory/learned.md`. Read them before you design.
- **Prior art:** the product's recent features that did the same job (step 2).
- **Drawing:** `reference/wireframe-build.md` turns those into a page: the flow
  file and its real components, the frame, the appendix and the page rules.
  Read it before you build.

Structure, flow and copy are under review, so there's no imagery or
decoration beyond what the components have. But every existing
screen, including the navigation and the page around the feature, is copied
from its source, never drawn as a gray block.

## People and data

Every person, place and sample value comes from
`docs/design-memory/fixtures.md`, including the sample recipient a merge tag
preview fills in. Never put real constituent, voter or CRM data on the page.
When the fixtures lack something the design needs, use a plausible value,
keep every date in the future, and add "add <what> to fixtures.md" under
Decisions needed. "Gap:" is for components only.

## Process

Work in a scratch folder outside any repo, `<work>/`, and keep the page in
`<work>/page/`.

1. **Read everything.** The ticket and its comments, every linked doc, meeting
   notes. Then the design system docs above. Then the code the feature touches:
   routes, modals, emails, the data it stores. With the code, list `docs/adr/`
   and read every active record whose scope the feature touches, and every
   superseded one whose subject it touches (an approach rejected before goes
   in `#questions`). An active record a person decided (`decided_by` is a
   handle, not `[agent]`) is a constraint on every option: keep what it
   decided. An option may reverse it only when the task asks for that change
   in so many words; quote that clause next to the record in `#questions`.
   Without such a clause, don't draw the reversal and don't offer it as a
   decision. For a design with no code change, listing them is
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
   read its code. Then read the `AGENTS.md` of the area the flow lives in and
   its siblings (`packages/gp-webapp/app/dashboard/outreach/AGENTS.md` lists
   every outreach channel's steps), and grep their code for the job's verb
   (crop, upload, schedule, preview): a part one channel already ships is
   prior art for every other. Never mark a `no-component` mutation or a gap
   before this search. Copy it, unless `docs/product-design.md` names it as a known
   gap; then follow the rule and say so in the post-back. When two recent
   features do the same job two ways and the docs don't settle it, pick one and
   ask in the post-back.
3. **Pass the source gate.** List every existing screen the flow touches and the
   source file of each. Build today's version of each from that source, render it
   next to the version on the page, and compare layout, labels and navigation.
   Never invent a screen. How, in `reference/wireframe-build.md`, "Existing
   screens". Screens behind sign-in (onboarding, the dashboard) can't be seen
   without a session the person gives you; with none, go straight to captures
   and code. To see today's screen, in this order: run the local app or dev
   with Playwright, if you can; else use screenshots from an existing capture;
   else compare against the code only, and say so in How we read the task and the
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
4. **Write how we read the task.** It is not a product brief: when the ticket
   has a product brief or one-pager, read it, build on it and link it rather
   than restate it. Answer the questions in `reference/review-lens.md` from the
   ticket, the code and, if you have it, Amplitude (device split, baseline). Write
   "Unknown" where you can't answer, never a guess. Every Unknown, every
   conflict between the rulebook and the code, every ticket claim the code
   doesn't match, every ADR from step 1 an option would reverse or weaken, with the task clause that asks for it (its
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
   `#a-drops`. Then write `<work>/notes/coverage.md`: every clause of the
   task, one per line, quoted, with where it lands. A clause is each thing the
   ticket, its scope, the meeting notes it carries and the designer's
   direction ask for, mention or leave open ("evaluate X", "out of scope: X").
   Each lands in one of two places: the screen key that draws it, per option
   when the options differ, or `questions` with the question it became under
   "Decisions needed". An out-of-scope or "evaluate" clause is a question, not
   a silence. A clause drawn other than as written goes in `#<x>-drops` too.
   No clause stays without a place. Draw only what the task asks: every
   screen, section and state on the page answers a clause of the ticket or
   the direction, or is a screen the flow passes through to get there.
   Anything more you think the feature needs (another section, a step after
   the flow, a settings change, a new notice) goes under "Decisions needed"
   as a question, not onto the page.
6. **Build the page.** Copy `assets/page-template.html` to
   `<work>/page/src.html` and fill in the three options' text, and copy
   `assets/flow-template.tsx` to `<work>/flow/option-a.tsx` (b, c) and draw
   each flow. Then run
   `python3 scripts/build.py <work>/page/src.html <work>/page`. It renders the
   flows with the real components (node and the repo's `node_modules`: run
   `npm ci` in the checkout first) and writes `index.html`.
7. **Check.** `python3 scripts/check.py --skip-build-shape <work>/page/index.html`
   catches banned words, dead links, external requests and a missing How we read the task,
   open questions list, entry screen, Sends line, appendix, Built from,
   What changes from today or Mutations list, template sample text left on
   the page and a page built from an old flow file. Its flow lint
   (`scripts/flow/lint.mjs`) catches raw elements, imports outside the
   styleguide, restyled components and hand-drawn looks with no marker,
   hardcoded colors, `style={}`, shrunk text, off-scale spacing, unearned
   muted text and banners, a seamless field with no host, a cite that holds
   nothing of what it claims, and `data-go` to no screen. It also reads
   `<work>/notes/coverage.md`: every clause line must name a screen or state
   key of the page in backticks, a block of the page (`#brief-measure`), or
   the question it became; a key the page doesn't have fails. And it checks
   the fixtures: every email address on a `.example` domain, no written date
   in the past. Then render
   it with Playwright (channel `chromium`). Playwright lives in the
   repo root `node_modules`, or the main checkout's when a worktree has none.
   Render at the widths in `docs/product-design.md` §10: 375px and 1280px,
   once at 1023px and 1024px for layouts that change at the breakpoint, and
   320px. On the page, click through the phone frame; open Desktop preview and
   click through it at 1280, 1024 and 1023.
   `node scripts/flow/shoot.mjs <work>/page/index.html <work>/screens`
   screenshots the page and every screen and state alone (phone, and each
   screen at 1280, 1024 and 1023), at full height when the screen scrolls,
   clicks every `data-go` on every screen at 375, runs axe-core inside the
   frame on every phone and desktop shot, and reports page errors, blank
   icons, sideways scroll, dead `data-go`, screens of one option that come
   out identical, and each serious or critical accessibility rule broken
   (contrast, names and labels, ARIA, target size) with the shots it broke
   on. It shoots several pages at once, so it takes under a minute. It also
   walks every path the flow file exports (`paths`, see the template) from
   entry at 375 and 1280, one screenshot per step in `screens/paths/`, and
   crops each control the design adds (not under `data-source`, not
   `data-inert`) at rest, on hover and on keyboard focus in
   `screens/controls/`, reporting a step it can't take and a control with
   no visible focus. Run it once per batch of fixes, not after each fix: fix
   everything a run reports, then run it again; after a fix to a few
   screens, `--only a/editor,a/review` reshoots just those. Fix every
   accessibility line on markup the design adds; one on a screen copied as
   shipped goes under "Rulebook vs code" in `#questions`. Export a path for
   every way through each option, and look at the path screenshots to see
   that a choice made on one screen (a photo, a color) is still there on the
   next. To open one screen yourself, `?view=phone` or `?view=desktop` with
   `&step=<screen key>` or `&state=<state key>` (and `&option=b` on the
   options page). Disable each control you changed that can be disabled and
   screenshot it. Confirm no icon is blank. Fix anything clipped,
   overlapping, dead or off-system. Controls marked `data-inert` (not part of
   this change) are exempt from clicking.
8. **Senior design review.** Run it as `reference/senior-review.md` says,
   once, and apply its fixes. It also covers the fit to the task: the
   review lens, distinct options, and an option that changes an existing
   system the ticket doesn't ask to change. Any copy a fix changes goes in
   `#<x>-drops` when it differs from shipped, and copy the ticket specifies
   never changes without a row there. Keep backups and any tools you write
   outside `<work>/build/`, which holds only build-shape fragments.
9. **Add how it's built, then the final check.** Build shapes come last,
   after the senior review's fixes, because any edit to an option makes its
   build shape stale: run this step once, on the final options. Run the `build-shape`
   skill (`.claude/skills/build-shape/SKILL.md`) in UX mode on
   `<work>/page/src.html` and the flow files. **build-shape is written for
   ux-review-options: wherever it names a
   script under `.claude/skills/ux-review-options/scripts/` (`option_section.py`,
   `build.py`), run the one with the same name under
   `.claude/skills/gp-design/scripts/` instead: only it hashes the flow file,
   and `check.py` here rejects a fragment hashed any other way.** build-shape's
   own scripts (its `check.py` on the fragments) run as it says. It writes one fragment per option to `<work>/build/`,
   which is reserved for those fragments: backups and tools go elsewhere.
   Its notes go to `<work>/build-shape-notes.md`. A risk it reports about an
   ADR goes under "Decisions needed"; one about feature loss goes in
   `#<x>-drops`. Editing `#<x>-drops` or the flow file changes the option's
   hash, so rerun this step after it.
   Rerun `build.py`, which inlines each fragment at the end of its option. This
   step is required. Skip it only when no option touches the system: copy,
   layout, or a screen's own states only. Any change to an API, a contract, a
   job, a stored field or a field the front end needs from the API touches it.
   Then write one line on why to `<work>/no-build-shape.txt`.
   Then run `python3 scripts/check.py <work>/page/index.html` with no flag: it
   also fails when build shapes are missing (with no skip note), stale, or
   showing by default. Render at the step 7 widths, confirm the build
   shapes are hidden on the page, then open each `?view=build` tab and
   screenshot it. Any later edit to an option means rerunning this step.
10. **Publish** with the `artifacts` skill (`.claude/skills/artifacts/SKILL.md`):
    `.claude/skills/artifacts/scripts/publish.sh <work>/page <feature>-options`, for
    example `import-contacts-options`.
    Pass `--update` when you republish. Publishing needs `npx vercel login`
    with a goodparty.org account that can assign `*.artifacts.goodparty.org`
    aliases. If `publish.sh` deploys but can't assign the alias, stop: don't
    share the raw deployment URL, tell the person their Vercel account needs
    that access, and hand back the local `index.html` meanwhile.
    Then open the published page, `?view=desktop` and `?view=build`, at 1280
    and 375: the views show only the flow or the build shape, with the whole
    bottom bar in view. The artifact host adds a bar to every page, so a page
    that passed locally can still break here.
11. **Post back.** Comment on the ticket (with no ticket, reply in chat; and reply
    in the Slack thread, if one asked) with the artifact link, the `?view=build` link for engineers,
    one line per option, the feedback we want, the new
    components each option needs (or "None"), the skip line from
    `no-build-shape.txt` if there is one, every line under "Decisions needed"
    as a question for a person, and the "Rulebook vs code" lines as FYI. Add any cheap
    variants worth testing later. Say that viewing needs a Good Party Vercel
    sign-in.

## One design

For one design instead of three options, copy
`assets/page-template-one.html` instead of `assets/page-template.html` in step
6: it has no B and C, and its `<main data-design="one">` tells `check.py` to
check `#option-a` only and to fail on any other option. Steps 1 to 4 and 6 to
11 run as written; step 5 writes the description, Sends line, Built from list,
What changes from today list and Mutations list for the one design. The design is the picked
direction: the appendix covers every state the build will need (Revision
rounds step 4), with no six-state cap. These parts of this workflow do not apply:

- "Real options, no recommendation" and "Three different models".
- Step 5's "pick three" and the list of other models.
- The review lens questions on distinct options and "which option worked", and
  the senior review's distinctness question.
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
5. Every republish runs steps 7 and 9 again, in order: check, then
   `build-shape` in UX mode for each changed option and the final check.
   The senior review (step 8) runs once per run, not per republish.
   `check.py` fails on a stale build shape, so it can't be published. A
   revision that skips them drifts. Say in
   the post-back that they ran.
6. Post which screens are today's and which are new, and ping the Slack thread.

## Staying in sync with the design system

The prototype has to look like what will be built, so it follows the design
system and never forks it.

- **A lesson from a review goes to the design system, not this workflow.** When a
  comment settles how something should work or look (a pattern, a container, a
  word), fix the source: `docs/product-design.md`, the component's `@summary`
  (which regenerates `COMPONENTS.md`), `docs/product-copy.md` or
  `docs/design-memory/learned.md`. Open that PR, or say in the post-back which
  doc needs it. Only drawing mechanics belong in `reference/wireframe-build.md`.
- **Never restate a rule here.** Point to the doc that owns it, so a change there
  reaches the next prototype with no edit to this workflow.
- **The prototype renders the styleguide itself.** A flow imports the real
  components and `build.py` compiles gp-webapp's own `globals.css`, so a
  component change reaches the next prototype with no edit here. When a
  component reads the window in a way the frame doesn't stand in for yet, fix
  `scripts/flow/runtime/` ("The frame" in `reference/wireframe-build.md`).

## Pitfalls

- **Invented screens.** When a design shows something that exists in the product
  (a page, a panel, the navigation, a wizard), replicate it faithfully from its
  source: same layout, same components, same labels, same navigation pattern. A
  reviewer who can't recognize today's screen can't judge the change. Never add a
  navigation pattern the product doesn't have (a "Back to X" link in a page body, a
  tab strip, a side sheet where the product uses a full-height drawer).

- **Unrequested scope.** A design that adds sections, steps or screens the
  task didn't ask for hides the answer to the ask and makes reviewers cut it
  back. Ask about them under "Decisions needed" instead (step 5).
- **Changing a shared component quietly.** A component other screens use (the
  flow shell, a card, a sheet, a styleguide component) changes everywhere it
  is used. "Mutations" in `reference/wireframe-build.md` says how to list it.
- **Unearned elements.** Helper text, banners and summary numbers break "Earn
  every element" in `docs/product-design.md`. `check.py` flags them.
- **Convergence.** Rounds of fixing pull options toward the same safe middle. Each
  option should become the best version of itself, not more like the others.
- **Dead interactions.** Every button does something, Restart returns to the first
  screen, and there's a way back on every step. Controls a copied screen
  brings that the change doesn't touch are exempt (`reference/wireframe-build.md`, "Every option must
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
