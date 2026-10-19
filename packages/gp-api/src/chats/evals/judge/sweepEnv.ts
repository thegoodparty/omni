import { z } from 'zod'
import {
  JUDGE_FIXTURE_ENV_NAMES,
  PLACEHOLDER_NAMES,
  type PlaceholderValues,
} from './caseParams'
import {
  DEFAULT_JUDGE_CONFIG,
  MAX_LIST_ATTEMPTS_PER_CASE,
  SPEND_ENV,
  SPEND_VALUE,
  spendsRealMoney,
  type JudgeConfig,
  type ShapeBudget,
} from './config'
import { ArmSchema, type Arm } from './record'
import {
  createLocalRecordStore,
  createS3RecordStore,
  s3PortFromClient,
  type RecordStore,
} from './records'
import { S3Client } from '@aws-sdk/client-s3'
import { judgeAwsClientConfig } from './awsCredentials'

// THE SWEEP IS CONFIGURED FROM THE ENVIRONMENT, NOT FROM ARGV, and that is
// forced rather than chosen. The arm capture has to run under vitest, because
// `useTestService()` registers beforeAll/beforeEach/afterAll to stand up the
// Postgres container and the authenticated app — hooks that only exist inside
// a vitest process. A test file has no argv of its own, so the environment is
// the only channel left.
//
// Everything is validated up front and a missing value is a sentence naming
// it, because the alternative is a sweep that spends money and then dies
// several frames deep on an undefined.

const NON_EMPTY = z.string().trim().min(1)

// Both halves of a sweep must agree on the id, since it is the directory the
// two arms meet in. Held to the record store's key alphabet here so the
// failure is "your sweep id is wrong" rather than a path error on the first
// write, after the first turn has already been paid for.
const SweepIdSchema = NON_EMPTY.regex(
  /^[A-Za-z0-9_-]+$/,
  // Phrased to read after the variable's name, since that is how the error
  // sentence is assembled.
  'names a directory in the record store, so it may contain only letters, ' +
    'digits, underscore and hyphen',
).max(
  64,
  // The page replay key carries it as one segment, and the broker refuses a
  // longer one, so it fails here before any arm is captured.
  'is part of every page replay key, so it may be at most 64 characters',
)

// Deduped, the same way `parseAgentSelector` dedupes the CLI's list. A
// repeated id would be swept twice and billed twice, and the second pass
// would overwrite the first's records at the same keys — so the sweep would
// pay double and report single.
const AgentIdsSchema = NON_EMPTY.transform((value) => [
  ...new Set(
    value
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id !== ''),
  ),
]).refine((ids) => ids.length > 0, {
  message: 'no agent ids in JUDGE_AGENTS',
})

// The arm's own reading of JUDGE_AGENTS, exported so armBudget.ts selects
// with the SAME parser rather than a second one that agrees today. A resolver
// that kept a duplicate the arm drops counted that agent twice and refused a
// real one for budget it never used.
export const parseAgentIds = (raw: string): string[] =>
  AgentIdsSchema.parse(raw)

// Affirmative, the same way the workflow's `live` switch is: only the exact
// string 'true' spends. Anything empty, absent or garbled reads as "do not
// spend", so a mangled value costs a sweep that did not happen rather than one
// nobody asked for.
const spends = (value: string | undefined): boolean =>
  spendsRealMoney({ [SPEND_ENV]: value })

// A VALUE A PLAN STEP RESOLVED ARRIVES AS AN EMPTY STRING WHEN IT COULD NOT
// BE RESOLVED, not as an absent variable, and reading one as malformed would
// refuse the arm. Actions exports every `env:` entry a job declares, including
// the ones built from a step output that came back empty, so
// `NON_EMPTY.optional()` is the wrong shape for all of them: it would kill a
// paid sweep over a value the policy says to proceed without.
//
// The Delta version is the case that established this. The workflow resolves
// it in a step of its own and publishes it as a step output; when the mart
// cannot be read that output is empty, and the policy is to sweep unpinned and
// say so in the report, because most agents never touch the mart and refusing
// a whole paid sweep over an unpinnable table is the wrong trade.
//
// The fixture identifiers below take the same shape for a sharper reason: `''`
// is not merely accepted downstream, it SUBSTITUTES — a case would be
// dispatched with `organization_slug: ''`, which the agent's own `minLength`
// refuses twenty minutes in. Read as "not supplied", the missing value is
// instead named by `assertNoPlaceholders` before the first dispatch.
//
// No shape is re-checked here, for any of them. `assertDeltaPin` refuses a
// non-numeric version before the first turn of the run that would splice it
// into SQL; a second regex in this file is one more thing to drift from it.
const BLANK_IS_UNSET = z
  .string()
  .transform((value) => value.trim())
  .transform((value) => (value === '' ? undefined : value))
  .optional()

