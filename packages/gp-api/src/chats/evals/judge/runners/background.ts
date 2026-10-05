import {
  JUDGE_RUN_ID_MAX_LENGTH,
  JUDGE_RUN_ID_PREFIX,
  judgeOverrideKeys,
  type JudgeOverride,
} from '@goodparty_org/contracts'
import { createHash } from 'crypto'
import { differenceInMilliseconds } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { z } from 'zod'
import { findAgent } from '../agents'
import { assertNoPlaceholders } from '../caseParams'
import { JUDGE_FIXTURE } from '../judgeFixtureIdentity'
import { PRICING_VERSION, priceUsd, UnpriceableRunError } from '../pricing'
import {
  isComparable,
  JsonValueSchema,
  RunRecordSchema,
  VariantSchema,
  type Arm,
  type CiContext,
  type JsonValue,
  type RunRecord,
  type TokenUsage,
  type TraceStep,
  type Variant,
} from '../record'

// The background half of the judge: 16 of the 20 agents.
//
// A background agent is not deployed like ordinary code. publish_experiments.py
// ships the FULL experiment set and writes index.json last as an atomic switch,
// with no per-experiment filter, so there is no way to publish one candidate.
// Instead this runner writes the arm's manifest and instruction to a
// content-addressed key under `_judge/<agentId>/<configDigest>/` and names that
// pair on the dispatch message as `_judge_override`. Identical bytes give an
// identical key, so a re-stage is idempotent and two branches never collide.
//
// NOTHING here writes index.json. That file is a single global switch, and a
// per-sweep write races every other sweep and main's CI.
//
// The experiment id on the message stays REAL, which is why the Fargate runner
// needs no change: it still asks the broker for its experiment, and the broker
// decides which bytes to serve from the ticket.

// ---------------------------------------------------------------------------
// Injected edges
// ---------------------------------------------------------------------------

// Everything this runner needs from S3, keyed by bucket and key, so a test
// backs it with a Map and no AWS SDK type reaches this file.
export interface ObjectStore {
  // Resolves undefined for a key that does not exist yet — the normal state
  // while a run is still going, not an error.
  getText(bucket: string, key: string): Promise<string | undefined>
  putText(bucket: string, key: string, body: string): Promise<void>
}

// Everything this runner needs from SQS. The queue URL belongs to the adapter,
// not here.
export interface DispatchQueue {
  send(message: {
    body: string
    groupId: string
    deduplicationId: string
  }): Promise<void>
}

// Injected so the poll loop is testable in microseconds instead of minutes.
export interface Clock {
  now(): Date
  sleep(ms: number): Promise<void>
}

