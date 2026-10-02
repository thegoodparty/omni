import { basename } from 'node:path'
import { AGENTS, type AgentEntry } from './agents'
import {
  describeIssues,
  isChatCase,
  loadCaseList,
  usesSeededTranscript,
  type CaseList,
  type JudgeCase,
} from './cases'
import { DEFAULT_JUDGE_CONFIG, type JudgeConfig } from './config'
import { selectAgents } from './cli'
import { ARM_KEY_ENV } from './modelKey'
import { isoUtc, RunRecordSchema, type RunRecord } from './record'
import {
  MANIFEST_SCHEMA_VERSION,
  type ArmAgent,
  type ArmManifest,
  type ArmSkip,
  type RecordStore,
} from './records'
import { variantFor, type ArmEnv } from './sweepEnv'

// ONE ARM. Walks the selected agents' case lists, drives every case on this
// side of the comparison, validates each record and writes it.
//
// It never touches the other arm, and it cannot: the other arm is a different
// checkout and therefore a different process. The two meet in the record
// store, and the judging entry (sweep.ts) is what reads both.
//
// The runner is injected. That is what lets this file be tested without
// standing up Postgres or calling a model, and it is also the seam the
// background runner plugs into when it lands.

export interface ArmCaseRequest {
  agent: AgentEntry
  case: JudgeCase
  attempt: number
  sweepId: string
  arm: ArmEnv['arm']
  variant: { ref: string; commit: string }
  // False unless the environment affirmatively said to spend. The caller is
  // expected to hand the runner a canned script when this is false, which is
  // how the whole pipeline is exercised end to end for nothing.
  spends: boolean
}

export interface CaptureArmDeps {
  store: RecordStore
  runCase: (request: ArmCaseRequest) => Promise<RunRecord>
  now: () => Date
  // Injected so a test needs no fixture files on disk. Production passes
  // `loadCaseList`.
  loadCases?: (agent: AgentEntry) => CaseList
  config?: JudgeConfig
}

export class ArmCaptureError extends Error {}

// A skip reason ends up in the manifest, then in a refusal, then in
// $GITHUB_STEP_SUMMARY — which is public, because omni is. It is arbitrary
// error text from whatever failed, and a client library that puts a
// credential or a DSN in an exception message would put it there too.
//
// Shapes, not values: we cannot enumerate the secrets, so this matches how
// they are written.
const SECRET_SHAPES: readonly [RegExp, string][] = [
  [/\bsk-[A-Za-z0-9_-]{8,}/g, '[redacted key]'],
  [/\bdapi[0-9a-f]{8,}/g, '[redacted token]'],
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s@]+:[^\s@]+@\S+/g, '[redacted url]'],
]

// Shapes are not enough on their own. DATABRICKS_CLIENT_SECRET is an opaque
// high-entropy OAuth secret matching none of them, and it is in the arm step's
// environment — so a Databricks SDK exception echoing it would land verbatim
// in ArmSkip.reason, in the manifest FILE, and from there in
// $GITHUB_STEP_SUMMARY on a public repository. GitHub's log-stream masking is
// not the backstop it looks like: the value travels through a file into a
// different process. The manifests are also headed for S3.
//
// So the known secret-bearing variables are redacted by VALUE as well.
const SECRET_VARS: readonly string[] = [
  'ANTHROPIC_API_KEY',
  // The name the real key reaches a spending arm under; see modelKey.ts. On
  // a dry run ANTHROPIC_API_KEY still holds the stub, so redacting that one
  // alone would redact the stub and leave the real value in the clear.
  ARM_KEY_ENV,
  'DATABRICKS_CLIENT_SECRET',
  'DATABRICKS_CLIENT_ID',
  'DATABASE_URL',
]

// A short value would blanket the whole reason — an empty or one-character
// variable replacing every character of it is worse than no redaction,
// because the sentence is what makes a skip actionable.
const MIN_SECRET_CHARS = 8

