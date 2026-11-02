---
title: gp-api Pulumi reads no GP_API secret value and manages no database password
status: active
decided_by: [dealvz]
date: 2026-11-02
code: ['#3507']
scope:
  - packages/gp-api/deploy/**
supersedes: []
superseded_by:
---

# gp-api Pulumi reads no GP_API secret value and manages no database password

## Decision

gp-api's Pulumi program never reads `GP_API_DEV` or `GP_API_PROD`. It takes
the secret's ARN from `getSecret`, and the keys it wires into the task
definition are declared per environment in `deploy/gp-api-secret-keys.ts`.
The Aurora clusters it owns (`gp-api-db`, `gp-api-db-prod`,
`gp-api-preview-shared-db`) carry no `masterPassword` input, the same as the
election cluster: each keeps the password it has, and tasks read
`DB_PASSWORD` from the secret at start. The one read of the secret's value
is a key check in `infra-cli.ts`, on dev and prod deploys only. So a pull
request's `pulumi preview` needs no `secretsmanager:GetSecretValue`, and no
stack's state holds a database password.

## Context

Step 4b of `docs/deploy-role-trust.md` in thegoodparty/ops: the gp-api
infrastructure diff on pull requests can move to a read-only role only once
the program stops reading secret values. The program read the whole secret
for two things, `DB_PASSWORD` as the clusters' `masterPassword` and the key
names for the task definition. The password also sat in each stack's state,
encrypted with the passphrase that any role running a diff must hold.

## Alternatives rejected

- **RDS-managed master password (`manageMasterUserPassword`).** Switching an
  existing cluster replaces its password at once, so prod needs a cutover.
  RDS then rotates it on a schedule, and ECS resolves secrets only at task
  start, so running tasks would fail new connections after each rotation.
- **Move the clusters to a stack that deploys only from `main`.** The largest
  change, it loses the pull request diff for database changes, and the new
  stack would still need one of the other answers for the password.

## Revisit if

The database password should rotate automatically: the managed password is
then the answer, together with tasks that re-read it.
