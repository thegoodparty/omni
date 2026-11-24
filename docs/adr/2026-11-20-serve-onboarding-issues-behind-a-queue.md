---
title: Serve onboarding queues its community-issue start and the route answers { queued: true }
status: active
decided_by: [agent]
date: 2026-11-20
code: ['#3949']
scope:
  - packages/gp-api/src/communityIssues/**
  - packages/gp-api/src/priorities/**
  - packages/contracts/src/priorities/**
  - packages/gp-webapp/app/serve/onboarding/**
supersedes: []
superseded_by:
---

# Serve onboarding queues its community-issue start and the route answers { queued: true }

## Decision

`POST /v1/community-issues/onboarding` no longer runs the paid work. It sends
one `communityIssueOnboarding` pg-boss job, keyed by organization slug, and
answers `{ queued: true }`. The worker loads the elected office, writes the
starter issues, then calls `onElectedOfficeCreated` to dispatch the full runs,
exactly as the request used to. `starterIssueCount` is gone from the response:
the route cannot report a count it has not produced yet, and no caller read it.

The priorities read that already polls for late starter issues,
`GET /v1/priorities/onboarding`, now also answers `searchPending`, the job's
own state from the queue. The step keeps saying "searching" while that is
true, so a job queued behind others is never read as a search that found
nothing.

## Context

The request ran a Gemini Flash search for up to 5 starter issues and then both
dispatches on its own thread, 25 to 55 seconds end to end. The priorities step
calls this route as soon as the office is saved, so a mobile browser gave up on
the fetch before the answer came back and retried into the same handler: the
first attempt kept spending, and the retry paid for a second search.

The step never used the response body. It waits 10 seconds, then polls
`GET /v1/priorities/onboarding` every 4 seconds for up to 120, which is where
starter issues that land late already appear. So the count was not carrying
information the UI had no other way to get.

pg-boss is the repo's queue (`2026-11-07-background-jobs-on-pg-boss.md`), and
its `sendMany` derives the job id from the key, so a retry, a double tap, and
a burst landing on different tasks leave one job rather than one generation
each. That key is what prevents a duplicate paid generation; nothing here
throttles the work on top of it. The queue does set `concurrency: 15` per
task, because the default of one slot would let a burst queue behind a 25 to
55 second search, leaving each official waiting on a search that has not
started yet.

## Alternatives rejected

- **Keep awaiting inline and raise the timeout, or retry sooner.** The user
  still waits most of a minute on the step whose only job is to show a list,
  and timeouts cannot be raised in a browser that already gave up. Retry
  tuning makes the duplicate paid search likelier, not rarer.
- **Queue the search but keep `starterIssueCount`.** Any count in the response
  means the handler awaited the search, which is the wait being removed. The
  field was dead weight for the client.
- **Keep deciding from a local timer.** A window counted on the client tells a
  slow search, a queued one and a dead one apart from none: it fires "nothing
  found" while the job is still out, and shows issues a moment later (lesson 3
  of the `2026-11-03` robocall post-mortem). The queue knows, so the queue
  answers.
- **Fire and forget without a job.** No retry, no dead letter, no dedupe, and a
  request that dies mid-search loses the run silently.
- **Do the search in the browser.** Puts the model vendor key in the client and
  an LLM prompt outside gp-api.

## Revisit if

The starter search gets fast enough (a second or two) that the wait is
acceptable again, or a caller needs the count before the priorities poll has
found issues.
