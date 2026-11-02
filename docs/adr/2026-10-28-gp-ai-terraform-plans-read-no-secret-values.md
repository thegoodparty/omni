---
title: gp-ai Terraform plans read no secret values
status: active
decided_by: [agent]
date: 2026-10-28
code: ['#3349']
scope:
  - packages/gp-ai/infrastructure/**
supersedes: []
superseded_by:
---

# gp-ai Terraform plans read no secret values

## Decision

No gp-ai Terraform root reads a Secrets Manager value when it plans. Secret
containers are managed, secret versions are not: an operator writes the first
value with `put-secret-value`. The one value a root genuinely needs,
`SERVE_API_KEY` for the `shared-infra` ALB listener rules, is a sensitive root
variable. `ci-apply-root.sh` reads it from `AI_SECRETS_<ENV>` under the deploy
role, and `ci-plan-root.sh` takes the value the rules already hold from the
root's own state. So the pull request plan role (`github-actions-pulumi-plan`,
in thegoodparty/ops) needs no `secretsmanager:GetSecretValue` at all.

## Context

Pull request plans run PR-authored Terraform under a read-only role. Three
dev secrets were read at plan time: `AI_SECRETS_DEV` through a
`data "aws_secretsmanager_secret_version"`, and `broker-dev` and
`broker-service-tokens-dev` because Terraform refreshes a managed
`aws_secretsmanager_secret_version` on every plan. The data source also wrote
the whole blob to state. The broker versions were `jsonencode({})`
placeholders with `ignore_changes = [secret_string]`, so Terraform never owned
their content. Step 4c of `docs/deploy-role-trust.md` in thegoodparty/ops.

## Alternatives rejected

- **Check the API key in the Lambdas instead of the ALB.** Removes the value
  from Terraform entirely, but changes how the endpoints authenticate.
- **A placeholder `serve_api_key` on plans.** Every PR plan would show the two
  listener rules changing, which trains reviewers to ignore the root.
- **Keep the managed broker versions and plan with `-refresh=false`.** Loses
  drift detection on every other resource in the root.
- **A dedicated `SERVE_API_KEY` secret.** Still a `GetSecretValue` grant on the
  plan role, for a value that is in state regardless.

## Revisit if

The ALB stops being the place the API key is checked, at which point
`serve_api_key` and its two script blocks can go.
