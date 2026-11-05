import { appendFileSync, readFileSync } from 'node:fs'
import { S3Client } from '@aws-sdk/client-s3'
import { PinoLogger } from 'nestjs-pino'
import { z } from 'zod'
import { LlmService } from '@/llm/services/llm.service'
import { AGENTS } from '../agents'
import { judgeAwsClientConfig } from '../awsCredentials'
import { s3PortFromClient } from '../records'
import { CODE_MAP } from './codeMap'
import { PICKER_MODEL } from './picker'
import { runPicker, type CallPicker } from './runPicker'
import { slackAlertEnvFromProcess } from './slackAlert'

// The entry point `judge-guard.yml` invokes with `npx tsx`, the same way it
// already invokes `judge-path-floor.sh` and the way judge.yml invokes
// `cli.ts` — never through a booted Nest app (this workflow runs from main's
// checkout only, reads the PR's diff as data, and never executes the PR's
// own code; see judge-guard.yml's header).
//
// `chatCompletion`, NOT `jsonCompletion`, on purpose. `jsonCompletion` sends
// a model-API-enforced grammar and THROWS when the reply does not fit it —
// at that point the raw text is gone, so `runPicker.ts`'s "isn't JSON or
// fails the shape" branch (which is supposed to save the raw output for
// debugging, per the failure table) would never see anything real. Plain
// chat completion always returns the text the model actually sent, which is
// what makes `parsePickerOutput`'s own JSON.parse + zod check a real check
// rather than dead code. The schema is spelled out in
// picker.ts's PICKER_SYSTEM_PROMPT instead of sent as a grammar.

const EnvSchema = z.object({
  GUARD_PR_NUMBER: z.string().regex(/^\d+$/),
  GUARD_RUN_ID: z.string().min(1),
  GUARD_CHANGED_PATHS_FILE: z.string().min(1),
  GUARD_DIFF_FILE: z.string().min(1),
  GUARD_FLOOR: z.string().default(''),
  JUDGE_RECORDS_BUCKET: z.string().min(1),
  GITHUB_OUTPUT: z.string().min(1),
})

const readLines = (path: string): string[] =>
  readFileSync(path, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

// LlmService's constructor throws "Please set AI_MODELS in your .env" when
// the variable is empty, before `models: [PICKER_MODEL]` below is ever read
// (sweep.ts's `ensureFallbackModels` hits the identical trap). The workflow
// sets AI_MODELS itself; this is a second line of defense for any other
// caller of this CLI.
const ensureAiModels = (env: NodeJS.ProcessEnv = process.env): void => {
  if (env.AI_MODELS === undefined || env.AI_MODELS.trim() === '') {
    env.AI_MODELS = PICKER_MODEL
  }
}

const callPicker: CallPicker = async ({ system, user }) => {
  ensureAiModels()
  const llm = new LlmService(new PinoLogger({ pinoHttp: {} }))
  const { content } = await llm.chatCompletion({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    models: [PICKER_MODEL],
    temperature: 0,
    // The orchestrator owns the retry-once policy from the failure-handling
    // table; LlmService's own retry/fallback would hide a failure from it.
    retries: 0,
  })
  return { raw: content }
}

const writeOutput = (path: string, key: string, value: string): void => {
  // GITHUB_OUTPUT is a `key<<EOF\nvalue\nEOF\n` multiline-safe append file —
  // a plain `key=value` line would break on the newlines a check summary or
  // a reason list can contain.
  const delimiter = `ghadelim_${Math.random().toString(36).slice(2)}`
  appendFileSync(path, `${key}<<${delimiter}\n${value}\n${delimiter}\n`, 'utf8')
}

export const main = async (): Promise<void> => {
  const env = EnvSchema.parse(process.env)
  const changedPaths = readLines(env.GUARD_CHANGED_PATHS_FILE)
  const diff = readFileSync(env.GUARD_DIFF_FILE, 'utf8')
  const floor = env.GUARD_FLOOR.split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  const registryIds = AGENTS.map((a) => a.agentId)

  const failureLog = s3PortFromClient(
    new S3Client(judgeAwsClientConfig()),
    env.JUDGE_RECORDS_BUCKET,
  )

  const result = await runPicker(
    {
      pr: Number(env.GUARD_PR_NUMBER),
      runId: env.GUARD_RUN_ID,
      changedPaths,
      diff,
      floor,
      codeMap: CODE_MAP,
      registryIds,
      now: new Date(),
    },
    {
      callPicker,
      failureLog,
      slackEnv: slackAlertEnvFromProcess(),
    },
  )

  writeOutput(env.GITHUB_OUTPUT, 'final_agents', result.finalAgents.join(','))
  writeOutput(env.GITHUB_OUTPUT, 'picker_status', result.pickerStatus)
  writeOutput(env.GITHUB_OUTPUT, 'check_conclusion', result.checkConclusion)
  writeOutput(env.GITHUB_OUTPUT, 'check_title', result.checkTitle)
  writeOutput(env.GITHUB_OUTPUT, 'check_summary', result.checkSummary)

  console.log(
    `::notice::guard picker: status=${result.pickerStatus} ` +
      `final=${result.finalAgents.join(',') || '(none)'} ` +
      `added=${result.added.map((a) => a.agentId).join(',') || '(none)'} ` +
      `dropped=${result.droppedIds.join(',') || '(none)'}`,
  )
}

// Only runs when invoked directly (`npx tsx runPickerCli.ts`), never on
// import — the same guard every other judge CLI entry point uses, since this
// module is also imported by tests that must not make a live call.
if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err)
    process.exit(1)
  })
}
