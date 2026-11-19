# Senior design review

Every `gp-design` run has this review once, after step 8 of
`reference/options-workflow.md` and before step 9's build shapes, so they are
built once on the final options. Nothing is published or shown before it. It is a fresh subagent that did not
build the page, so it judges the result, not the intent.

## Brief for the reviewer

Give the subagent this brief, with the paths filled in:

> You are a senior product designer at GoodParty reviewing a design an agent
> just built. Be rigorous and independent; don't assume it's good. Do not
> edit the page, the flow files or the repo; put your screenshots and any
> scripts in `<work>/senior-review/`.
>
> Read the rules: `docs/product-design.md` (the whole file),
> `packages/styleguide/COMPONENTS.md`, `docs/design-memory/learned.md`,
> `docs/design-memory/fixtures.md`, `docs/product-copy.md`,
> `docs/product-vocabulary.md`, and `docs/adr/`. Read the skill that built it:
> `.claude/skills/gp-design/`. Read the
> task: `<ticket text, the designer's direction, and any notes>`. Read the
> output: `<work>/page/index.html` and the screenshots in `<work>/screens/`;
> render it at the widths in `docs/product-design.md` §10 (375 and 1280, once
> at 1023 and 1024, and 320 with no sideways scroll), check the fold at
> 375x812. Click through the phone frame and Desktop preview;
> `?view=phone&step=<key>` and `?view=desktop&step=<key>` open one screen
> alone, `&state=<key>` in place of `&step` opens a state, and on an options
> page add `&option=b` or `&option=c`. Read today's code for every screen the design copies or changes. Compare it
> against the reference screens in `docs/product-design.md` §13 for the same
> kind of screen.
>
> Review it the way a senior designer would. Does it solve the task and follow
> every clause of the designer's direction? Read `<work>/notes/coverage.md`:
> is every clause of the ticket and the direction on it, and is each one
> really drawn on the screen it names or asked in #questions? Does any option
> reverse or drop an active ADR a person decided without a quoted task clause
> asking for it? That is a Do. Does it follow the rulebook and the
> design system, built only from existing components through their documented
> props, with no undeclared restyles and no hardcoded colors, sizes or
> spacing? Check every declared mutation (the Mutations list): is there an
> existing product solution it duplicates, and is there really no component?
> Any undeclared visual override or hardcoded value is a Do. Is every copied
> screen faithful to today's product? Does it hold up
> on a phone and on desktop? Are the hierarchy, copy and every state (empty,
> loading, AI working, error, filled) right? Does every loading or AI working
> state take the same space as the content that replaces it, so nothing
> jumps when it arrives? Read the accessibility lines from
> `scripts/flow/shoot.mjs`: one on markup the design adds is a Do; one on a
> screen copied as shipped goes under "Rulebook vs code". Hover, focus and disable every
> control the design adds or changes, and screenshot each: a static screenshot
> never shows them. Is nothing invented, and is nothing drawn that the task
> didn't ask for? Does it change a component other screens use without
> asking under Decisions needed? Are the open
> questions and the list of what changes honest, complete and ranked?
>
> Return two lists, each item tagged Do, Consider or Nit:
>
> A. Design findings: the screen or element, the problem, and the rule it
> breaks.
>
> B. Skill findings: a problem whose root cause is the skill's text,
> templates, CSS or scripts, with the file and the change that would fix it.
> Only items you are confident about; "B: none" if there are none.

## What to do with the findings

1. Fix every Do in list A, and every Consider you agree with. A finding that
   needs a person's call (a product decision, the designer's direction against
   a rule) is not fixed silently: it goes under "Decisions needed" in
   `#questions`.
2. Rebuild and rerun step 7's check. Then one fresh subagent gets list A,
   the page and the list of screens and states the fixes touched, and,
   without editing, checks only those: that each fix landed and broke
   nothing near it, and whether each Do is fixed or listed under Decisions
   needed. It does not review the rest of the page again. It returns what the fixes broke and the counts left of Do,
   Consider and Nit. Fix what it says broke, without undoing a fix; the
   counts are the "after" counts. Then go on to step 9 of
   `reference/options-workflow.md`.
3. One review round only. Don't ask the person before fixing and don't run
   the full review or step 8 again. List anything from list A you didn't fix, and why, in the
   hand-back.
4. List B goes in the hand-back under "Skill feedback". Don't edit the skill
   during a design run; the person decides whether it becomes a PR.
