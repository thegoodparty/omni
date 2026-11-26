---
title: The photo_letter email is a fixed structure with two photos and a signature, beside the original layouts
status: active
decided_by: [eugenebazdyriev]
date: 2026-11-25
code: []
scope:
  - packages/contracts/src/outreach/EmailBlock.schema.ts
  - packages/contracts/src/outreach/EmailContent.schema.ts
  - packages/contracts/src/outreach/EmailLayoutPreset.const.ts
  - packages/contracts/src/outreach/EmailTemplate.const.ts
  - packages/contracts/src/outreach/EmailContent.examples.ts
  - packages/contracts/src/outreach/OutreachEmail.schema.ts
  - packages/gp-api/src/emailOutreach/templates/**
  - packages/gp-api/src/emailOutreach/services/outreachEmailGeneration.service.ts
  - packages/gp-api/src/emailOutreach/services/outreachEmailProfile.service.ts
  - packages/gp-webapp/app/dashboard/outreach/v2/email/emailForm.util.ts
supersedes: [2026-11-06-email-photo-can-sit-at-the-bottom-of-every-layout.md]
superseded_by:
---

# The photo_letter email is a fixed structure with two photos and a signature, beside the original layouts

## Decision

A new layout preset, `photo_letter`, has one fixed order, top to bottom: photo, headline (a level 1 heading), text, photo, text, button, signature. Every part is optional except the first text, and none is reordered or repeated. Unlike every other preset, this one is checked: `EMAIL_LAYOUT_PRESETS.photo_letter.structure` lists the slots, and `checkEmailBlocks(blocks, layout)` refuses blocks that do not fill them in order (no level 2 headings, no dividers).

Only `photo_letter` takes two photos and the new `signature` block (`name`, optional `office`, optional `imageUrl`, and `profileUrl`). gp-api, not the client, sets `profileUrl` at save, preview, test send and prepare: the organization owner's live public profile page (`/people/<slug>` on `WEBAPP_ROOT_URL`, through `PublicProfileAddressService`), or empty when there is none, and the link is left out. The schema accepts only https on goodparty.org, www.goodparty.org and dev.goodparty.org, the hosts `WEBAPP_ROOT_URL` takes. The other presets keep at most one photo and refuse a signature. At most one button and at least one paragraph stay the rule everywhere. The system footer is unchanged and still added by gp-api.

The template colors are eight new theme keys (`slate`, `burgundy`, `pink`, `orange`, `indigo`, `halo_green`, `cyan`, `lavender`; `cyan` is the preset's default). The color fills the button and the profile link, text stays neutral, and the page is the color at 9% on white, precomputed to hex. They sit in `EMAIL_THEMES` beside the six original keys, which stay as they are.

The original presets (`short_cta`, `long_update`, `personal_letter`) and their renderers do not change, so every saved and sent email renders byte for byte as before (a snapshot test holds this). The shipped editor offers only the original presets and themes (`EMAIL_CLASSIC_LAYOUT_PRESETS`, `EMAIL_CLASSIC_THEMES`).

The AI draft for `photo_letter` writes both texts in one request (`body` and `body2`), so they read as one message.

## Context

The new email editor is a fixed form, not a block list: the designer's structure has a second photo between two texts and a signature block with a profile link, and nothing moves. The 2026-11-06 record made every layout a treatment that never refuses content and capped every email at one photo, which this structure breaks. Sends store only the layout and theme keys plus blocks, so changing an existing preset or theme in place would change emails already sent.

## Alternatives rejected

- **Rewrite the three presets into the new structure.** Saved drafts and sent emails would render differently, and the shipped editor would break.
- **Replace `EMAIL_THEMES` with the eight new colors.** Theme keys are stored on sends; removing or editing one changes or breaks old emails.
- **Let the new preset take blocks in any order, like the others.** The editor has no reordering, so an out-of-order email could only come from a bug or an agent, and the preview would not match the form.
- **Two AI requests, one per text.** The texts would not read as one message and the draft would take twice as long.

## Revisit if

The original presets are retired: the classic lists, their layouts and the one-photo rule can then go.