export interface BackgroundRunnerDeps {
  store: ObjectStore
  queue: DispatchQueue
  clock: Clock
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface InputFileRef {
  bucket: string
  key: string
  dest: string
}

export interface BackgroundCase {
  caseId: string
  params: Record<string, JsonValue>
  // Pre-staged files the runner fetches into /workspace/input/ before the agent
  // boots. Preferred over a URL param for anything that would otherwise be
  // fetched live, since it removes the fetch from the comparison entirely.
  inputFiles?: InputFileRef[]
}

// The bytes the agent actually reads. Both arms are staged this way, including
// base: a branch's base ref need not equal what is published, and a cached base
// arm is only sound if its digest names exactly the bytes that ran.
export interface AgentConfig {
  // The BEHAVIOR PROJECTION, not the published `manifest.json`. The consumer
  // accepts only {model, max_turns, timeout_seconds, output_schema, runtime}
  // and requires the first three — a judge override may change what the agent
  // is told to do, never what it is allowed to touch, so `scope`, `routing`
  // and `input_schema` come from the published manifest alone. Handing this
  // field a published manifest is refused by stageAgentConfig; see
  // validateOverrideManifest for why it is refused here rather than at the
  // Lambda.
  manifest: string
  instruction: string
}

export interface BackgroundRunInput {
  sweepId: string
  // Doubles as the dispatch's `experiment_type`. It stays the real id.
  agentId: string
  arm: Arm
  attempt: number
  agentCase: BackgroundCase
  config: AgentConfig
  // configDigest is computed here from the staged bytes rather than accepted,
  // so the override key and the record can never name different content.
  variant: Omit<Variant, 'configDigest'>
  organizationSlug: string
  // Only for an agent the registry marks readsGpApi, and only ever the
  // fixture account's id; see buildDispatchMessage.
  clerkUserId?: string
  metadataBucket: string
  artifactBucket: string
  poll: PollOptions
  dataVersion?: string
  env?: NodeJS.ProcessEnv
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

// The run-id prefix and its length cap come from @goodparty_org/contracts,
// never from a literal here. This module declared its own pair once, and they
// drifted from the consumer's (`judge-` against `_judge-`), which silently
// turned off every safety the prefix gates. See the drift guard in the test
// file: contracts cannot be imported by Python, so the TS/Python equality is
// asserted against the Python source text instead.
//
// The consumer landed in 6a5ba31fb and now READS the prefix, so getting it
// wrong no longer means "ignored" — it means refused:
//   * `_validate_judge_dispatch` fullmatches the whole run id against
//     `^_judge-[A-Za-z0-9_-]{1,29}$`, so a mismatched prefix refuses the
//     dispatch outright and the sweep sees only a poll timeout.
//   * `send_error_callback` suppresses on `_judge-` alone, so each refusal
//     posts to gp-api's results queue — the `Experiment run not found`
//     alerting storm this whole path exists to avoid.
//   * `is_eval` is derived from it at mint, so without it the broker keeps
//     its own callback AND overwrites the org's `latest.json` pointer.
//   * dispatch_handler refuses a judge BASE arm of a write-action experiment
//     only when it recognises the run id. A base arm writes to gp-api through
//     the broker's `/agent/mcp` proxy, which does not read `ticket.is_eval`,
//     so an unrecognised judge run makes real product writes on a real
//     organization while every signal that would surface them is suppressed.
//     That is the one consequence here that is not merely cost.
export { JUDGE_RUN_ID_PREFIX } from '@goodparty_org/contracts'

// Floor on the compressed form, so shortening the id can never buy a
// collision. 48 bits across one sweep's cases is not a risk; less would start
// to be.
const MIN_DIGEST_CHARS = 12

// One safe segment of an id: the same shape judgeOverrideKeys pins, so a
// sweepId or caseId that can be a run id can also be a key.
//
// Rejected rather than substituted. Replacing the offending characters looks
// kinder and is worse: `a/b` and `a-b` would collapse to one run id, and since
// the SQS deduplication id IS the run id, the second case's dispatch would be
// silently swallowed while both records read the same artifact — two results
// from one execution, with nothing reporting the collision. Case ids are
// authored fixtures, so demanding a clean one costs nothing.
const ID_SEGMENT = /^[A-Za-z0-9_-]+$/

const requireSegment = (label: string, value: string): string => {
  if (!ID_SEGMENT.test(value)) {
    throw new Error(`unsafe ${label} for a judge run: ${value}`)
  }
  return value
}

// dispatch_handler's _EXPERIMENT_ID_RE, which is stricter than the key
// layout's charset: a dash or a capital passes staging and is then rejected at
// the Lambda, which is the silent-stall failure mode again.
const EXPERIMENT_ID = /^[a-z][a-z0-9_]{0,63}$/

// dispatch_handler's _IDENTIFIER_RE.
// Exported so judgeIdentifiers.ts makes slugs by this rule, not a copy of it.
export const ORG_SLUG = /^[a-zA-Z0-9_-]{1,64}$/

const sha256 = (...parts: string[]): string => {
  const hash = createHash('sha256')
  // NUL-separated: without it `{manifest: 'ab', instruction: 'c'}` and
  // `{manifest: 'a', instruction: 'bc'}` would hash alike, and two different
  // configs sharing one override key is the one failure content addressing
  // exists to prevent.
  for (const part of parts) hash.update(part, 'utf8').update('\u0000')
  return hash.digest('hex')
}

// 128 bits of the sha256 over the arm's bytes. Long enough that a collision is
// not a thing that happens, short enough to keep the S3 key readable, and hex
// so it satisfies the key layout's segment charset.
export const backgroundConfigDigest = (config: AgentConfig): string =>
  sha256(config.manifest, config.instruction).slice(0, 32)

export interface RunIdParts {
  sweepId: string
  // THE AGENT IS PART OF THE RUN. Two agents' lists share case ids —
  // top_community_issues and trending_issues share their first three — and
  // the platform's job table is keyed on the run id alone, so without it the
  // second agent's dispatch was dropped as a duplicate of the first's and its
  // poll ran out the clock. armBudget.ts refuses such a pair against a base
  // ref whose run ids predate this.
  agentId: string
  caseId: string
  arm: Arm
  attempt: number
}

// Deterministic per (sweep, agent, case, arm, attempt), which is what makes the
// artifact key predictable before dispatch and a double-dispatch of the same
// attempt collapse instead of paying twice. It is deliberately NOT stable
// across sweeps: the artifact archive is written with IfNoneMatch=*, so a
// second run reusing an id would 409 at publish time.
//
// 36 characters does not fit a readable sweep and case, so most ids compress
// to a digest. Nothing is lost for analysis — the record carries sweepId,
// caseId, arm and attempt as their own fields — only the ability to read a
// case off an S3 prefix by eye.
export const judgeRunId = (parts: RunIdParts): string => {
  // Interpolated straight into the id, so a non-integer would put a dot in it
  // and be rejected at the Lambda — after the dispatch, where the rejection is
  // invisible.
  if (!Number.isSafeInteger(parts.attempt) || parts.attempt < 1) {
    throw new Error(`attempt must be a positive integer, got ${parts.attempt}`)
  }
  const tail = `${parts.arm}-${parts.attempt}`
  const readable =
    `${JUDGE_RUN_ID_PREFIX}${requireSegment('sweepId', parts.sweepId)}-` +
    `${requireSegment('agentId', parts.agentId)}-` +
    `${requireSegment('caseId', parts.caseId)}-${tail}`
  if (readable.length <= JUDGE_RUN_ID_MAX_LENGTH) return readable

  // Sized to fill exactly what the tail leaves, so the compressed form uses
  // every character available to it rather than a round number that happens
  // to fit.
  const room =
    JUDGE_RUN_ID_MAX_LENGTH - JUDGE_RUN_ID_PREFIX.length - tail.length - 1
  if (room < MIN_DIGEST_CHARS) {
    throw new Error(
      `no room for a ${MIN_DIGEST_CHARS}-char digest in a ` +
        `${JUDGE_RUN_ID_MAX_LENGTH}-char run id once "${tail}" is reserved`,
    )
  }
  return `${JUDGE_RUN_ID_PREFIX}${sha256(readable).slice(0, room)}-${tail}`
}

// The runner publishes under `<experiment_id>/<run_id>/`, and the experiment id
// stays real, so a judge artifact lands in the production experiment's prefix.
// We tell one apart by the reserved run-id prefix rather than asking the broker
// for an artifact-prefix override, because that prefix is already load-bearing
// for the task reaper and for the dispatch handler's error callback.
//
// It does NOT cover everything. The broker also writes a mutable pointer at
// `<experiment_id>/<organization_slug>/latest.json`, whose key carries no run
// id, and an artifact-prefix override would not have covered that either. A
// reserved organization slug is what keeps a judge run away from it — see
// JUDGE_ORG_SLUG_PREFIX.
//
// Validated rather than trusting the call order: staging happens to reject an
// unsafe agentId first inside runBackgroundCase, but these are exported for
// other tracks and a read outside the intended prefix should not depend on who
// calls what.
export const artifactKey = (agentId: string, runId: string): string =>
  `${requireSegment('agentId', agentId)}/${runId}/artifact.json`

export const traceKey = (agentId: string, runId: string): string =>
  `${requireSegment('agentId', agentId)}/${runId}` +
  '/logs/workspace/conversation.jsonl'

export const isJudgeRunId = (runId: string): boolean =>
  runId.startsWith(JUDGE_RUN_ID_PREFIX)

// ---------------------------------------------------------------------------
// Reading foreign JSON
// ---------------------------------------------------------------------------

// Every JSON this module reads comes from S3 or from an orchestrator, so none
// of it is trusted: it is parsed and schema-checked together, and the two
// failure modes are told apart. Malformed bytes and a well-formed document
// that no longer fits the contract mean different things to a caller — see the
// base-arm cache, where one is a corrupt object and the other is schema skew
// that will re-charge every sweep until someone is told which it is.
export type JsonReadFailure = 'unparseable' | 'schemaSkew'

export type JsonRead<T> =
  | { ok: true; value: T }
  | { ok: false; reason: JsonReadFailure }

const safeJson = <T>(schema: z.ZodType<T>, text: string): JsonRead<T> => {
  try {
    const result = schema.safeParse(JSON.parse(text))
    return result.success
      ? { ok: true, value: result.data }
      : { ok: false, reason: 'schemaSkew' }
  } catch {
    // Only JSON.parse throws in here. Zod reports a schema failure as a
    // returned result, never as an exception, which is what keeps the two
    // reasons from collapsing into one.
    return { ok: false, reason: 'unparseable' }
  }
}

// ---------------------------------------------------------------------------
// Staging
// ---------------------------------------------------------------------------

export interface StagedConfig {
  digest: string
  override: JudgeOverride
}

// The key layout comes from judgeOverrideKeys, never from concatenation here.
// The Python side builds from the same helper's shape precisely so the two
// cannot drift, and the helper throws on an agentId or digest that could
// escape the reserved prefix.
//
// Pure, so the caller can check every dispatch precondition before anything is
// written.
export const judgeConfigKeys = (
  agentId: string,
  config: AgentConfig,
): StagedConfig => {
  const digest = backgroundConfigDigest(config)
  return { digest, override: judgeOverrideKeys(agentId, digest) }
}

// _judge_override_behavior's allowlist and manifest_loader's read caps. Same
// reason as the dispatch ceilings below: a manifest the consumer refuses is
// refused with the results callback suppressed, so the sweep stages both arms,
// dispatches both, hears nothing, and records `infraError: poll timed out` —
// the symptom, never the cause. These are the checks where that reasoning
// bites hardest, because the most natural mistake is to hand this field the
// PUBLISHED manifest.json, whose `$schema`, `id`, `version`, `scope` and
// `input_schema` are each refused by name or as an unrecognised key.
const OVERRIDE_BEHAVIOR_FIELDS = new Set([
  'model',
  'max_turns',
  'timeout_seconds',
  'output_schema',
  'runtime',
])
const OVERRIDE_REQUIRED_FIELDS = ['model', 'max_turns', 'output_schema']
const MAX_OVERRIDE_MANIFEST_BYTES = 256 * 1024
const MAX_OVERRIDE_INSTRUCTION_BYTES = 1024 * 1024

// Only the shape the consumer keys on: the field names, and the fact that the
// document is a JSON object at all. The values are NOT re-validated here —
// `max_turns` bounds, the model pattern and the Draft-07 `output_schema` check
// all live in the consumer, and duplicating them would mean two sources of
// truth for a judgment the consumer makes anyway.
const OverrideManifestSchema = z.record(z.string(), JsonValueSchema)

const validateOverrideManifest = (config: AgentConfig): void => {
  const manifestBytes = Buffer.byteLength(config.manifest, 'utf8')
  if (manifestBytes > MAX_OVERRIDE_MANIFEST_BYTES) {
    throw new Error(
      `override manifest is ${manifestBytes} bytes, over the consumer's ` +
        `read cap of ${MAX_OVERRIDE_MANIFEST_BYTES}`,
    )
  }
  const instructionBytes = Buffer.byteLength(config.instruction, 'utf8')
  if (instructionBytes > MAX_OVERRIDE_INSTRUCTION_BYTES) {
    throw new Error(
      `override instruction is ${instructionBytes} bytes, over the ` +
        `consumer's read cap of ${MAX_OVERRIDE_INSTRUCTION_BYTES}`,
    )
  }
  const manifest = safeJson(OverrideManifestSchema, config.manifest)
  if (!manifest.ok) {
    throw new Error(
      'override manifest is not a JSON object, so the consumer cannot ' +
        'project it down to behavior fields',
    )
  }
  const unknown = Object.keys(manifest.value)
    .filter((key) => !OVERRIDE_BEHAVIOR_FIELDS.has(key))
    .sort()
  if (unknown.length > 0) {
    throw new Error(
      `override manifest carries non-behavior field(s) ` +
        `${unknown.join(', ')}; a judge override may only set ` +
        `${[...OVERRIDE_BEHAVIOR_FIELDS].sort().join(', ')}. A judge run may ` +
        'change what the agent is told to do, never what it is allowed to ' +
        'touch, so pass the behavior projection, not the published manifest',
    )
  }
  const absent = OVERRIDE_REQUIRED_FIELDS.filter(
    (field) => !(field in manifest.value),
  )
  if (absent.length > 0) {
    throw new Error(
      `override manifest is missing field(s) ${absent.join(', ')}, which ` +
        'the Fargate runner requires of any manifest the broker serves it',
    )
  }
}

export const stageAgentConfig = async (
  store: ObjectStore,
  bucket: string,
  agentId: string,
  config: AgentConfig,
): Promise<StagedConfig> => {
  const staged = judgeConfigKeys(agentId, config)
  validateOverrideManifest(config)
  await store.putText(bucket, staged.override.manifest_key, config.manifest)
  await store.putText(
    bucket,
    staged.override.instruction_key,
    config.instruction,
  )
  return staged
}

const MANIFEST_FILENAME = 'manifest.json'

// Derived from the helper's own output rather than rebuilt, so the cache can
// never sit at a path the override layout does not own.
const judgeFolder = (agentId: string, configDigest: string): string => {
  const { manifest_key } = judgeOverrideKeys(agentId, configDigest)
  return manifest_key.slice(0, -MANIFEST_FILENAME.length)
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

// Reserved envelope key the dispatch handler strips out of params before the
// agent's input schema sees them.
const INPUT_FILES_KEY = '_input_files'

// dispatch_handler's own ceilings. Duplicated here on purpose: a dispatch that
// trips one is rejected at the Lambda, and because a judge run suppresses the
// result callback, that rejection is invisible — the sweep just waits out the
// full poll timeout and records infraError with no reason. Failing here turns
// a 20-minute silent stall into an immediate, named error.
const MAX_INPUT_FILES = 10
const MAX_INPUT_FILES_JSON_BYTES = 4_000
const MAX_PARAMS_JSON_BYTES = 260_000

// Python measures params with json.dumps' default `", "` / `": "` separators,
// always at least a byte per separator larger than JSON.stringify's compact
// form, and it measures them AFTER popping the envelope key. Rather than
// reproduce that spacing byte for byte, budget against the compact size with
// room to spare: no realistic fixture is within a fifth of the cap, and a
// payload that passes here is then guaranteed to pass there.
const PARAMS_BUDGET_BYTES = Math.floor(MAX_PARAMS_JSON_BYTES * 0.8)

// dispatch_handler's own shapes for an input-file ref. The bucket is NOT
// checked here: the Lambda requires it to equal `gp-agent-run-inputs-` plus
// its own ENVIRONMENT, which this side does not know.
const INPUT_FILE_DEST = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,254}$/
const MAX_INPUT_FILE_KEY_LENGTH = 1024

export interface DispatchMessage {
  run_id: string
  experiment_type: string
  organization_slug: string
  clerk_user_id?: string
  params: Record<string, JsonValue>
  priority: 'HIGH' | 'DEFAULT'
  _judge_override: JudgeOverride
}

// Also reserved. The broker publishes a MUTABLE pointer at
// `<experiment_id>/<organization_slug>/latest.json` beside the immutable
// per-run archive, and that key is scoped to the organization rather than the
// run — so a judge run dispatched under a real slug overwrites that
// organization's product pointer. Neither the run-id prefix nor an artifact
// prefix override prevents it. Confining judge dispatches to a slug no real
// organization uses puts the pointer somewhere nothing reads, and the slug is
// not load-bearing anywhere else: scope derivation and the SQL rewriter bind
// the district from params, never from this. The one exception is the
// fixture slug, which the broker sends to gp-api as X-Organization-Slug for
// the agents that read it.
export const JUDGE_ORG_SLUG_PREFIX = 'judge-'

export const buildDispatchMessage = (args: {
  runId: string
  agentId: string
  organizationSlug: string
  clerkUserId?: string
  agentCase: BackgroundCase
  override: JudgeOverride
}): DispatchMessage => {
  if (!EXPERIMENT_ID.test(args.agentId)) {
    throw new Error(
      `agentId "${args.agentId}" is not a dispatchable experiment_type ` +
        `(${EXPERIMENT_ID.source})`,
    )
  }
  if (!ORG_SLUG.test(args.organizationSlug)) {
    throw new Error(
      `organization_slug "${args.organizationSlug}" is not dispatchable ` +
        `(${ORG_SLUG.source})`,
    )
  }
  if (!args.organizationSlug.startsWith(JUDGE_ORG_SLUG_PREFIX)) {
    throw new Error(
      `judge dispatch needs a "${JUDGE_ORG_SLUG_PREFIX}" organization slug ` +
        `so it cannot overwrite a real organization's latest.json, got ` +
        `"${args.organizationSlug}"`,
    )
  }
  // A judge run may act as one user only, the seeded fixture, and only on its
  // own organization. Anything else would let a sweep read, and through the
  // broker's proxy write, as whoever a caller happened to name.
  if (
    args.clerkUserId !== undefined &&
    (args.clerkUserId !== JUDGE_FIXTURE.clerkUserId ||
      args.organizationSlug !== JUDGE_FIXTURE.orgSlug)
  ) {
    throw new Error(
      `a judge dispatch may name only the fixture user ` +
        `"${JUDGE_FIXTURE.clerkUserId}" on "${JUDGE_FIXTURE.orgSlug}", got ` +
        `"${args.clerkUserId}" on "${args.organizationSlug}"`,
    )
  }
  if (
    args.clerkUserId !== undefined &&
    findAgent(args.agentId)?.readsGpApi !== true
  ) {
    throw new Error(
      `${args.agentId} does not read gp-api, so its judge dispatch names no ` +
        'user; only a readsGpApi agent runs as the fixture account',
    )
  }
  // The backstop for the sweep-wide check in substituteBackgroundCases. That
  // one is what makes a missing fixture value cost nothing; this one is what
  // makes a caller who skipped it unable to send a literal `{judgeOrgSlug}`
  // to the broker — which would ACCEPT it, since these params are plain
  // strings with at most a minLength, launch a task, and bill a run against
  // an organization that does not exist. See assertNoPlaceholders.
  //
  // `inputFiles` is covered too, not just `params`. Its bucket, key and dest
  // are strings that reach S3 and the Lambda, so a token in one would be
  // exactly the failure the guard's comment claims nothing downstream catches.
  // No authored list uses inputFiles yet, which is why it has to be checked
  // now rather than when the first one does.
  assertNoPlaceholders(args.agentCase.caseId, {
    ...args.agentCase.params,
    ...(args.agentCase.inputFiles !== undefined && {
      inputFiles: args.agentCase.inputFiles.map((file) => ({ ...file })),
    }),
  })
  // The handler rejects any `_`-prefixed params key it does not reserve, and
  // it pops the one it does, so a case that hand-rolls its own envelope key
  // would either be refused at the Lambda or silently outrank `inputFiles`.
  const reserved = Object.keys(args.agentCase.params).filter((key) =>
    key.startsWith('_'),
  )
  if (reserved.length > 0) {
    throw new Error(
      `case ${args.agentCase.caseId} params carry reserved envelope key(s) ` +
        `${reserved.join(', ')}; use the case's inputFiles instead`,
    )
  }
  const inputFiles = args.agentCase.inputFiles ?? []
  if (inputFiles.length > MAX_INPUT_FILES) {
    throw new Error(
      `case ${args.agentCase.caseId} carries ${inputFiles.length} input ` +
        `files, over the dispatch handler's limit of ${MAX_INPUT_FILES}`,
    )
  }
  for (const file of inputFiles) {
    if (!INPUT_FILE_DEST.test(file.dest)) {
      throw new Error(
        `input file dest "${file.dest}" is not a simple filename ` +
          `(${INPUT_FILE_DEST.source})`,
      )
    }
    if (file.key === '' || file.key.length > MAX_INPUT_FILE_KEY_LENGTH) {
      throw new Error(
        `input file key must be 1 to ${MAX_INPUT_FILE_KEY_LENGTH} chars, ` +
          `got ${file.key.length}`,
      )
    }
  }
  const refs = inputFiles.map((file) => ({
    bucket: file.bucket,
    key: file.key,
    dest: file.dest,
  }))
  // The Lambda hands this to the Fargate task as the INPUT_FILES_JSON
  // container override, whose own budget is far smaller than params'. Ten
  // worst-case refs clear the count check and blow this one.
  const refsBytes = Buffer.byteLength(JSON.stringify(refs), 'utf8')
  if (refsBytes > MAX_INPUT_FILES_JSON_BYTES) {
    throw new Error(
      `case ${args.agentCase.caseId} input files serialize to ${refsBytes} ` +
        `bytes, over the dispatch handler's limit of ` +
        `${MAX_INPUT_FILES_JSON_BYTES}`,
    )
  }
  // Measured without the envelope key, which is what the Lambda measures
  // after popping it.
  const paramsBytes = Buffer.byteLength(
    JSON.stringify(args.agentCase.params),
    'utf8',
  )
  if (paramsBytes > PARAMS_BUDGET_BYTES) {
    throw new Error(
      `case ${args.agentCase.caseId} params serialize to ${paramsBytes} ` +
        `bytes, over the judge's budget of ${PARAMS_BUDGET_BYTES} ` +
        `(the dispatch handler's cap is ${MAX_PARAMS_JSON_BYTES})`,
    )
  }
  const params: Record<string, JsonValue> = {
    ...args.agentCase.params,
    ...(refs.length > 0 ? { [INPUT_FILES_KEY]: refs } : {}),
  }
  // clerk_user_id only for the agents that read gp-api, and then only the
  // fixture account. Omitted, the ticket names no user and /agent/mcp refuses
  // the run, which is what every other judge dispatch wants. Named, the run
  // can reach gp-api's MCP tools as an account with no campaign and no
  // website, so the write tools it could call 404 rather than write.
  //
  // Nothing about a results queue. A judge dispatch has no experiment_run row,
  // so a callback logs `Experiment run not found` once per run — noise, not
  // corruption, since gp-api's handler does a findUnique and returns on a miss
  // rather than creating a row. Of the three senders, only the runner's own
  // fallback post is silenced by omitting the queue from this side; the
  // broker's CallbackSender and the dispatch handler's error callback both need
  // the Python-side skip the design calls for. This side's job is to ask for
  // nothing and to invent no callback.
  return {
    run_id: args.runId,
    experiment_type: args.agentId,
    organization_slug: args.organizationSlug,
    ...(args.clerkUserId !== undefined && { clerk_user_id: args.clerkUserId }),
    params,
    priority: 'DEFAULT',
    _judge_override: args.override,
  }
}

// A send rejection aborts the case, because nothing has been produced yet and
// a synthesized record would report an outcome no run ever had. An accepted
// send whose response was lost is covered by the same two properties the retry
// path leans on: the deduplication id collapses the second send, and the run
// id is deterministic, so a re-run finds the first task's artifact.
const dispatch = async (
  queue: DispatchQueue,
  message: DispatchMessage,
): Promise<void> =>
  queue.send({
    body: JSON.stringify(message),
    // One FIFO group per run, not per organization. A shared group would
    // serialize the whole sweep, turning five 20-minute runs into an hour and
    // a half.
    groupId: message.run_id,
    // Deterministic, so a retried send inside SQS's dedup window collapses
    // rather than launching a second Fargate task and paying twice.
    deduplicationId: message.run_id,
  })

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------

export interface PollOptions {
  timeoutMs: number
  intervalMs: number
}

export type PollOutcome =
  | { kind: 'found'; body: string; waitedMs: number }
  | { kind: 'timedOut'; waitedMs: number }

// The timeout is the only thing between a silently dead Fargate task and a hung
// sweep, and it protects the ORCHESTRATOR, not the spend: returning timedOut
// records the case and moves on while the task keeps running and keeps calling
// the model until its own timeout_seconds expires. The task reaper is the thing
// that would otherwise notice, and the design has it skip judge run ids, so
// nothing is watching. Size this as the manifest's timeout_seconds plus a
// margin.
//
// A store rejection aborts the case rather than being swallowed: retrying an
// S3 GET belongs to the adapter, and treating a broken credential as "not there
// yet" would burn the whole window and then report a timeout.
//
// Unlike the module's other aborts, by this point the task is running and the
// money is committed — but there is still no artifact, no trace and no record
// to keep, and nothing is lost permanently: the run id is deterministic, so a
// re-run of the same attempt polls the same key and picks up whatever the
// orphaned task eventually publishes.
export const pollForObject = async (
  store: ObjectStore,
  clock: Clock,
  bucket: string,
  key: string,
  options: PollOptions,
): Promise<PollOutcome> => {
  if (options.timeoutMs <= 0 || options.intervalMs <= 0) {
    throw new Error(
      'poll needs a positive timeout and interval; a zero interval spins on ' +
        `S3 for the whole window (got ${options.timeoutMs}ms / ` +
        `${options.intervalMs}ms)`,
    )
  }
  // The deadline is only checked between gets, so an interval longer than the
  // window overshoots it by a whole interval and the recorded latency is the
  // interval rather than the timeout.
  if (options.intervalMs > options.timeoutMs) {
    throw new Error(
      `poll interval ${options.intervalMs}ms exceeds the timeout ` +
        `${options.timeoutMs}ms, so the deadline would be overshot by a ` +
        'whole interval',
    )
  }
  const startedAt = clock.now()
  for (;;) {
    const body = await store.getText(bucket, key)
    const waitedMs = differenceInMilliseconds(clock.now(), startedAt)
    if (body !== undefined) return { kind: 'found', body, waitedMs }
    if (waitedMs >= options.timeoutMs) return { kind: 'timedOut', waitedMs }
    await clock.sleep(options.intervalMs)
  }
}

// ---------------------------------------------------------------------------
// Trace
// ---------------------------------------------------------------------------

// conversation.jsonl, as the Fargate harness writes it. Two dialects exist and
// only the flat one is produced on Fargate, but both are cheap to accept.
// `.nullish()`, not `.optional()`, on every field the writer can emit as null.
// The harness logs with `json.dumps(record, default=str)` over values like
// `ToolResultBlock.is_error`, which is `bool | None`, and `ToolUseBlock.input`,
// which can be None — so `"is_error": null` and `"input": null` are real lines.
// `.optional()` rejects null, a rejected line is skipped entirely, and a
// skipped tool_use both loses a call and shifts every later error's
// attribution. Tolerating null is the difference between a partial trace and a
// quietly wrong one.
const ContentBlockSchema = z.object({
  type: z.string(),
  name: z.string().nullish(),
  input: z.record(z.string(), JsonValueSchema).nullish(),
  is_error: z.boolean().nullish(),
})

const UsageSchema = z.object({
  input_tokens: z.number().int().nonnegative().nullish(),
  output_tokens: z.number().int().nonnegative().nullish(),
  cache_read_input_tokens: z.number().int().nonnegative().nullish(),
  cache_creation_input_tokens: z.number().int().nonnegative().nullish(),
})

const TraceLineSchema = z.object({
  type: z.string(),
  // The SDK hangs usage off the message, which is where the harness's own
  // `_price_turn(message.model, message.usage)` reads it, so that is where it
  // will appear if it is ever logged. The top-level field is accepted too
  // rather than betting on one of the two.
  message: z
    .object({
      content: z.array(ContentBlockSchema).nullish(),
      usage: UsageSchema.nullish(),
    })
    .nullish(),
  is_error: z.boolean().nullish(),
  total_cost_usd: z.number().nonnegative().nullish(),
  usage: UsageSchema.nullish(),
})

// Native web search is the one input a sweep cannot hold still: the fetch
// happens inside the model call with nothing to record. The report says which
// cases saw the live world rather than pretending they did not.
const LIVE_WEB_TOOLS = new Set(['WebSearch', 'WebFetch'])

export interface TraceSummary {
  trace: TraceStep[]
  toolCalls: number
  toolErrors: number
  tokens: TokenUsage
  // The SDK's own authoritative total from the `result` record. See
  // captureCostUsd for why this is not simply re-derived.
  traceCostUsd?: number
  liveWeb: boolean
  toolQueries: string[]
}

const zeroTokens = (): TokenUsage => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
})