// WHO ASKED FOR THESE AGENTS: a person who named them, or the trigger's diff.
// `auto` picking an agent up because a README in its directory moved is an
// accidental sweep, and the identical-config and identical-output refusals
// exist to stop one. A request that names what to sweep is not that, and it
// already comes from someone with push access — judge-comment.yml admits only
// `admin|maintain|write` and denies on a failed lookup — so the refusals turn
// into qualifiers in the report rather than silence.
//
// Affirmative, like the spend switch: only this exact word disarms anything,
// so an empty, absent or garbled value leaves every refusal armed. That is the
// safe direction, because the cost of reading `explicit` as `auto` is a sweep
// that refused and said why, and the cost of the reverse is a verdict about
// two things nothing proved were different.
export const SELECTION_ENV = 'JUDGE_SELECTION'
export const EXPLICIT_SELECTION = 'explicit'

// WHERE THIS ARM DRIVES THE CHAT AGENT: in its own process, or over HTTP
// against a deployed gp-api. See runners/chatRuntime.ts for the seam the two
// implement and for the list of directives only the in-process one can
// honour.
//
// Unset is `inprocess` and `inprocess` is byte-for-byte what every arm did
// before this variable existed, so a workflow that never sets it is
// unaffected. Anything else is a typo, and a typo that fell back to the
// default would capture a whole arm in the wrong process and report it as a
// verdict — which is why this is the one judge variable where a garbled
// value is fatal rather than read as "no".
export const ARM_RUNTIME_ENV = 'JUDGE_ARM_RUNTIME'
export const ARM_RUNTIME_KINDS = ['inprocess', 'http'] as const
export type ArmRuntimeKind = (typeof ARM_RUNTIME_KINDS)[number]
export const ARM_RUNTIME_DEFAULT: ArmRuntimeKind = 'inprocess'

const isArmRuntimeKind = (value: string): value is ArmRuntimeKind =>
  ARM_RUNTIME_KINDS.some((kind) => kind === value)

// Hand-written rather than a z.enum, for the reason positiveInt is: the
// sentence has to name the variable, quote what it was given and list what
// it accepts, and zod's enum message carries only the last of the three.
const armRuntimeFrom = (raw: string | undefined): ArmRuntimeKind => {
  if (raw === undefined) return ARM_RUNTIME_DEFAULT
  if (isArmRuntimeKind(raw)) return raw
  throw new SweepEnvError(
    `${ARM_RUNTIME_ENV} is "${raw}", which is not a runtime an arm can be ` +
      'driven on; set it to ' +
      ARM_RUNTIME_KINDS.map((kind) => `"${kind}"`).join(' or ') +
      `, or leave it unset for "${ARM_RUNTIME_DEFAULT}"`,
  )
}

// WHERE AN HTTP ARM POINTS. Required by that runtime and meaningless to the
// in-process one, so it is checked only when the runtime asked for it —
// an origin set on an in-process arm is a leftover, not a failure.
export const TARGET_BASE_URL_ENV = 'JUDGE_TARGET_BASE_URL'

const targetBaseUrlFrom = (raw: string | undefined): string => {
  if (raw === undefined) {
    throw new SweepEnvError(
      `${ARM_RUNTIME_ENV} is "http", so this arm drives a deployed gp-api ` +
        `and needs its origin in ${TARGET_BASE_URL_ENV}; the preview's URL ` +
        'is what the deploy step publishes',
    )
  }
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new SweepEnvError(
      `${TARGET_BASE_URL_ENV} is "${raw}", which is not a URL`,
    )
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new SweepEnvError(
      `${TARGET_BASE_URL_ENV} is "${raw}", whose scheme is not http or https`,
    )
  }
  // Trailing slash removed here rather than at every join: the paths the
  // runner builds all start with one, and `//v1/chats` is a different route
  // to some proxies and the same one to others.
  return raw.replace(/\/+$/, '')
}

const PR_NUMBER = z
  .string()
  .regex(/^\d+$/)
  .transform((value) => Number.parseInt(value, 10))
  .refine((n) => n > 0)

