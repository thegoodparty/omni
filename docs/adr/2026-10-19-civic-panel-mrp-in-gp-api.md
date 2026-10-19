---
title: The civic panel's opinion model runs in gp-api as TypeScript, not as a warehouse or Python job
status: active
decided_by: [agent]
date: 2026-10-19
code: ['#2962']
scope:
  - packages/gp-api/src/priorities/util/mrp.util.ts
  - packages/gp-api/src/contacts/utils/civicPanelAllocation.util.ts
supersedes: []
superseded_by:
---

# The civic panel's opinion model runs in gp-api as TypeScript, not as a warehouse or Python job

## Decision

The multilevel model of opinion by group (MRP) and the round 2 targeting
are hand-written TypeScript in gp-api: Newton's method for the posterior
mode, the Laplace approximation for its uncertainty, and draws pushed
through the district's cells. They run in process wherever the priority
read and the panel plan already run.

## Context

A district's model is small: a few dozen parameters, a few hundred frame
cells, a few hundred answers. A fit takes about 1 ms. The answers live in
gp-api Postgres, the plan that draws the next batch lives in gp-api, and
the frame is the same aggregate cell read the census steering already makes
from the warehouse. Round 2 refits after every batch, so the model sits on
the path that opens the next send.

## Alternatives rejected

- **Stan or PyMC in `packages/gp-ai`.** Full MCMC rather than an
  approximation, but a new service call, queue hop and deploy on the path to
  every batch, for a model this size.
- **A Databricks job.** Close to the frame, far from the answers and the
  plan, and minutes of warehouse start-up per refit.

## Revisit if

The model gains interactions or structured priors that the Laplace
approximation handles badly, or a check against a full MCMC fit of the
same data shows ranges that do not hold.
