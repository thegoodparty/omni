---
name: ux-review-canvas
description: Build a UX review canvas for a feature ticket on Claude Design - an overview, every way in, and three distinct options, each a flow above a clickable wireframe in one neutral wireframe kit, plus the open questions. Use when a ticket moves to Committed (the Delegate trigger) or when someone asks for UX options, wireframes or a review canvas for a ticket, so the team can check the UX direction before agents build it.
---

Build a Claude Design canvas that lets the team review a feature's UX direction in
a few minutes, before agents build it. The user gives you a ticket (ClickUp URL)
and any docs, meeting notes or transcripts behind it.

## Why this skill exists

Agents build what a ticket says, and a ticket rarely says enough about the
experience. A quick human review of the options catches a wrong direction while it's
still cheap to change. Two things make that review work:

- **Three real options, no recommendation.** More than three is more than a person
  can take in during a quick review, so narrowing the field is your job, not the
  reviewer's. AI has a blind spot for system thinking
  and broader UX consequences, and it drifts to the safest option even when that
  option isn't good. So the canvas lays out options and trade-offs and leaves the
  call to people. Never rank, score, star or pick a winner, in any page, flow or
  label.
- **One neutral kit.** Every option uses the same plain wireframe look, so people
  compare models, not styling. Some options stay close to today's product layout;
  others are radically different layouts. Both kinds belong on every canvas.

## What the canvas holds (and nothing else)

Three pages. Don't add appendix pages, exploration boards or alternate screen sets.

1. **Overview** (`Overview.dc.html`): the problem, who it's for, how we'll know it
   worked (the metric), what today's code does that holds whichever option is built,
   the rules every option follows and what not to claim, how users reach the
   feature, a table of the options side by side (name, one line, family, layout,
   doors supported, biggest risk), what was said in meetings, and links to every
   source: the ticket and each doc.
2. **Options:** the ways in first, then the three options lettered A to C, close
   to today's product first, then new layouts.
   - **Ways in:** one entry board per door (`E-*.dc.html`) showing only its title,
     what we know about the user there, and Current vs Proposed. See
     `reference/flow-spec.md`.
   - **Each option:** a landscape flow board (`Flow-<ID>.dc.html`, generated) above
     one clickable wireframe (`W-<ID>-<Name>.dc.html`). One wireframe per option. A
     very short description, one sentence.
   - Exactly three options. At least one close to today's product and at least one
     new layout. Never add a fourth; if two candidates share a model, keep the
     stronger version of it.
3. **Questions** (`Questions.dc.html`): the questions only people can answer (product
   and system calls), then technical and architecture questions with the code
   detail beside them, file paths included.

## People and data

Use `docs/design-memory/fixtures.md`: Sarah Chen is the default Serve user (Sarah
in copy), Jared is candidate success, Maplewood is the place. Follow
`docs/design-memory/learned.md`. Sample emails use example.com and phone numbers
use 555. Never put real constituent, voter or CRM data on a board.

## Process

Work in a scratchpad folder, `<work>`, laid out as:

```
<work>/project/      the canvas files: canvas.json and every *.dc.html
<work>/specs/        one flow spec per option (<ID>.json)
<work>/doors.json    the ways in
<work>/reviews/      review round logs
<work>/.render/      render cache (render.py manages it)
```

1. **Read everything.** The ticket and its comments, every linked doc, meeting
   notes. Then read the code the feature touches: routes, modals, emails, the data
   it stores. Today's behavior is the "Current" side of every way in, and code facts
   often kill or reshape an option. Note each fact with its file path.
2. **Find the ways in** and write `doors.json`.
3. **Research the options.** Look at how other products solve the same job (forms,
   one question at a time, conversation, human-led, calendar, checklist, invitation,
   letter, agent workspace, search). Consider many, then build three: the three
   that differ most from each other while each still solving the job. At least one
   close to today's product and at least one new layout.
4. **Create the canvas.** `Artifact` with `action: "quickstart"`, `intent: "design"`,
   then create it from the Design type it names. The result tells you how to fill
   it. Read its runtime (`artifact-type/dc-runtime.js`) and run
   `scripts/render.py setup <work> <dc-runtime.js>`.
5. **Build the boards** in the kit (`reference/kit.md`): the entry boards, then each
   option's wireframe with its start states, then its spec, then
   `scripts/flowstrip.py <work>`. Then the Overview and Questions.
6. **Check and measure.** `scripts/check_boards.py [--serve] <work>/project/*.dc.html`,
   then `scripts/render.py measure` on every hand-built board. Set `$preview` and the
   root `min-height` to the measured height plus 32 to 48px. Frames clip anything
   taller, and estimates are always wrong.
7. **Review rounds.** At least two, with subagents over disjoint groups of boards
   (`reference/review-rounds.md`).
8. **Lay out and publish.** `scripts/build_canvas.py <work> "<title>"`, then publish
   `<work>/project` to the canvas URL.
9. **Share it.** The canvas starts private, and no tool can change who has access.
   Tell the person to open it, click **Share** and give the goodparty.org
   organization edit access, so anyone on the team can comment and edit. If this
   ran without a person (Delegate), put that step in the ticket comment.
10. **Post back.** Comment on the ticket with the canvas link, one line per option,
    and the top questions.

## Scripts

All in `scripts/`. Each takes `<work>` and prints its usage when run without
arguments.

| Script | Does |
|---|---|
| `render.py` | Saves the runtime, measures board heights, takes screenshots, tiles contact sheets |
| `flowstrip.py` | Builds and measures each `Flow-<ID>.dc.html` from its spec |
| `check_boards.py` | Catches what the canvas runtime fails on silently, plus banned words |
| `build_canvas.py` | Lays out `canvas.json`: the three pages, ways in, options grouped close then new |

Never hand-edit a generated `Flow-*.dc.html` or `canvas.json`. Change the spec or the
board, then rebuild.

## Pitfalls

- **Frames clip.** Measure every board after every change in height.
- **Flows drift from wireframes.** A spec written from memory is wrong. Write it
  from the board, and check it again in each review round.
- **Convergence.** Review rounds pull options toward the same safe middle. Each
  option should become the best version of itself, not more like the others.
- **Unbuildable claims.** Don't show a door or a prefill the code can't support
  without saying what has to change. That goes in Questions.
- **Private content in this repo.** This repo is public. Ticket text, meeting notes
  and canvases stay in the scratchpad and on claude.ai, never committed here.