// Shared by both entry points: the sweep id, the agents, and where the records
// live. The arm capture needs more (see ArmEnvSchema); the judging entry needs
// exactly this.
const SweepEnvSchema = z.object({
  JUDGE_SWEEP_ID: SweepIdSchema,
  JUDGE_AGENTS: AgentIdsSchema,
  JUDGE_RECORDS_DIR: NON_EMPTY.optional(),
  JUDGE_RECORDS_BUCKET: NON_EMPTY.optional(),
  JUDGE_PR_NUMBER: PR_NUMBER.optional(),
  // Read by BOTH entry points, not just the arms. The judging step spends
  // too — one panel call per judgeable pair, per seat — so a switch that
  // gated only the arms would make "exercise the pipeline for nothing" a
  // false claim, and it was one.
  JUDGE_SPEND: z.string().optional(),
  // Read by BOTH entry points too, and by all three processes of a sweep. It
  // is BLANK_IS_UNSET rather than NON_EMPTY.optional() for the reason the long
  // note above gives: the workflow builds it from the selection step's output,
  // so it arrives as an empty string on any path that did not set one, and a
  // parser that read blank as malformed would refuse the arm.
  [SELECTION_ENV]: BLANK_IS_UNSET,
  // The base ref's worktree, which the judging step reads one thing from: which
  // cases the BASE list holds out as controls. Blank on a local run, which
  // reads as "not readable" and scores every case.
  JUDGE_BASE_DIR: BLANK_IS_UNSET,
})

const ArmEnvSchema = SweepEnvSchema.extend({
  JUDGE_ARM: ArmSchema,
  JUDGE_BASE_REF: NON_EMPTY,
  JUDGE_CANDIDATE_SHA: NON_EMPTY,
  // The HEAD of the checkout THIS process is running in, which is the only
  // authoritative answer to "which commit produced these records": the base
  // arm runs in a worktree whose commit nothing else in the environment knows.
  JUDGE_ARM_COMMIT: NON_EMPTY,
  JUDGE_CANDIDATE_REF: NON_EMPTY.optional(),
  // The Delta table version BOTH arms must read, so a verdict can never be
  // an artifact of the voter data moving between the two captures. It comes
  // from outside the arm processes for exactly that reason: an arm that read
  // the current version itself would read a different one.
  JUDGE_DATA_VERSION: BLANK_IS_UNSET,
  // THE ONE SET OF IDENTIFIERS both arms substitute into a background case's
  // params, threaded for exactly the reason above: two arms resolving their
  // own would be comparing two inputs. `judgeIdentifiers.ts` resolves them
  // once per sweep outside the arms and `fixtureEnv` builds these three
  // entries from the same constant they are keyed by here.
  //
  // All three optional, because most sweeps need none of them: nine of the
  // fifteen background lists carry plain data, and every chat list does. A
  // case that needs one and did not get it is refused by
  // `assertNoPlaceholders`, which names the token and the case before
  // anything is dispatched — a better failure than an arm that will not
  // start over a variable most of its agents never read.
  [JUDGE_FIXTURE_ENV_NAMES.orgSlug]: BLANK_IS_UNSET,
  [JUDGE_FIXTURE_ENV_NAMES.raceId]: BLANK_IS_UNSET,
  [JUDGE_FIXTURE_ENV_NAMES.userEmail]: BLANK_IS_UNSET,
  // WHERE A BACKGROUND DISPATCH GOES, and all three optional because a chat
  // sweep needs none of them. An arm that will not start over a variable most
  // of its agents never read is a worse failure than the one below: a
  // background agent whose destination is missing is refused by name when its
  // capture is attempted, after the chat agents in the same sweep have already
  // produced their verdicts.
  //
  // Not defaulted to a bucket name built from the environment, deliberately.
  // A wrong-but-plausible default would dispatch somewhere real; an absent one
  // cannot.
  JUDGE_METADATA_BUCKET: BLANK_IS_UNSET,
  JUDGE_ARTIFACT_BUCKET: BLANK_IS_UNSET,
  JUDGE_DISPATCH_QUEUE_URL: BLANK_IS_UNSET,
  // THE BACKGROUND BUDGET, RESOLVED ONCE AND HANDED TO BOTH ARMS.
  //
  // It lives in config.ts, and the base arm runs the BASE REF'S config.ts in
  // a second worktree. So a branch that changed it would walk one budget on
  // candidate and another on base, and every case only one arm walked would
  // be paid for and pair with nothing. The workflow reads the candidate's
  // value once and passes it to both, the way it does the mart's Delta
  // version, so the two arms agree by construction rather than by luck.
  //
  // ATTEMPTS SWITCHES THE MODE. Present, it is a sweep-level input and
  // MAX_CASES blank means "no cap". Absent, nothing was resolved — a local
  // run — and the arm uses its own config wholesale. Keyed on one variable
  // so that "blank cap" and "not supplied" cannot be confused.
  JUDGE_BACKGROUND_ATTEMPTS: BLANK_IS_UNSET,
  JUDGE_BACKGROUND_MAX_CASES: BLANK_IS_UNSET,
  // Which background agents both arms may walk, decided once by armBudget.ts.
  // Read under the same mode switch: with ATTEMPTS present, a blank list
  // means NONE were admitted — never "decide for yourself", which is the
  // per-arm decision this replaces. GitHub hands an empty output over as an
  // empty string, so "admitted nothing" and "never resolved" would otherwise
  // read the same.
  JUDGE_BACKGROUND_ADMITTED: BLANK_IS_UNSET,
  // Why each refused agent was refused, as one JSON object, so the report
  // can say what the resolver decided. Display only for a background agent,
  // which ADMITTED decides; for a chat agent, being named here is the
  // refusal, since chat agents are walked by default. JSON rather than a
  // delimited list because a reason can carry anything, including a
  // multi-line zod message; JSON.stringify keeps it to the single line
  // $GITHUB_OUTPUT needs.
  JUDGE_BACKGROUND_REFUSED: BLANK_IS_UNSET,
  // Control cases past the cap that both arms walk, as one JSON object of
  // agent ids to case ids, decided once by armBudget.ts. Under the same mode
  // switch. See walkedCases for why the arm never decides this itself.
  JUDGE_BACKGROUND_EXTRA_CASES: BLANK_IS_UNSET,
  // Agents whose own list sets its attempts, as one JSON object of agent ids
  // to attempt counts, decided once by armBudget.ts from the candidate's
  // lists. An agent absent here walks JUDGE_BACKGROUND_ATTEMPTS. Under the
  // same mode switch, so the arm never reads its own list's count on a sweep.
  JUDGE_BACKGROUND_AGENT_ATTEMPTS: BLANK_IS_UNSET,
  // The arm's whole wall-clock budget, resolved once like the rest. It is the
  // last per-checkout value both arms have to agree on: the base arm's vitest
  // timeout is otherwise its own ref's constant, so a branch that raised it
  // would admit an agent the base arm is then killed partway through.
  JUDGE_ARM_BUDGET_MS: BLANK_IS_UNSET,
  // Both BLANK_IS_UNSET and both validated by hand below, because the pair
  // only makes sense together: the origin is required by one runtime and
  // ignored by the other.
  [ARM_RUNTIME_ENV]: BLANK_IS_UNSET,
  [TARGET_BASE_URL_ENV]: BLANK_IS_UNSET,
})

