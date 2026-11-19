---
title: Test users are created by a shared package, and the judge imports no gp-api code
status: active
decided_by: [agent]
date: 2026-11-19
code: []
scope:
  - packages/judge/**
  - packages/test-users/**
  - packages/gp-webapp/e2e-tests/tests/utils/**
supersedes: []
superseded_by:
---

# Test users are created by a shared package, and the judge imports no gp-api code

## Decision

Provisioning a signed-in GoodParty test user lives in one npm workspace package,
`packages/test-users` (`@goodparty_org/test-users`). Both the e2e suite and the
pairwise eval framework (`packages/judge`, `@goodparty_org/judge`) import it. The
e2e suite's `tests/utils/headless-user.ts` and `src/helpers/serve.helper.ts`
re-export it under the names the specs already use.

The judge takes two webapp base URLs as its whole input and drives everything
through HTTP against them. It imports no gp-api runtime code — a suite file may
`import type` from gp-api at most — and holds no AWS, S3, SQS or Databricks
access. `CLERK_SECRET_KEY` and a way to sign in a user are all it needs beyond
the two URLs and a judge-model key.

## Context

The e2e suite had the only correct implementation of test-user provisioning,
including the ordering rule that keeps setup from 401ing: gp-api JIT-provisions a
user on its first authenticated request by asking Clerk's Backend API who the
`clerkId` is, and that budget is per Clerk instance (100 req/10s), shared by
every PR preview and CI shard. A browser holding a Clerk session for a user
gp-api has never seen fans out ~8 concurrent provisioning attempts, each spending
that budget. So the user, campaign or elected office, and org are created through
the API client FIRST and a browser is signed in LAST.

A second copy of that path in the judge would drift from it. An in-process judge
would also be measuring gp-api's code against dev's database rather than the two
deployed stacks a migration PR is about.

## Alternatives rejected

- **Copy `bootstrapTestUser` into the judge.** Two implementations of the
  ordering rule drift, and the judge's copy would not be exercised by the e2e
  suite that depends on the rule.
- **Let the judge import gp-api.** It would drag the whole app graph into a
  two-URL comparison, and measure something other than the deployed behaviour.
- **Keep provisioning inside `e2e-tests/` and import across the workspace.** That
  directory is a separate workspace with its own tsconfig and no Next runtime;
  the judge importing into it would pull Playwright into a Node runner.

## Revisit if

A comparison needs identical user state the two arms cannot each provision — the
three attempts of a case already share one profile so only the identity is new.
