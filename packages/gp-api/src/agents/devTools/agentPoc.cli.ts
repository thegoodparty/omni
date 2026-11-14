/**
 * The agent POC's dev view and worker, against whatever database DATABASE_URL
 * names. Run from the build (the npm script builds first): tsx drops
 * emitDecoratorMetadata, and swc-node trips over the app's import cycles.
 *
 *   npm run poc:agent -w packages/gp-api -- start <electedOfficeId> [meetingDate] [--agent meetingBriefingSingleStage]
 *   npm run poc:agent -w packages/gp-api -- start --input <briefing-input.json>
 *   npm run poc:agent -w packages/gp-api -- view <runId> [--watch] [--json]
 *   npm run poc:agent -w packages/gp-api -- work
 *
 * `start` and `view` work no queue (JOBS_WORKERS=off); `work` works only the
 * agent queue, so pointing it at a shared database never makes this machine a
 * worker for anything else.
 */
import '../../configrc'

import { readFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { bootstrap } from '../../app'
import { MeetingBriefingsService } from '../../meetings/services/meetingBriefings.service'
import { isAgentName } from '../agents.registry'
import { AgentsService } from '../agents.service'
import { formatRunView } from './runViewFormat'

const [command = '', ...args] = process.argv.slice(2)
// Read by JobsService at bootstrap, so it only has to be set before main().
process.env.JOBS_WORKERS = command === 'work' ? 'agentRun' : 'off'

const flag = (name: string): string | undefined => {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}
const positional = args.filter(
  (arg, index) => !arg.startsWith('--') && !args[index - 1]?.startsWith('--'),
)

const TERMINAL = new Set(['completed', 'failed', 'superseded'])

const main = async (): Promise<void> => {
  // The full app, not an application context: several modules need the
  // HTTP adapter. It is initialised but never listens.
  const app = await bootstrap({ loggingEnabled: command === 'work' })
  await app.init()
  const agents = app.get(AgentsService)

  const watch = async (runId: string, json: boolean): Promise<void> => {
    for (;;) {
      const view = await agents.getRun(runId)
      // Without stage outputs and the artifact: a line past 64 KB reaches
      // the kill test split, with log lines written in between.
      const { artifact: _artifact, ...summary } = view
      const slim = {
        ...summary,
        stages: view.stages.map(({ output: _output, ...stage }) => stage),
      }
      console.log(
        json ? `POC_RUN_VIEW ${JSON.stringify(slim)}` : formatRunView(view),
      )
      if (TERMINAL.has(view.status)) return
      await sleep(2_000)
    }
  }

  try {
    if (command === 'start') {
      const [electedOfficeId, meetingDate] = positional
      const inputFile = flag('--input')
      const agent = flag('--agent') ?? 'meetingBriefing'
      if (!isAgentName(agent)) throw new Error(`no agent named ${agent}`)
      // --input: a briefing input written by hand, for a database whose
      // office cannot resolve its state and position (no election database).
      const input: unknown = inputFile
        ? JSON.parse(readFileSync(inputFile, 'utf8'))
        : await app.get(MeetingBriefingsService).buildAgentBriefingInput({
            electedOfficeId: electedOfficeId ?? '',
            ...(meetingDate ? { meetingDate } : {}),
          })
      if (!inputFile && !electedOfficeId) {
        throw new Error('start needs an electedOfficeId or --input')
      }
      const { runId } = await agents.run(agent, input)
      console.log(`POC_RUN_STARTED ${runId}`)
      if (args.includes('--watch')) await watch(runId, args.includes('--json'))
      return
    }
    if (command === 'view') {
      const [runId] = positional
      if (!runId) throw new Error('view needs a runId')
      if (args.includes('--watch')) {
        await watch(runId, args.includes('--json'))
      } else {
        console.log(formatRunView(await agents.getRun(runId)))
      }
      return
    }
    if (command === 'work') {
      console.log('POC_WORKER_READY')
      await new Promise<never>(() => undefined)
    }
    throw new Error(`unknown command "${command}": start, view or work`)
  } finally {
    await app.close()
  }
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