export class SweepEnvError extends Error {}

// One sentence, naming what is missing or wrong. Zod's own report is a tree,
// and a tree in a workflow log is what makes someone re-run a job to read it
// again.
//
// "Not set" is decided from the environment rather than from the issue,
// because an absent variable and a malformed one need different sentences and
// zod reports both as an invalid type.
const asSentence = (
  issues: readonly z.core.$ZodIssue[],
  source: NodeJS.ProcessEnv,
): string =>
  issues
    .map((issue) => {
      const name = String(issue.path[0] ?? '(root)')
      const value = source[name]
      return value === undefined || value.trim() === ''
        ? `${name} is not set`
        : `${name} ${issue.message}`
    })
    .join(', and ')

export interface SweepEnv {
  sweepId: string
  agentIds: string[]
  prNumber?: number
  recordsDir?: string
  recordsBucket?: string
  // False unless JUDGE_SPEND is exactly 'true'. On an arm it means the runner
  // gets a canned script; on the judging entry it means a canned panel. Both
  // have to honour it or the pipeline is not exercisable for nothing.
  spends: boolean
  // The judging entry acts on it: an identical config digest, or identical
  // output on every pair, is then reported with a qualifier instead of
  // refused.
  explicitSelection: boolean
  baseDir?: string
}

type ParsedSweep = z.infer<typeof SweepEnvSchema>

const toSweepEnv = (data: ParsedSweep): SweepEnv => ({
  sweepId: data.JUDGE_SWEEP_ID,
  agentIds: data.JUDGE_AGENTS,
  spends: spends(data.JUDGE_SPEND),
  explicitSelection: data[SELECTION_ENV] === EXPLICIT_SELECTION,
  ...(data.JUDGE_PR_NUMBER !== undefined && {
    prNumber: data.JUDGE_PR_NUMBER,
  }),
  ...(data.JUDGE_RECORDS_DIR !== undefined && {
    recordsDir: data.JUDGE_RECORDS_DIR,
  }),
  ...(data.JUDGE_RECORDS_BUCKET !== undefined && {
    recordsBucket: data.JUDGE_RECORDS_BUCKET,
  }),
  ...(data.JUDGE_BASE_DIR !== undefined && { baseDir: data.JUDGE_BASE_DIR }),
})

