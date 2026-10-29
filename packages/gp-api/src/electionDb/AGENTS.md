# AGENTS.md

Election, race, place, position and candidacy data. Read-only in gp-api — the
tables are loaded by ETL, and nothing here writes to them.

## Why this is a second Prisma client

The data lives on its own Aurora cluster (`election-api-db-{develop,prod}`),
separate from gp-api's. It stays there: consolidating the service did not
consolidate the databases. So this directory owns a second generated client,
`src/generated/election-prisma`, built from `prisma-election/schema`.

`ElectionDbService` holds that client. Model-backed services extend
`createElectionDbBase(ELECTION_MODELS.X)` — the election-side analogue of
`createPrismaBase(MODELS.X)`. It gives you `this.model`, `this.client`,
`this.logger` and the usual bound passthroughs.

```ts
@Injectable()
export class PlacesService extends createElectionDbBase(
  ELECTION_MODELS.Place,
) {}
```

Note there is no `constructor() { super() }`, unlike `createPrismaBase`
services elsewhere in gp-api: `no-useless-constructor` is an error here, and
the base needs no constructor arguments.

`ElectionDbModule` is `@Global()`, so services here do not import it.

## Layout

```
src/electionDb/
├── electionDb.service.ts       # owns the second PrismaClient
├── electionDbBase.util.ts      # createElectionDbBase, ELECTION_MODELS
├── electionDb.module.ts        # @Global
├── shared/util/                # ported helpers shared across the modules
└── <feature>/                  # service + schema + types + module, no controller
```

Controllers do **not** live here. The HTTP surface these services back is in
`src/elections/`, namespaced under `/v1/elections/*`. The routes gp-marketing
reads are `@PublicAccess()` + `ServiceReadGuard`, not `M2MOnly`: gp-marketing
sends a JWT-format machine token or a Vercel OIDC token, which
`SessionGuard` only turns into `serviceReader`, never `m2mToken`, so `M2MOnly`
would 403 it.
Every `src/elections/` controller also runs
`ServiceReadConcurrencyInterceptor`, which lets at most 30 machine-caller
reads (`serviceReader` or `m2mToken`) run at once per gp-api task. The rest
queue, and a read still waiting after 30s gets a 503. That leaves 20 of the 50
election-db connections free for user-facing reads during a gp-marketing
crawl. Human callers are not capped.
Most of what the old service exposed has no HTTP surface at all any more — it
is reached by direct injection from gp-api code.

## Local development

Locally the election database is `electiondb` in the gp-api docker Postgres,
loaded by `scripts/setup/election-db.sh` (run by `npm run setup`; refetch
and reload with `npm run seed:election`). The seed is every row for
Michigan, North Carolina and Wyoming in the dev election database, plus the
rows those point at in other states, with `Person.email`, `Person.phone`,
`Person.gp_api_user_id` and `Candidacy.email` nulled. Voter density is
limited to Laramie County, WY, which covers the fixture office in Cheyenne.

It is built by `prisma-election/seed/refresh.sh`, which needs a connection
to the dev election database (VPN only) and `--upload` writes it to the
private `gp-local-election-seed-dev` bucket that
`POST /v1/dev-env/election-seed` presigns. Never commit the file: this repo
is public and the seed is restricted data. Refresh it when a migration adds
a required column, or when its races have mostly passed; the "upcoming
election" reads run against real dates.

## Gotchas

- **`prisma-election/schema/migrations/` is byte-identical to what the old
  service applied.** The election database's `_prisma_migrations` table holds
  those checksums. Reformatting a migration — even whitespace — makes every
  one of them fail. Never touch an applied migration.
- **The datasource is named `db`, not `electionDb`.** Prisma namespaces native
  type attributes by datasource name, and 38 `@db.Date` / `@db.Char(2)` uses
  across the model files depend on it. `ElectionDbService` passes
  `datasources: { db: ... }` to match.
- **Migrations run fatally at boot** (`deploy/docker-entrypoint.sh`), except in
  previews, which read the shared dev election database and must never migrate
  it. CI guards schema-vs-migration drift in the `Checks` job.
- **The client connects fail-soft.** A satellite database must not stop gp-api
  booting, so a failed connect logs and retries lazily; `.instance` throws at
  request time instead. That is deliberately weaker than the migration gate.
- **Query logging is gated on `ENABLE_QUERY_LOGGING`, not `LOG_LEVEL`.** gp-api
  deploys `LOG_LEVEL=debug` in prod, so gating on it would ship every query and
  its parameters to Loki off the request event loop.