// A factory, not a shared constant: a caller that mutated one would corrupt
// every later run's telemetry with no visible link between them.
export const emptyTrace = (): TraceSummary => ({
  trace: [],
  toolCalls: 0,
  toolErrors: 0,
  tokens: zeroTokens(),
  liveWeb: false,
  toolQueries: [],
})

// Reading S3 bytes, so every line is validated rather than trusted. A line
// the harness truncated mid-write is normal for exactly the run whose partial
// trace is most worth keeping, so a bad line is skipped, never fatal.
const parseTraceLine = (
  text: string,
): z.infer<typeof TraceLineSchema> | undefined => {
  const read = safeJson(TraceLineSchema, text)
  return read.ok ? read.value : undefined
}

// Bounds on a trace, because the trace of a 20-minute agent run is whatever
// the agent under test wrote, and both `trace` and `toolQueries` end up inside
// the RunRecord that the base-arm cache stores and every later sweep
// re-downloads. Truncation loses detail; no bound loses the sweep.
const MAX_TRACE_BYTES = 20_000_000
const MAX_TRACE_STEPS = 5_000
const MAX_TOOL_QUERIES = 200
const MAX_TOOL_QUERY_CHARS = 20_000

export const traceTooLarge = (jsonl: string): boolean =>
  Buffer.byteLength(jsonl, 'utf8') > MAX_TRACE_BYTES

