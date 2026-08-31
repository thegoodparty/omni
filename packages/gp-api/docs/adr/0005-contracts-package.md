# 0005 — Shared contracts package

Status: accepted

## Context

`gp-webapp` and `gp-sdk` need request/response types and Zod schemas that match gp-api exactly. Three options:

1. Each consumer redeclares the shapes (drift guaranteed)
2. Generate an OpenAPI spec from the API and have consumers code-gen against it
3. A shared workspace package owned in the monorepo, consumed by everyone

## Decision

Option 3. `packages/contracts` is an npm workspace package named `@goodparty_org/contracts`. It contains Zod schemas (which produce both runtime validators and TS types via `z.infer`) and re-exports generated Prisma enums.

Builds via `tsup`. `dist/` is gitignored, and consumers resolve the package through `main`/`types`, which point into it — so a missing or stale `dist` surfaces as nonsense in the consumer rather than as a clear "build me first". `packages/contracts/scripts/ensure-built.ts` guards that: it rebuilds only when `dist` is older than the sources, and every consumer calls it from its build and typecheck scripts and from its vitest global setup.

## Process

- Changes to `packages/contracts/src/` should update affected consumers in the same PR.
- CI builds contracts before consumers so type and runtime drift is caught before merge.

## Known gap

The most-used campaign shapes (`CampaignSchema.data`, `details`, `aiContent`) are still typed as `z.record(z.string(), z.unknown())` in contracts. The real shape lives in `gp-api/src/campaigns/schemas/updateCampaign.schema.ts`. Migrating it is a multi-PR refactor coordinated with gp-webapp consumers.

## Consequences

- One source of truth for cross-service shapes.
- Adding a new shared shape costs: edit contracts, build, and import/update consumers in the same PR. Documented as a workflow in `docs/contracts.md`.
