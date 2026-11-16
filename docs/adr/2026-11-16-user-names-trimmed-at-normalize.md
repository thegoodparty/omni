---
title: User names are trimmed at normalizePersonName, not at each write path
status: active
decided_by: [agent]
date: 2026-11-16
code: ['#3844']
scope:
  - packages/gp-api/src/shared/util/strings.util.ts
  - packages/gp-api/src/users/**
  - packages/contracts/src/users/**
---

# User names are trimmed at normalizePersonName, not at each write path

## Decision

Whitespace at either end of `User.first_name` / `User.last_name` is stripped
inside `normalizePersonName`, the one function every name write already goes
through: `createUser`, `findOrProvisionByClerk` (which copies the name Clerk
holds), and `updateUser`. The Zod input schema trims too, and the sign-up form
trims before handing the name to Clerk, because Clerk keeps its own copy and
gp-api reads that copy once at first sign-in. The migration
`20261116190000_trim_user_names` cleans the rows written before this.

The trim is idempotent and lives at the choke point rather than in each caller
so a future writer cannot miss it. That is the failure this fixes: `createUser`
trimmed and the Clerk provisioning path did not, so a padded name reached the
row whenever a user's first sign-in took the second path.

## Context

A sign-up bug left 6,618 prod rows with a trailing space (5,343 first, 3,708
last; every one a plain space, none a tab or newline), and 266 more arrived in
the year after the ticket was filed, so cleaning it without closing the write
path would only have refilled it. `TRIM`-based matching in the data pipeline and the outbound
integrations that consume names compare the exact string, so the space broke
them: the linked bug was candidate names with extra spaces breaking a
Campaign Schedule Request integration. A one-shot cleanup script had shipped
earlier and been deleted as dead code without ever being run against prod, so
the residue was still there and a manual prod run was the only way to clear it.

## Alternatives rejected

- **Trim in every writer instead of the shared util.** What the code already
  did, and the reason the bug survived: one path trimmed, another did not, and
  nothing forced a new writer to trim.
- **Another hand-run prod script.** Needs someone to export a prod
  `DATABASE_URL` and run it twice; that is exactly what did not happen last
  time. A data migration runs once on deploy, the way
  `20261006180000_capitalize_lowercase_user_names` did.
- **Collapse internal whitespace too.** The 13 rows with a double space inside
  a name are indistinguishable from a deliberate two-word name ("Mary Jane"),
  so a regex here would corrupt real data to fix a cosmetic case.

## Revisit if

A name-holding table appears outside `User` (a CRM contact table of our own,
say), where this choke point does not reach and the trim has to be repeated.
