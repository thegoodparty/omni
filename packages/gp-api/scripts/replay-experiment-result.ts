// Replays an agent experiment result through the gp-api consumer queue: finds
// (or seeds, with --org) the ExperimentRun row for runId, then sends the
// broker-shaped agentExperimentResult envelope pointing at an existing S3
// artifact to the queue named by SQS_QUEUE. Exists for local Tier-1 dry runs:
// replay a real dev artifact through the full consumer persist path without
// dispatching a paid Fargate run. Safe to run twice — the consumer's
// terminal-status guard drops the duplicate.
//
// Usage:
//   npx tsx scripts/replay-experiment-result.ts <runId> <artifactBucket> \
//     <artifactKey> [--status success|failed] [--org <organizationSlug>]
import 'dotenv/config'
import { ExperimentRunStatus, PrismaClient } from '../src/generated/prisma'
import { SQS } from '@aws-sdk/client-sqs'
import { QueueType } from '../src/queue/queue.types'
import { FIND_EXISTING_ORDINANCES } from '../src/ordinances/ordinances.constants'

const parseArgs = () => {
  const args = process.argv.slice(2)
  const flags: Record<string, string> = {}
  const positional: string[] = []
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--status' || arg === '--org') {
      const value = args[i + 1]
      if (!value) throw new Error(`${arg} requires a value`)
      flags[arg.slice(2)] = value
      i += 1
    } else {
      positional.push(arg)
    }
  }
  const [runId, artifactBucket, artifactKey] = positional
  if (!runId || !artifactBucket || !artifactKey) {
    throw new Error(
      'usage: replay-experiment-result.ts <runId> <artifactBucket> ' +
        '<artifactKey> [--status success|failed] [--org <organizationSlug>]',
    )
  }
  const status = flags.status ?? 'success'
  if (status !== 'success' && status !== 'failed') {
    throw new Error(`--status must be success or failed, got: ${status}`)
  }
  return { runId, artifactBucket, artifactKey, status, org: flags.org }
}

async function main() {
  const { runId, artifactBucket, artifactKey, status, org } = parseArgs()

  const queueName = process.env.SQS_QUEUE
  if (!queueName) throw new Error('SQS_QUEUE not set')

  const sqs = new SQS({})
  const { QueueUrl } = await sqs.getQueueUrl({ QueueName: queueName })
  if (!QueueUrl) throw new Error(`Queue not found: ${queueName}`)

  const prisma = new PrismaClient()

  let run = await prisma.experimentRun.findUnique({ where: { runId } })
  if (!run) {
    if (!org) {
      throw new Error(
        `no ExperimentRun row for ${runId}; pass --org <slug> to seed one`,
      )
    }
    // Seeded non-terminal so the consumer's terminal-status guard lets the
    // replayed result through.
    run = await prisma.experimentRun.create({
      data: {
        runId,
        organizationSlug: org,
        experimentType: FIND_EXISTING_ORDINANCES,
        status: ExperimentRunStatus.RUNNING,
      },
    })
  }

  const body = JSON.stringify({
    type: QueueType.AGENT_EXPERIMENT_RESULT,
    data: { runId, status, artifactKey, artifactBucket },
  })

  const sqsResp = await sqs.sendMessage({
    QueueUrl,
    MessageBody: body,
    MessageGroupId: runId,
    MessageDeduplicationId: `${runId}-${status}-${Date.now()}`,
  })

  console.log(
    JSON.stringify(
      { run, sqsMessageId: sqsResp.MessageId, queueUrl: QueueUrl },
      null,
      2,
    ),
  )
  await prisma.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
