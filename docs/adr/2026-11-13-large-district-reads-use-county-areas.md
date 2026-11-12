---
title: A large district's priority read models county areas, not tracts
status: active
decided_by: [swain]
date: 2026-11-13
code: ['#3764']
scope:
  - packages/gp-api/src/priorities/util/tractAreas.util.ts
  - packages/gp-api/src/priorities/services/censusComposition.ts
  - packages/gp-api/src/priorities/util/mrp.util.ts
supersedes: [2026-11-04-mrp-fit-bounded-by-frame-size.md]
superseded_by:
---

# A large district's priority read models county areas, not tracts

## Decision

Past `MAX_TRACTS_READ_ALONE` (60) tracts, the read's frame groups tracts
into areas before the census raking (`tractAreas`): one area per county (a
tract GEOID's first five digits), a county over 1/30 of the district's
adults split into runs of tracts in GEOID order of about 1/30 each, and
counties under 1% pooled into `other`, which weights the model but is never
named. The answers, theme cells and adults per tract map to the same areas,
so the model, its major groups, `districtAnswersNeeded` and the read status
agree. Area ids (`37119`, `37119:2`) expand back to their tracts from the
district's adults, so `areaOfTracts` still draws a list from tracts. A
district of 60 tracts or fewer reads by tract as before. `MAX_MRP_PARAMETERS`
and `MAX_MRP_CELLS` stay as a safety ceiling; a read that hits one logs at
error and stores no read. The model change awaits Samuel's sign-off.

## Context

The read names a place only when it holds `MAJOR_GROUP_SHARE` (3%) of the
district's adults. Past about 33 equal tracts no tract reaches that, so
about 69 Serve offices in large districts never got "hear more from these
areas". The 2026-11-04 bound (#3588) left tract out entirely past 100
tracts to keep the dense fit small after a statewide district (3,003
tracts, 3,018 parameters) froze gp-api. Areas keep the fit small too: that
statewide district is about 25 areas and 40 parameters and fits in tens of
milliseconds, and a one-county district of 800 tracts is 30 areas.

## Alternatives rejected

- **Leave tract out past 100 tracts** (the 2026-11-04 record). Bounded, but
  a big district never names a place to hear more from.
- **Whole counties only.** A county is rarely 3% of a state, and a
  county-wide district is one county, so neither would name anything.
- **A sparse solver over every tract.** Fits the parameters, but no tract
  is a major group at that size, so it names nothing more.

## Revisit if

Samuel's model review asks for a different area size or pooling rule, or
the warehouse publishes tract outlines that would let areas follow
geography rather than GEOID order.
