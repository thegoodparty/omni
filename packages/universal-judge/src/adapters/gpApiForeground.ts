/**
 * Produce outputs from an in-process gp-api chat agent, for one variant.
 *
 * A foreground agent's variant is the source itself — a PR changes a prompt
 * builder, a tool description, or a pinned model, and there is nothing published
 * anywhere to point at. So the variant is a checkout, and this runs the same
 * producer inside each one.
 *
 * The contract with gp-api is deliberately thin: a single script that takes a case
 * and writes one JSON file. The judge does not import anything from gp-api and
 * knows nothing about Nest, Prisma, or the chat stack; swapping in a different
 * foreground app means pointing at a different script, not changing this file.
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Case, RunOutcome, VariantRole } from '../types.js'

/**
 * Producers, by agent. Each entry says which package to run in and which file to
 * run; adding a foreground agent is a line here plus a producer in that package.
 *
 * They run under vitest because gp-api's test harness boots the real app through
 * vitest lifecycle hooks, and driving the shipped HTTP route is the only way to
 * exercise the real agent rather than a reimplementation of it.
 */
export const PRODUCERS: Record<
  string,
  { packageDir: string; testPath: string }
> = {
  ordinance_draft: {
    packageDir: 'packages/gp-api',
    testPath: 'src/universalJudge/ordinanceDraftProducer.test.ts',
  },
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000

export const produceForeground = async (args: {
  agent: string
  testCase: Case
  variant: VariantRole
  checkout: string
  timeoutMs?: number
  log?: (message: string) => void
}): Promise<RunOutcome> => {
  const log = args.log ?? (() => {})
  const workDir = mkdtempSync(join(tmpdir(), 'universal-judge-'))
  const outPath = join(workDir, 'output.json')
  const startedAt = Date.now()

  try {
    log(
      `${args.testCase.id}/${args.variant}: running producer in ${args.checkout}`,
    )
    await runProducer({
      checkout: args.checkout,
      agent: args.agent,
      testCase: args.testCase,
      outPath,
      timeoutMs: args.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    })

    const parsed = JSON.parse(readFileSync(outPath, 'utf8')) as {
      output: unknown
      costUsd?: number
    }
    return {
      caseId: args.testCase.id,
      variant: args.variant,
      status: 'ok',
      output: parsed.output,
      costUsd: parsed.costUsd,
      durationSeconds: (Date.now() - startedAt) / 1000,
    }
  } catch (error) {
    return {
      caseId: args.testCase.id,
      variant: args.variant,
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
      durationSeconds: (Date.now() - startedAt) / 1000,
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

const runProducer = (args: {
  checkout: string
  agent: string
  testCase: Case
  outPath: string
  timeoutMs: number
}) =>
  new Promise<void>((resolve, reject) => {
    const producer = PRODUCERS[args.agent]
    if (!producer) {
      reject(new Error(`no foreground producer registered for "${args.agent}"`))
      return
    }

    const child = spawn('npx', ['vitest', 'run', producer.testPath], {
      cwd: join(args.checkout, producer.packageDir),
      env: {
        ...process.env,
        UNIVERSAL_JUDGE_CASE: args.testCase.id,
        UNIVERSAL_JUDGE_OUT: args.outPath,
        UNIVERSAL_JUDGE_PARAMS: JSON.stringify(args.testCase.params),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    // Producer stdout is progress noise; only the output file matters.
    child.stdout.on('data', () => {})

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(
        new Error(
          `producer timed out after ${Math.round(args.timeoutMs / 60000)} minutes`,
        ),
      )
    }, args.timeoutMs)

    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) return resolve()
      const tail = stderr.trim().split('\n').slice(-8).join('\n')
      reject(new Error(`producer exited ${code}${tail ? `: ${tail}` : ''}`))
    })
  })
