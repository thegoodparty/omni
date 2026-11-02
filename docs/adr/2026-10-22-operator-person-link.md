---
title: An operator can link an unlinked gp-api user to a live civics person
status: active
decided_by: [agent]
date: 2026-10-22
code: ['#3124']
scope:
  - packages/gp-api/src/personProfiles/**
supersedes: []
superseded_by:
---

# An operator can link an unlinked gp-api user to a live civics person

## Decision

`User.person_id` is normally written only from the data platform's link
(`person.gp_api_user_id`, read by `PersonIdBackfillService`). An admin or M2M
caller can now also set it through `POST /v1/person-profiles/links`, naming the
actor. The route only links a user who has no link, to a person that exists and
is not retired, that no other user holds. Moving an existing link stays with the
drift sweep, which carries the profile, takedown and claim rows along with it.

## Context

The person mart publishes no `gp_api_user_id` for a person group that holds
more than one gp-api account. The warehouse copy of the users table keeps
accounts that were deleted in gp-api, so a candidate who deletes and re-creates
their account lands in such a group and can never link: the editor stays on
"still setting up your official record" with no path out but a prod DB write
(ENG-11353). On 2026-10-22, 2,613 groups held more than one gp-api account.

## Alternatives rejected

- Link automatically when the user's verified email matches `Person.email`.
  It would have fixed this case, but it lets a matching email claim a public
  page with no human in the loop. That is a product call, not a bug fix.
- Wait for the data platform to drop deleted accounts and pick one user per
  group. That is the right long-term fix, but it leaves users locked out until
  it ships, with no lever for support in the meantime.

## Revisit if

The mart publishes one live gp-api user per group and deleted accounts leave
the identity graph. The route then has nothing to repair and can be removed.
