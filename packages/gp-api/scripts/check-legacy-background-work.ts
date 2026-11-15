/**
 * CI ban: gp-api's background work runs on pg-boss (src/jobs/AGENTS.md).
 *
 * Fails on any @Cron or @Interval decorator in src (tests aside): scheduled
 * work is a pg-boss SCHEDULES entry. Fails on any QueueType value outside
 * INBOX_QUEUE_TYPES: SQS only carries messages other systems send, and a new
 * one adds its value here in the same PR, where review sees it.
 *
 * Usage: npx tsx scripts/check-legacy-background-work.ts
 */
import { readdirSync, readFileSync } from 'fs'
import { join, relative } from 'path'

const ROOT = join(__dirname, '..')

export const INBOX_QUEUE_TYPES = [
  'pollAnalysisComplete',
  'feedbackSynthesisComplete',
  'panelRepliesUploaded',
  'agentExperimentResult',
]

export const parseQueueTypes = (source: string): string[] => {
  const body = /export enum QueueType \{([\s\S]*?)\n\}/.exec(source)?.[1] ?? ''
  return [...body.matchAll(/^\s*[A-Z0-9_]+\s*=\s*'([^']*)'/gm)].map((m) => m[1])
}

export const countScheduledJobs = (source: string): number =>
  source.match(/^\s*@(Cron|Interval)\(/gm)?.length ?? 0

const listSourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return listSourceFiles(path)
    return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : []
  })

export const findProblems = (
  queueTypes: string[],
  scheduled: Record<string, number>,
): string[] => {
  const problems: string[] = []
  for (const name of queueTypes) {
    if (!INBOX_QUEUE_TYPES.includes(name)) {
      problems.push(
        `QueueType ${name} is not a message from another system. ` +
          'Background work goes on pg-boss (src/jobs/AGENTS.md), not SQS.',
      )
    }
  }
  for (const file of Object.keys(scheduled).sort()) {
    problems.push(
      `${file} has ${scheduled[file]} @Cron/@Interval. Scheduled work goes ` +
        'on pg-boss SCHEDULES (src/jobs/AGENTS.md).',
    )
  }
  return problems
}

const main = () => {
  const queueTypes = parseQueueTypes(
    readFileSync(join(ROOT, 'src/queue/queue.types.ts'), 'utf8'),
  )
  const scheduled: Record<string, number> = {}
  for (const path of listSourceFiles(join(ROOT, 'src'))) {
    const count = countScheduledJobs(readFileSync(path, 'utf8'))
    if (count > 0) scheduled[relative(ROOT, path)] = count
  }
  const problems = findProblems(queueTypes, scheduled)
  if (problems.length === 0) {
    console.log('Background work: no @Cron/@Interval, SQS is inbox only.')
    return
  }
  for (const problem of problems) console.error(`- ${problem}`)
  process.exit(1)
}

if (require.main === module) main()
