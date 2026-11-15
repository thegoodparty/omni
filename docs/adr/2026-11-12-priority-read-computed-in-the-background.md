---
title: A priority's read is computed in a background job on its own thread, stored, and fetched in the browser
status: active
decided_by: [swain]
date: 2026-11-12
code: ['#3750']
scope:
  - packages/gp-api/src/priorities/services/priorityRead.service.ts
  - packages/gp-api/src/priorities/services/priorityResults.service.ts
  - packages/gp-api/src/priorities/util/mrp.thread.ts
  - packages/gp-webapp/app/dashboard/priorities/[priorityId]/**
supersedes: []
superseded_by:
---

# A priority's read is computed in a background job on its own thread, stored, and fetched in the browser

## Decision

The priority read's model runs only in the `priorityReadRefresh` pg-boss
job, on a worker thread, and its result is stored per priority in
`priority_read`. Requests read the stored row and queue a refresh when it is
missing or stale. A refresh is queued when answers are coded, when a view
finds the row stale, and daily. The priority page and the results page
fetch the read in the browser, not in their server render.

## Context

On 2026-11-04 a statewide district's fit ran on gp-api's request thread for
minutes, once per read-status request, Home load and agent turn, on every
task, and froze the fleet. The read only changes when answers are coded
(one writer), when the warehouse rebuilds the district, or on a deploy. The
2026-11-04 bound (`2026-11-04-mrp-fit-bounded-by-frame-size.md`) caps the
fit's size; this record moves where and how often it runs. The model stays
TypeScript in gp-api (`2026-10-19-civic-panel-mrp-in-gp-api.md`), now off
the request path. pg-boss workers run inside the same tasks that serve
requests, so the fit gets its own thread too.

## Alternatives rejected

- **Keep the per-task in-memory cache.** Every task fit on its own, on the
  request thread, and every view between answers could pay for a fit.
- **A background job on the main thread.** The fit would still hold the
  event loop that serves requests while it runs.
- **Making the math async.** Yielding between steps still runs all of it
  on the one thread, and every hot loop would need it.
- **Run all background work on a separate thread or service.** Most jobs
  wait on I/O, which does not block. A second app in a thread doubles
  memory and connections for a problem only CPU-bound work has.
- **The model in Databricks.** Answers would reach the page tens of
  minutes late, in a second language.

## Revisit if

gp-api grows other CPU-bound background work (then a shared thread pool, or
a worker service), or the stale window between coding and a refresh shows
up as a problem for officials.
