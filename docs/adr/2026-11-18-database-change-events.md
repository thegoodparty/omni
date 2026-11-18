---
title: Database change events are a trigger, an outbox and one relay into pg-boss
status: active
decided_by: [swain]
date: 2026-11-18
code: []
scope:
  - packages/gp-api/src/dbChanges/**
  - packages/gp-api/src/jobs/changes.registry.ts
  - packages/gp-api/prisma/schema/dbChange.prisma
supersedes: []
superseded_by:
---

# Database change events are a trigger, an outbox and one relay into pg-boss

## Decision

A write that background work must follow is captured by a database trigger,
not by the application code that writes it. `db_change_capture()`, an `AFTER
ROW` trigger on each table that has a handler, inserts one row into the
`db_change` outbox with the row's `to_jsonb()` before and after. One relaying
task, holding a lease row, reads unsent rows in id order and sends one pg-boss
job per listening handler in the same transaction that stamps them relayed. A
handler is then an ordinary job: same queues, retries, dead letters and
alerts. `CHANGES` in `packages/gp-api/src/jobs/changes.registry.ts` is the one
place that decides what is captured, and a generator writes the migration that
installs exactly those triggers.

## Context

Handler work behind a write used to be a call in the writer, so it fired only
where someone remembered to add it, and it ran inside the request. Two classes
of write could not reach it at all: raw SQL (`$executeRaw`, `$queryRaw` — the
bulk paths), and writes made outside gp-api by the data platform. Both needed
one capture point that every writer shares, without every writer knowing about
it, and without adding work to the transaction's critical path.

The outbox is what makes that safe. The trigger only inserts; the relay is the
one thing that talks to pg-boss, so a slow or failing queue never delays or
fails the write that produced the change, and a write rolled back leaves
nothing behind because its outbox row rolls back with it.

## Alternatives rejected

- **A Prisma client extension on `$allOperations`.** Cleanest to install, and
  it sees every ORM write. It cannot see raw SQL, which is where the bulk
  writes are, and it cannot see the data platform's write-back, which is the
  case that started this. Capture would silently miss both.
- **The trigger writing pg-boss jobs directly.** Removes the relay, but
  couples every table's write path to pg-boss's schema and its `job` table
  inserts, makes a queue outage fail the write, and puts the fan-out to N
  handlers and the per-row ordering inside a plpgsql function.
- **WAL-based CDC (Debezium, Sequin).** The textbook answer, and a new
  service, a new deployment and a new on-call surface, for a volume one task
  drains in seconds. Rejected for now; revisit if capture ever has to scale
  past what one relay drains, or must include every table without a
  per-table decision.
- **Polling for changed rows** (`updated_at > cursor`). Misses deletes, sees
  only the latest state of a row, and needs an indexed column every table
  would have to have.

## Revisit if

The relay cannot keep a backlog down, a handler needs the WAL's exact
operation ordering across tables, or Realtime CDC becomes as cheap to operate
as a table.
