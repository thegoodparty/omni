import { Client } from 'pg'
import { execFileSync } from 'child_process'

// Maintains gpdb_preview_template on the shared Aurora cluster: a fully
// migrated + seeded database that ticket 10552 copies per-PR via
// `CREATE DATABASE ... TEMPLATE gpdb_preview_template`. Must run inside the
// VPC — the cluster endpoint is not public — so it is invoked via
// `aws ecs run-task` from the refresh workflow, not from the CI runner.
//
// DB_PASSWORD is supplied by the task definition's Secrets Manager injection;
// DB_HOST (the shared cluster endpoint) is passed as a run-task env override.

const TEMPLATE_DB = 'gpdb_preview_template'

const dbHost = process.env.DB_HOST
const dbUser = process.env.DB_USER
const dbPassword = process.env.DB_PASSWORD

if (!dbHost || !dbUser || !dbPassword) {
  console.error('Required env vars: DB_HOST, DB_USER, DB_PASSWORD')
  process.exit(1)
}

const client = new Client({
  host: dbHost,
  port: 5432,
  database: 'postgres',
  user: dbUser,
  password: dbPassword,
  ssl: { rejectUnauthorized: false },
})

const terminateBackends = () =>
  client.query(
    `SELECT pg_terminate_backend(pid)
     FROM pg_stat_activity
     WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [TEMPLATE_DB],
  )

const main = async () => {
  await client.connect()

  // seed/seed.ts is not idempotent (seedOffices/seedEcanvasserDemoAccount do
  // blind creates against unique columns, factory seeds compound on re-run),
  // so we cannot re-seed in place. Dropping and recreating an empty template
  // makes each refresh seed against a fresh DB exactly like a per-PR
  // gpdb_pr_<n> does today — the only seed path proven to work.
  // WITH (FORCE) terminates any lingering sessions as part of the drop, so a
  // session that reconnects after a plain terminate (idle-in-transaction, or a
  // concurrent CREATE DATABASE ... TEMPLATE) can't make DROP fail mid-refresh.
  await client.query(`DROP DATABASE IF EXISTS "${TEMPLATE_DB}" WITH (FORCE)`)
  await client.query(`CREATE DATABASE "${TEMPLATE_DB}"`)
  console.log(`Recreated empty ${TEMPLATE_DB}.`)

  const databaseUrl = `postgresql://${dbUser}:${dbPassword}@${dbHost}:5432/${TEMPLATE_DB}`
  // IS_PREVIEW=true makes seed/seed.ts take the factory-seed path (users,
  // campaigns, websites, offices, contentful) that PR previews get. Without it
  // the dev task def's NODE_ENV=production sends seed down the LIMIT_SEEDS csv
  // path (seedMtfcc → Google Sheets), which both fails here and is the wrong
  // data — the template must mirror a preview's seed, since per-PR DBs clone it.
  const childEnv = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    IS_PREVIEW: 'true',
  }

  console.log('Running prisma migrate deploy against template...')
  execFileSync(
    'npx',
    ['prisma', 'migrate', 'deploy', '--schema=prisma/schema'],
    { env: childEnv, stdio: 'inherit' },
  )

  console.log('Seeding template...')
  execFileSync('npx', ['tsx', 'seed/seed.ts'], {
    env: childEnv,
    stdio: 'inherit',
  })

  // Leave no open session on the template — Postgres rejects
  // CREATE DATABASE ... TEMPLATE while any session is connected to the source.
  await terminateBackends()
  await client.end()

  console.log(`${TEMPLATE_DB} refreshed.`)
}

main().catch((err) => {
  console.error('refresh-preview-template failed:', err)
  process.exit(1)
})
