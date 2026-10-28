---
name: ux-review-options
description: Produce 3 distinct design options for a feature ticket as one clickable wireframe page, published to a private Vercel artifact link. Use when a ticket moves to Committed (the Delegate trigger) or when someone asks for UX options, wireframes or a design review for a ticket, so the team can pick the UX direction before agents build it. Replaces ux-review-canvas.
---

Produce three design options for a feature, as one page the team can open, click
through and comment on. The user gives you a ticket (ClickUp URL) and any docs,
meeting notes or transcripts behind it.

This replaces `ux-review-canvas`. Same goal. No Claude Design, a short brief
instead of an overview page, and three options instead of eight to twelve.

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

That is all. If the ticket reaches the feature from more than one place, start on
the most common entry point and name the others in the comment you post back.
Don't build a board per entry point.

## Look: wireframe feel, real design system

Designs read as wireframes and are built from our design system.

- **Wireframe feel:** structure, flow and copy are what's under review. Neutral
  surfaces, no imagery (a labeled gray box stands in for a photo or chart), no
  decorative illustration, gradients or shadows, no brand flourishes. Real words
  everywhere, never lorem ipsum or `[BRACKETS]`.
- **Real components:** buttons, inputs, cards, badges, tabs, dialogs, steppers and
  the rest come from `packages/styleguide`, with its real variants, sizes and
  tokens. Don't invent a new button style.

How to build that, with the token and component mapping, is in
`reference/design-rules.md`. Read it before you build.

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
   notes. Then read the code the feature touches: routes, modals, emails, the data
   it stores. Today's behavior is the starting point for the close-to-today option,
   and code facts often kill or reshape an option. Find the entry point: the route
   and the button or link that starts the flow today.
2. **Write the brief.** Answer the questions in `reference/review-lens.md` from the
   ticket, the code and, if you have it, Amplitude (device split, baseline). Write
   "Unknown" where you can't answer, never a guess. If this turns out to be a
   product or marketing problem rather than a design one, say so in the post-back.
3. **Pick three options.** Think about how other products solve the same job (form,
   one question at a time, conversation, human-led, calendar, checklist,
   invitation, agent workspace, search). Pick three that are each a different
   model. Write the one-sentence description and the Sends line for each before
   you build.
4. **Build the page.** Copy `assets/page-template.html` to
   `<work>/page/src.html`, fill in the three options, then run
   `python3 scripts/build.py <work>/page/src.html <work>/page`. It inlines the
   design tokens and component CSS and writes `index.html`.
5. **Check.** `python3 scripts/check.py <work>/page/index.html` catches banned words,
   dead links, external requests and a missing brief, entry point, Sends line or
   fold. Then render it with `agent-browser` (headless Chromium) at 1280px and
   390px and click every path in every option. Fix anything clipped, overlapping,
   dead or off-system.
6. **Review.** One round with a subagent that reads only the page, the ticket,
   `reference/review-lens.md` and `reference/design-rules.md`. It clicks every path,
   answers every question in the review lens against the page, checks the options
   are distinct and the copy rules hold, and fixes what it finds. Don't let it pull
   the options toward each other.
7. **Publish.** `scripts/publish.sh <work>/page <slug>`, where the slug is
   `ux-<ClickUp task id>`. Rules and commands are in `reference/publishing.md`.
8. **Post back.** Comment on the ticket (and reply in the Slack thread, if one
   asked) with the artifact link, one line per option, the feedback we want, and
   every "Unknown" from the brief as a question for a person. Add any cheap
   variants worth testing later. Say that viewing needs a Good Party Vercel
   sign-in.

## Pitfalls

- **Convergence.** Rounds of fixing pull options toward the same safe middle. Each
  option should become the best version of itself, not more like the others.
- **Dead interactions.** Every button does something, Restart returns to the first
  screen, and there's a way back and a person to reach on every step.
- **Starting mid-flow.** A wireframe that opens on the feature's first screen
  leaves the reviewer asking how they got there. Open on the entry point.
- **Showing what isn't under review.** Navigation, sidebars and anything the
  feature doesn't change are labeled gray blocks, so feedback lands on the
  feature.
- **Unbuildable claims.** Don't show a prefill or an entry the code can't support
  without saying what has to change, in the comment you post back.
- **Iframes.** The Vercel comment toolbar can't see inside an iframe. Put the
  wireframes directly in the page.
- **Public repo.** This repo is public. Ticket text, meeting notes and the built
  page stay in the scratch folder and on Vercel, never committed here.
