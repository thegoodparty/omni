# Contracts (`@goodparty_org/contracts`)

Shared Zod schemas and TypeScript types consumed by `gp-api`, `@goodparty_org/sdk`, and `gp-admin`. Anything that crosses a service boundary (request/response shapes, public enums) belongs here. ADR / detailed guide: `docs/contracts.md`.

**In-tree, not published.** Despite the scoped `@goodparty_org/contracts` name, this is an in-tree workspace package, not a live npm-registry package. Consumers depend on it via a `"*"` workspace dependency and a node_modules symlink, so a change is live as soon as it's built — no version bump, no publish, no install. npm publishing is intentionally disabled in omni (see the "publish ... not enabled in omni yet" note in `.github/workflows/contracts.yml`). It was published pre-monorepo; don't assume the scoped name implies a registry release.

## Key files

| Path                        | Purpose                                                                       |
| --------------------------- | ----------------------------------------------------------------------------- |
| `package.json`              | npm metadata; `name: "@goodparty_org/contracts"`, dual CJS/ESM build via tsup |
| `tsup.config.ts`            | Build config — emits `dist/index.{js,mjs,d.ts}`                               |
| `src/index.ts`              | Public surface; everything reachable from here is exported                    |
| `src/<feature>/`            | Per-domain schemas (`campaigns/`, `users/`, `elections/`, `ecanvasser/`)      |
| `src/shared/`               | Cross-domain primitives (pagination, enums, util types)                       |
| `src/generated/`            | Output of `scripts/generate-enums.ts` (Prisma → Zod enum mirrors)             |
| `scripts/generate-enums.ts` | Generates Zod enums from Prisma enums to keep them in sync                    |
| `CHANGELOG.md`              | Historical changelog from the pre-monorepo package                            |
| `dist/`                     | Local build output                                                            |

## Patterns

- **Build pipeline is two stages**: `npm run generate-enums` → `tsup`. Both run via `npm run build`. `scripts/build-contracts.ts` at the repo root short-circuits when the source is older than `dist/index.js`.
- **Prisma enums are the source of truth for enum values** — never hand-write a Zod enum that mirrors a Prisma one; let `generate-enums.ts` do it. Add the Prisma enum first, then regenerate.
- **Adding a public schema**: create the Zod schema in `src/<feature>/`, export from `src/<feature>/index.ts`, then re-export from `src/index.ts`. If it isn't reachable from the root index, it doesn't ship.
- **Consumer updates are part of the contract change.** Because consumers use the workspace package directly, update affected apps in the same PR instead of relying on a version bump.
- The contracts build runs automatically on `npm run start:dev`, `npm run build`, and `npm test` — you generally don't run `cd contracts && npm run build` by hand.

## Gotchas

- **Never bypass `@goodparty_org/contracts` for cross-service shapes** (root `AGENTS.md`, "Never" list). Don't redeclare a schema in `gp-api/src/` if it's already in contracts.
- **Don't use `.passthrough()` on input schemas** (Rule from root `AGENTS.md`). Use `.strict()` or the default behaviour.
- `dist/` should never be edited by hand — it's regenerated on every build.
- `gp-sdk`, `gp-admin`, and `gp-api` consume this in-tree via the `"*"` workspace dependency (node_modules symlink), not over the npm registry. A breaking change is live the moment it's built — coordinate the producer and every consumer in the **same PR** rather than relying on a version bump.

## Verify

Reproduce the CI **Validate** job (`.github/workflows/contracts.yml`) before opening a PR. From the repo root:

```bash
npm run build -w packages/contracts   # generate-enums + tsup
```
