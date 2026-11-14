/**
 * Starts a meeting briefing, kills the worker running it partway through
 * readPacket, starts a new worker, and reports whether the run resumed.
 *
 *   npm run poc:kill-test -w packages/gp-api -- <electedOfficeId> [meetingDate]
 *     [--change-shape] [--hard] [--kill-after-steps 2] [--timeout-minutes 60]
 *     [--input briefing-input.json]
 *
 * --change-shape adds a field to PacketNotesSchema before the second worker
 * starts (and restores the file after), which is a shape change: the run must
 * start over. --hard kills with SIGKILL (a crash) instead of SIGTERM (a
 * deploy). Real model calls: one briefing costs real money. Runs from the
 * build, with DATABASE_URL and the model and Databricks keys in .env.
 */
import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { RunView } from '@/agents/types'
import { killTestVerdict, readyToKill } from './killTestVerdict'
import { RunViewSchema } from './runView.schema'

const args = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}
const [electedOfficeId, meetingDate] = args.filter(
  (arg, index) => !arg.startsWith('--') && !args[index - 1]?.startsWith('--'),
)
const changeShape = args.includes('--change-shape')
const killSignal = args.includes('--hard') ? 'SIGKILL' : 'SIGTERM'
const killAfterSteps = Number(flag('--kill-after-steps') ?? 2)
const timeoutMs = Number(flag('--timeout-minutes') ?? 60) * 60_000
const inputFile = flag('--input')

// Runs from dist/agents/devTools, like the CLI it launches.
const GP_API_ROOT = join(__dirname, '..', '..', '..')
const CLI = join(__dirname, 'agentPoc.cli.js')
const SCHEMA_FILE = join(
  GP_API_ROOT,
  'src',
  'agents',
  'meetingBriefing',
  'meetingBriefingStages.schema.ts',
)
const SCHEMA_ANCHOR = 'export const PacketNotesSchema = z.strictObject({\n'
const SHAPE_PROBE = '  kill_test_probe: z.string().nullable(),\n'

const launch = (label: string, cliArgs: string[]): ChildProcess => {
  const child = spawn(process.execPath, [CLI, ...cliArgs], {
    cwd: GP_API_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stderr?.on('data', (chunk: Buffer) =>
    process.stderr.write(`[${label}] ${chunk.toString()}`),
  )
  return child
}

const lines = (child: ChildProcess, onLine: (line: string) => void): void => {
  if (!child.stdout) return
  createInterface({ input: child.stdout }).on('line', onLine)
}

const exited = (child: ChildProcess): Promise<void> =>
  new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve()
    else child.once('exit', () => resolve())
  })

const workerReady = (child: ChildProcess): Promise<void> =>
  new Promise((resolve, reject) => {
    lines(child, (line) => {
      if (line === 'POC_WORKER_READY') resolve()
    })
    child.once('exit', (code) =>
      reject(new Error(`worker exited before it was ready (${code})`)),
    )
  })

const progressKey = (view: RunView): string =>
  JSON.stringify([
    view.runId,
    view.shapeHash,
    view.status,
    view.stages.map((stage) => [stage.name, stage.status, stage.steps]),
  ])

const progressed = (before: RunView, view: RunView): boolean =>
  progressKey(before) !== progressKey(view)

const log = (message: string): void => console.log(`[kill-test] ${message}`)

// A deploy of the edited source: the second worker runs what this builds.
const build = (): void => {
  const result = spawnSync('npx', ['nest', 'build'], {
    cwd: GP_API_ROOT,
    stdio: 'inherit',
  })
  if (result.status !== 0) throw new Error('nest build failed')
}

const main = async (): Promise<void> => {
  if (!electedOfficeId && !inputFile) {
    throw new Error('usage: kill-test <electedOfficeId> | --input <file>')
  }
  const originalSchema = readFileSync(SCHEMA_FILE, 'utf8')
  if (changeShape && !originalSchema.includes(SCHEMA_ANCHOR)) {
    throw new Error(`cannot find PacketNotesSchema in ${SCHEMA_FILE}`)
  }

  const children: ChildProcess[] = []
  try {
    log('starting worker A')
    const workerA = launch('worker A', ['work'])
    children.push(workerA)
    await workerReady(workerA)

    log('starting the run and the observer')
    const observer = launch('observer', [
      'start',
      ...(inputFile ? ['--input', inputFile] : []),
      ...(electedOfficeId ? [electedOfficeId] : []),
      ...(meetingDate ? [meetingDate] : []),
      '--watch',
      '--json',
    ])
    children.push(observer)

    let before: RunView | undefined
    let firstAfter: RunView | undefined
    let final: RunView | undefined
    let workerBStarted = false
    let onBefore: (() => void) | undefined
    const reachedKillPoint = new Promise<void>((resolve) => {
      onBefore = resolve
    })

    lines(observer, (line) => {
      if (line.startsWith('POC_RUN_STARTED ')) log(line)
      if (!line.startsWith('POC_RUN_VIEW ')) return
      const view = RunViewSchema.parse(
        JSON.parse(line.slice('POC_RUN_VIEW '.length)),
      )
      final = view
      if (!before && readyToKill(view, killAfterSteps)) {
        before = view
        onBefore?.()
      }
      // The first view after the second worker started that shows it at
      // work: a requeued job waits a minute before it is claimed, so views
      // in between still show the killed attempt. A shape change shows as
      // the new attempt's hash.
      if (workerBStarted && !firstAfter && before) {
        const moved = changeShape
          ? view.shapeHash !== before.shapeHash
          : progressed(before, view)
        if (moved) firstAfter = view
      }
    })

    const observerDone = exited(observer)
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`no result in ${timeoutMs / 60_000} minutes`)),
        timeoutMs,
      ).unref(),
    )
    await Promise.race([
      reachedKillPoint,
      observerDone.then(() => {
        throw new Error(
          'the run finished before readPacket reached the kill point',
        )
      }),
      timeout,
    ])

    log(`killing worker A with ${killSignal} during readPacket`)
    workerA.kill(killSignal)
    await exited(workerA)

    if (changeShape) {
      log('changing PacketNotesSchema before the new worker starts')
      writeFileSync(
        SCHEMA_FILE,
        originalSchema.replace(SCHEMA_ANCHOR, SCHEMA_ANCHOR + SHAPE_PROBE),
      )
      build()
    }

    log('starting worker B')
    const workerB = launch('worker B', ['work'])
    children.push(workerB)
    await workerReady(workerB)
    workerBStarted = true

    await Promise.race([observerDone, timeout])
    if (!before || !firstAfter || !final) {
      throw new Error('the observer never saw the run after the restart')
    }
    const verdict = killTestVerdict({
      before,
      firstAfter,
      final,
      changedShape: changeShape,
    })
    for (const line of verdict.lines) log(line)
    process.exitCode = verdict.pass ? 0 : 1
  } finally {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM')
      }
    }
    if (changeShape) {
      writeFileSync(SCHEMA_FILE, originalSchema)
      build()
    }
  }
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
