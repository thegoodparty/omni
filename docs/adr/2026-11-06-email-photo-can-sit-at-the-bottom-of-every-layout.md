---
title: Email layouts shape content but never refuse it, and a photo can sit at the bottom of any layout
status: active
decided_by: [eugenebazdyriev]
date: 2026-11-06
code: ['fix/email-outreach-fixes']
scope:
  - packages/contracts/src/outreach/EmailBlock.schema.ts
  - packages/contracts/src/outreach/EmailContent.schema.ts
  - packages/contracts/src/outreach/EmailLayoutPreset.const.ts
  - packages/contracts/src/outreach/EmailContent.examples.ts
  - packages/gp-api/src/emailOutreach/templates/**
  - packages/gp-webapp/app/dashboard/outreach/v2/email/emailForm.util.ts
supersedes: [2026-11-02-email-layouts-shape-content-but-never-refuse-it.md]
superseded_by:
---

# Email layouts shape content but never refuse it, and a photo can sit at the bottom of any layout

## Decision

An outreach email stays `{ layout, theme, subject, previewText?, blocks }`, with `blocks` an ordered list of `heading`, `paragraph`, `image`, `button` and `divider` (`EmailContentSchema` in contracts). A layout is a visual treatment plus guidance, never validation. Content valid in one layout is valid in all three (`short_cta`, `long_update`, `personal_letter`).

The checks every email gets, in every layout (`checkEmailBlocks` and the block schemas): a subject, at least one paragraph to send, at most one image and at most one button, `https` links (a button's link is required once it has a label), plain text with only `{{first_name}}` and `{{last_name}}` merged, the field lengths, 30 blocks and 15,000 characters of text.

Each preset in `EMAIL_LAYOUT_PRESETS` keeps its usual blocks and guidance, which the layout's `.describe()` hands to an agent drafting for it. Nothing reads them as rules.

Each layout's renderer draws every block it is given. `short_cta` puts its button on the theme band wherever it sits in the list; `long_update` puts its first level 1 heading in the masthead; `personal_letter` draws every block in the order given.

What changed: the sender places the photo, at the top or at the bottom, in every layout. A photo that comes after a paragraph or the button is at the bottom, and every layout draws it last, before the footer (full width in `short_cta` under the band and in `long_update` under the text, inset in `personal_letter`). A photo before any paragraph keeps the layout's top placement: edge to edge above the text in `short_cta`, under the masthead in `long_update`.

The footer stays system-owned: gp-api adds it to every send.

## Context

The record this replaces let only `personal_letter` place its photo; `short_cta` and `long_update` lifted the image to the top wherever it sat. The write step now has Move to bottom on the photo in every layout, and the preview has to match it. Stored drafts render as before: their photo either comes first or, in a personal letter, already sits at the end.

## Alternatives rejected

- **Offer bottom only in a personal letter.** The write step comes before the layout is picked, so the control would appear and disappear with a choice made later.
- **Let the layout keep the photo at the top.** The preview would show the photo where the sender did not put it.

## Revisit if

Real sends show a bottom photo that reads badly in a layout often enough to warrant a design change.
