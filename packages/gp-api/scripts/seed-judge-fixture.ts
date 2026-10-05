/**
 * Seeds the one dev account the Universal Judge's gp-api-reading background
 * agents (meeting_briefing, top_community_issues, trending_issues) run as: a
 * user, its `judge-fixture` organization, an elected office, priorities and a
 * community issue feed. The rows are src/chats/evals/judge/judgeFixtureSeed.ts;
 * this file only decides whether it may write them.
 *
 *   DATABASE_URL='<dev url>' npx tsx scripts/seed-judge-fixture.ts --confirm-dev
 *
 * Safe to run twice: the second run writes nothing. Refuses a prod host, and
 * asks you to type back any host that is not the dev cluster.
 */
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { PrismaClient } from '../src/generated/prisma'
import {
  databaseTarget,
  seedJudgeFixture,
  seedRefusal,
} from '../src/chats/evals/judge/judgeFixtureSeed'

const askForHost = async (): Promise<string | undefined> => {
  if (!stdin.isTTY) return undefined
  const rl = createInterface({ input: stdin, output: stdout })
  const answer = await rl.question('Type the host to confirm: ')
  rl.close()
  return answer
}

const main = async (): Promise<void> => {
  if (!process.argv.includes('--confirm-dev')) {
    throw new Error(
      'pass --confirm-dev to say you mean to write to a dev database',
    )
  }
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')

  const target = databaseTarget(url)
  console.log(
    `Target: ${target.host}:${target.port || '5432'}/${target.database} ` +
      `(${target.kind})`,
  )
  const refusal = seedRefusal(
    target,
    target.kind === 'unknown' ? await askForHost() : undefined,
  )
  if (refusal !== undefined) throw new Error(refusal)

  const prisma = new PrismaClient({ datasourceUrl: url })
  try {
    const report = await seedJudgeFixture(prisma)
    for (const outcome of ['created', 'updated', 'unchanged'] as const) {
      console.log(`${outcome}: ${report[outcome].length}`)
      for (const label of report[outcome]) console.log(`  ${label}`)
    }
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
