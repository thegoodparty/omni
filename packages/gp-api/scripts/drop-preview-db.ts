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
  // Never let the task hang: a run-task that never exits blocks its ECS
  // cluster's teardown (ClusterContainsTasksException). Fail fast if the
  // cluster is unreachable or a statement stalls.
  connectionTimeoutMillis: 15_000,
  statement_timeout: 60_000,
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

  // WITH (FORCE) terminates surviving sessions and drops in one step
  // (Postgres 13+), so a still-running preview app can't block the drop.
  // Double-quote the name for the underscore/digit pattern; prNumber is a
  // GitHub-supplied PR number, not free-form user input.
  await client.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`)

  console.log(`Dropped database ${dbName}.`)
  await client.end()
}

main().catch((err) => {
  console.error('drop-preview-db failed:', err)
  process.exit(1)
})
