---
title: Email layouts shape content but never refuse it
status: superseded
decided_by: [stephtea]
date: 2026-11-02
code: ['#3512']
scope:
  - packages/contracts/src/outreach/EmailBlock.schema.ts
  - packages/contracts/src/outreach/EmailContent.schema.ts
  - packages/contracts/src/outreach/EmailLayoutPreset.const.ts
  - packages/contracts/src/outreach/EmailContent.examples.ts
  - packages/gp-api/src/emailOutreach/templates/**
  - packages/gp-webapp/app/dashboard/outreach/v2/email/emailForm.util.ts
supersedes: [2026-10-30-email-content-typed-blocks.md]
superseded_by: 2026-11-06-email-photo-can-sit-at-the-bottom-of-every-layout.md
---

# Email layouts shape content but never refuse it

## Decision

An outreach email stays `{ layout, theme, subject, previewText?, blocks }`, with `blocks` an ordered list of `heading`, `paragraph`, `image`, `button` and `divider` (`EmailContentSchema` in contracts). What changes is the layout: it is a visual treatment plus guidance, never validation. Content valid in one layout is valid in all three (`short_cta`, `long_update`, `personal_letter`).

The checks every email gets, in every layout (`checkEmailBlocks` and the block schemas): a subject, at least one paragraph to send, at most one image and at most one button, `https` links (a button's link is required once it has a label), plain text with only `{{first_name}}` and `{{last_name}}` merged, the field lengths, 30 blocks and 15,000 characters of text.

Each preset in `EMAIL_LAYOUT_PRESETS` keeps its usual blocks and guidance ("one level 1 heading", "the button last"), which the layout's `.describe()` hands to an agent drafting for it. Nothing reads them as rules.

Each layout's renderer draws every block it is given. `short_cta` puts its image above the text and its button on the theme band wherever they sit in the list; `long_update` puts its first level 1 heading in the masthead and its image under it; `personal_letter` draws headings and dividers in the order given.

The footer stays system-owned: gp-api adds it to every send.

## Context

#3470 made layouts presets with structure rules (`checkEmailLayout`): `short_cta` needed exactly one button, last, a headline, at most 600 characters in 1 or 2 paragraphs and no dividers; `long_update` needed a level 1 heading first and 2 paragraphs; `personal_letter` refused headings and dividers. The compose form mirrored those rules, hid Title in a personal letter, required the Button in `short_cta` and blocked the look step with a list of what didn't fit. On 2026-11-02 Stephen decided the rules are aesthetic: senders decide which layout fits what they wrote.

Stored drafts keep loading: every draft that met the old rules meets these, and drafts with the old fixed fields still map to their old layout's preset when they fit the block limits.

## Alternatives rejected

- **Keep the rules and explain them better.** Senders were sent back to rewrite or switch layout over choices that are theirs.
- **Loosen a few rules.** Any rule left is still an aesthetic one somebody hits.

## Revisit if

Real sends show a layout that reads badly with content it was not shaped for, often enough to warrant a design change rather than a rule.
