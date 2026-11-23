---
title: gp-ai Terraform uses AWS provider v6
status: active
decided_by: [swain]
date: 2026-10-30
code: ['#3450']
scope:
  - packages/gp-ai/infrastructure/**
supersedes: []
superseded_by:
---

# gp-ai Terraform uses AWS provider v6

## Decision

Every gp-ai Terraform root and module requires `hashicorp/aws` `~> 6.0`. Each
root's `.terraform.lock.hcl` pins the exact version, with `h1` hashes for
linux_amd64, darwin_arm64 and darwin_amd64. Read the region from
`data.aws_region.<name>.region`, not the deprecated `.name`.

## Context

The serve-analyze trigger and `shared/slack-notifier` Lambdas need to move
from `nodejs22.x` to `nodejs24.x` with the rest of omni's Node 24 move. The
provider only accepts `nodejs24.x` from 6.21.0, and 5.100.0 is the last 5.x
release. None of the 47 resource types these roots manage changed schema
version between 5.100.0 and 6.71.0, so state written by v6 stays readable by
v5 if this has to be reverted.

## Alternatives rejected

- Stay on v5 and keep both Lambdas on `nodejs22.x`. That ties them to a Node
  line the rest of omni is leaving, and the provider will never add new
  runtimes to 5.x.
- Move only the two roots that own the Lambdas. dev and prod roots call the
  same modules, so a split pin means every module has to work on both
  provider majors.

## Revisit if

The provider ships v7, or a 6.x release changes the schema version of a
resource type these roots manage. A rollback to v5 is no longer safe after
that.
