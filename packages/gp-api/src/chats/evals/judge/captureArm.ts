import { S3Client } from '@aws-sdk/client-s3'
import { SQSClient } from '@aws-sdk/client-sqs'
import { AGENTS, type AgentEntry } from './agents'
import { judgeAwsClientConfig } from './awsCredentials'
import { SPEND_ENV } from './config'
import type { RunRecord } from './record'
import type { ArmManifest } from './records'
import {
  realClock,
  s3ObjectStore,
  sqsDispatchQueue,
} from './runners/awsAdapters'
import {
  runBackgroundCase,
  type BackgroundRunnerDeps,
} from './runners/background'
import {
  armDeps,
  backgroundRunInputFor,
  capturableAgents,
} from './runners/backgroundDispatch'
import { ciContextFromEnv, runChatHttpCase } from './runners/chatHttp'
import {
  JUDGE_CLERK_SECRET_ENV,
  clerkPortFrom,
  judgeAccounts,
  type JudgeAccounts,
} from './runners/judgeAccount'
import { captureArm, unjudgeableRecords } from './sweepArm'
import {
  SweepEnvError,
  armConfigFor,
  backgroundDestinationFrom,
  parseArmEnv,
  storeFromEnv,
  type ArmEnv,
} from './sweepEnv'

// ONE ARM OF ONE SWEEP, steps 1 and 2 of three: this runs once in the base
// worktree with JUDGE_ARM=base and once in the candidate worktree with
// JUDGE_ARM=candidate. Step 3, the judging, is `sweep.ts`.
//
// A chat agent is driven over HTTP against a deployed gp-api: the base arm
// against dev, the candidate arm against the PR's preview. A background agent
// is staged and dispatched over SQS, as before. Neither boots the app here.

export const DEV_API_URL = 'https://gp-api-dev.goodparty.org'
export const BASE_API_URL_ENV = 'JUDGE_BASE_API_URL'
export const CANDIDATE_API_URL_ENV = 'JUDGE_CANDIDATE_API_URL'

// Dev for the base arm unless told otherwise. The candidate arm has no
// default: the only deployment of the candidate is the PR's preview, and
// judge.yml names it once the preview serves the candidate commit.
export const chatArmUrl = (
  env: Pick<ArmEnv, 'arm'>,
  source: NodeJS.ProcessEnv,
): string | undefined => {
  const named =
    source[env.arm === 'base' ? BASE_API_URL_ENV : CANDIDATE_API_URL_ENV]
      ?.trim()
      .replace(/\/+$/, '') || undefined
  return env.arm === 'base' ? (named ?? DEV_API_URL) : named
}

// WHY THIS ARM CANNOT DRIVE A CHAT AGENT, or nothing. There is no free path:
// a deployed gp-api answers with the real model, so a dry run skips every
// chat agent by name rather than spend.
export const chatArmRefusal = (
  spends: boolean,
  url: string | undefined,
  clerkSecret: string | undefined,
): string | undefined => {
  if (!spends) {
    return (
      `${SPEND_ENV} is not "true", and a chat agent has no free path: its ` +
      'arm drives a deployed gp-api, which answers with the real model'
    )
  }
  if (url === undefined) {
    return (
      `${CANDIDATE_API_URL_ENV} is not set, so there is no deployment of the ` +
      "candidate to drive; judge.yml sets it once the PR's gp-api preview " +
      'serves the candidate commit'
    )
  }
  if (clerkSecret === undefined) {
    return (
      `${JUDGE_CLERK_SECRET_ENV} is not set, so no test account can be made ` +
      'to drive a chat agent with'
    )
  }
  return undefined
}

// The registry this arm walks: every chat agent blocked with the refusal when
// there is one, so captureArm records each by name in the manifest's
// `skipped` before any HTTP call.
export const armRegistry = (
  registry: readonly AgentEntry[],
  refusal: string | undefined,
): AgentEntry[] =>
  registry.map(
    (agent): AgentEntry =>
      refusal === undefined ||
      agent.shape !== 'chat' ||
      agent.status === 'blocked'
        ? agent
        : { ...agent, status: 'blocked', blockedReason: refusal },
  )

