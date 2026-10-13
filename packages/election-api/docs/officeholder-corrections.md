# Correcting officeholder data (incumbents, ended terms)

`OfficeHolder` is **ETL-owned**: `gp-data-platform` rebuilds it from BallotReady
`office_holders_v3` (see `prisma/schema/officeHolder.prisma`). Neither `election-api`
nor `gp-api` writes it, and there is no in-repo override table. That is deliberate:
a row edited by hand in Postgres is replaced on the next ETL run, so it is not a fix.

## Rule

Never edit `OfficeHolder` (or `Person`) rows in production by hand. Fix the source.

## Where public profiles read incumbency

- `PersonsService` (`src/persons/persons.service.ts`) returns `Person.OfficeHolders`.
- A term counts as current via `OfficeHolder.isCurrent` (BallotReady-derived),
  with `startAt` / `endAt` as the term dates. A seat shows an incumbent only when
  one of its terms has `isCurrent = true`.

## Runbook: someone took over a term (resignation, appointment, special election)

Example: ENG-11254. Joy Page replaced Rene Neal on DC ANC SMD 8C08.

1. Look up both people by slug in election-api and note each `OfficeHolder` row:
   `GET /v1/persons/by-slug/<slug>?includeOfficeHolders=true`. Confirm Neal's row
   still has `isCurrent = true` / no `endAt`, and whether Page has any row.
2. Report the correction to BallotReady (office holder add/end for the position).
   This is the durable path: the next import carries it into `OfficeHolder`.
3. If BallotReady will be slow, ask the data team to add an override in
   `gp-data-platform` (a dbt seed joined into the officeholder mart, keyed on
   `br_office_holder_id` / position + person, setting `is_current`, `start_at`,
   `end_at`). Overrides must live in that repo so every rebuild applies them.
4. After the next ETL run, re-check both slugs and the public page.

A human (data team or BallotReady contact) must do steps 2-3. Code in this repo
cannot create or end a term.

## If an in-app override is ever wanted

It would need a new table (for example `OfficeHolderOverride`) written by an
authenticated admin route, and `PersonsService` merging it over ETL rows at read
time. That is a product decision, not a bug fix; raise it before building.
