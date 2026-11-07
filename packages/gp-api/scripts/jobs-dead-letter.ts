import { PgBoss } from 'pg-boss'
import {
  deadLetterQueue,
  JOB_NAMES,
  type JobName,
} from '../src/jobs/jobs.registry'

// Inspect and handle jobs in the pg-boss dead-letter queues. DATABASE_URL
// picks the database (root CLAUDE.md data access recipes).
//   npm run jobs:dead-letter -- list
//   npm run jobs:dead-letter -- redrive <job name> [job id]
//   npm run jobs:dead-letter -- delete <job name> <job id>

const usage =
  'usage: list | redrive <job name> [job id] | delete <job name> <job id>'

const [command, nameArg, id] = process.argv.slice(2)

const toJobName = (name: string | undefined): JobName => {
  const match = JOB_NAMES.find((jobName) => jobName === name)
  if (!match) {
    throw new Error(`Unknown job ${name}. Jobs: ${JOB_NAMES.join(', ')}`)
  }
  return match
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
      for (const name of JOB_NAMES) {
        const jobs = await boss.findJobs(deadLetterQueue(name))
        for (const job of jobs) {
          console.log(
            JSON.stringify({
              job: name,
              id: job.id,
              createdOn: job.createdOn,
              sourceRetryCount: job.sourceRetryCount,
              data: job.data,
              error: job.sourceOutput,
            }),
          )
        }
      }
    } else if (command === 'redrive') {
      const queue = deadLetterQueue(toJobName(nameArg))
      const moved = id
        ? await boss.redrive(queue, { ids: [id] })
        : await boss.redrive(queue)
      console.log(`Redrove ${moved} job(s) from ${queue}`)
    } else if (command === 'delete' && id) {
      await boss.deleteJob(deadLetterQueue(toJobName(nameArg)), id)
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