// WHAT THIS ARM MUST NOT GO GREEN ON: having captured nothing. Derived from
// the request rather than from the walk's own counts, which are vacuous when
// nothing ran.
export const armProblems = (
  manifest: ArmManifest,
  written: readonly RunRecord[],
  requested: readonly string[],
  capturable: readonly string[],
  spends: boolean,
): string[] => {
  const problems: string[] = []
  const accounted = [
    ...manifest.agents.map((agent) => agent.agentId),
    ...manifest.skipped.map((skip) => skip.agentId),
  ].sort()
  if (JSON.stringify(accounted) !== JSON.stringify([...requested].sort())) {
    problems.push(
      `the manifest accounts for ${accounted.join(', ') || 'no agent'} but ` +
        `the arm was asked for ${[...requested].sort().join(', ')}`,
    )
  }
  const captured = manifest.agents.map((agent) => agent.agentId).sort()
  const missing = capturable.filter((id) => !captured.includes(id))
  if (missing.length > 0) {
    problems.push(
      `${missing.join(', ')} could have been captured and was not; skipped: ` +
        JSON.stringify(manifest.skipped),
    )
  }
  const recorded = manifest.agents.reduce(
    (sum, agent) => sum + agent.recordsWritten,
    0,
  )
  if (written.length !== recorded) {
    problems.push(
      `the manifest says ${recorded} record(s) were written and the store ` +
        `holds ${written.length}`,
    )
  }
  const broken = unjudgeableRecords(written, spends)
  if (broken.length > 0) {
    problems.push(`no judgeable record among: ${broken.join(', ')}`)
  }
  for (const agent of manifest.agents) {
    const runs = new Set(
      written
        .filter((record) => record.agentId === agent.agentId)
        .map((record) => record.runId),
    ).size
    if (runs !== agent.cases * agent.attempts) {
      problems.push(
        `${agent.agentId} stored ${runs} run(s) for ${agent.cases} case(s) ` +
          `at ${agent.attempts} attempt(s)`,
      )
    }
  }
  return problems
}

const main = async (): Promise<number> => {
  const env = parseArmEnv()
  const config = armConfigFor(env)
  const store = storeFromEnv(env)
  const ci = ciContextFromEnv()
  const baseUrl = chatArmUrl(env, process.env)
  const clerkSecret = process.env[JUDGE_CLERK_SECRET_ENV]?.trim() || undefined
  // Both arms refuse chat without the candidate's deployment: a base arm that
  // drove chat anyway would pay for records nothing can pair with.
  const registry = armRegistry(
    AGENTS,
    chatArmRefusal(
      env.spends,
      chatArmUrl({ arm: 'candidate' }, process.env),
      clerkSecret,
    ),
  )
  const find = (agentId: string): AgentEntry | undefined =>
    registry.find((agent) => agent.agentId === agentId)

  // One pair of AWS clients for the arm, built only if a background agent
  // runs, and one account pool, built only if a chat agent does.
  let ports: BackgroundRunnerDeps | undefined
  const backgroundPorts = (): BackgroundRunnerDeps => {
    ports ??= {
      store: s3ObjectStore(new S3Client(judgeAwsClientConfig())),
      queue: sqsDispatchQueue(
        new SQSClient(judgeAwsClientConfig()),
        backgroundDestinationFrom(env).dispatchQueueUrl,
      ),
      clock: realClock,
    }
    return ports
  }
  const pool: { accounts?: JudgeAccounts } = {}

  let manifest: ArmManifest
  try {
    manifest = await captureArm(
      {
        store,
        now: () => new Date(),
        ...armDeps(env, config),
        runCase: async (request) => {
          if (request.agent.shape === 'background') {
            return runBackgroundCase(
              backgroundPorts(),
              backgroundRunInputFor(request, env),
            )
          }
          if ('params' in request.case) {
            throw new Error(
              `${request.case.caseId} carries params, so it is a ` +
                'background case and not a chat one',
            )
          }
          if (baseUrl === undefined || clerkSecret === undefined) {
            throw new Error(
              'a chat agent reached the runner on an arm that refused chat',
            )
          }
          const chatAccounts = (pool.accounts ??= judgeAccounts(
            { baseUrl },
            clerkPortFrom(clerkSecret),
            env.fixtureValues.raceId,
          ))
          const agentId = request.agent.agentId
          return runChatHttpCase({
            agentId,
            case: request.case,
            sweepId: request.sweepId,
            arm: request.arm,
            attempt: request.attempt,
            ref: request.variant.ref,
            baseUrl,
            account: () => chatAccounts.provision(agentId),
            ...(ci && { ci }),
          })
        },
      },
      env,
      registry,
    )
  } finally {
    for (const failure of (await pool.accounts?.deleteAll()) ?? []) {
      console.warn(`could not delete the judge's Clerk user ${failure}`)
    }
  }

  const written = await store.listRecords(env.sweepId, env.arm)
  const problems = armProblems(
    manifest,
    written,
    env.agentIds,
    capturableAgents(env.agentIds, env, find, config),
    env.spends,
  )
  console.log(
    `${env.arm} arm: ${manifest.agents.length} agent(s) captured, ` +
      `${manifest.skipped.length} skipped, ${written.length} record(s)`,
  )
  for (const skip of manifest.skipped) {
    console.log(`  skipped ${skip.agentId}: ${skip.reason}`)
  }
  for (const problem of problems) console.error(problem)
  return problems.length === 0 ? 0 : 1
}

if (require.main === module) {
  main()
    .then((code) => {
      process.exitCode = code
    })
    .catch((err: Error) => {
      console.error(err instanceof SweepEnvError ? err.message : err)
      process.exitCode = 1
    })
}
