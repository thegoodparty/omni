---
title: On Win, imported people not in the voter file are counted next to voters as "New contacts added"
status: active
decided_by: [swain]
date: 2026-10-30
code: ['#PR']
scope:
  - packages/gp-api/src/contacts/services/contacts.service.ts
  - packages/gp-api/src/peopleDb/databricks/databricksVoterSql.util.ts
  - packages/gp-api/src/peopleDb/databricks/databricksDistrictStatsSql.util.ts
  - packages/contracts/src/people/ListDetailContacts.schema.ts
  - packages/contracts/src/people/PeopleFilters.schema.ts
supersedes: []
superseded_by:
---

# On Win, imported people not in the voter file are counted next to voters as "New contacts added"

## Decision

A Win campaign's imported people that match no voter become contacts like
any voter (searchable, on lists, reached by outreach), but they are counted
next to the voters, never inside them, as "New contacts added". For a Win
campaign whose reads join its imported contacts, `GET /v1/contacts/stats`
and both list-detail routes count voters only and return `newContactsCount`
(and `newContactsReachable` per channel) beside them, from the same
statement (`splitNewContacts`). A `source` filter (`voterFile`, `imported`)
on `PeopleFilters` and the saved `VoterFileFilter` picks one side. Serve is
unchanged: an office counts everyone together, and the filter 400s there.

This applies the read model of
`2026-10-29-import-contacts-covers-win-pro-campaigns.md` to counts.

## Context

A campaign's contacts are its district's registered voters, so an imported
row can only match a voter. Counting the unmatched rows as people made
"Voters in your district" grow past the voter file, which is false, and the
Campaign Manager called them voters on the campaign's uploaded lists. Bryan
and Swain chose option A of three (#tmp-import-contacts).

## Alternatives rejected

- **Enrich only (B).** Unmatched rows stay inside the upload and never
  become people, so a campaign could never text its own volunteers.
- **A separate group (C).** Unmatched people in their own list, out of every
  count and the default audience. More surface to explain, and a text to
  everyone would quietly skip people the campaign brought in.
- **Count them inside the voter totals with a label.** Keeps one number but
  it is no longer a count of voters.

## Revisit if

Serve needs the same split, or the voter file starts carrying people who
are not registered voters for Win.