export const parseTrace = (jsonl: string): TraceSummary => {
  const trace: TraceStep[] = []
  const tokens = zeroTokens()
  const toolQueries: string[] = []
  let toolCalls = 0
  let rawToolErrors = 0
  let liveWeb = false
  let traceCostUsd: number | undefined

  // Counting past the cap keeps toolCalls honest even once steps stop being
  // recorded, so the clamp below and the telemetry still agree.
  const pushStep = (step: Omit<TraceStep, 'index'>): number | undefined => {
    if (trace.length >= MAX_TRACE_STEPS) return undefined
    const index = trace.length
    trace.push({ ...step, index })
    return index
  }

  // The flat harness dialect carries no tool_use_id on a result, so a failure
  // cannot be correlated to its call by id — only by order. Results arrive in
  // call order, so the pairing is FIFO: the next result belongs to the oldest
  // unanswered call.
  //
  // A backward scan for the most recent unfailed tool step gets this wrong the
  // moment a turn batches calls, which the harness does: two tool_use blocks
  // in one assistant message then two results, first failing, marks the SECOND
  // call as the failure. Every attribution after that is wrong too.
  const awaitingResult: number[] = []

  const consumeResult = (isError: boolean, error: string): void => {
    const index = awaitingResult.shift()
    if (!isError) return
    const step = index === undefined ? undefined : trace[index]
    if (step && step.kind === 'tool') {
      step.error = error
      return
    }
    // A failure with no call to pin it to: a result whose tool_use was
    // dropped by the step cap, or a trace whose opening lines were lost.
    pushStep({ kind: 'error', error })
  }

  const readBlocks = (blocks: z.infer<typeof ContentBlockSchema>[]): void => {
    for (const block of blocks) {
      if (block.type === 'text') {
        pushStep({ kind: 'text' })
        continue
      }
      if (block.type === 'tool_use') {
        const tool = block.name ?? ''
        toolCalls += 1
        const index = pushStep(
          tool === '' ? { kind: 'tool' } : { kind: 'tool', tool },
        )
        // A step the cap refused to record is simply not queued. That cannot
        // mis-align the rest, because results arrive in call order: every
        // pre-cap call is answered before a post-cap one is, so the queue only
        // ever holds recorded steps that are still genuinely unanswered.
        if (index !== undefined) awaitingResult.push(index)
        if (LIVE_WEB_TOOLS.has(tool)) liveWeb = true
        // Only a structured `sql` field is taken. A background agent reaches
        // the warehouse by curling the broker from Bash, so its SQL is buried
        // in a shell command string — see the PR body. Regexing it back out
        // would put something that is not the agent's verbatim query into a
        // field whose whole value is being verbatim.
        const sql = block.input?.sql
        if (
          typeof sql === 'string' &&
          sql !== '' &&
          toolQueries.length < MAX_TOOL_QUERIES
        ) {
          toolQueries.push(sql.slice(0, MAX_TOOL_QUERY_CHARS))
        }
        continue
      }
      // The CLI dialect nests the result inside a user message.
      if (block.type === 'tool_result') {
        const isError = block.is_error === true
        if (isError) rawToolErrors += 1
        consumeResult(isError, 'tool call failed')
      }
    }
  }

  for (const line of jsonl.split('\n')) {
    const text = line.trim()
    if (text === '') continue
    const record = parseTraceLine(text)
    if (record === undefined) continue

    const usage = record.message?.usage ?? record.usage
    if (usage) {
      tokens.input += usage.input_tokens ?? 0
      tokens.output += usage.output_tokens ?? 0
      tokens.cacheRead += usage.cache_read_input_tokens ?? 0
      tokens.cacheWrite += usage.cache_creation_input_tokens ?? 0
    }

    if (record.type === 'assistant' || record.type === 'user') {
      readBlocks(record.message?.content ?? [])
    } else if (record.type === 'tool_result') {
      const isError = record.is_error === true
      if (isError) rawToolErrors += 1
      consumeResult(isError, 'tool call failed')
    } else if (record.type === 'result') {
      traceCostUsd = record.total_cost_usd ?? traceCostUsd
    }
  }

  return {
    trace,
    toolCalls,
    // The record schema refuses toolErrors > toolCalls. A trace can violate
    // that — a failed result with no preceding tool_use block survives a
    // truncated write — and clamping keeps a real, salvageable run from being
    // thrown away over a bookkeeping artifact.
    toolErrors: Math.min(rawToolErrors, toolCalls),
    tokens,
    ...(traceCostUsd === undefined ? {} : { traceCostUsd }),
    liveWeb,
    toolQueries,
  }
}

