---
title: Prisma migrations own the pgboss schema; pg-boss never migrates itself
status: active
decided_by: [agent]
date: 2026-11-07
code: ['#3676']
scope:
  - packages/gp-api/src/jobs/jobs.service.ts
  - packages/gp-api/scripts/pg-boss-migration.ts
  - packages/gp-api/prisma/schema/migrations/*_pg_boss_*/**
supersedes: []
superseded_by:
---

# Prisma migrations own the pgboss schema; pg-boss never migrates itself

## Decision

The `pgboss` schema is installed and upgraded by Prisma migrations generated
from pg-boss's own SQL (`npm run migrate:pg-boss`). pg-boss runs with
`migrate: false`, so a task whose pg-boss version does not match the
installed schema fails at `start()` instead of changing the schema.

## Context

Every gp-api boot already runs `prisma migrate deploy` once, before the app
starts. The test harness builds one template database from the Prisma
migrations, so the schema reaches every test suite with no extra step.
Prisma only diffs the `public` schema, so the CI drift check ignores
`pgboss`.

## Alternatives rejected

- **Let pg-boss migrate on `start()`** (its default). Two migration systems
  at boot, schema changes made by whichever task starts first, and a test
  template without the schema, so every suite would install it.