export interface ArmEnv extends SweepEnv {
  arm: Arm
  baseRef: string
  candidateSha: string
  armCommit: string
  candidateRef?: string
  dataVersion?: string
  // The identifiers a background case's `{judge…}` tokens are substituted
  // with. Always present and usually EMPTY — a sweep that resolved none
  // supplies none — so the absence is an empty object rather than an optional
  // field, and `substituteBackgroundCases` takes it either way.
  fixtureValues: PlaceholderValues
  // Absent on a chat-only sweep. `backgroundDestinationFrom` turns the three
  // into one value or one sentence, so nothing downstream has to decide what a
  // half-configured destination means.
  metadataBucket?: string
  artifactBucket?: string
  dispatchQueueUrl?: string
  // Absent on a local run, where the arm's own config decides. Without the
  // in-flight slots: on a sweep the admitted list already says what runs, so
  // the arm never counts slots, and they stay the arm's own.
  backgroundBudget?: Omit<ShapeBudget, 'maxInFlight'>
  // Present exactly when backgroundBudget is. Absent on a local run, where
  // the arm decides admission itself by spending its own budget down.
  backgroundAdmitted?: ReadonlySet<string>
  backgroundRefused?: ReadonlyMap<string, string>
  backgroundExtraCases?: ReadonlyMap<string, readonly string[]>
  backgroundAgentAttempts?: ReadonlyMap<string, number>
  armBudgetMs?: number
  // Where this arm drives a CHAT agent. Background agents are dispatched to
  // a queue either way and read nothing here.
  armRuntime: ArmRuntimeKind
  // Present exactly when armRuntime is 'http'.
  targetBaseUrl?: string
}

export interface BackgroundDestination {
  metadataBucket: string
  artifactBucket: string
  dispatchQueueUrl: string
}

// ALL THREE OR NONE, and the error names every one that is missing rather than
// the first. A sweep configured with two of the three is a workflow edit that
// dropped a line, and finding out one variable at a time costs a capture
// attempt each.
export const backgroundDestinationFrom = (
  env: ArmEnv,
): BackgroundDestination => {
  const missing = [
    ['JUDGE_METADATA_BUCKET', env.metadataBucket],
    ['JUDGE_ARTIFACT_BUCKET', env.artifactBucket],
    ['JUDGE_DISPATCH_QUEUE_URL', env.dispatchQueueUrl],
  ]
    .filter(([, value]) => value === undefined)
    .map(([name]) => name)
  if (
    missing.length > 0 ||
    env.metadataBucket === undefined ||
    env.artifactBucket === undefined ||
    env.dispatchQueueUrl === undefined
  ) {
    throw new SweepEnvError(
      `a background agent cannot be dispatched without ${missing.join(', ')}` +
        '; set them on the arm steps or select only chat agents',
    )
  }
  return {
    metadataBucket: env.metadataBucket,
    artifactBucket: env.artifactBucket,
    dispatchQueueUrl: env.dispatchQueueUrl,
  }
}

type ParsedArm = z.infer<typeof ArmEnvSchema>

// Keyed off the vocabulary rather than read back out of the parsed object, so
// the three variables cannot drift from the three tokens they supply: the same
// constant names the schema key above and the placeholder below.
const fixtureValuesFrom = (data: ParsedArm): PlaceholderValues => {
  const values: PlaceholderValues = {}
  for (const name of PLACEHOLDER_NAMES) {
    const value = data[JUDGE_FIXTURE_ENV_NAMES[name]]
    if (value !== undefined) values[name] = value
  }
  return values
}

const requireStore = (env: SweepEnv, what: string): void => {
  if (env.recordsDir === undefined && env.recordsBucket === undefined) {
    throw new SweepEnvError(
      `${what} has nowhere to put records: set JUDGE_RECORDS_DIR to a ` +
        'local directory, or JUDGE_RECORDS_BUCKET to an S3 bucket',
    )
  }
  if (env.recordsDir !== undefined && env.recordsBucket !== undefined) {
    throw new SweepEnvError(
      `${what} was given both JUDGE_RECORDS_DIR and JUDGE_RECORDS_BUCKET, ` +
        'and there is no rule for which one wins; set exactly one',
    )
  }
}

export const parseSweepEnv = (
  source: NodeJS.ProcessEnv = process.env,
): SweepEnv => {
  const parsed = SweepEnvSchema.safeParse(source)
  if (!parsed.success) {
    throw new SweepEnvError(
      'the judging entry cannot run: ' +
        asSentence(parsed.error.issues, source),
    )
  }
  const env = toSweepEnv(parsed.data)
  requireStore(env, 'the judging entry')
  return env
}

