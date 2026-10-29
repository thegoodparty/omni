---
title: People outside the voter file get gp-api-minted uuid person ids from contact uploads
status: active
decided_by: [swain]
date: 2026-10-29
code: []
scope:
  - packages/gp-api/src/contactUploads/**
  - packages/gp-api/prisma/schema/contactUpload.prisma
  - packages/gp-api/src/peopleDb/databricks/databricksVoterSql.util.ts
supersedes: []
superseded_by:
---

# People outside the voter file get gp-api-minted uuid person ids from contact uploads

## Decision

A contact upload row that matches nobody in the org's district, or that the
user resolves to a new person, gets a person id gp-api mints: a uuid in
`contact_upload_match.person_id`, with `is_new_person` set. That id is the
person's id everywhere a person id is used (contacts, statuses, notes,
outreach recipients, the civic panel), the same as an L2 id. It reaches people
reads through the org's contact overlay, which places the person in the org's
district, so it only appears in reads of that district. The id belongs to one
org; there is no cross-org identity and no merge.

## Context

Officials upload constituents the voter file does not hold: newsletter
subscribers, meeting sign-ins, people who moved in. Every feature keys people
by a single `personId` string and already reads people from one join, so a
person needs an id of the same shape for those features to work without
per-feature changes. L2 ids are uuid-shaped, and the read path's id guard
(`idList`) accepts only uuids.

`2026-10-23-civic-panel-joins-only-from-resolved-numbers.md` removed the last
identity outside the voter file, the civic panel's public joiners. That record
still holds: a JOIN counts only from a number the send or the people data
resolves. An imported person is a person the people data now holds, so a
JOIN reply to a send that reached them resolves as it does for anyone else.

## Alternatives rejected

- **Only accept rows that match the voter file.** Drops exactly the people
  officials most want to reach.
- **A separate contact table with its own id space.** A second identity path
  every feature would have to learn, which the civic panel record removed for
  the same reason.

## Revisit if

The product adds merge or cross-org identity for imported people.
