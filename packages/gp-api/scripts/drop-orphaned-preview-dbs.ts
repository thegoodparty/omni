import { Client } from 'pg'

// Backstop sweep: drops per-PR preview databases on the shared Aurora cluster
// whose PR is no longer open (gpdb_pr_<n> with no matching open PR). Must run
// inside the VPC — the cluster endpoint is not public — so it is invoked via
// `aws ecs run-task` from the preview-cleanup cron, not from the CI runner.
//
// DB_PASSWORD is supplied by the task definition's Secrets Manager injection;
// DB_HOST (the shared cluster endpoint) and OPEN_PRS (space-separated open PR
// numbers) are passed as run-task env overrides.

const dbHost = process.env.DB_HOST
const dbUser = process.env.DB_USER
const dbPassword = process.env.DB_PASSWORD
const openPrs = (process.env.OPEN_PRS ?? '').split(/\s+/).filter(Boolean)

if (!dbHost || !dbUser || !dbPassword) {
  console.error('Required env vars: DB_HOST, DB_USER, DB_PASSWORD')
  process.exit(1)
}

const openPrSet = new Set(openPrs)

// An empty set is ambiguous between "no open PRs" and a fetch failure, and the
// consequence (dropping every preview database) is irreversible — refuse it.
if (openPrSet.size === 0) {
  console.log('OPEN_PRS is empty — skipping sweep to avoid dropping all dbs.')
  process.exit(0)
}

const client = new Client({
  host: dbHost,
  port: 5432,
  database: 'postgres',
  user: dbUser,
  password: dbPassword,
  ssl: { rejectUnauthorized: false },
})

const main = async () => {
  await client.connect()

  const result = await client.query<{ datname: string }>(
    "SELECT datname FROM pg_database WHERE datname LIKE 'gpdb_pr_%'",
  )

  let failed = 0
  for (const { datname } of result.rows) {
    const prNumber = datname.replace('gpdb_pr_', '')
    if (openPrSet.has(prNumber)) {
      console.log(`${datname}: PR #${prNumber} still open, keeping.`)
      continue
    }
    // One stuck database (e.g. a session that can't be terminated) must not
    // abort the rest of the sweep — log it and keep going.
    try {
      console.log(`Dropping orphaned ${datname} (PR #${prNumber} closed)...`)
      await client.query(
        `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
         WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [datname],
      )
      await client.query(`DROP DATABASE IF EXISTS "${datname}"`)
      console.log(`Dropped ${datname}.`)
    } catch (err) {
      failed += 1
      console.error(`Failed to drop ${datname}:`, err)
    }
  }

  await client.end()

  if (failed > 0) {
    console.error(`${failed} database(s) failed to drop; see logs above.`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('drop-orphaned-preview-dbs failed:', err)
  process.exit(1)
})