export const scrubReason = (
  reason: string,
  env: NodeJS.ProcessEnv = process.env,
): string => {
  const byValue = SECRET_VARS.reduce((text, name) => {
    const value = env[name]
    return value !== undefined && value.length >= MIN_SECRET_CHARS
      ? text.split(value).join(`[redacted ${name}]`)
      : text
  }, reason)
  return SECRET_SHAPES.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    byValue,
  )
}

// WHAT THE CAPTURE MUST NOT GO GREEN ON, and it is not the same thing on the
// two paths.
//
// Under the canned script every turn is deterministic, so an infraError is a
// harness bug and every one of them is a failure worth failing the step over.
// Under real spend it is a provider 429 or a dropped stream: `runners/chat.ts`
// classifies that as infraError and RETURNS the record rather than throwing,
// and the rest of the pipeline is built to survive exactly that — normalize
// excludes the pair, score counts it as an exclusion, report prints it.
// Failing the capture step over one flaky turn in eighteen would abort a
// fully paid sweep, skip the judging step and leave the PR with no verdict at
// all. So under spend the invariant weakens to the one the pipeline actually
// needs: something survived, and an arm of nothing but infraErrors pairs into
// an empty comparison.
export const unjudgeableRecords = (
  records: readonly RunRecord[],
  spends: boolean,
): string[] => {
  const broken = records
    .filter(
      (record) => record.status === 'infraError' || record.output === null,
    )
    .map((record) => record.runId)
  if (!spends) return broken
  return broken.length === records.length ? broken : []
}

// The record has to describe the case we asked about. A runner that returned
// someone else's record would have it written under THIS case's key, which
// silently replaces a real result with an unrelated one — and both look like
// valid records, so nothing downstream could notice.
//
// A plain Error, not an ArmCaptureError, for the same reason the invalid
// record below is: a runner that answers the wrong question is ONE agent's
// runner, and the per-agent catch in `captureArm` turns this into a named
// skip. An arm-fatal throw here would abort the whole arm, destroying the
// captures the other agents in it have already been paid for.
const assertAnswersRequest = (
  record: RunRecord,
  request: ArmCaseRequest,
): void => {
  const mismatches = [
    ['sweepId', record.sweepId, request.sweepId],
    ['arm', record.arm, request.arm],
    ['agentId', record.agentId, request.agent.agentId],
    ['caseId', record.caseId, request.case.caseId],
    ['attempt', String(record.attempt), String(request.attempt)],
  ].filter(([, got, want]) => got !== want)

  if (mismatches.length > 0) {
    throw new Error(
      'the runner returned a record for a different run: ' +
        mismatches
          .map(([field, got, want]) => `${field} is ${got}, asked for ${want}`)
          .join(', '),
    )
  }
}

// Thrown so a partial capture can still say how many records it left behind.
// A skip that reported none would have the manifest contradict the store, and
// the manifest is what the judging entry trusts.
export class PartialAgentCaptureError extends Error {
  constructor(
    readonly agentId: string,
    readonly recordsWritten: number,
    readonly cause: Error,
  ) {
    super(
      `${cause.message} (this agent had written ${recordsWritten} ` +
        'record(s) before it failed, and they are in the store)',
    )
  }
}

const captureAgent = async (
  deps: CaptureArmDeps,
  env: ArmEnv,
  agent: AgentEntry,
  list: CaseList,
  attemptsPerCase: number,
): Promise<ArmAgent> => {
  // A mutable counter rather than a return value, so a walk that throws
  // partway can still report what it left in the store.
  const progress = { recordsWritten: 0 }
  try {
    await walkCases(deps, env, agent, list, attemptsPerCase, progress)
  } catch (err) {
    if (err instanceof ArmCaptureError) throw err
    throw new PartialAgentCaptureError(
      agent.agentId,
      progress.recordsWritten,
      err instanceof Error ? err : new Error(String(err)),
    )
  }
  const seeded = list.cases
    .filter((one) => isChatCase(one) && usesSeededTranscript(one))
    .map((one) => one.caseId)
  return {
    agentId: agent.agentId,
    // The basename, not the absolute path it was read from: the manifest is
    // rendered into a public summary and the runner's directory layout is
    // nobody's business.
    caseList: basename(list.source),
    placeholderCases: list.placeholder,
    ...(seeded.length > 0 && { seededTranscriptCases: seeded }),
    cases: list.cases.length,
    attempts: attemptsPerCase,
    recordsWritten: progress.recordsWritten,
  }
}

