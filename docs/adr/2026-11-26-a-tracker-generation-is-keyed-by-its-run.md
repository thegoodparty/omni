---
title: A tracker generation is keyed by the run that produced it and appends once
status: active
decided_by: [swain, agent]
date: 2026-11-26
code: []
scope:
  - packages/gp-api/prisma/schema/campaignTrackerTask.prisma
  - packages/gp-api/src/campaigns/campaignTracker/services/campaignTrackerTasks.service.ts
---

# A tracker generation is keyed by the run that produced it and appends once

## Decision

`campaign_tracker_tasks` carries a nullable `source_run_id`: the run whose
artifact produced the row, on whichever engine. The append takes a per-campaign
`pg_advisory_xact_lock` (`TRACKER_GENERATION_ADVISORY_LOCK_KEY`) and skips when
a row already holds that run's id, so one run appends one generation.

The column is nullable and unbackfilled. Static and deterministic-outreach rows
never have a run, and every generation written before the column has no value to
recover; treating either as "already handled" would suppress a real append.

## Context

Both completion paths are at-least-once. The PMF Engine's result arrives on an
SQS message that a retry redelivers, and gp-api's runner re-runs `onArtifact`
from the run's stored artifact when an attempt dies after it. The append had
been a read of the latest week followed by an insert, unlocked, so a replay
computed the same next index and inserted a second "week 3" beside the first.
The candidate sees the highest `week`, so the duplicate reads as one generation
twice — two lists, two Slack posts, doubled CAS tasks.

The append is also the one place the two engines' completion paths meet, so the
guard has to work for a run that never wrote S3 (gp-api's engine hands
`onArtifact` the output directly).

## Alternatives rejected

- **A unique index on `(campaign_id, source_run_id)`.** One generation inserts
  many rows stamped with the same run id, so that index rejects the second row
  of every normal append — it forbids the ordinary case, not the replayed one.
  The predicate that would help (`where source_run_id is not null`) changes
  nothing: the rows of one generation all share the id and each carries a
  distinct generated primary key, so there is no key two attempts could collide
  on. A null-column index also would not bite, since Postgres treats nulls as
  distinct. And where it could fire, it turns a replay into a P2002 the caller
  must translate, where the stamp lets the append simply return.
- **A unique index on the generation number** (`campaign_id, week` over the
  dynamic rows) needs a partial predicate anyway for the default rows, whose
  `week` is a calendar offset, and it cannot tell a replay from the weekly
  cron's legitimate next generation until the insert already conflicts — after
  the caller has computed and materialized the whole generation.
- **Upserting the whole generation.** The rows are identified by generated ids,
  not by anything stable across attempts, so an upsert has no key to collide on.
- **A claim row per run.** A second table for one boolean is more moving parts
  than the column the rows already need, and it would leave the rows unable to
  say which run produced them — which is what makes the replay check a single
  indexed read.
- **Locking only, or checking only.** The lock alone serializes the pair but
  nothing tells the second delivery its rows are already down; the check alone
  is the unlocked read-then-insert that loses the race it was added for.

## Revisit if

Tracker generations stop being appended (the weekly re-run is replaced by an
in-place regenerate), or a retry becomes able to produce genuinely different rows
for one run id, which would make the second one's rows worth keeping.