const hasTokens = (tokens: TokenUsage): boolean =>
  tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite > 0

// `cost.usdAtCapture` is a snapshot of what a run cost at the time, and it is
// never the thing compared — comparison re-derives from pricing.ts so a price
// change re-prices all of history.
//
// A background run today has no token counts to derive from. The Fargate
// harness consumes the SDK's per-message `usage` in-process to price a turn and
// writes only `total_cost_usd` to conversation.jsonl, so the tokens this runner
// records are zeros and the honest snapshot is the harness's own figure. The
// token path is kept live for the day the harness logs usage, because deriving
// from zeros would print $0.00 beside a verdict as if it were measured.
// priceUsd throws on an unlisted model, and on any cache token while the
// listed model has no cache rate — which is the moment usage starts being
// logged, the very case the token path exists for. That throw would escape
// after the dispatch and the poll, discarding the artifact, the trace and the
// whole record of a run that already spent twenty minutes and a few dollars.
// The harness's own total is not fiction, so degrading to it is strictly
// better than losing the run. The README's "throw rather than guess" belongs
// to the comparison layer, which re-derives and can still refuse.
export interface CaptureCost {
  usd: number
  // Set when `usd` is a placeholder rather than a measurement, so a report can
  // print "unmeasured" instead of "$0.00".
  unmeasured?: string
}

