---
title: A priority's round 2 draw leans on the priority's saved read, not a model of its own
status: active
decided_by: [swain]
date: 2026-11-13
code: ['#PR']
scope:
  - packages/gp-api/src/priorities/services/priorityRoundTwoDraw.service.ts
  - packages/gp-api/src/priorities/services/priorityRead.service.ts
  - packages/gp-api/src/priorities/util/roundTwo.util.ts
supersedes: []
superseded_by:
---

# A priority's round 2 draw leans on the priority's saved read, not a model of its own

## Decision

The round 2 draw takes the priority's read, the one stored in
`priority_read` that the priority page shows, through
`PriorityReadService.currentRead`. When the stored read is missing or its
`inputsKey` is stale, the draw's job computes and stores it first, through
the same path as the `priorityReadRefresh` job. The draw leans toward the
read's groups with `batchWeights`, on `dimensionsOf` the read's
`raceNameable`, and keeps the 15% unsteered slice. No read draws the whole
send unsteered. Round 2's own fit and its census product frame are gone.
Swain (`swain`) decided it, pending Samuel's sign-off on who follow-up
texts go to.

## Context

Round 2 was built on 2026-10-19 with its own fit, on a frame made by
multiplying the census marginals. On 2026-10-20 the page's read moved to
the voter file's cells raked to census sex by age and adults per tract
(`2026-10-20-civic-panel-frame-from-census-sex-age.md`), which rejected the
product frame, but round 2 kept it. Round 2 also counted answers its own
way: no unsent or canceled filter, no `campaignId` filter, and no one
answer per person. So a follow-up could lean toward groups the page did
not name, and there were two models to keep in step. This brings round 2
in line with the 2026-10-20 record, and any change to the read's frame
now reaches round 2 with it.

## Alternatives rejected

- **Keep round 2's own fit, on the read's frame.** Still a second model
  and a second way of counting answers to keep in step with the page.
- **Read the stored row as it is.** A row from before the latest answers
  would lean on a read the page is about to replace.
- **Queue a refresh and wait for it.** The draw already runs in a job;
  computing in place is simpler than waiting on another.

## Revisit if

The draw needs a model the page does not show, for example one that weighs
channels or answer rates the read leaves out.
