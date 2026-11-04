---
title: The contact person sheet is one component, opened by personId
status: active
decided_by: [eugenebazdyriev]
date: 2026-11-04
code: ['#3598']
scope:
  - packages/gp-webapp/app/dashboard/contacts/crm/person/**
  - packages/gp-webapp/app/dashboard/contacts/crm/ContactsTableProvider.tsx
supersedes: []
superseded_by:
---

# The contact person sheet is one component, opened by personId

## Decision

Voter Data's person sheet (`PersonSheet` in `crm/person/PersonOverlay.tsx`)
is the one full record of a person. Its reads (the person, top issues,
activity) live in `usePersonCard(personId)`, keyed as the contacts page keys
them, and the status row reads Win or Serve from `useWinVoterContext`. So a
page without `ContactsTableProvider` opens the same sheet with a personId
(`PersonCardSheet`). The contacts page still opens it from its URL
(`PersonOverlay`), so deep links and Back work as before.

## Context

The status row, top issues and activity feed read the contacts table's
provider, so a page outside the contacts route could only show the record
without them. The import upload page opened a trimmed sheet and lost the
status row (voter likelihood, support status, opt in), which reviewers
flagged as inconsistent with the contact card.

## Alternatives rejected

- Copy the status row and activity feed into each page that needs them: two
  records that drift apart.
- Wrap other pages in `ContactsTableProvider`: it also loads the contacts
  list and segments, and selects the person from the contacts URL.
- Link out to Voter Data for the full record: the user leaves the page they
  were on.

## Revisit if

A surface needs a deliberately smaller record. The chat card and the issue
capture report keep `PersonRecord` without these parts by design.