// Same rule as the token path above, not a new one: this is the fourth place
// in this feature where a zero would be printed beside a verdict as if it had
// been measured. The harness writes `total_cost_usd` only inside its
// `ResultMessage` branch, and its own `timeout_seconds` cancels the loop
// before that message arrives — so the expensive failure, a run that ran the
// full window, is exactly the one with no figure. A sweep with two timed-out
// cases would under-report its bill by roughly 40%. `CostSchema.usdAtCapture`
// is required and non-nullable, so the zero has to stay in the number; the
// note is what keeps it from reading as a measurement.
const unmeasuredCost = (traceCostUsd: number | undefined): CaptureCost =>
  traceCostUsd === undefined
    ? {
        usd: 0,
        unmeasured:
          'cost is unmeasured, not zero: the trace carried no ' +
          'total_cost_usd and no token usage to derive one from, which is ' +
          'what a run cancelled at its own timeout_seconds looks like',
      }
    : { usd: traceCostUsd }

export const captureCostUsd = (
  tokens: TokenUsage,
  model: string,
  traceCostUsd: number | undefined,
): CaptureCost => {
  if (!hasTokens(tokens)) return unmeasuredCost(traceCostUsd)
  try {
    return { usd: priceUsd(tokens, model) }
  } catch (err) {
    if (err instanceof UnpriceableRunError) return unmeasuredCost(traceCostUsd)
    throw err
  }
}

// ---------------------------------------------------------------------------
// CI provenance
// ---------------------------------------------------------------------------

const PULL_REF = /^refs\/pull\/(\d+)\//

