---
title: CI workflows assume the shared pull-request or deploy role; no per-workflow roles
status: active
decided_by: [swain]
date: 2026-11-12
code: ['#3772']
scope:
  - .github/workflows/**
supersedes: []
superseded_by:
---

# CI workflows assume the shared pull-request or deploy role; no per-workflow roles

## Decision

omni CI has two AWS roles, both in thegoodparty/ops. A `pull_request` job
assumes the pull-request role, `github-actions-preview-deploy`. A job that
runs from `main`, including one in the `production` environment, assumes the
deploy role, `github-actions-pulumi-deploy` (`vars.AWS_ROLE_ARN`). A new
workflow uses one of these. If it needs more access, or another OIDC
subject, that role's policy or trust is widened in ops. No workflow gets a
role of its own.

## Context

`vercel-config.yml` runs in the `production` environment for its Vercel
token, so its OIDC subject is `environment:production`, which the deploy role
did not trust. The first version of thegoodparty/ops#528 added
`github-actions-vercel-config-deploy` for that one workflow. Swain set the
rule instead: one pull-request role and one deploy role, never a role per
workflow. ops#528 now lets the deploy role trust
`repo:thegoodparty/omni:environment:production`.
This generalizes `2026-11-03-gp-api-diff-on-preview-deploy-role.md`, which
made the same call for one pull request workflow.

## Alternatives rejected

- **A role per workflow, pinned by `job_workflow_ref`.** Narrower per job,
  but every one is another trust document and policy to keep right, added
  one workflow at a time. Rejected for `vercel-config.yml` in ops#528.

## Existing exceptions

Older roles to consolidate onto the two above. None may be copied:

- `vars.AWS_PLAN_ROLE_ARN` (`github-actions-pulumi-plan`): pull request
  Terraform plans and ECR Public logins in `gp-ai.yml` and `gp-api.yml`.
  Target: the pull-request role.
- `web-app-e2e-tests`: the E2E shards in `gp-webapp.yml` and `release.yml`.
  Target: the pull-request role on pull requests, the deploy role on `main`.
- `github-actions-judge-sweep`: `judge.yml`. Target: the deploy role.

## Revisit if

A job's grant cannot fit in the shared role's policy: move statements to a
managed policy on the same role, not to a new role.
