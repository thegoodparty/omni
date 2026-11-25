---
title: The case scout reads existing cases by parsing the judged suites' source off main
status: active
decided_by: [dealvz]
date: 2026-11-25
code: ['#4072']
scope:
  - packages/gp-api/src/caseScout/services/caseScoutCaseLists.service.ts
  - packages/gp-api/src/caseScout/util/suiteCases.util.ts
  - packages/gp-api/src/chats/general/campaign-manager/campaign_assistant.eval.ts
  - packages/gp-api/src/chats/general/chief-of-staff/chief_of_staff.eval.ts
supersedes: []
superseded_by:
---

# The case scout reads existing cases by parsing the judged suites' source off main

## Decision

Before drafting, the case scout reads each covered agent's existing case ids
and grading conditions from the pairwise suite the judge runs
(`campaign_assistant.eval.ts`, `chief_of_staff.eval.ts`). It fetches the raw
source from main, unauthenticated, and a small reader in
`util/suiteCases.util.ts` pulls out each `id` and `grading.condition` written
as string literals (or several joined by `+`). A test checks that reader
against the TypeScript AST of both real suites, so a case it would misread
fails CI in the PR that adds it. The `cases/<agent>.json` files are still read
for their fixture note and as a fallback. dealvz decided the scout reads the
judged suites; parsing the raw source, rather than another way of reading
them, was the implementing agent's choice.

## Context

Delegate appends the scout's cases to the two suites, and the judge runs only
the suites. The scout read only the JSON files, which no judge runs and
Delegate does not write, so once Delegate's cases merged the scout could not
see them and could draft the same failure again. gp-api cannot import a
suite: the production build leaves out `*.eval.ts`, a suite imports
`@goodparty_org/judge` (a devDependency), and importing one registers vitest
tests. gp-api must also never hold a GitHub key, because it reads transcripts,
so the read stays an unauthenticated fetch of a public file.

## Alternatives rejected

- **Import the suites at runtime.** Blocked by the build exclusion, the
  devDependency and the test registration above.
- **Move the cases into data files the suites load.** Restructures every
  suite, and what Delegate writes into them, for one reader's sake.
- **Have Delegate also write the JSON.** Two copies of every case that can
  drift, and the scout would trust the copy the judge does not run.

## Revisit if

A suite needs a computed `id` or `condition`, or the scout covers a suite
whose cases are built in a way the reader cannot follow; then a data file the
suite imports becomes the cheaper path.
