import { randomUUID } from 'node:crypto'
import { PgBoss } from 'pg-boss'
import { z } from 'zod'

// Queue jobsLoadTest jobs to load-test job-driven autoscaling
// (src/jobs/AGENTS.md § Scaling). DATABASE_URL picks the database.
//   npm run jobs:load-test -- <count> <seconds> [--allow-prod]
// Each job sleeps <seconds> on a worker. Every job is its own group, so a
// free worker on any task can start it.

const usage = 'usage: <count> <seconds (1-600)> [--allow-prod]'

const args = process.argv.slice(2)
const allowProd = args.includes('--allow-prod')
const positional = args.filter((arg) => arg !== '--allow-prod')

const main = async () => {
  const parsed = z
    .tuple([
      z.coerce.number().int().min(1),
      z.coerce.number().int().min(1).max(600),
    ])
    .safeParse(positional)
  if (!parsed.success) {
    console.log(usage)
    process.exitCode = 1
    return
  }
  const [count, seconds] = parsed.data
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('Set DATABASE_URL')
  const host = new URL(connectionString).hostname
  // In prod these jobs also page jobs-backed-up and add tasks for real.
  if (host.includes('gp-api-db-prod') && !allowProd) {
    throw new Error(`${host} is prod; pass --allow-prod to load-test it`)
  }
  const boss = new PgBoss({
    connectionString,
    max: 2,
    migrate: false,
    supervise: false,
    schedule: false,
    registerInstance: false,
  })
  await boss.start()
  try {
    const jobs = Array.from({ length: count }, () => {
      const id = randomUUID()
      // key_strict_fifo needs a key on every job; its own id makes it its
      // own group.
      return { id, data: { seconds }, singletonKey: id }
    })
    await boss.insert('jobsLoadTest', jobs)
    console.log(
      `Queued ${count} jobsLoadTest job(s) of ${seconds}s each on ${host}`,
    )
  } finally {
    await boss.stop({ graceful: false })
  }
}

void main()
