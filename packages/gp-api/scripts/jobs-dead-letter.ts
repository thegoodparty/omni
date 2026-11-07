import { PgBoss } from 'pg-boss'

// Inspect and handle jobs in the pg-boss dead-letter queues. DATABASE_URL
// picks the database: the gp-api database of the affected environment.
//   npm run jobs:dead-letter -- list
//   npm run jobs:dead-letter -- redrive <job name> [job id]
//   npm run jobs:dead-letter -- delete <job name> <job id>
// A redriven job joins the back of its group.

const usage =
  'usage: list | redrive <job name> [job id] | delete <job name> <job id>'

const [command, name, id] = process.argv.slice(2)

const main = async () => {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('Set DATABASE_URL')
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
    if (command === 'list') {
      const queues = await boss.getQueues()
      for (const queue of queues.filter((q) => q.name.endsWith('-dlq'))) {
        for (const job of await boss.findJobs(queue.name)) {
          console.log(
            JSON.stringify({
              queue: queue.name,
              id: job.id,
              createdOn: job.createdOn,
              sourceRetryCount: job.sourceRetryCount,
              data: job.data,
              error: job.sourceOutput,
            }),
          )
        }
      }
    } else if (command === 'redrive' && name) {
      const queue = `${name}-dlq`
      const moved = await boss.redrive(queue, id ? { ids: [id] } : {})
      console.log(`Redrove ${moved} job(s) from ${queue}`)
    } else if (command === 'delete' && name && id) {
      const queue = `${name}-dlq`
      await boss.deleteJob(queue, id)
      console.log(`Deleted ${id}`)
    } else {
      console.log(usage)
      process.exitCode = 1
    }
  } finally {
    await boss.stop({ graceful: false })
  }
}

void main()
