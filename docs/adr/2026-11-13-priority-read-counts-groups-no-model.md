---
title: A priority's read counts coded answers per group; it fits no opinion model
status: active
decided_by: [swain]
date: 2026-11-13
code: ['#3770']
scope:
  - packages/gp-api/src/priorities/util/priorityGroupRead.util.ts
  - packages/gp-api/src/priorities/services/priorityRead.service.ts
  - packages/gp-api/src/contacts/utils/civicPanelAllocation.util.ts
supersedes: [2026-10-19-civic-panel-mrp-in-gp-api.md]
superseded_by:
---

# A priority's read counts coded answers per group; it fits no opinion model

## Decision

A priority's read is counts: for each group of the district's frame, its
share of the district and how many people with a coded answer are in it.
It is `representative` once every major group has `MIN_VOICES_PER_GROUP`
(3) answers and the district's floor is met. The round 2 draw gives a major
group short of three `MAX_TARGET_WEIGHT` and every other major group 1.
The MRP model, its ranges, its size ceiling and its worker thread are gone,
and nothing reports `gettingClose`, which stays in the contract's enum.
Swain (`swain`) decided it on Samuel's direction, below.

## Context

Samuel (`samuelgoodparty`), who owns the model, in #eng-prod-design on
2026-11-12: "Yes, you should shut it down for now. It's not even necessary
right now because we aren't learning about group opinions yet, we're just
selecting members of pre-determined groups up to a certain threshold. So
just take out the MRP stuff and I'll roll it in more thoughtfully."

The model had frozen gp-api once (a statewide fit, 2026-11-04) and needed
a background job, a worker thread and a size ceiling to stay safe. What
the page and round 2 act on is whether each group has its three, which
counts answer without a fit.

Still in force: the census frame (2026-10-20), the floor (2026-10-22,
less its range check), the background job and stored read (2026-11-12,
less the thread: the two warehouse reads still keep it off the request
path), county areas past 60 tracts (2026-11-13, less the fit's ceiling),
and round 2 leaning on the saved read (2026-11-13).

## Alternatives rejected

- **Keep the model and hide the range.** Keeps the cost and the risk for
  output nobody reads yet.
- **Keep the model behind a flag.** A second path to keep correct while
  Samuel redesigns it.

## Revisit if

Samuel brings back a model of what each group thinks; it would be a new
record.
