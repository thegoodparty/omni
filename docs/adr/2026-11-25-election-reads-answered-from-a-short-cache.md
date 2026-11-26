---
title: An identical machine election read is answered from a 30s per-task cache
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

# An identical machine election read is answered from a 30s per-task cache

## Decision

A machine-caller read under `GET /v1/elections/*` that repeats an identical one
(method + path + the query string with its keys sorted) is answered from a
per-task map for 30s, and a read that is already in flight is joined rather
than repeated. Settled 200s only: human callers, non-GETs and non-200s bypass
it, a failed read deletes its entry, and a response over 1 MB is served but not
stored. The map is bounded to 2,000 entries and 32 MB, least-recently-answered
evicted, with expired entries swept when a new one is stored. It logs
cumulative hit, join, miss and oversized counts every 1,000 decisions, because
the effect is a rate a human has to measure after a deploy.

`public-person-profiles` shares the same pool and the same read cap but is
deliberately excluded: its owner can publish or hide a profile and that has to
be visible on the next read.

30s of staleness is acceptable because the nightly swap is the only writer of
these tables. It is not a general licence for caching election data: a second
writer to these tables, or a write path from gp-api, invalidates the 30s window
and this record.

## Context

On 2026-11-25 five public place and race reads answered 500 in 24 ms with
Prisma P2024 — 5s acquire timeout on a 50-connection election-db pool — after
a gp-marketing crawl wave asked for 9,476 race documents in one minute against
a ~900 baseline. One URL was fetched ten times a minute and every ask rebuilt
the document from two or three SQL statements, so a wave needed the whole pool
to rebuild what it had just built. The two existing guards (a 30-read
admission cap, a 5s pool shed) only decide who is refused, and the reason they
exist — a crawl must not stall gp-api's health probe — is served better by not
doing the work twice.

The cache is per task, and prod routes by least outstanding requests across
4–24 tasks (`deploy/components/service.ts`), so how much the TTL saves depends
on how many of a document's repeats land on the same task inside 30s: roughly
50–70% at 4 tasks and 20% or less at 24, using the crawl's ~10 fetches per URL
per minute. The in-flight join does not depend on that — a burst that arrives
together in one task opens one connection — and the pool is per task, so the
join is the part that bounds concurrency. The counters exist to settle which
of the two effects dominates in prod; nothing here claims a fleet-wide hit
rate.

## Alternatives rejected

- **A cache shared across tasks.** gp-api has no shared cache store: the
  alternatives are S3 or Postgres per read, which costs more than the election
  query it saves, or new infrastructure, which is more than one safe PR. The
  shared-layer form of this is the read-replica or post-swap snapshot below.
- **Raise `connection_limit`.** It buys headroom without removing the duplicate
  work, and the 5s shed is sized against the database's own connection budget.
  Kept as the follow-up lever if post-deploy counters and latency show reads
  still queuing with the cache in place.
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
writer other than the nightly swap, or the logged ratios show a hit rate low
enough that the follow-up, not this cache, is the fix.
