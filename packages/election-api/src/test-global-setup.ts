import { Client } from 'pg'
import {
  TEMPLATE_LOCK_KEY,
  TEMPLATE_PREFIX,
  TEST_POSTGRES_URL_VAR,
  externalTestPostgresUrl,
  loadMigrationsSql,
  templateDbName,
  testPostgresUri,
  withDatabase,
} from './test-postgres'

// Runs once for the whole vitest run, before any worker starts. Builds the
// schema into a template database a single time so each useTestService suite can
// clone it (CREATE DATABASE ... TEMPLATE) instead of replaying every migration
// against the shared container in its own beforeAll.
//
// The template is named after a digest of the migrations it holds, so a
// concurrent run on the same commit shares this one instead of racing to
// rebuild it, and one on different migrations builds its own. Nothing is
// dropped and rebuilt in place, which is what the old fixed name did and what
// made two concurrent runs against one server destroy each other's template.
export default async () => {
  const baseUri = await testPostgresUri()

  // One probe before any other work, so that a sidecar that never came up
  // reads as broken infrastructure instead of as a wall of failing tests.
  if (externalTestPostgresUrl(process.env)) {
    const { hostname, port } = new URL(baseUri)
    const probe = new Client({ connectionString: baseUri })
    try {
      await probe.connect()
    } catch (err) {
      const cause = err instanceof Error ? err.message : 'unknown error'
      throw new Error(
        `${TEST_POSTGRES_URL_VAR} points at ${hostname}:${port}, but the ` +
          `test database there is unreachable: ${cause}. This is the test ` +
          'infrastructure, not the code under test — every database-backed ' +
          'failure in this run is this connection, not the change being ' +
          `tested. Start the Postgres sidecar, or unset ` +
          `${TEST_POSTGRES_URL_VAR} to fall back to a testcontainer.`,
      )
    }
    await probe.end()
  }

  // DB SAFETY: the testcontainer always binds to a random localhost port. Refuse
  // to run migrations against anything but a local host — this guarantees the
  // harness can never touch a dev/prod database, even if misconfigured.
  const host = new URL(baseUri).hostname
  if (host !== 'localhost' && host !== '127.0.0.1') {
    throw new Error(
      `Refusing to migrate a non-local test database (host=${host}). ` +
        'The integration harness only ever targets a Postgres testcontainer.',
    )
  }

  const template = templateDbName()

  const admin = new Client({ connectionString: baseUri })
  await admin.connect()
  try {
    await admin.query(`SELECT pg_advisory_lock(${TEMPLATE_LOCK_KEY})`)

    // A builder only holds a scratch database while it holds this lock, so
    // anything matching right now is residue from a run that died before it
    // could publish. Superseded templates and clones left by killed runs are
    // not swept: an external server is a sidecar recycled with the task, and
    // a container is recycled with the machine.
    const abandoned = await admin.query<{ datname: string }>(
      'SELECT datname FROM pg_database WHERE datname LIKE $1',
      [`${TEMPLATE_PREFIX}%_building_%`],
    )
    for (const { datname } of abandoned.rows) {
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
      connectionString: withDatabase(baseUri, scratch),
    })
    await build.connect()
    await build.query(loadMigrationsSql())
    await build.end()

    // Postgres refuses to copy a database while any session is connected to
    // it, so bar connections outright the way template0 does. Concurrent
    // clones are then safe no matter how many runs share this server.
    await admin.query(
      `ALTER DATABASE "${scratch}" WITH ALLOW_CONNECTIONS false`,
    )
    await admin.query(`ALTER DATABASE "${scratch}" RENAME TO "${template}"`)
  } finally {
    await admin.query(`SELECT pg_advisory_unlock(${TEMPLATE_LOCK_KEY})`)
    await admin.end()
  }
}
