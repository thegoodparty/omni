---
title: Dead letters are deleted and batch-handled per entry, not as one request
status: active
decided_by: [swain]
date: 2026-11-23
code: ['#TBD']
scope:
  - packages/gp-api/src/admin/jobDeadLetters/**
  - packages/gp-admin/src/app/dashboard/job-dead-letters/**
  - packages/contracts/src/jobs/**
supersedes: []
superseded_by:
---

# Dead letters are deleted and batch-handled per entry, not as one request

## Decision

gp-admin can drop a dead letter, not only re-drive it, on the single route and
on a batch route. Both operations exist per entry and in batch.

The batch routes are not one transaction and not one pg-boss call. They run
the same per-entry redrive or delete the single routes run, in a loop, and
answer 200 with what happened to each: `{ redriven | deleted, failed: [{ id,
message }] }`. A batch therefore succeeds for the entries that can be handled
and reports the ones that cannot, with the message the single route would have
answered. Only an error that is not one of those per-entry refusals, a real
fault, fails the whole request.

Delete is fenced on the row's name being a dead-letter queue, exactly as the
existing read and redrive queries are, so an id that names a live job on a
real queue is not deletable through this route.

## Context

`docs/adr/2026-11-20-job-dead-letters-are-redriven-from-gp-admin.md` recorded
that there was no batch move, and the shell script kept that. In practice the
dead letters arrive in bursts of one cause: the incident that prompted this
left five rows of `ordinanceRefreshDispatch` failing on the same missing
position, and every one of them needed the same handling. The console was
five confirm dialogs.

A batch had to be all-or-nothing or per entry. All-or-nothing loses: the one
row of a selection that cannot move (no recorded source queue, or a held
`singletonKey` on a `key_strict_fifo` queue) would refuse the whole batch, and
the operator's next step is to hand-pick around it. Per entry matches what the
data already is, a set of independent jobs.

Delete is here because some dead letters are not worth replaying at all. A job
whose payload names a record that no longer exists cannot succeed on any
retry, and leaving it to expire after 14 days is 14 days of a paging alert per
row.

## Alternatives rejected

- **One `pg-boss` call for the whole batch.** `redrive` takes many ids, but
  it reports only a count, so the caller cannot say which row stayed put, and
  it cannot express "this one has no source queue" per entry. The count is the
  same information a per-entry loop produces, minus the attribution.
- **One transaction over the batch.** A partial success is the desired outcome
  here, so a transaction would turn a mostly-successful batch into a failed
  one.
- **A hard delete on any job id, not only dead letters.** The console's job is
  dead letters; a route that can drop a queued or active job is a different
  capability with a different blast radius, and nothing asks for it.
- **Selecting across pages.** The selection is page-local, so a batch can only
  act on what the operator can see. A cross-page selection would need ids held
  across navigations and a way to show what is about to be handled.

## Revisit if

Dead letter bursts grow past one page (100, the batch cap and the list's
maximum page size), or if handling the same cause across queues needs a filter
("re-drive every dead letter whose error contains X").
