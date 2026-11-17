---
name: gp-design
description: The one way in for design work in omni. Takes a task in plain words or a ClickUp ticket and returns either one design or three options to pick from, built only from the design system and checked against the rulebook. Use when someone asks to design, mock up, prototype or explore a screen, flow or feature, with or without a ticket.
---

# GP design

One command for any design task. This skill keeps no design rules of its own: it
decides what to make, sends the work to the right place, and checks the result
against the docs that own the rules.

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

The user gives a ClickUp ticket, a plain description, or both, plus any notes,
transcripts or screenshots. A ticket is never required.

Ask only what you can't find in the ticket, the code or the docs, in one message:

- **One design or options?** One design when the direction is settled. Three
  options when the team still has to pick a direction.
- **Win, Serve or both?** When the answer is one product but the code is
  shared with the other (a component both mount), the brief states what the
  change does to the other product.
- **Where does the user start?** The screen and the thing they tap.

Never ask the user for the measurement baseline. Try the `query-analytics-data`
skill (`amp` CLI), then the Amplitude MCP; if neither is reachable, write
"Unknown" and put it in `#questions` and the hand-back. When the feature has
no traffic yet, use a sibling flow's numbers as a proxy, per
`ux-review-options` step 4.

## 2. Make it

**Options.** Run the `ux-review-options` skill
(`.claude/skills/ux-review-options/SKILL.md`) with the ticket or the
description. It builds three different approaches as one clickable page and
publishes it.

**One design.** Run the `ux-review-options` pipeline as its "One design"
section says, which lists the three-option rules that don't apply:

- Steps 1 to 4 as written: read everything, find the prior art, pass the source
  gate, write the brief.
- Step 5 for the one design, as that "One design" section says.
- Steps 6 to 9: build the page from `assets/page-template-one.html`, check,
  review, then `build-shape` and the final check.
- Publish (step 10) and post back (step 11) as §4 here says.

When the user wants it in the product instead (a working prototype in
gp-webapp), build it there and follow `packages/gp-webapp/AGENTS.md`. The same
rules apply: only components from `COMPONENTS.md`, through their documented
props.

## 3. Check before showing

Before the user sees anything, check the result against the rulebook, not your
memory of it:

- Every element has a source, per "Every design shows what it's built from" in
  `docs/product-design.md` §7. A part with no source is a gap: list it as a
  proposal, never hand-roll it.
- Copy passes `docs/product-copy.md` and `docs/product-vocabulary.md`.
- People and data come from `fixtures.md`. No real voter, constituent or CRM data.
- Every rule in `learned.md` holds.
- Every claim the ticket makes about today's product matches the code. List
  each mismatch as an open question.
- Map each clause of the designer's direction to the screen that delivers it.
  Any clause not delivered as written goes in What changes from today or
  Decisions needed.
- When the brief's data shows desktop as a large share, or the direction asks
  for a side-by-side layout, include a static desktop frame, per "Phone first"
  in `.claude/skills/ux-review-options/reference/wireframe-build.md`.
- Where the rulebook and the shipped code disagree, copy the code on a screen
  the design leaves unchanged, and list the conflict. In a new or changed step,
  a sibling that breaks a rule is not copied: the rule wins
  (`docs/product-design.md` §7), and the difference is listed too. The rule
  wins only for the parts the design changes. Shared shell and chrome the
  ticket doesn't change (the flow footer, the header) are copied as shipped,
  even on a changed step, and listed under "Rulebook vs code", unless the
  rulebook ties fixing that gap to changing the flow (`docs/product-design.md`
  §3, "move it to a page"); then it goes under Decisions needed.
- List `docs/adr/`. For each active record whose scope the design touches and
  would reverse or weaken, put its title and `decided_by` in `#questions`.
  Also read superseded records whose subject the design touches, and list
  relevant history (an approach rejected before) in `#questions`. For a
  design with no code change, that is enough. Any code change that
  implements it follows "Check before you change" in the root `AGENTS.md`:
  when a human decided the record, stop and confirm with them first.

## 4. Hand it back

Publish the page per `ux-review-options` step 10 and give the link. If the
person asked not to publish, give the local path to `index.html` instead (for a
prototype in gp-webapp, the branch and route). Add one line on what it is, the
gaps and proposed components (or "None"), and every open question for a person.
`#questions` on the page and in the post-back holds two lists: "Decisions
needed" (every Unknown, ticket claim the code doesn't match, ADR reversal and
decision for a person) and "Rulebook vs code (copied, no action)". Before you
list a decision, answer it yourself if the rulebook, `learned.md` or the
designer's direction already does, and name the rule. When the designer's
direction and a rule disagree, neither answers it: list it under Decisions
needed with both sources. Rank "Decisions needed"
with the ones that block the build first, and keep only what a person must
decide. When there is
a ticket, post the same on it, unless the person asked not to post.

## When someone corrects the design

A correction that settles how something should work or look goes to the doc
that owns it, not to this skill: `docs/product-design.md`, `learned.md`,
`product-copy.md`, or the component's `@summary` (which regenerates
`COMPONENTS.md`). Open that PR, or say which doc needs it.
