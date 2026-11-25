---
title: A welcome card's two facts come from the onboarding search, estimated when it finds nothing, with the source stored and never returned
status: active
decided_by: [agent]
date: 2026-11-25
code: ['#4066']
scope:
  - packages/gp-api/src/priorities/services/priorityFocusRating.service.ts
  - packages/gp-api/src/priorities/util/focusCards.util.ts
  - packages/gp-api/src/communityIssues/services/communityIssueStarter.service.ts
  - packages/gp-api/prisma/schema/priority.prisma
  - packages/gp-api/prisma/schema/communityIssue.prisma
  - packages/contracts/src/priorities/PriorityFocus.schema.ts
supersedes: []
superseded_by:
---

# A welcome card's two facts come from the onboarding search, estimated when it finds nothing, with the source stored and never returned

## Decision

Every card on the welcome's Priorities step shows resident interest (high,
medium, low) and first win (weeks, months, a year or more), for every winner.

- A community issue's resident interest is its existing `priority`. Its first
  win is a new column the starter search fills from the same sources.
- An issue the winner ran on (a `Priority` from `win_import` or `user_stated`)
  gets both from a second search inside the same `communityIssueOnboarding`
  job. When local sources of the last year say nothing about it, the model
  still returns a level, estimated from the kind of issue, the place and the
  district issue labels the product holds.
- Each stored value carries where it came from (`local_sources` or
  `estimate`) in its own column. No route returns those columns. A value is
  recorded as sourced only when the model named a source URL for the issue.
- A card no search has rated yet shows `medium` and `months`. Nothing stores
  that placeholder on the priority or the issue; the saved pick records it as
  `default` on the card that showed it.

Olly Farshi (design owner) decided on 2026-11-25 that every card shows both
facts and that the model estimates when it finds nothing. Bryan Levine said on
2026-11-24 that a community issue's priority is the resident signal. The
storage and the job placement are the agent's.

## Context

Ran-on issues had no rating: no search had ever looked at them, and the only
district data at onboarding is modeled issue scores, which are leans against
the state and cannot be read as a count of people. Few winners have campaign
issues stored, so the extra search runs for few offices, and only for an
office that came from a win.

## Alternatives rejected

- **Leave the line off ran-on cards.** The earlier plan. The design owner
  ruled it out: no card may show a blank.
- **Map a ran-on issue to a district score.** No mapping exists from a typed
  issue to a score key, and a score is not resident interest.
- **Estimate without saying so.** An estimate shown beside sourced values
  could never be checked. The source column is what makes an audit possible.
- **Return the source to the client.** The design shows one word per fact.
  A client that has the source will sooner or later show it.
- **A separate job for the rating.** The step's `searchPending` reads one
  job's state. Two jobs would need two reads and a rule for combining them.

## Revisit if

The full `top_community_issues` run starts writing first win itself (it
writes none today, so its new rows wait for the next onboarding start), or an
audit shows the estimates are wrong often enough to mislead.
