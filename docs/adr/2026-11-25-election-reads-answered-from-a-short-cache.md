---
title: An identical machine election read is answered from a 30s in-memory cache
status: active
decided_by: [agent]
date: 2026-11-25
code: ['#4092']
scope:
  - packages/gp-api/src/elections/interceptors/electionReadCache.interceptor.ts
  - packages/gp-api/src/elections/controllers/**
  - packages/gp-api/src/elections/elections.module.ts
supersedes: []
superseded_by:
---

# An identical machine election read is answered from a 30s in-memory cache

## Decision

A machine-caller read under `GET /v1/elections/*` that repeats an identical one
(method + path + the query string with its keys sorted) is answered from a
per-process map for 30s, and a read that is already in flight is joined rather
than repeated. Settled 200s only: human callers, non-GETs and non-200s bypass
it, and a failed read deletes its entry. The map is bounded to 2,000 entries,
least-recently-answered evicted. `public-person-profiles` shares the same pool
and the same read cap but is deliberately excluded, because its owner can
publish or hide a profile and that has to be visible on the next read.

30s of staleness is acceptable because the nightly swap is the only writer of
these tables. It is not a general licence for caching election data: adding a
second writer to these tables, or a write path from gp-api, invalidates the
30s window and this record.

## Context

On 2026-11-25 five public place and race reads answered 500 in 24ms with
Prisma P2024 — 5s acquire timeout on a 50-connection election-db pool — after
a gp-marketing crawl wave asked for 9,476 race documents in one minute against
a ~900 baseline. One URL was fetched ten times a minute and every ask rebuilt
the document from two or three SQL statements, so a wave needed the whole pool
to rebuild what it had just built. The two existing guards (a 30-read
admission cap, a 5s pool shed) only decide who is refused, and the reason they
exist — a crawl must not stall gp-api's health probe — is served better by not
doing the work twice.

## Alternatives rejected

- **Raise `connection_limit`.** It buys headroom without removing the duplicate
  work, and the 5s shed is sized against the database's own connection budget.
  Kept as the follow-up lever if post-deploy telemetry still shows reads
  queuing with the cache in place.
- **Cache at the caller (gp-marketing) or at the edge.** The crawl is one
  machine caller of several, and the repeated rebuild is in gp-api; caching
  upstream leaves every other service reader on the same path.
- **Cache until the next swap instead of 30s.** Matches the data's real
  freshness, but needs an invalidation signal from the ETL job; 30s already
  collapses a crawl wave without one.
- **A read replica or a post-swap snapshot of these documents.** The deeper
  fix, and it takes the pool off the crawl's path entirely, but it is more than
  one safe PR. Named as a follow-up on ENG-11791.

## Revisit if

The crawl stops repeating URLs (the cache earns nothing), these tables gain a
writer other than the nightly swap, or post-deploy telemetry shows race reads
still queueing with the cache in place.
