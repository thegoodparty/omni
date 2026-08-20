import { Client } from 'pg'
import {
  TEMPLATE_LOCK_KEY,
  TEMPLATE_PREFIX,
  loadMigrationsSql,
  startTestPostgres,
  templateDbName,
} from './test-postgres'

// Suites drop their own clone, so a survivor means the run that made it was
// killed. Age-gate it anyway: a young clone may belong to a run in flight.
const STALE_CLONE_INTERVAL = '6 hours'

// A superseded template is cheap to rebuild and otherwise leaves one full
// schema copy per migration set this machine has ever tested.
const STALE_TEMPLATE_INTERVAL = '7 days'

// pg_database carries no creation time. missing_ok is what keeps this from
// throwing when a concurrent run's afterAll drops its clone mid-query.
const CREATED_AT =
  "(pg_stat_file('base/' || oid || '/PG_VERSION', true)).modification"

// Runs once for the whole vitest run, before any worker starts, so each
// useTestService suite can clone a prebuilt schema (CREATE DATABASE ...
// TEMPLATE) instead of replaying every migration in its own beforeAll.
//
// The template is named after a digest of the migrations it holds, so a
// concurrent run on the same commit shares this one instead of racing to
// rebuild it, and one on different migrations builds its own. Nothing is
// dropped and rebuilt in place, which is what the old fixed name required and
// what forced the container to be scoped per checkout.
export default async () => {
  const container = await startTestPostgres()
  const baseUri = container.getConnectionUri()
  const template = templateDbName()

  const admin = new Client({ connectionString: baseUri })
  await admin.connect()
  try {
    await admin.query(`SELECT pg_advisory_lock(${TEMPLATE_LOCK_KEY})`)

    // A builder only holds a scratch database while it holds this lock, so
    // anything matching right now is residue from a run that died before it
    // could publish.
    const abandoned = await admin.query<{ datname: string }>(
      'SELECT datname FROM pg_database WHERE datname LIKE $1',
      [`${TEMPLATE_PREFIX}%_building_%`],
    )

    const superseded = await admin.query<{ datname: string }>(
      `SELECT datname FROM pg_database
         WHERE datname LIKE $1 AND datname <> $2
           AND ${CREATED_AT} < now() - interval '${STALE_TEMPLATE_INTERVAL}'`,
      [`${TEMPLATE_PREFIX}%`, template],
    )

    const staleClones = await admin.query<{ datname: string }>(
      `SELECT datname FROM pg_database
         WHERE datname LIKE 'test_db_%'
           AND ${CREATED_AT} < now() - interval '${STALE_CLONE_INTERVAL}'`,
    )

    for (const { datname } of [
      ...abandoned.rows,
      ...superseded.rows,
      ...staleClones.rows,
    ]) {
      await admin.query(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`)
    }

    const existing = await admin.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [template],
    )
    if (existing.rowCount) return

    // Build under a scratch name and publish with a rename. CREATE DATABASE
    // makes a database visible before the migrations below finish replaying
    // into it, so existence is not readiness: a run killed mid-replay would
    // otherwise leave a half-built template that every later run would clone.
    const scratch = `${template}_building_${process.pid}`
    await admin.query(`CREATE DATABASE "${scratch}"`)

    const build = new Client({
      connectionString: baseUri.replace('/postgres', `/${scratch}`),
    })
    await build.connect()
    await build.query(loadMigrationsSql())
    await build.end()

    // Postgres refuses to copy a database while any session is connected to
    // it, so bar connections outright the way template0 does. Concurrent
    // clones are then safe no matter how many checkouts share this container.
    await admin.query(
      `ALTER DATABASE "${scratch}" WITH ALLOW_CONNECTIONS false`,
    )
    await admin.query(`ALTER DATABASE "${scratch}" RENAME TO "${template}"`)
  } finally {
    await admin.query(`SELECT pg_advisory_unlock(${TEMPLATE_LOCK_KEY})`)
    await admin.end()
  }
}
