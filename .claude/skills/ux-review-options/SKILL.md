---
name: ux-review-options
description: Produce 3 distinct design options for a feature ticket as one clickable wireframe page, published to a private Vercel artifact link. Use when a ticket moves to Committed (the Delegate trigger) or when someone asks for UX options, wireframes or a design review for a ticket, so the team can pick the UX direction before agents build it.
---

Produce three design options for a feature, as one page the team can open, click
through and comment on. The user gives you a ticket (ClickUp URL) and any docs,
meeting notes or transcripts behind it.

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

One static page, `index.html`: a brief at the top, then three sections,
`#option-a`, `#option-b`, `#option-c`. No ways-in boards, no flow diagrams, no
questions page.

The brief (`#brief`) is short:

1. The elevator summary, one sentence each: user, problem, solution, data and
   measurement. Measurement names the metric, the primary call to action, the
   baseline if there is one, and how soon we'd know.
2. Where users come from and what they expect when they arrive.
3. The feedback we want today (`#feedback-ask`): one to three specific asks.

Each option has:

1. A name (two or three words, for example "Review sheet") and one sentence on what
   the user experiences.
2. A "Sends" line: the emails, texts and notifications this option triggers, or
   "Nothing".
3. One clickable wireframe of the full flow, in a 390px phone frame with the fold
   marked. The first screen is the entry point: the screen the user is on before
   they start, with the thing they tap. Then every step to the landing state.
   Use a desktop frame instead only when the feature is desktop-only, and say why
   on the frame (`data-desktop-reason`).
4. A collapsed Other states appendix under the frame: the screens off the happy
   path the user will really hit (an error, processing, failed, empty, undo), and
   how they find out later when work happens in the background. The frame stays
   the happy path.
5. A "How it's built" panel under the appendix: one build shape for this option,
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

Use `docs/design-memory/fixtures.md`: Sarah Chen is the default Serve user (Sarah
in copy), Jared is candidate success, Maplewood is the place. Follow every rule in
`docs/design-memory/learned.md`, `docs/product-copy.md` and
`docs/product-vocabulary.md`. Sample emails use example.com and phone numbers use
555. Never put real constituent, voter or CRM data on the page.

## Process

Work in a scratch folder outside any repo, `<work>/`, and keep the page in
`<work>/page/`.

1. **Read everything.** The ticket and its comments, every linked doc, meeting
   notes. Then the design system docs above. Then the code the feature touches:
   routes, modals, emails, the data it stores. Today's behavior is the starting
   point for the close-to-today option, and code facts often kill or reshape an
   option. Find the entry point: the route and the button or link that starts the
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
   screens".
4. **Write the brief.** Answer the questions in `reference/review-lens.md` from the
   ticket, the code and, if you have it, Amplitude (device split, baseline). Write
   "Unknown" where you can't answer, never a guess. If this turns out to be a
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
   ever a proposal for the team, per §7.
6. **Build the page.** Copy `assets/page-template.html` to
   `<work>/page/src.html`, fill in the three options, then run
   `python3 scripts/build.py <work>/page/src.html <work>/page`. It inlines the
   design tokens and component CSS and writes `index.html`.
7. **Add how it's built.** Run the `build-shape` skill
   (`.claude/skills/build-shape/SKILL.md`) in UX mode on `<work>/page/src.html`.
   It writes one fragment per option to `<work>/build/`. Rerun `build.py`, which
   inlines each fragment at the end of its option. This step is required. Skip it
   only when no option touches the system (copy or layout only): then write one
   line on why to `<work>/no-build-shape.txt`.
8. **Check.** `python3 scripts/check.py <work>/page/index.html` catches banned words,
   dead links, external requests and a missing brief, entry point, Sends line,
   fold or appendix, and flags unearned muted text, banners, blank icons and
   off-scale spacing. It also fails when build shapes are missing (with no skip
   note), stale, or showing by default. Then render it with
   `agent-browser` (headless Chromium) at 1280px and 390px and click every path in
   every option. Screenshot every screen and confirm no icon is blank. Confirm
   the build shapes are hidden on load, then turn on "Show how it's built" and
   screenshot them too. Fix anything clipped, overlapping, dead or off-system.
9. **Review.** One round with a subagent that reads only the page, the ticket,
   `reference/review-lens.md`, `reference/wireframe-build.md` and
   `docs/product-design.md`. It clicks every path, answers every question in the
   review lens against the page, checks the options are distinct and the copy
   rules hold, and fixes what it finds. It flags any option that changes an
   existing system (lists, filters, outreach) the ticket doesn't ask to change.
   Don't let it pull the options toward each other.
10. **Publish** with the `artifacts` skill (`.claude/skills/artifacts/SKILL.md`):
   `.claude/skills/artifacts/scripts/publish.sh <work>/page <feature>-options`, for
   example `import-contacts-options`.
   Pass `--update` when you republish.
11. **Post back.** Comment on the ticket (and reply in the Slack thread, if one
   asked) with the artifact link, the same link with `?build` for engineers,
   one line per option, the feedback we want, the new
   components each option needs (or "None"), the skip line from
   `no-build-shape.txt` if there is one, and every "Unknown" from the brief
   as a question for a person. Add any cheap
   variants worth testing later. Say that viewing needs a Good Party Vercel
   sign-in.

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
5. Any change to an option reruns `build-shape` in UX mode for that option, then
   `build.py`. `check.py` fails on a stale build shape, so it can't be published.
6. Every republish runs the same check (step 8) and review (step 9) as the first
   one. A revision that skips them drifts: the phone frame and fold go missing.
   Say in the post-back that both ran.
7. Post which screens are today's and which are new, and ping the Slack thread.

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
  screen, and there's a way back and a person to reach on every step.
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
