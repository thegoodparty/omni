import { PgBoss, type JobWithMetadata } from 'pg-boss'

// Inspect and handle jobs in the pg-boss dead-letter queues. DATABASE_URL
// picks the database: the gp-api database of the affected environment.
//   npm run jobs:dead-letter -- list
//   npm run jobs:dead-letter -- redrive <job name> [job id]
//   npm run jobs:dead-letter -- delete <job name> <job id>
// Redrive and delete also delete the failed original in the job's own queue.
// On a key_strict_fifo queue that failed job blocks its key until it is gone,
// so a redriven job would otherwise wait behind it forever.

const usage =
  'usage: list | redrive <job name> [job id] | delete <job name> <job id>'

const [command, name, id] = process.argv.slice(2)

const deleteSource = async (
  boss: PgBoss,
  job: Pick<JobWithMetadata, 'sourceName' | 'sourceId'>,
) => {
  if (job.sourceName && job.sourceId) {
    await boss.deleteJob(job.sourceName, job.sourceId)
  }
}

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
      const jobs = await boss.findJobs(queue, id ? { id } : {})
      const moved = await boss.redrive(queue, id ? { ids: [id] } : {})
      for (const job of jobs) await deleteSource(boss, job)
      console.log(`Redrove ${moved} job(s) from ${queue}`)
    } else if (command === 'delete' && name && id) {
      const queue = `${name}-dlq`
      const [job] = await boss.findJobs(queue, { id })
      if (!job) throw new Error(`No job ${id} in ${queue}`)
      await boss.deleteJob(queue, id)
      await deleteSource(boss, job)
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
