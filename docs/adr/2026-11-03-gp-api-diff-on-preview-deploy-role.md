---
title: gp-api's infrastructure diff runs on the preview deploy role, not a role of its own
status: active
decided_by: [swain]
date: 2026-11-03
code: ['#3524']
scope:
  - .github/workflows/gp-api-infrastructure-diffs.yml
supersedes: []
superseded_by:
---

# gp-api's infrastructure diff runs on the preview deploy role, not a role of its own

## Decision

`gp-api-infrastructure-diffs.yml` assumes `github-actions-preview-deploy`,
the role PR previews and their teardown already use. Every AWS role an omni
pull request job assumes for gp-api's Pulumi is that one role. Its grants
for the diff are reads only, each named in thegoodparty/ops
(`deploy/components/ci-roles/policies.ts`): gp-api's current dev and prod
checkpoints, the state passphrase, the two Grafana tokens, the prod app
secret's metadata, and the dev and prod gp-api services.

## Context

Step 5b of `docs/deploy-role-trust.md` in thegoodparty/ops moves the diff off
the admin deploy role, which 4b (#3507) made possible. Both candidate roles
would be trusted on `repo:thegoodparty/omni:pull_request`, and a pull request
can assume any role trusted on its subject by editing its workflow. Two
roles would separate nothing, and one role keeps everything an omni pull
request can reach in one document.

## Alternatives rejected

- **A dedicated `github-actions-gp-api-plan` role.** The first version of
  thegoodparty/ops#440. It had the Terraform plan role's shape,
  `ReadOnlyAccess` plus denies, so a new lookup would have worked without an
  ops change. Rejected in review because it adds a second document for the
  same subject without narrowing what that subject can reach.

## Revisit if

The diff needs reads the preview deploy role's inline policy cannot fit:
the diff's statements then move to a managed policy on the same role, not
to a new role.
