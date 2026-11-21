# Prisma

Postgres schema, migrations, and the Prisma client surface. Schema is split per-model under `schema/` (Prisma's multi-file schema feature). Migrations are immutable once applied.

## Key files

| Path                                    | Purpose                                                                             |
| --------------------------------------- | ----------------------------------------------------------------------------------- |
| `schema/schema.prisma`                  | Generators (`prisma-client-js`, `prisma-json-types-generator`) and datasource       |
| `schema/<model>.prisma`                 | One file per model (`campaign.prisma`, `organization.prisma`, etc.)                 |
| `schema/migrations/<timestamp>_<name>/` | Applied migrations — **never edit, never delete**                                   |
| `schema/migrations/migration_lock.toml` | Prisma's lock — committed                                                           |
| `schema/<model>.jsonTypes.d.ts`         | Hand-maintained TS types for `Json` columns (avoid creating new ones — see Rule 25) |

## Patterns

- **One model per file.** When adding a model, create `schema/<modelName>.prisma`. Don't append to `schema.prisma`.
- **The PrismaBase pattern is mandatory** for services backed by a model — see root `CLAUDE.md`.
- **Migrations**: `npm run migrate:dev` creates and applies one locally. `npm run migrate:reset` wipes the local DB and re-seeds. Never run reset against a non-local database.
- **Pending-migration check** runs on every `npm run start:dev` via `scripts/check-pending-migrations.ts`. If you see the yellow warning banner, run `migrate:dev` before continuing.
- **`prisma-json-types-generator`** turns `Json` columns into typed fields if you have a matching `<model>.jsonTypes.d.ts` and a `///` comment annotation in the `.prisma` file (e.g. `/// [CampaignData]`). The generator is run as part of `npm run generate`.

## Gotchas

- **Migrations are immutable.** Editing a file in `schema/migrations/<timestamp>/` after it's been applied will desync prod from dev. If you need to fix a bad migration, write a new one.
- **Drop a column or table one deploy after the code stops using it.** `prisma migrate deploy` runs when each new task boots (`packages/gp-api/deploy/docker-entrypoint.sh`), and prod keeps the previous deploy's tasks serving until the new ones are healthy, then drains them for 120s (`deploymentMinimumHealthyPercent` and `deregistrationDelay` in `packages/gp-api/deploy/components/service.ts`). So for minutes the old code runs against the new schema. Prisma names every mapped column in its SELECT and in a `create`'s or `update`'s RETURNING, so an old task fails on a dropped column even when nothing reads its value and the table is empty. Ship it in two PRs: first remove every use from the code and the Prisma model with no migration, then, once that is live in prod, the drop migration. The same holds for a rename and for a new NOT NULL column without a default. #3891 and #3893 are the worked example. `npm run check:destructive-migrations` (CI) fails a migration this change adds that drops or renames a column or table unless it carries `-- expand-contract: <why the drop is safe>`.
- **Secrets stay out of Databricks.** The `databricks_federation` role reads every table in `public`, including future ones, except `user.password`, `user.password_reset_token` and `peerly_phone_list.token`. Those two tables have column-level grants instead, so a new column on either is unreadable until a migration runs `GRANT SELECT (<column>) ON <table> TO databricks_federation`. A migration that adds a secret column (token, hash, key) to any other table must revoke that table and grant its other columns. See `deploy/databricks/federation/README.md`.
- **`map:` and snake_case** — DB columns are `snake_case`, Prisma fields are `camelCase`, joined by `@map()`. Match the existing style on adjacent fields when adding columns.
- **`Json` columns are an anti-pattern** for known-shape data (Rule 25). Several legacy models (`Campaign.data`, `Campaign.details`) use them — don't replicate that for new models. Prefer proper columns or relations.
- **Don't bypass `npm run generate`.** `prisma generate` alone misses the route-types step (`scripts/generate-route-types.ts`) that the `generate` script also runs.
- `binaryTargets = ["native", "linux-musl-openssl-3.0.x"]` is set so the same `node_modules/.prisma` works in the Alpine Docker image — keep it.