const prNumberFrom = (env: NodeJS.ProcessEnv): number | undefined => {
  const explicit = Number(env.JUDGE_PR_NUMBER)
  if (Number.isSafeInteger(explicit) && explicit > 0) return explicit
  // A `/judge` comment arrives as an issue_comment event, whose GITHUB_REF is
  // not a pull ref, so the workflow passes the number through the env var
  // above. This covers a pull_request-triggered sweep.
  const fromRef = PULL_REF.exec(env.GITHUB_REF ?? '')?.[1]
  const parsed = Number(fromRef)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

// Absent on a local run, which has no Actions run to point at.
export const ciContext = (env: NodeJS.ProcessEnv): CiContext | undefined => {
  const repo = env.GITHUB_REPOSITORY
  const workflowRunId = env.GITHUB_RUN_ID
  if (!repo || !workflowRunId) return undefined
  const attempt = Number(env.GITHUB_RUN_ATTEMPT)
  const prNumber = prNumberFrom(env)
  return {
    repo,
    ...(prNumber === undefined ? {} : { prNumber }),
    workflowRunId,
    workflowRunAttempt:
      Number.isSafeInteger(attempt) && attempt > 0 ? attempt : 1,
    workflowRunUrl: `https://github.com/${repo}/actions/runs/${workflowRunId}`,
  }
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

const UTC_ISO = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"

const isoUtc = (date: Date): string => formatInTimeZone(date, 'UTC', UTC_ISO)

const artifactValue = (body: string): JsonValue | undefined => {
  const read = safeJson(JsonValueSchema, body)
  return read.ok ? read.value : undefined
}

// `getText` resolves undefined for a key that does not exist, so a REJECTION
// here is a real store error rather than "not there yet" — and the difference
// matters, which is why the two are returned apart instead of both collapsing
// to an empty trace.
const readTraceBody = async (
  store: ObjectStore,
  input: BackgroundRunInput,
  runId: string,
): Promise<{ body?: string; error?: string }> => {
  try {
    const body = await store.getText(
      input.artifactBucket,
      traceKey(input.agentId, runId),
    )
    return body === undefined ? {} : { body }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

// The affirmative spend switch. Nothing on this branch constructs a real store
// or queue yet, so nothing can spend today — but this module is where the ~$8
// per run is committed, so the gate belongs here rather than in whatever wires
// it up later.
//
// The exact string, which is the feature's convention: `1`, `yes`, `TRUE` and
// a shell that expanded an unset variable to the empty string all fail closed.
// And a throw rather than a synthetic record, because a sweep that reported
// outcomes it never ran would be worse than one that did not run.
export const JUDGE_SPEND_ENV = 'JUDGE_SPEND'
const JUDGE_SPEND_ON = 'true'

const requireSpendAuthorized = (env: NodeJS.ProcessEnv): void => {
  if (env[JUDGE_SPEND_ENV] !== JUDGE_SPEND_ON) {
    throw new Error(
      `a background judge run dispatches a Fargate task that spends real ` +
        `money, so it needs ${JUDGE_SPEND_ENV}=${JUDGE_SPEND_ON} exactly; ` +
        `got ${env[JUDGE_SPEND_ENV] === undefined ? 'unset' : `"${env[JUDGE_SPEND_ENV]}"`}`,
    )
  }
}

// Exactly the RunRecord fields an orchestrator supplies that the id helpers do
// not already pin. sweepId, caseId and attempt are checked by judgeRunId.
const RunPreconditionsSchema = z.object({
  sweepId: z.string().min(1),
  variant: VariantSchema.omit({ configDigest: true }),
})

// One case, one arm, one attempt: stage, dispatch, poll, emit. Returns the
// record rather than writing it anywhere, so the caller owns storage.
export const runBackgroundCase = async (
  deps: BackgroundRunnerDeps,
  input: BackgroundRunInput,
): Promise<RunRecord> => {
  const env = input.env ?? process.env
  // Checked here rather than beside the dispatch call, because the module's
  // own rule is that every precondition is settled before anything is written
  // or sent, and staging writes first.
  requireSpendAuthorized(env)
  // The record's own preconditions, checked BEFORE the spend rather than at
  // RunRecordSchema.parse after it. `variant` arrives as
  // Omit<Variant, 'configDigest'>, whose fields are all `.min(1)`, so an
  // orchestrator that resolved a base commit to '' typechecks, spends the
  // twenty minutes and the few dollars, and only then throws inside parse —
  // discarding the run it just paid for.
  RunPreconditionsSchema.parse({
    sweepId: input.sweepId,
    variant: input.variant,
  })
  const { digest, override } = judgeConfigKeys(input.agentId, input.config)
  const runId = judgeRunId({
    sweepId: input.sweepId,
    agentId: input.agentId,
    caseId: input.agentCase.caseId,
    arm: input.arm,
    attempt: input.attempt,
  })
  // Built before anything is written or sent, because every precondition the
  // dispatch handler enforces is checked in here: an agentId or a slug the
  // Lambda would reject must not first leave staged bytes in the bucket.
  const message = buildDispatchMessage({
    runId,
    agentId: input.agentId,
    organizationSlug: input.organizationSlug,
    clerkUserId: input.clerkUserId,
    agentCase: input.agentCase,
    override,
  })

  await stageAgentConfig(
    deps.store,
    input.metadataBucket,
    input.agentId,
    input.config,
  )

  const startedAt = deps.clock.now()
  await dispatch(deps.queue, message)

  const outcome = await pollForObject(
    deps.store,
    deps.clock,
    input.artifactBucket,
    artifactKey(input.agentId, runId),
    input.poll,
  )
  const endedAt = deps.clock.now()

  // Read on both paths. The harness uploads logs on its timeout and kill paths
  // too, so a timed-out run often still has a partial trace, and a timeout with
  // its tool calls visible is worth far more than one without.
  //
  // Wrapped, unlike pollForObject. There the trade-off runs the other way: a
  // store rejection during the poll aborts a case that has produced nothing
  // yet, so there is nothing to keep. Here the artifact, the output, the
  // latency and the run identity are all already in memory, and this GET is
  // decoration. Letting a throttle (`SlowDown`) or a credential that expired
  // during an 18-minute poll propagate would throw away a completed, fully
  // paid run on the strength of its very next request.
  const traceRead = await readTraceBody(deps.store, input, runId)

  // A trace we cannot read is NOT quietly replaced with an empty one, whether
  // it is over the cap, absent, or unreadable. Empty telemetry reads as zero
  // tool calls and zero tool errors, which makes isComparable() true, which
  // lets runBackgroundBaseArm cache a base arm whose every Databricks read may
  // have failed — a permanent baseline claiming zero tool errors, with the
  // evidence in the trace that never arrived. That defeats the "a tool error
  // is never a quality signal" protection for every later sweep of the digest,
  // which is the exact outcome the notCached guard exists to prevent.
  //
  // Absence is not normal for a healthy run: the harness writes
  // conversation.jsonl unconditionally and uploads it on the timeout and kill
  // paths too, so an artifact with no trace means the upload 500ed or
  // `_collect_workspace_files` skipped it past its per-file or total cap.
  // Treating that as unmeasurable costs nothing in the good case, and a
  // re-read later is free because the run id is deterministic.
  const traceFailure =
    traceRead.error !== undefined
      ? `trace read failed, so the run cannot be measured: ${traceRead.error}`
      : traceRead.body === undefined
        ? 'run published an artifact but no trace, so it cannot be measured'
        : traceTooLarge(traceRead.body)
          ? `trace exceeds ${MAX_TRACE_BYTES} bytes, so the run cannot be ` +
            'measured'
          : undefined
  const summary =
    traceFailure === undefined && traceRead.body !== undefined
      ? parseTrace(traceRead.body)
      : emptyTrace()

  const value =
    outcome.kind === 'found' ? artifactValue(outcome.body) : undefined
  const failure =
    outcome.kind === 'timedOut'
      ? `poll timed out after ${outcome.waitedMs}ms waiting for ` +
        artifactKey(input.agentId, runId)
      : value === undefined
        ? 'published artifact is not JSON'
        : traceFailure

  const cost = captureCostUsd(
    summary.tokens,
    input.variant.model,
    summary.traceCostUsd,
  )
  // An unmeasured cost is a trace step rather than a `failure`, because it is
  // not a reason to discard the run: the agent produced an artifact and the
  // figure is only the bill. Folding it into `failure` would make the record
  // infraError and drop a perfectly good comparison over a missing number.
  const notes = [failure, cost.unmeasured].filter(
    (note): note is string => note !== undefined,
  )
  const trace = [
    ...summary.trace,
    ...notes.map((error, offset) => ({
      index: summary.trace.length + offset,
      kind: 'error' as const,
      error,
    })),
  ]

  const ci = ciContext(env)

  return RunRecordSchema.parse({
    schemaVersion: 1,
    sweepId: input.sweepId,
    runId,
    agentId: input.agentId,
    agentShape: 'background',
    arm: input.arm,
    variant: { ...input.variant, configDigest: digest },
    caseId: input.agentCase.caseId,
    attempt: input.attempt,
    startedAt: isoUtc(startedAt),
    endedAt: isoUtc(endedAt),
    input: {
      kind: 'params',
      value: {
        params: input.agentCase.params,
        inputFiles: (input.agentCase.inputFiles ?? []).map((file) => ({
          bucket: file.bucket,
          key: file.key,
          dest: file.dest,
        })),
      },
    },
    // Null exactly when the status is infraError; the schema enforces the
    // pairing and isComparable() keeps such a run out of the delta.
    output:
      failure === undefined && value !== undefined
        ? { kind: 'artifact', value }
        : null,
    trace,
    telemetry: {
      latencyMs: differenceInMilliseconds(endedAt, startedAt),
      tokens: summary.tokens,
      cost: {
        usdAtCapture: cost.usd,
        pricingVersion: PRICING_VERSION,
      },
      toolCalls: summary.toolCalls,
      toolErrors: summary.toolErrors,
      // A background attempt is the retry dimension; nothing is retried
      // inside one.
      retries: 0,
    },
    toolQueries: summary.toolQueries,
    ...(input.dataVersion === undefined
      ? {}
      : { dataVersion: input.dataVersion }),
    liveWeb: summary.liveWeb,
    status: failure === undefined ? 'produced' : 'infraError',
    ...(ci === undefined ? {} : { ci }),
  })
}

// ---------------------------------------------------------------------------
// The cached base arm
// ---------------------------------------------------------------------------

// A background run is a few dollars and 15 to 20 minutes, so re-running base
// every sweep doubles the bill on the most expensive agents we have. Base is
// captured once per (agent, base config digest, case) and reused until base's
// digest changes, which is the same content addressing the override key uses.
//
// What this forfeits is the back-to-back interleaving that absorbs live-world
// drift. A background fixture pins most of its input world, but the platform
// check and the Databricks read stay live, so the capture time is recorded and
// the report stamps a comparison whose arms are far apart. The cure for a
// verdict that looks like drift is re-capturing base: one run, not a sweep.
// Its own version, not RunRecordSchema's. This is the third cross-checkout
// contract in the feature to need a marker, and the reason is specific: this
// envelope is written by one checkout and read by another weeks later, and
// leaning on the record's `schemaVersion: z.literal(1)` alone means that the
// day that literal moves, every sweep pays ~$8 per case forever while
// reporting `cache: 'miss'`, which reads as a first capture rather than as a
// cache nothing can use. Versioning the envelope makes the skew nameable.
export const CACHED_BASE_ARM_SCHEMA_VERSION = 1

export const CachedBaseArmSchema = z.object({
  schemaVersion: z.literal(CACHED_BASE_ARM_SCHEMA_VERSION),
  capturedAt: z.string().datetime(),
  record: RunRecordSchema,
})
export type CachedBaseArm = z.infer<typeof CachedBaseArmSchema>

// One object per case rather than one per agent. A shared document would need
// read-modify-write to add a case, and two sweeps capturing different cases of
// the same base would lose one another's work.
export const baseArmCacheKey = (
  agentId: string,
  configDigest: string,
  caseId: string,
): string =>
  `${judgeFolder(agentId, configDigest)}base/` +
  `${requireSegment('caseId', caseId)}.json`

// Why a read missed. Treating a stale entry as a miss is right — the cost of
// re-capturing is one run, and the cost of handing a half-valid record to the
// judge is a wrong verdict — but discarding WHY is not. 'absent' is a first
// capture and costs one run once; 'schemaSkew' costs one run per case per
// sweep until someone changes the writer, and the two are indistinguishable
// from `cache: 'miss'` alone.
export type CacheMissReason =
  | 'absent'
  | 'unparseable'
  | 'schemaSkew'
  | 'keyMismatch'

// A fifth outcome, and deliberately NOT a fifth CacheMissReason: a miss is a
// statement about the cache's CONTENTS, and this is a statement about our own
// read. Folding the two together would report a transient bucket error as
// 'absent', which reads as "no entry, go spend ~$8" when the honest answer is
// "we do not know whether an entry exists".
export type CacheRead =
  | { kind: 'entry'; entry: CachedBaseArm }
  | { kind: 'miss'; reason: CacheMissReason }
  | { kind: 'unreadable'; error: string }

// The key path asserts which agent, digest and case an entry is for; the record
// inside it only claims to. Checking that the two agree is what makes "a cached
// base arm is only sound if its digest names exactly the bytes that ran" a
// property rather than a comment — otherwise anything able to write one object
// into the judge prefix installs a schema-valid baseline that every later sweep
// reuses, which either hides a regression or invents one.
//
// isComparable is re-checked here, not only on write: a hand-written entry
// would otherwise walk straight past the write-side guard.
const cacheEntryMatches = (
  entry: CachedBaseArm,
  agentId: string,
  configDigest: string,
  caseId: string,
): boolean => {
  const { record } = entry
  return (
    record.arm === 'base' &&
    record.agentShape === 'background' &&
    record.agentId === agentId &&
    record.caseId === caseId &&
    record.variant.configDigest === configDigest &&
    isComparable(record)
  )
}

export const readCachedBaseArm = async (
  store: ObjectStore,
  bucket: string,
  agentId: string,
  configDigest: string,
  caseId: string,
): Promise<CacheRead> => {
  // Built OUTSIDE the guard: baseArmCacheKey throws on a caseId that could
  // escape the reserved prefix, and that is a bad input rather than a store
  // error. Reporting it as unreadable would make the sweep spend on a case it
  // should have refused.
  const key = baseArmCacheKey(agentId, configDigest, caseId)
  let body: string | undefined
  try {
    body = await store.getText(bucket, key)
  } catch (err) {
    // Guarded for the same reason readTraceBody is, one step earlier in the
    // case. Unguarded, a `SlowDown` or an expired credential on this one GET
    // aborted the whole case before any run was dispatched — a case thrown
    // away over an error that may not outlive the next request. Proceeding
    // cannot hide a genuinely broken bucket either: staging writes to this
    // same bucket immediately afterwards and aborts there, with nothing spent.
    return {
      kind: 'unreadable',
      error: err instanceof Error ? err.message : String(err),
    }
  }
  if (body === undefined) return { kind: 'miss', reason: 'absent' }
  const read = safeJson(CachedBaseArmSchema, body)
  if (!read.ok) return { kind: 'miss', reason: read.reason }
  return cacheEntryMatches(read.value, agentId, configDigest, caseId)
    ? { kind: 'entry', entry: read.value }
    : { kind: 'miss', reason: 'keyMismatch' }
}

export interface BaseArmResult {
  record: RunRecord
  // 'miss' and 'unknown' both mean this record was captured and stored; they
  // differ in what the cache said first. 'miss' is "there was no usable
  // entry", 'unknown' is "the read failed, so nothing is claimed either way".
  // 'notCached' means the record was not stored, whichever of the two it was.
  cache: 'hit' | 'miss' | 'notCached' | 'unknown'
  // Why the cache did not serve this record. Absent on a hit, and absent when
  // the read failed — there is no known reason in that case, which is the
  // point of keeping the two fields apart.
  cacheMissReason?: CacheMissReason
  // Set instead when the cache READ itself rejected, so a report can say the
  // capture happened without knowing whether it had to.
  cacheReadError?: string
  // When the returned record's run actually happened. On a hit this can predate
  // the candidate by weeks, which is the whole reason it is surfaced.
  capturedAt: string
}

// Read-through. The returned record is the cached one UNCHANGED, including its
// original sweepId, ci and timestamps: rewriting them to the current sweep
// would erase exactly the evidence the staleness stamp is computed from. The
// report pairs arms by agent and case, not by sweep.
export const runBackgroundBaseArm = async (
  deps: BackgroundRunnerDeps,
  input: BackgroundRunInput,
  cacheBucket: string,
): Promise<BaseArmResult> => {
  if (input.arm !== 'base') {
    throw new Error(
      `runBackgroundBaseArm is only for the base arm, got "${input.arm}"`,
    )
  }
  const digest = backgroundConfigDigest(input.config)
  const caseId = input.agentCase.caseId

  const cached = await readCachedBaseArm(
    deps.store,
    cacheBucket,
    input.agentId,
    digest,
    caseId,
  )
  if (cached.kind === 'entry') {
    return {
      record: cached.entry.record,
      cache: 'hit',
      capturedAt: cached.entry.capturedAt,
    }
  }
  // Spread onto every return below, so a capture that happened because the
  // cache could not be read never reports the same way as one that happened
  // because the cache was empty.
  const why =
    cached.kind === 'unreadable'
      ? { cacheReadError: cached.error }
      : { cacheMissReason: cached.reason }
  if (cached.kind === 'unreadable') {
    console.error(
      `judge: reading the cached base arm for ${input.agentId}/${caseId} ` +
        'failed; capturing a fresh one rather than abandoning the case, and ' +
        'reporting the cache state as unknown rather than as a miss',
      cached.error,
    )
  }

  const record = await runBackgroundCase(deps, input)
  // Never cache a run that cannot be compared. A cached timeout, or a cached
  // run whose data read failed, would be reused by every later sweep — so a
  // dead credential would become a permanent baseline rather than one bad run.
  if (!isComparable(record)) {
    return {
      record,
      cache: 'notCached',
      ...why,
      capturedAt: record.startedAt,
    }
  }
  const entry: CachedBaseArm = {
    schemaVersion: CACHED_BASE_ARM_SCHEMA_VERSION,
    capturedAt: record.startedAt,
    record,
  }
  // Failing to SAVE a measurement must not destroy it. The base arm has run to
  // completion — twenty minutes and a few dollars — and the record is already
  // in hand; an AccessDenied on `_judge/*` (a role with read but not write) or
  // a 503 on the PutObject would otherwise throw out of here, so the caller
  // loses the base record and the paired candidate arm has nothing to compare
  // against. Reported as notCached, which makes the next sweep re-capture:
  // that is the documented cost of a miss, rather than losing this sweep too.
  try {
    await deps.store.putText(
      cacheBucket,
      baseArmCacheKey(input.agentId, digest, caseId),
      JSON.stringify(entry),
    )
  } catch (err) {
    console.error(
      `judge: caching the base arm for ${input.agentId}/${caseId} failed; ` +
        'keeping the record and reporting it uncached',
      err,
    )
    return {
      record,
      cache: 'notCached',
      ...why,
      capturedAt: entry.capturedAt,
    }
  }
  return {
    record,
    cache: cached.kind === 'unreadable' ? 'unknown' : 'miss',
    ...why,
    capturedAt: entry.capturedAt,
  }
}
