/**
 * The agent POC's dev view and worker, against whatever database DATABASE_URL
 * names. Run from the build (the npm script builds first): tsx drops
 * emitDecoratorMetadata, and swc-node trips over the app's import cycles.
 *
 *   npm run poc:agent -w packages/gp-api -- start <electedOfficeId> [meetingDate] [--watch] [--json]
 *   npm run poc:agent -w packages/gp-api -- view <runId> [--watch] [--json]
 *   npm run poc:agent -w packages/gp-api -- work
 *
 * `start` and `view` work no queue (JOBS_WORKERS=off); `work` works only the
 * agent queue, so pointing it at a shared database never makes this machine a
 * worker for anything else.
 */
import '../../configrc'

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

  // Follows a superseded run to the fresh run that replaced it.
  const watch = async (startRunId: string, json: boolean): Promise<void> => {
    let runId = startRunId
    for (;;) {
      const view = await agents.getRun(runId)
      console.log(
        json
          ? // readline splits on U+2028 and U+2029, which page text carries.
            `POC_RUN_VIEW ${JSON.stringify(view).replace(/[\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`)}`
          : formatRunView(view),
      )
      if (view.supersededBy) {
        runId = view.supersededBy
        continue
      }
      if (TERMINAL.has(view.status)) return
      await sleep(2_000)
    }
  }

  try {
    if (command === 'start') {
      const [electedOfficeId, meetingDate] = positional
      if (!electedOfficeId) throw new Error('start needs an electedOfficeId')
      const agent = flag('--agent') ?? 'meetingBriefing'
      if (!isAgentName(agent)) throw new Error(`no agent named ${agent}`)
      const input = await app
        .get(MeetingBriefingsService)
        .buildAgentBriefingInput({
          electedOfficeId,
          ...(meetingDate ? { meetingDate } : {}),
        })
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
