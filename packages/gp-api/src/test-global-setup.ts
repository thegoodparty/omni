import { Client } from 'pg'
import {
  TEMPLATE_DB,
  TEMPLATE_LOCK_KEY,
  loadMigrationsSql,
  startTestPostgres,
} from './test-postgres'

// Runs once for the whole vitest run, before any worker starts. Builds the
// schema into a template database a single time so each useTestService suite can
// clone it (CREATE DATABASE ... TEMPLATE) instead of replaying every migration
// against the shared container in its own beforeAll.
//
// Another vitest run process can be doing the exact same thing against this
// same reused container right now. Without the advisory lock, its DROP
// DATABASE ... WITH (FORCE) can land while a suite here is mid-clone, which
// reproducibly breaks with "template database does not exist" and lock
// timeouts on the per-test TRUNCATE. The exclusive lock blocks until every
// suite's shared clone lock (test-service.ts) is released, then proceeds.
export default async () => {
  const container = await startTestPostgres()
  const baseUri = container.getConnectionUri()

  const admin = new Client({ connectionString: baseUri })
  await admin.connect()
  try {
    await admin.query(`SELECT pg_advisory_lock(${TEMPLATE_LOCK_KEY})`)
    await admin.query(`DROP DATABASE IF EXISTS ${TEMPLATE_DB} WITH (FORCE)`)
    await admin.query(`CREATE DATABASE ${TEMPLATE_DB}`)

    const template = new Client({
      connectionString: baseUri.replace('/postgres', `/${TEMPLATE_DB}`),
    })
    await template.connect()
    await template.query(loadMigrationsSql())
    await template.end()
  } finally {
    await admin.query(`SELECT pg_advisory_unlock(${TEMPLATE_LOCK_KEY})`)
    await admin.end()
  }
}