export const parseArmEnv = (
  source: NodeJS.ProcessEnv = process.env,
): ArmEnv => {
  const parsed = ArmEnvSchema.safeParse(source)
  if (!parsed.success) {
    throw new SweepEnvError(
      'the sweep cannot capture an arm: ' +
        asSentence(parsed.error.issues, source),
    )
  }
  const data = parsed.data

  // The candidate arm's commit is known twice: once as the PR head the plan
  // priced and once as the HEAD of this checkout. They must agree, or the
  // records describe a commit nobody asked about — which is exactly what a
  // stale or wrongly-fetched checkout produces, and it is invisible in the
  // records themselves because both values look like commits.
  if (
    data.JUDGE_ARM === 'candidate' &&
    data.JUDGE_ARM_COMMIT !== data.JUDGE_CANDIDATE_SHA
  ) {
    throw new SweepEnvError(
      `the candidate arm is checked out at ${data.JUDGE_ARM_COMMIT} but the ` +
        `sweep was planned against ${data.JUDGE_CANDIDATE_SHA}; this ` +
        'checkout is not the commit under test',
    )
  }

  const backgroundBudget = backgroundBudgetFrom(data)
  const backgroundAdmitted =
    backgroundBudget === undefined
      ? undefined
      : new Set(
          (data.JUDGE_BACKGROUND_ADMITTED ?? '')
            .split(',')
            .map((id) => id.trim())
            .filter((id) => id !== ''),
        )
  const backgroundRefused =
    backgroundBudget === undefined ? undefined : refusedFrom(data)
  const backgroundExtraCases =
    backgroundBudget === undefined ? undefined : extraCasesFrom(data)
  const backgroundAgentAttempts =
    backgroundBudget === undefined ? undefined : agentAttemptsFrom(data)
  const armBudgetMs =
    backgroundBudget === undefined || data.JUDGE_ARM_BUDGET_MS === undefined
      ? undefined
      : positiveInt('JUDGE_ARM_BUDGET_MS', data.JUDGE_ARM_BUDGET_MS)
  const armRuntime = armRuntimeFrom(data[ARM_RUNTIME_ENV])
  const targetBaseUrl =
    armRuntime === 'http'
      ? targetBaseUrlFrom(data[TARGET_BASE_URL_ENV])
      : undefined
  const env: ArmEnv = {
    ...toSweepEnv(data),
    armRuntime,
    ...(targetBaseUrl !== undefined && { targetBaseUrl }),
    ...(backgroundBudget !== undefined && { backgroundBudget }),
    ...(backgroundAdmitted !== undefined && { backgroundAdmitted }),
    ...(backgroundRefused !== undefined && { backgroundRefused }),
    ...(backgroundExtraCases !== undefined && { backgroundExtraCases }),
    ...(backgroundAgentAttempts !== undefined && { backgroundAgentAttempts }),
    ...(armBudgetMs !== undefined && { armBudgetMs }),
    arm: data.JUDGE_ARM,
    baseRef: data.JUDGE_BASE_REF,
    candidateSha: data.JUDGE_CANDIDATE_SHA,
    armCommit: data.JUDGE_ARM_COMMIT,
    fixtureValues: fixtureValuesFrom(data),
    ...(data.JUDGE_METADATA_BUCKET !== undefined && {
      metadataBucket: data.JUDGE_METADATA_BUCKET,
    }),
    ...(data.JUDGE_ARTIFACT_BUCKET !== undefined && {
      artifactBucket: data.JUDGE_ARTIFACT_BUCKET,
    }),
    ...(data.JUDGE_DISPATCH_QUEUE_URL !== undefined && {
      dispatchQueueUrl: data.JUDGE_DISPATCH_QUEUE_URL,
    }),
    ...(data.JUDGE_CANDIDATE_REF !== undefined && {
      candidateRef: data.JUDGE_CANDIDATE_REF,
    }),
    ...(data.JUDGE_DATA_VERSION !== undefined && {
      dataVersion: data.JUDGE_DATA_VERSION,
    }),
  }
  requireStore(env, `the ${env.arm} arm`)
  assertRuntimeCanSpend(env)
  assertRuntimeCanPin(env)
  return env
}

// THE DELTA PIN IS AN IN-PROCESS REWRITE, so an HTTP arm cannot apply one
// and must not pretend to. Refused here rather than per case: the runtime
// refuses it there too, but by then every chat case in the sweep fails
// separately with the same sentence, and the thing to change is one
// workflow input.
const assertRuntimeCanPin = (env: ArmEnv): void => {
  if (env.armRuntime !== 'http' || env.dataVersion === undefined) return
  throw new SweepEnvError(
    `${ARM_RUNTIME_ENV} is "http" and JUDGE_DATA_VERSION is ` +
      `"${env.dataVersion}", but the pin is a VERSION AS OF rewrite ` +
      'DatabricksSqlProvider.query performs inside the agent process. A ' +
      'deployed gp-api neither pins nor reports a version, so this arm ' +
      'would record one it never applied. Leave JUDGE_DATA_VERSION blank ' +
      `for an HTTP sweep, or leave ${ARM_RUNTIME_ENV} unset to pin.`,
  )
}

