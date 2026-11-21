import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { NoObjectGeneratedError } from 'ai'
import { z } from 'zod'
import { createJudgeModel } from '../judgeModel'
import { CODE_MAP, type SuiteDirectory } from './codeMap'
import { PICKER_MODEL, PickerOutputSchema } from './picker'
import { runPicker, type CallPicker } from './runPicker'
import { unsweepableReasonFor } from './sweepable'

const EnvSchema = z.object({
  GUARD_CHANGED_PATHS_FILE: z.string().min(1),
  GUARD_DIFF_FILE: z.string().min(1),
  GUARD_FLOOR: z.string().default(''),
  GUARD_EVAL_FILES_FILE: z.string().min(1),
  GUARD_HEAD_SHA: z.string().min(1),
  GH_REPO: z.string().min(1),
  GUARD_RAW_OUTPUT_FILE: z.string().min(1),
  GITHUB_OUTPUT: z.string().min(1),
})

const readLines = (file: string): string[] =>
  readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

const stemOf = (evalFile: string): string =>
  path.posix.basename(evalFile, '.eval.ts')

// A schema failure keeps the model's raw text, so runPicker can save it as a
// debugging artifact and fall back to the floor.
const callPicker: CallPicker = async ({ system, user }) => {
  const judgeModel = createJudgeModel({
    env: { ...process.env, JUDGE_MODEL: PICKER_MODEL },
  })
  try {
    const object = await judgeModel(PickerOutputSchema, `${system}\n\n${user}`)
    return { raw: JSON.stringify(object) }
  } catch (err) {
    if (NoObjectGeneratedError.isInstance(err)) return { raw: err.text ?? '' }
    throw err
  }
}

const writeOutput = (file: string, key: string, value: string): void => {
  const delimiter = `ghadelim_${Math.random().toString(36).slice(2)}`
  appendFileSync(file, `${key}<<${delimiter}\n${value}\n${delimiter}\n`, 'utf8')
}

export const main = async (): Promise<void> => {
  const env = EnvSchema.parse(process.env)
  const changedPaths = readLines(env.GUARD_CHANGED_PATHS_FILE)
  const diff = readFileSync(env.GUARD_DIFF_FILE, 'utf8')
  const floor = env.GUARD_FLOOR.split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  const evalFiles = readLines(env.GUARD_EVAL_FILES_FILE)
  const registryIds = evalFiles.map(stemOf)

  const suiteDirectories: SuiteDirectory[] = []
  for (const file of evalFiles) {
    const dir = `${path.posix.dirname(file)}/`
    const existing = suiteDirectories.findIndex((d) => d.path === dir)
    if (existing === -1) {
      suiteDirectories.push({ path: dir, suites: [stemOf(file)] })
    } else {
      const entry = suiteDirectories[existing]
      suiteDirectories[existing] = {
        path: dir,
        suites: [...(entry?.suites ?? []), stemOf(file)],
      }
    }
  }

  const readEvalAtHead = (suite: string): string | undefined => {
    const file = evalFiles.find((f) => stemOf(f) === suite)
    if (file === undefined) return undefined
    try {
      return execFileSync(
        'gh',
        [
          'api',
          '-H',
          'Accept: application/vnd.github.raw',
          `repos/${env.GH_REPO}/contents/${file}?ref=${env.GUARD_HEAD_SHA}`,
        ],
        { encoding: 'utf8' },
      )
    } catch {
      return undefined
    }
  }

  const result = await runPicker(
    {
      changedPaths,
      diff,
      floor,
      codeMap: CODE_MAP,
      suiteDirectories,
      registryIds,
    },
    { callPicker, unsweepableReason: unsweepableReasonFor(readEvalAtHead) },
  )

  writeOutput(env.GITHUB_OUTPUT, 'final_suites', result.finalSuites.join(','))
  writeOutput(env.GITHUB_OUTPUT, 'picker_status', result.pickerStatus)
  writeOutput(env.GITHUB_OUTPUT, 'failure_reason', result.failureReason ?? '')
  writeOutput(env.GITHUB_OUTPUT, 'check_conclusion', result.checkConclusion)
  writeOutput(env.GITHUB_OUTPUT, 'check_title', result.checkTitle)
  writeOutput(env.GITHUB_OUTPUT, 'check_summary', result.checkSummary)

  if (result.rawOutput !== undefined) {
    writeFileSync(env.GUARD_RAW_OUTPUT_FILE, result.rawOutput, 'utf8')
  }
  writeOutput(
    env.GITHUB_OUTPUT,
    'raw_output_saved',
    String(result.rawOutput !== undefined),
  )

  console.log(
    `::notice::guard picker: status=${result.pickerStatus} ` +
      `final=${result.finalSuites.join(',') || '(none)'} ` +
      `added=${result.added.map((a) => a.suite).join(',') || '(none)'} ` +
      `dropped=${result.droppedIds.join(',') || '(none)'} ` +
      `unsweepable=${
        result.unsweepable.map((s) => s.suite).join(',') || '(none)'
      }`,
  )
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err)
    process.exit(1)
  })
}
