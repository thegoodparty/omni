---
title: Email content is typed blocks; layouts are presets
status: active
decided_by: [stephtea]
date: 2026-10-30
code: ['#3470']
scope:
  - packages/contracts/src/outreach/EmailBlock.schema.ts
  - packages/contracts/src/outreach/EmailContent.schema.ts
  - packages/contracts/src/outreach/EmailLayoutPreset.const.ts
  - packages/contracts/src/outreach/EmailContent.examples.ts
  - packages/gp-api/src/emailOutreach/templates/**
supersedes: []
superseded_by:
---

# Email content is typed blocks; layouts are presets

## Decision

An outreach email is `{ layout, theme, subject, previewText?, blocks }`, where `blocks` is an ordered list from a closed set of eight types: `heading`, `paragraph`, `image`, `button`, `details`, `section`, `signature`, `divider` (`EmailContentSchema` in contracts). A layout is a preset, not a template: a starting arrangement of blocks, structure rules (`checkEmailLayout`) and a visual treatment. The three presets are `short_cta` (optional photo, one headline, one or two short paragraphs, one big button last), `long_update` (masthead, intro, 2 to 6 sections) and `personal_letter` (paragraphs ending in one signature, no headings or photos). Every theme in `EMAIL_THEMES` works with every layout. `EmailContentSchema`, with `.describe()` text on every field, checks what is sent and what an AI agent returns, so an agent can draft a whole email the way other channels produce structured drafts. The editor saves through `EmailContentDraftSchema`: the same blocks and rules, except that text and links may be empty and a required block may still be missing.

The footer (paid-for-by, postal address, why the reader is getting it, unsubscribe) is not a block. gp-api adds it to every send, so no author or agent can remove or edit it.

## Context

Drafts had fixed fields (subject, headline, body, image, button) and three layouts (`newsletter`, `reminder`, `call_to_action`) that rendered nearly the same email. Stephen and Bryan want layouts that look clearly different, without designing for specific cases before we know what candidates and officials will send. A Chief of Staff conversation should be able to turn progress on issues into a constituent update in one step.

Text stays plain (line breaks only) and only `{{first_name}}` and `{{last_name}}` merge, because the gp-api renderer escapes every other brace for SES's Handlebars templates. Links must be `https`. The schema stores them as typed, so the renderer still runs `protectUrl` on every one. The upload flow's check that an image is ours (`assertEmailImageUrl`) covers only the old `imageUrl` today; step 2 applies it to `image.url`, `section.image.url` and `signature.photoUrl`.

Rollout:

- Step 1 (this record): the contracts schema, the presets and example drafts. Nothing reads them yet.
- Step 2: a renderer per block and a treatment per layout in `templates/`, a JSON column on `OutreachEmail` (schema-only migration), and the compose block editor. Email is at 0% in prod, so only dev drafts use the old fields. They are mapped to blocks in code when loaded (headline to heading, body to paragraph, image, button), with no data migration. The old columns and `EMAIL_LAYOUTS` are deleted once nothing reads them.
- Step 3: AI and agent drafting return `EmailContent`, using `EMAIL_CONTENT_EXAMPLES` as few-shot examples.

## Alternatives rejected

- **More fixed-field layouts.** Each new layout needs new columns, and an agent can't express "three updates and a sign-off".
- **A free-form drag-and-drop builder.** Hard to keep good-looking and accessible across Gmail, Outlook and Apple Mail, and nothing to steer an agent toward an email that works.
- **Arbitrary HTML or markdown.** Breaks the brace escaping and the dark-mode rules the renderer depends on, and opens injection paths.
- **Custom fonts.** Unreliable in email clients; themes cover color only.

## Revisit if

Real sends show authors fighting the presets, such as wanting sections in a short email, or a fourth shape keeps coming up.