const walkCases = async (
  deps: CaptureArmDeps,
  env: ArmEnv,
  agent: AgentEntry,
  list: CaseList,
  attemptsPerCase: number,
  progress: { recordsWritten: number },
): Promise<void> => {
  for (const judgeCase of list.cases) {
    for (let attempt = 1; attempt <= attemptsPerCase; attempt += 1) {
      const request: ArmCaseRequest = {
        agent,
        case: judgeCase,
        attempt,
        sweepId: env.sweepId,
        arm: env.arm,
        variant: variantFor(env),
        spends: env.spends,
      }
      // Validated here as well as in the runner, because `runCase` is
      // injected: whatever satisfies the seam has to produce a record this
      // store will accept, and finding that out at write time would leave a
      // half-captured arm behind a schema error.
      //
      // A plain Error, so the per-agent catch in `captureArm` turns it into
      // a named skip. A runner that cannot produce a valid record is broken,
      // but it is one agent's runner and the rest of the sweep is still
      // worth having.
      const parsed = RunRecordSchema.safeParse(await deps.runCase(request))
      if (!parsed.success) {
        throw new Error(
          `the runner produced an invalid record for ${judgeCase.caseId} ` +
            `attempt ${attempt}: ` +
            describeIssues(parsed.error.issues),
        )
      }
      assertAnswersRequest(parsed.data, request)
      await deps.store.putRecord(parsed.data)
      progress.recordsWritten += 1
    }
  }
}

export const captureArm = async (
  deps: CaptureArmDeps,
  env: ArmEnv,
  registry: readonly AgentEntry[] = AGENTS,
): Promise<ArmManifest> => {
  const config = deps.config ?? DEFAULT_JUDGE_CONFIG
  const loadCases = deps.loadCases ?? loadCaseList
  const startedAt = deps.now()

  const selection = selectAgents({ kind: 'list', ids: env.agentIds }, registry)
  if (selection.unknown.length > 0) {
    // Fatal rather than skipped. The trigger validates ids against the
    // registry and exits non-zero on a miss, so an unknown id reaching a
    // process that is about to spend means the two disagree about what an
    // agent is — and quietly sweeping the rest would bill for a narrower run
    // than the plan priced.
    throw new ArmCaptureError(
      `not agents in the registry: ${selection.unknown.join(', ')}`,
    )
  }

  const agents: ArmAgent[] = []
  const skipped: ArmSkip[] = selection.blocked.map((agent) => ({
    agentId: agent.agentId,
    reason: agent.blockedReason ?? 'blocked with no reason on record',
  }))

  for (const agent of selection.selected) {
    try {
      const list = loadCases(agent)
      agents.push(
        await captureAgent(deps, env, agent, list, config.attemptsPerCase),
      )
    } catch (err) {
      // One agent's capture failing leaves the others usable, which the design
      // asks for explicitly. The reason is carried into the manifest so the
      // report says which agent failed and why, rather than showing an agent
      // with fewer cases than it was billed for.
      if (err instanceof ArmCaptureError) throw err
      skipped.push({
        agentId: agent.agentId,
        reason: scrubReason(err instanceof Error ? err.message : String(err)),
      })
    }
  }

  const variant = variantFor(env)
  const manifest: ArmManifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    sweepId: env.sweepId,
    arm: env.arm,
    ref: variant.ref,
    commit: variant.commit,
    startedAt: isoUtc(startedAt),
    endedAt: isoUtc(deps.now()),
    agents,
    skipped,
    spent: env.spends,
  }
  await deps.store.putManifest(manifest)
  return manifest
}
