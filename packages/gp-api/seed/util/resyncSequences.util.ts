import { PrismaClient } from '../../src/generated/prisma'

/**
 * Tables the factory seeds insert into with an EXPLICIT `id`, where the model's
 * `id` is `@default(autoincrement())` and therefore backed by a Postgres
 * sequence.
 *
 * Postgres only advances a sequence when a row actually draws from it. An
 * insert that supplies its own id leaves the sequence untouched, so after the
 * seed the sequence still points near 1 while `MAX(id)` is somewhere else
 * entirely, and the next insert that relies on the default gets handed an id
 * that already exists — Prisma P2002 on the id column. It does not self-heal:
 * the sequence has to climb all the way past `MAX(id)` first.
 *
 * Normally that is a few hundred wasted ids. Here it is unbounded, because all
 * three factories draw from `faker.number.int({ max: 2147483647 })` — the int4
 * ceiling. One seeded row can land `MAX(id)` within a rounding error of 2^31,
 * after which creating a campaign position or plan version in that database
 * fails essentially forever.
 *
 * Kept as a literal list rather than derived from the Prisma DMMF because the
 * hazard is not "this model autoincrements", it is "a seed writes this model's
 * id by hand" — a property of the seed, not of the schema.
 * resyncSequences.util.test.ts checks this list against the factories.
 */
export const SEQUENCE_BACKED_TABLES_SEEDED_WITH_EXPLICIT_IDS = [
  'campaign_plan_version',
  'campaign_position',
  'campaign_update_history',
] as const

/**
 * Point each sequence at `MAX(id) + 1` so the seeded database can create rows
 * normally afterwards.
 *
 * Only ever reached from the factory seeds, which run against preview
 * (`gpdb_pr_<n>`) and local databases. Production never executes them — the
 * entrypoint gates seeding on `IS_PREVIEW`, and `seed.ts` gates the factory
 * branch on `NODE_ENV`.
 *
 * `setval(seq, n, false)` means "the next nextval() returns n", which is what
 * makes the empty-table case correct: `MAX(id)` is NULL, `COALESCE(..., 0) + 1`
 * is 1, and the first row gets id 1 exactly as a fresh sequence would. It is
 * also why this is idempotent — the value is computed from the table, not
 * incremented, so repeated runs converge rather than drift. Safe to run before
 * traffic only: it can hand back ids that a concurrent insert is using.
 *
 * `pg_get_serial_sequence` returns NULL for a column with no sequence, and
 * `setval` is strict, so a model that later moves off autoincrement turns this
 * into a silent no-op rather than an error. That silence is the trap worth
 * naming: a resync aimed at a non-sequence column reports success while doing
 * nothing at all, so the list above has to be kept honest by the test, not by
 * trusting that this function would complain.
 */
export async function resyncSeededSequences(prisma: PrismaClient) {
  for (const table of SEQUENCE_BACKED_TABLES_SEEDED_WITH_EXPLICIT_IDS) {
    // Table names come from the frozen const list above, never from input.
    await prisma.$executeRawUnsafe(
      `SELECT setval(
         pg_get_serial_sequence('"${table}"', 'id'),
         COALESCE((SELECT MAX(id) FROM "${table}"), 0) + 1,
         false
       )`,
    )
  }
}
