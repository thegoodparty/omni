---
name: ux-review-options
description: Produce 3 distinct design options for a feature ticket as one clickable wireframe page, published to a private Vercel artifact link. Use when a ticket moves to Committed (the Delegate trigger) or when someone asks for UX options, wireframes or a design review for a ticket, so the team can pick the UX direction before agents build it. Replaces ux-review-canvas.
---

Produce three design options for a feature, as one page the team can open, click
through and comment on. The user gives you a ticket (ClickUp URL) and any docs,
meeting notes or transcripts behind it.

This replaces `ux-review-canvas`. Same goal. No overview page, no Claude Design,
and three options instead of eight to twelve.

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
  layout and at least one a different layout paradigm.

## What the artifact holds (and nothing else)

One static page, `index.html`, with three sections: `#option-a`, `#option-b`,
`#option-c`. No overview, no ways-in boards, no flow diagrams, no questions page.
Each option has:

1. A name (two or three words, for example "Review sheet") and one sentence on what
   the user experiences.
2. One clickable wireframe of the full flow, from the first screen to the landing
   state, in a frame at the right width (desktop or 390px phone).

That is all. If the ticket reaches the feature from more than one place, make the
wireframe's start screen match the most common one and say the others in the
comment you post back. Don't build a board per entry point.

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
in copy), Jared is candidate success, Maplewood is the place. Follow
`docs/design-memory/learned.md`, `docs/product-copy.md` and
`docs/product-vocabulary.md`. Sample emails use example.com and phone numbers use
555. Never put real constituent, voter or CRM data on the page.

## Process

Work in a scratch folder outside any repo, `<work>/`, and keep the page in
`<work>/page/`.

1. **Read everything.** The ticket and its comments, every linked doc, meeting
   notes. Then read the code the feature touches: routes, modals, emails, the data
   it stores. Today's behavior is the starting point for the close-to-today option,
   and code facts often kill or reshape an option. If the feature changes a screen
   that exists today, find that screen's source (page, sheets, nav, copy labels) and
   rebuild it from the code before you design the change. Rules in
   `reference/design-rules.md`, "Existing screens".
2. **Pick three options.** Think about how other products solve the same job (form,
   one question at a time, conversation, human-led, calendar, checklist,
   invitation, agent workspace, search). Pick three that are each a different
   model. Write the one-sentence description for each before you build.
3. **Build the page.** Copy `assets/page-template.html` to
   `<work>/page/src.html`, fill in the three options, then run
   `python3 scripts/build.py <work>/page/src.html <work>/page`. It inlines the
   design tokens and component CSS and writes `index.html`.
4. **Check.** `python3 scripts/check.py <work>/page/index.html` catches banned words,
   dead links and external requests. Then render it with `agent-browser` (headless
   Chromium) at 1280px and 390px and click every path in every
   option. Fix anything clipped, overlapping, dead or off-system.
5. **Review.** One round with a subagent that reads only the page, the ticket and
   `reference/design-rules.md`. It clicks every path, checks the options are
   distinct and the copy rules hold, and fixes what it finds. Don't let it pull the
   options toward each other.
6. **Publish.** `scripts/publish.sh <work>/page <slug>`, where the slug is
   `ux-<ClickUp task id>`. Rules and commands are in `reference/publishing.md`.
7. **Post back.** Comment on the ticket (and reply in the Slack thread, if one
   asked) with the artifact link, one line per option, and anything the page
   assumes that a person needs to confirm. Say that viewing needs a Good Party
   Vercel sign-in.

## Pitfalls

- **Invented screens.** When a design shows something that exists in the product
  (a page, a panel, the navigation, a wizard), replicate it faithfully from its
  source: same layout, same components, same labels, same navigation pattern. A
  reviewer who can't recognize today's screen can't judge the change. Never add a
  navigation pattern the product doesn't have (a "Back to X" link in a page body, a
  tab strip, a side sheet where the product uses a full-height drawer).

- **Convergence.** Rounds of fixing pull options toward the same safe middle. Each
  option should become the best version of itself, not more like the others.
- **Dead interactions.** Every button does something, Restart returns to the first
  screen, and there's a way back and a person to reach on every step.
- **Unbuildable claims.** Don't show a prefill or an entry the code can't support
  without saying what has to change, in the comment you post back.
- **Iframes.** The Vercel comment toolbar can't see inside an iframe. Put the
  wireframes directly in the page.
- **Public repo.** This repo is public. Ticket text, meeting notes and the built
  page stay in the scratch folder and on Vercel, never committed here.
