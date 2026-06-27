import { Client } from 'pg'

// Drops the per-PR preview database from the shared Aurora cluster.
// Must run from inside the VPC — the cluster endpoint is not public.
// Invoked via `aws ecs run-task` command override during PR teardown.

const prNumber = process.env.PR_NUMBER
const dbHost = process.env.DB_HOST
const dbUser = process.env.DB_USER
const dbPassword = process.env.DB_PASSWORD

if (!prNumber || !dbHost || !dbUser || !dbPassword) {
  console.error('Required env vars: PR_NUMBER, DB_HOST, DB_USER, DB_PASSWORD')
  process.exit(1)
}

const dbName = `gpdb_pr_${prNumber}`

const client = new Client({
  host: dbHost,
  port: 5432,
  // Connect to the maintenance DB — the target DB may still have active
  // sessions and cannot be dropped from within itself.
  database: 'postgres',
  user: dbUser,
  password: dbPassword,
  ssl: { rejectUnauthorized: false },
})

const main = async () => {
  await client.connect()

  const exists = await client.query(
    'SELECT 1 FROM pg_database WHERE datname = $1',
    [dbName],
  )

  if (exists.rows.length === 0) {
    console.log(`Database ${dbName} does not exist, nothing to drop.`)
    await client.end()
    return
  }

  // Terminate any surviving connections so DROP DATABASE does not
  // block. pg_terminate_backend returns false for sessions that
  // cannot be terminated (e.g. superuser), but DROP DATABASE IF
  // EXISTS below handles any remaining ones.
  await client.query(
    `SELECT pg_terminate_backend(pid)
     FROM pg_stat_activity
     WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [dbName],
  )

  // Double-quote the database name to handle the underscore/digit
  // pattern safely without interpolating any user-controlled value
  // into the SQL string.
  await client.query(`DROP DATABASE IF EXISTS "${dbName}"`)

  console.log(`Dropped database ${dbName}.`)
  await client.end()
}

main().catch((err) => {
  console.error('drop-preview-db failed:', err)
  process.exit(1)
})
