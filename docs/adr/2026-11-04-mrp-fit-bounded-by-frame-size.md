---
title: The in-process MRP fit is bounded by frame size, and districts past 100 tracts leave tract out
status: superseded
decided_by: [agent]
date: 2026-11-04
code: ['#3588']
scope:
  - packages/gp-api/src/priorities/util/mrp.util.ts
  - packages/gp-api/src/priorities/services/censusComposition.ts
  - packages/gp-api/src/priorities/util/roundTwo.util.ts
supersedes: []
superseded_by: 2026-11-13-large-district-reads-use-county-areas.md
---

# The in-process MRP fit is bounded by frame size, and districts past 100 tracts leave tract out

## Decision

The priority read's model and round 2's stay in process
(`2026-10-19-civic-panel-mrp-in-gp-api.md`), with a bound on how large a
frame they fit. Past `MAX_MRP_TRACTS` (100) tracts, the read's frame and
round 2's leave tract out of the model, so the fit sees age, sex and race
only. `fitMrp` and `poststratify` refuse any frame past `MAX_MRP_PARAMETERS`
(150) or `MAX_MRP_CELLS` (20,000) with `MrpFrameTooLargeError`, before doing
any work. The read takes that as no read, and round 2 as an unsteered draw.
At the caps a fit takes about 300 ms on an M-series Mac.

## Context

On 2026-11-04 a priority in a statewide district (North Carolina: 3,003
tracts, 189,284 voter-file cells, 3,018 parameters) froze every gp-api prod
task that read it. The fit is dense Newton plus a Laplace covariance and
400 draws through the frame. Its cost grows with the cube of the parameters,
and it runs synchronously on the event loop. Measured on a synthetic frame of
that shape, it took 118 s (800 tracts took 3 s). The ECS health check
replaced the tasks first. The 2026-10-19 record assumed "a few dozen
parameters, a few hundred frame cells", which a statewide, county or
big-city district breaks.

A tract is a major group only at 3% of the district. Past 100 tracts that
takes three times the average tract's adults, so the screens almost never
named a tract in a district that size, and leaving tract out costs nothing
they show.

## Alternatives rejected

- **Only a size guard returning no read.** Bounded, but a statewide or county
  priority would never get a read, though its age, sex and race groups fit
  fine.
- **Fit on a worker thread with a timeout.** Keeps the event loop free, but
  still burns a core for the whole timeout, still never finishes a
  statewide frame, and adds a second build entry point. A bounded fit makes
  it unnecessary.
- **A sparse or structured solver** (the tract block of the Hessian is
  diagonal). Scales the Newton step, but the 400 draws through 190,000 cells
  still take seconds. It is more code to get right during an incident.
- **Counties in place of tracts for big districts.** Keeps some geography,
  but `areaOfTracts` and the unreached-area lists read tract IDs, and a
  county is rarely 3% of a state either.

## Revisit if

Statewide officials need neighborhood reads, or the fit gains dimensions
that push the parameters back toward the cap.
