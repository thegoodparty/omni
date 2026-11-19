---
title: Consent to email is affirmed at the contact import, not on each send
status: active
decided_by: [stephtea]
date: 2026-11-02
code: ['#3510']
scope:
  - packages/gp-api/src/emailOutreach/services/outreachEmailConfirm.service.ts
  - packages/gp-api/src/emailOutreach/services/outreachEmail.service.ts
  - packages/contracts/src/outreach/OutreachEmail.schema.ts
  - packages/gp-webapp/app/dashboard/contacts/crm/import/importContactsCopy.ts
  - packages/gp-webapp/app/dashboard/outreach/v2/email/**
supersedes: []
superseded_by:
---

# Consent to email is affirmed at the contact import, not on each send

## Decision

The contact import's consent box reads "These people agreed to hear from
me, including by email. I am responsible for that.", and that affirmation
(`ContactUpload.consentAffirmedAt`) is what an email send relies on.
Confirm no longer requires per-send consent, and the email flow has no
consent box. The draft save still accepts `consentConfirmed` so an older
client can save, and ignores it. `OutreachEmail.consentConfirmedAt` and
`consentConfirmedByUserId` stay as unused columns; no migration.

## Context

Only imported contacts have email addresses, so every email recipient came
through an import that already asked for consent. The import's box was
generic, which is why email asked again on every send. Asking twice for the
same people added a step to every send without a different promise behind
it.

Uploads affirmed under the old wording are not filtered out, on purpose:
contact import has not been live in prod, and no real contacts were uploaded
in dev, so no real upload was affirmed under the wording that left out
email.

## Alternatives rejected

- **Keep a per-send box.** The user repeats the same statement on every
  send for people they already vouched for at import.
- **Drop the old field from the save contract.** The save schema is strict,
  so a client still sending `consentConfirmed` would get a 400 during the
  deploy.
- **Drop the consent columns.** Not needed for the change, and dropping
  them loses the record of consent already given on past sends.

## Revisit if

Email addresses come from a source other than the contact import, such as
the voter file.
