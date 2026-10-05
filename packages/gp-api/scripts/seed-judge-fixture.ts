/**
 * Seeds the one dev account the Universal Judge's gp-api-reading background
 * agents (meeting_briefing, top_community_issues, trending_issues) run as: a
 * user, its `judge-fixture` organization, an elected office, priorities and a
 * community issue feed. The rows are src/chats/evals/judge/judgeFixtureSeed.ts;
 * this file only decides whether it may write them.
 *
 *   DATABASE_URL='<dev cluster writer url>' \
 *     npx tsx scripts/seed-judge-fixture.ts --confirm-dev
 *
 * Safe to run twice: the second run writes nothing. Refuses every host but the
 * dev cluster's writer endpoint, including localhost and tunnels.
 */
import { PrismaClient } from '../src/generated/prisma'
import {
  databaseTarget,
  seedJudgeFixture,
  seedRefusal,
  type SeedReport,
} from '../src/chats/evals/judge/judgeFixtureSeed'

export interface SeedCliDeps {
  seed: (databaseUrl: string) => Promise<SeedReport>
  log: (line: string) => void
}

const seedWithPrisma = async (databaseUrl: string): Promise<SeedReport> => {
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl })
  try {
    return await seedJudgeFixture(prisma)
  } finally {
    await prisma.$disconnect()
  }
}

const defaultDeps: SeedCliDeps = {
  seed: seedWithPrisma,
  log: (line) => console.log(line),
}

export const main = async (
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  deps: SeedCliDeps = defaultDeps,
): Promise<SeedReport> => {
  if (!argv.includes('--confirm-dev')) {
    throw new Error(
      'pass --confirm-dev to say you mean to write to the dev database',
    )
  }
  const url = env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')

  const target = databaseTarget(url)
  deps.log(
    `Target: ${target.host}:${target.port || '5432'}/${target.database} ` +
      `(${target.kind})`,
  )
  const refusal = seedRefusal(target)
  if (refusal !== undefined) throw new Error(refusal)

  const report = await deps.seed(url)
  for (const outcome of ['created', 'updated', 'unchanged'] as const) {
    deps.log(`${outcome}: ${report[outcome].length}`)
    for (const label of report[outcome]) deps.log(`  ${label}`)
  }
  return report
}

if (require.main === module) {
  main(process.argv.slice(2), process.env).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
