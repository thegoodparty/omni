---
title: Release retry decides on the steps that started, not on the job
status: active
decided_by: [agent]
date: 2026-11-19
code: ['#3945']
scope:
  - .github/scripts/release-retry.sh
  - .github/workflows/release-retry.yml
---

# Release retry decides on the steps that started, not on the job

## Decision

`.github/scripts/release-retry.sh` refuses a lost-runner job only when a step
that mutates deploy state has started. Those steps are matched by name:
`Deploy (Pulumi)`, and gp-ai's `apply <env>/<stack>` and `reverify <env>/<stack>`.
A job's absence from `STATELESS_RE` no longer makes its whole run unretryable.
The safety property is unchanged where it matters: nothing is retried once an
apply started, because a dead runner can leave a state lock and a half-applied
stack, and both Pulumi and Terraform refuse to proceed on top of one.

The step names are load-bearing. A new apply step that is not named to match one
of those patterns will be retried mid-apply, which fails loudly on the lock
rather than applying over a half-applied stack.

## Context

The retry was built to recover a release run that GitHub lost a runner in
(ENG-11537, #3517, 2026-11-02). Its safety rule was job-granular: a lost-runner
job, once any step had run, was retried only if its name was on `STATELESS_RE`.
That was cheap and failed closed, which is right for a young mechanism.

It also made a whole job unretryable if any part of it could hold state. On
2026-11-19 (ENG-11700, run 44598590352) GitHub lost the runner 46 minutes into
`Build and push Docker image` in `Dev gp-api`, 12 green steps in. The Pulumi
apply had not started, so no lock existed, but the job was on the deny list and
nothing retried it. Prod stayed on the previous release until an unrelated
commit landed three minutes later and its train shipped the change.

`Dev gp-api` holds two risk classes in one job: minutes of idempotent work
(checkout, build, buildx, an ECR push under an immutable SHA tag) followed by
the Pulumi apply. The jobs API had the distinguishing evidence all along:
`Deploy (Pulumi)` was `pending` with `started_at: null` while the build step was
`in_progress`.

## Alternatives rejected

- **Keep the job list and only split gp-api's build into its own job.** Fixes
  one job; `Dev gp-ai` has the same shape (two lambda builds, then 12 Terraform
  applies) and every future deploy job would repeat it. Splitting is still worth
  doing for blast radius, as a follow-up.
- **Retry any lost-runner job mid-run.** Unsafe: an apply that started can hold
  a state lock.
- **Deny by default and allowlist every stateless step name.** Every new step
  name, including each `actions/checkout` SHA bump, would silently stop retries.
- **Give the Docker build a `timeout-minutes` instead.** A hung build is not a
  lost runner, so the guard refuses it either way. Worth doing separately, for
  how long the train waits, not for whether prod recovers.

## Revisit if

A state-mutating step cannot be named to match one of the patterns, or GitHub
starts exposing lock or deploy-state evidence that a retry could read directly.
