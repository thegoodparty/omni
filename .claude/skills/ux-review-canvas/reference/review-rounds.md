# Review rounds

A first draft of the three options always has drift: boards that don't match their
flows, a door that opens on the wrong step, chrome that differs from board to board,
copy that breaks the product rules. Review rounds catch it before people see it.

## How to run a round

1. Write `<work>/REVIEW-BRIEF.md` once and append to it after each round. It holds
   the scenario and sample values (from `docs/design-memory/fixtures.md`), the
   product rules for this ticket, the tools, and every canvas-wide decision so far.
   Reviewers read it first, so a decision made in round 2 holds in round 4.
2. Give each option (its wireframe and spec) to one subagent, and the entry boards
   to the reviewer of option A. Disjoint so no two reviewers edit the same file.
3. Each reviewer reads the brief, `kit.md`, `flow-spec.md`, the Overview and every
   earlier round log. Then for each board: click through every path in a headless
   render, fix what's wrong in place, and run `check_boards.py`.
4. Each reviewer writes `<work>/reviews/r<N>-<group>.md`: changes by file, then
   "Seen but not fixed". Their reply lists files changed and new heights.
5. You rebuild what's generated (`flowstrip.py`, then `build_canvas.py`), take a
   contact sheet of every option's first screen (`render.py shot` and `sheet`), and
   write the cross-board decisions into the brief for the next round.

Two rounds is the floor. Run a final consistency pass with every option's flow and
first screen on one contact sheet, so reviewers compare their boards against all of
them, not just the kit.

## What reviewers check

- **Flow matches wireframe:** same steps, order, headings, branches and doors.
- **Start states:** each `#from=<key>` opens on the step the spec says, prefilled
  as `knows` says. Restart returns there.
- **Kit and chrome:** the same top bar, buttons, type sizes and logo as the other
  boards. Nothing outside the kit's palette.
- **Product rules:** the ones in the brief, plus `docs/product-copy.md`,
  `docs/product-vocabulary.md` and `docs/design-memory/learned.md`.
- **Never stuck:** every path ends at the landing state or has a way forward and a
  person to reach.
- **Facts:** anything the boards claim about today's product is true in the code.
  Check the code, not the ticket.
- **Accessibility:** 44px targets, 4.5:1 contrast, labels, focus return from panels,
  reduced motion, and no horizontal scroll at 390px.
- **Distinct:** each option stays its own model. Reviewers make each one the best
  version of itself. They don't pull options toward each other or toward the safest
  one.
- **Height:** measure the tallest state at design width and set `$preview` and the
  root `min-height`. Clipped content is the most common thing people notice first.

## Rendering for review

- `render.py shot` with `--hash from=<key>` to see a start state.
- To reach later states, add a click script before `</body>` in a copy under
  `<work>/.render/`, never in the real board.
- Headless Chrome won't lay out narrower than 500px. For 390px, load the board in a
  390px iframe on a test page in `.render/`.
- Always render with reduced motion (the scripts do), or entrance animations hide
  content in screenshots.