// AN HTTP ARM AND A DRY RUN ARE NOT COMPATIBLE, and the refusal is here
// rather than at the first case because by then an arm step has booted a
// Postgres container and a Nest app for nothing.
//
// A dry run replaces the model with a canned script, and the only seam that
// can do that is `installLlmCapture`, which rewrites `streamChatCompletion`
// on the arm process's OWN LlmService singleton. A deployed container has no
// such seam and nothing the arm can reach from outside it: the turns would
// be real, paid ones captured under a flag that says nothing was spent. The
// other direction — stubbing the model inside the deployed app — would make
// the eval measure the stub.
//
// So the two settings are named together, because either one of them is the
// one to change and which one depends on what was wanted.
const assertRuntimeCanSpend = (env: ArmEnv): void => {
  if (env.armRuntime !== 'http' || env.spends) return
  throw new SweepEnvError(
    `${ARM_RUNTIME_ENV} is "http" but ${SPEND_ENV} is not ` +
      `"${SPEND_VALUE}", so this arm asked to drive a DEPLOYED gp-api with ` +
      "a canned model. The canned model is a patch on this process's own " +
      'LlmService and a deployed container is not this process, so every ' +
      'turn would be a real, paid one recorded as a dry run. Set ' +
      `${SPEND_ENV}=${SPEND_VALUE} to sweep over HTTP, or leave ` +
      `${ARM_RUNTIME_ENV} unset to dry-run in process.`,
  )
}

// A positive integer or a sentence. Not `z.coerce.number()`: that reads
// "1.5" and "1e1" as numbers and "" as 0, and every one of those reaches
// slice or a loop bound as something nobody wrote.
const UNIT_FOR: Record<string, string> = {
  JUDGE_BACKGROUND_ATTEMPTS: 'attempts',
  JUDGE_BACKGROUND_MAX_CASES: 'cases',
  JUDGE_ARM_BUDGET_MS: 'milliseconds',
}

const positiveInt = (name: string, raw: string): number => {
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw new SweepEnvError(
      `${name} is "${raw}", which is not a positive whole number of ` +
        (UNIT_FOR[name] ?? 'units') +
        '; the workflow resolves it from the candidate config, so a value ' +
        'like this means that step printed something unexpected',
    )
  }
  return Number(raw)
}

const backgroundBudgetFrom = (
  data: ParsedArm,
): Omit<ShapeBudget, 'maxInFlight'> | undefined => {
  if (data.JUDGE_BACKGROUND_ATTEMPTS === undefined) {
    // A cap with no attempts is a half-resolved budget. Refused rather than
    // dropped, because dropping it silently falls back to the arm's own
    // config — which is the per-checkout mismatch this input exists to end.
    for (const name of [
      'JUDGE_BACKGROUND_MAX_CASES',
      'JUDGE_BACKGROUND_ADMITTED',
      'JUDGE_BACKGROUND_REFUSED',
      'JUDGE_BACKGROUND_EXTRA_CASES',
      'JUDGE_BACKGROUND_AGENT_ATTEMPTS',
      'JUDGE_ARM_BUDGET_MS',
    ] as const) {
      if (data[name] !== undefined) {
        throw new SweepEnvError(
          `${name} is set but JUDGE_BACKGROUND_ATTEMPTS is not, so this is ` +
            'half a budget; the workflow sets all of them or none',
        )
      }
    }
    return undefined
  }
  const attemptsPerCase = positiveInt(
    'JUDGE_BACKGROUND_ATTEMPTS',
    data.JUDGE_BACKGROUND_ATTEMPTS,
  )
  return data.JUDGE_BACKGROUND_MAX_CASES === undefined
    ? { attemptsPerCase }
    : {
        attemptsPerCase,
        maxCases: positiveInt(
          'JUDGE_BACKGROUND_MAX_CASES',
          data.JUDGE_BACKGROUND_MAX_CASES,
        ),
      }
}

const RefusedSchema = z.record(z.string(), z.string())

const refusedFrom = (data: ParsedArm): ReadonlyMap<string, string> => {
  const raw = data.JUDGE_BACKGROUND_REFUSED
  if (raw === undefined) return new Map()
  const parseJson = (): ReturnType<typeof RefusedSchema.safeParse> | null => {
    try {
      return RefusedSchema.safeParse(JSON.parse(raw))
    } catch {
      return null
    }
  }
  const result = parseJson()
  if (result === null) {
    throw new SweepEnvError(
      'JUDGE_BACKGROUND_REFUSED is not JSON; the workflow resolves it from ' +
        'the candidate, so this means that step printed something unexpected',
    )
  }
  if (!result.success) {
    throw new SweepEnvError(
      'JUDGE_BACKGROUND_REFUSED is not an object of agent ids to reasons',
    )
  }
  return new Map(Object.entries(result.data))
}

const ExtraCasesSchema = z.record(z.string(), z.array(z.string().min(1)))

