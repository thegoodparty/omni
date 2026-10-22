---
title: A priority read is never representative below the district's answersNeeded
status: active
decided_by: [bryclevgp]
date: 2026-10-22
code: ['#2977']
scope:
  - packages/gp-api/src/priorities/util/mrpReadStatus.util.ts
  - packages/gp-api/src/contacts/utils/civicPanelAllocation.util.ts
  - packages/gp-api/src/priorities/services/censusComposition.ts
  - packages/contracts/src/outreach/AnswersNeeded.const.ts
supersedes: []
superseded_by:
---

# A priority read is never representative below the district's answersNeeded

## Decision

`mrpReadStatus` holds a priority's read to a floor on total answers: until
the people heard reach the district's `answersNeeded`
(`ceil(MIN_VOICES_PER_GROUP / smallestMajorShare)`), the read is
`notYetRepresentative` and `needed` is at least that floor. The per-group
minimum of three and the 20-point range check stay. The floor is
`frameAnswersNeeded` of the model's own frame, the same function
`districtAnswersNeeded` sizes round 1 and the civic panel from, so the
target an official is given and the point the read calls a priority done
cannot drift apart.

## Context

The read from #2977 counted only groups. Groups are marginals (age band,
sex, tract, race when nameable), and one answer counts once on every
dimension, so a district's groups fill long before its total does. A local
seed with 40 answers over 20 groups (6 age bands, 2 sexes, 12 tracts), most
saying yes, read "representative", while the sizing from #2983 had asked for
about 100 answers in the same district. Bryan's rule of thumb is three
answers per group, and the sizing already turns it into a total.

## Alternatives rejected

- **Keep groups only.** Calls a priority done at a fraction of the answers
  the official was told to get, and on a few answers per group.
- **A fixed total (say 100) for every district.** Disagrees with the sizing
  wherever the smallest major group is larger than 3%.
- **Tighten the range threshold instead.** Changes the model's math to
  stand in for a count, and still would not match the sizing target.
