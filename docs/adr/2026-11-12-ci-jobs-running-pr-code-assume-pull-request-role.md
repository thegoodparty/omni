---
title: A CI job that runs pull request code assumes the pull-request role, whatever ref starts it
status: active
decided_by: [agent]
date: 2026-11-12
code: ['#TBD']
scope:
  - .github/workflows/judge.yml
  - .github/workflows/judge-*.yml
supersedes: []
superseded_by:
---

# A CI job that runs pull request code assumes the pull-request role, whatever ref starts it

## Decision

`judge.yml` assumes the pull-request role, `github-actions-preview-deploy`,
not the deploy role. It starts from `main` (a dispatch, a `/judge` comment or
the guard's `pull_request_target`), so it presents the main ref, but its
sweep job checks out and runs the branch it judges with the credentials in
its environment. The pull-request role trusts it on main, pinned to
`judge.yml` by `job_workflow_ref`, and holds its grants in a managed policy
in thegoodparty/ops. This refines
`2026-11-12-ci-assumes-shared-pull-request-or-deploy-role.md`, whose
exception list named the deploy role as the judge's target; the two-role
rule itself stands.

## Context

The judge had a role of its own, `github-actions-judge-sweep`, scoped to a
few dev S3 prefixes and one dev queue. Folding it into a shared role was
decided on 2026-11-12. The deploy role carries `AdministratorAccess` and is
trusted on omni's main ref with no workflow pin, so moving the judge there
would hand admin credentials to code from any branch a person with push
access asks the judge to sweep.

## Alternatives rejected

- **The deploy role, as the 2026-11-12 list said.** Admin for unreviewed
  code, the exposure `thegoodparty/ops` `docs/deploy-role-trust.md` exists
  to close.
- **Keep the judge's own role.** The role-per-workflow pattern the
  2026-11-12 rule ended.

## Revisit if

The judge stops running pull request code with credentials in its
environment, for example by splitting the AWS calls into a job that runs only
`main`'s code.
