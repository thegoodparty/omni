---
name: gp-design
description: The one way in for design work in omni. Takes a task in plain words or a ClickUp ticket and returns either one design or three options to pick from, built only from the design system and checked against the rulebook. Use when someone asks to design, mock up, prototype or explore a screen, flow or feature, with or without a ticket.
---

# GP design

One command for any design task. This skill keeps no design rules of its own: it
decides what to make, sends the work to the right place, and checks the result
against the docs that own the rules.

Every run goes in this order: prototype (read the task, rules, code and prior
art, write the brief), design (build the clickable phone and desktop flows
from the design system and pass the checks), review (the senior design
review), fix (apply its findings), present (hand it back per §4). Pattern
research across other products is a separate skill, not part of this one.

## The rules come from the repo

Read these before designing, every time. Never restate a rule here; point to the
doc, so a change there reaches the next design with no edit to this skill.

- `docs/product-design.md`: the rulebook. Flows, pages vs overlays, states,
  layout, type and color, mobile, and "Before you design: a feature reaches the
  whole product".
- `packages/styleguide/COMPONENTS.md`: which component for which job.
- `docs/design-memory/learned.md`: rules earned from past corrections.
- `docs/design-memory/fixtures.md`: the standard people, places and mock data.
- `docs/product-copy.md` and `docs/product-vocabulary.md`: copy, and Win vs Serve
  words.

## 1. Take the task

The user gives a ClickUp ticket, a plain description, or both, plus anything
that helps. A ticket is never required. Use each kind of input for what it is:

- **Notes and transcripts:** decisions and context. A decision stated there is
  binding, like the designer's direction.
- **Screenshots, diagrams and flow sketches:** the structure and the flow to
  follow. The look still comes only from our components.
- **Existing prototypes** (a teammate's, a Claude Design canvas): the
  direction. Rebuild it from the design system; every difference goes in
  What changes from today, and every part with no component is a gap.
- **Examples from other products:** a pattern to borrow, never a look to copy.
  The brief says what was taken from each and why.
- **Findings from another skill** (pattern research, a product brief, an
  earlier audit): read them before the brief and cite them in it.

Make one design unless the ask says options, explore or compare, or the
trigger is a ticket moved to Committed; then make three options. Ask only when
that is unclear.

Ask only what you can't find in the ticket, the code or the docs, in one message:

- **Win, Serve or both?** The answer goes on the page's `<main>` as
  `data-product="win"`, `"serve"` or `"both"` ("Win and Serve" in
  `.claude/skills/ux-review-options/reference/wireframe-build.md`). When the
  answer is one product but the code is shared with the other (a component
  both mount), the brief states what the change does to the other product.
- **Where does the user start?** The screen and the thing they tap.

Never ask the user for the measurement baseline: `ux-review-options` step 4
says where it comes from.

## 2. Make it

Run the `ux-review-options` skill
(`.claude/skills/ux-review-options/SKILL.md`) with the ticket or the
description, through step 9, then publish and post back per §4 here.

- **Options.** Steps 1 to 9 as written: three different approaches on one
  clickable page.
- **One design.** As its "One design" section says, which lists the
  three-option rules that don't apply. Steps 1 to 4 as written; step 5 for
  the one design; steps 6 to 9 with
  `.claude/skills/ux-review-options/assets/page-template-one.html`.

Every design has a phone flow and a desktop flow: "Phone first" in
`.claude/skills/ux-review-options/reference/wireframe-build.md`.

When the user wants it in the product instead (a working prototype in
gp-webapp), build it there and follow `packages/gp-webapp/AGENTS.md`. The same
rules apply: only components from `COMPONENTS.md`, through their documented
props.

## 3. Check before showing

These checks run inside steps 1 to 8 of `ux-review-options`, against the docs
above, not your memory of them:

- Step 1: list `docs/adr/`, active and superseded records.
- Steps 4 and 5: every ticket claim checked against the code, and each clause
  of the designer's direction mapped to the screen that delivers it.
- Step 8, the reviewer: every element has a source, copy, people and data
  from `fixtures.md`, and every rule in `learned.md`.
- Where a rulebook vs code conflict goes: "Existing screens" item 2 in
  `.claude/skills/ux-review-options/reference/wireframe-build.md`.
- After step 9, always: the senior design review in
  `reference/senior-review.md`. A fresh subagent reviews the page once; fix
  its findings right away, without asking and without a second review.
  Nothing is published or shown before the fixes are in.

## 4. Hand it back

After step 9 and the senior design review, publish the page per `ux-review-options` step 10 and give the
link, plus the same link with `?view=phone` and with `?view=desktop`. The main
link always shows Phone and Desktop side by side. If the person asked not to
publish, give the local path to `index.html` instead (for a prototype in gp-webapp, the branch and route). Add one line on
what it is, the gaps and proposed components (or "None"), and every open
question for a person. Add what the review found and fixed, anything left
unfixed and why, and its "Skill feedback". What goes in `#questions` and how it is ranked:
`ux-review-options` step 4. When there is a ticket, post back per step 11,
unless the person asked not to post.

## When someone corrects the design

A correction that settles how something should work or look goes to the doc
that owns it, not to this skill: `docs/product-design.md`, `learned.md`,
`product-copy.md`, or the component's `@summary` (which regenerates
`COMPONENTS.md`). Open that PR, or say which doc needs it.

## When you change this skill

After any change to this skill or to `ux-review-options`, rerun the fixed
tasks in `reference/eval-tasks.md` and compare with the last run, as it says.
