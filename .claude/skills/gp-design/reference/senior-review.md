# Senior design review

Every `gp-design` run ends with this review, after `ux-review-options` step 9
and before anything is published or shown. It is a fresh subagent that did not
build the page, so it judges the result, not the intent.

## Brief for the reviewer

Give the subagent this brief, with the paths filled in:

> You are a senior product designer at GoodParty reviewing a design an agent
> just built. Be rigorous and independent; don't assume it's good. Do not
> edit anything.
>
> Read the rules: `docs/product-design.md` (the whole file),
> `packages/styleguide/COMPONENTS.md`, `docs/design-memory/learned.md`,
> `docs/design-memory/fixtures.md`, `docs/product-copy.md`,
> `docs/product-vocabulary.md`, and `docs/adr/`. Read the skill that built it:
> `.claude/skills/gp-design/` and `.claude/skills/ux-review-options/`. Read the
> task: `<ticket text, the designer's direction, and any notes>`. Read the
> output: `<work>/page/index.html` and the screenshots in `<work>/screens/`;
> render it at the widths in `docs/product-design.md` §10 (375 and 1280, once
> at 1023 and 1024, and 320 with no sideways scroll), check the fold at
> 375x812. Click through the phone frame and Desktop preview;
> `?view=phone&step=<key>` and `?view=desktop&step=<key>` open one screen
> alone. Read today's code for every screen the design copies or changes. Compare it
> against the reference screens in `docs/product-design.md` §13 for the same
> kind of screen.
>
> Review it the way a senior designer would. Does it solve the task and follow
> every clause of the designer's direction? Does it follow the rulebook and the
> design system, built only from existing components through their documented
> props, with no undeclared restyles and no hardcoded colors, sizes or
> spacing? Check every declared mutation (the Mutations list): is there an
> existing product solution it duplicates, and is there really no component?
> Any undeclared visual override or hardcoded value is a Do. Is every copied
> screen faithful to today's product? Does it hold up
> on a phone and on desktop? Are the hierarchy, copy and every state (empty,
> loading, AI working, error, filled) right? Hover, focus and disable every
> control the design adds or changes, and screenshot each: a static screenshot
> never shows them. Is nothing invented? Are the open
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
2. Rebuild, then rerun `ux-review-options` steps 7 to 9: the check, the step 8
   review and `build-shape`, because any edit to the option makes the build
   shape stale. The step 8 rerun fixes only what the senior review fixes
   broke; it never undoes a senior review fix.
3. One review round only. Don't ask the person before fixing and don't run
   the review again: fix, rebuild, pass the check, and hand back. List anything
   from list A you didn't fix, and why, in the hand-back.
4. List B goes in the hand-back under "Skill feedback". Don't edit the skill
   during a design run; the person decides whether it becomes a PR.