const extraCasesFrom = (
  data: ParsedArm,
): ReadonlyMap<string, readonly string[]> => {
  const raw = data.JUDGE_BACKGROUND_EXTRA_CASES
  if (raw === undefined) return new Map()
  const parseJson = (): ReturnType<
    typeof ExtraCasesSchema.safeParse
  > | null => {
    try {
      return ExtraCasesSchema.safeParse(JSON.parse(raw))
    } catch {
      return null
    }
  }
  const result = parseJson()
  if (result === null) {
    throw new SweepEnvError(
      'JUDGE_BACKGROUND_EXTRA_CASES is not JSON; the workflow resolves it ' +
        'from the candidate, so this means that step printed something ' +
        'unexpected',
    )
  }
  if (!result.success) {
    throw new SweepEnvError(
      'JUDGE_BACKGROUND_EXTRA_CASES is not an object of agent ids to case ids',
    )
  }
  return new Map(Object.entries(result.data))
}

const AgentAttemptsSchema = z.record(
  z.string(),
  z.number().int().positive().max(MAX_LIST_ATTEMPTS_PER_CASE),
)

const agentAttemptsFrom = (data: ParsedArm): ReadonlyMap<string, number> => {
  const raw = data.JUDGE_BACKGROUND_AGENT_ATTEMPTS
  if (raw === undefined) return new Map()
  const parseJson = (): ReturnType<
    typeof AgentAttemptsSchema.safeParse
  > | null => {
    try {
      return AgentAttemptsSchema.safeParse(JSON.parse(raw))
    } catch {
      return null
    }
  }
  const result = parseJson()
  if (result === null) {
    throw new SweepEnvError(
      'JUDGE_BACKGROUND_AGENT_ATTEMPTS is not JSON; the workflow resolves ' +
        'it from the candidate, so this means that step printed something ' +
        'unexpected',
    )
  }
  if (!result.success) {
    throw new SweepEnvError(
      'JUDGE_BACKGROUND_AGENT_ATTEMPTS is not an object of agent ids to ' +
        `attempt counts from 1 to ${MAX_LIST_ATTEMPTS_PER_CASE}`,
    )
  }
  return new Map(Object.entries(result.data))
}

// The arm budget read where vitest needs it — at module scope, before any
// test body runs, because the timeout is taken when `it` is registered. The
// SAME strict parse parseArmEnv applies, so the two reads cannot disagree:
// a looser module-scope read once accepted "1e7", which parseArmEnv refuses.
// Blank or absent is a local run, which uses the arm's own constant.
//
// UNDER THE SAME MODE SWITCH as everything else here: the budget counts only
// when ATTEMPTS is present. Without that gate a local run with only
// JUDGE_ARM_BUDGET_MS set got this timeout from it while the loader spent the
// arm constant — two readings of one value — and was killed partway through.
export const armTimeoutMs = (
  env: NodeJS.ProcessEnv,
  fallback: number,
): number => {
  const raw = env.JUDGE_ARM_BUDGET_MS?.trim()
  const attempts = env.JUDGE_BACKGROUND_ATTEMPTS?.trim()
  return raw === undefined || raw === '' || !attempts
    ? fallback
    : positiveInt('JUDGE_ARM_BUDGET_MS', raw)
}

// The config this arm actually walks with: its own, with the background
// budget replaced when the sweep supplied one. ONE function, read by both
// captureArm (attempts) and the case loader (the cap), so the two halves of
// the budget cannot come from two different places.
export const armConfigFor = (
  env: ArmEnv,
  base: JudgeConfig = DEFAULT_JUDGE_CONFIG,
): JudgeConfig =>
  env.backgroundBudget === undefined
    ? base
    : {
        ...base,
        background: {
          ...env.backgroundBudget,
          maxInFlight: base.background.maxInFlight,
        },
      }

// What a record's `variant.ref` says for this arm. The base arm is a branch
// name; the candidate arm's head ref is not in the plan's outputs, so it falls
// back to naming the commit rather than to the base ref, which would make the
// two arms indistinguishable in the one field meant to tell them apart.
export const variantFor = (env: ArmEnv): { ref: string; commit: string } => ({
  ref:
    env.arm === 'base'
      ? env.baseRef
      : (env.candidateRef ?? `candidate@${env.candidateSha.slice(0, 12)}`),
  commit: env.armCommit,
})

export const storeFromEnv = (env: SweepEnv): RecordStore => {
  if (env.recordsBucket !== undefined) {
    const bucket = env.recordsBucket
    return createS3RecordStore(
      s3PortFromClient(new S3Client(judgeAwsClientConfig()), bucket),
      bucket,
    )
  }
  if (env.recordsDir === undefined) {
    throw new SweepEnvError('no record store configured')
  }
  return createLocalRecordStore(env.recordsDir)
}
