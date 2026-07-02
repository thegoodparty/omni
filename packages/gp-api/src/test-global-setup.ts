import { Client } from 'pg'
import {
  TEMPLATE_DB,
  loadMigrationsSql,
  startTestPostgres,
} from './test-postgres'

// Runs once for the whole vitest run, before any worker starts. Builds the
// schema into a template database a single time so each useTestService suite can
// clone it (CREATE DATABASE ... TEMPLATE) instead of replaying every migration
// against the shared container in its own beforeAll.
export default async () => {
  const container = await startTestPostgres()
  const baseUri = container.getConnectionUri()

  const admin = new Client({ connectionString: baseUri })
  await admin.connect()
  await admin.query(`DROP DATABASE IF EXISTS ${TEMPLATE_DB} WITH (FORCE)`)
  await admin.query(`CREATE DATABASE ${TEMPLATE_DB}`)
  await admin.end()

  const template = new Client({
    connectionString: baseUri.replace('/postgres', `/${TEMPLATE_DB}`),
  })
  await template.connect()
  await template.query(loadMigrationsSql())
  await template.end()
}
