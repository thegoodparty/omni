import { isBefore, parseISO } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { z } from 'zod'

// The judge's one cross-track contract. Every runner emits this shape and
// every layer above a runner reads only this shape, which is what lets one
// judge cover both chat and background agents without knowing which
// produced a record.
//
// FROZEN once this lands. Changing it re-syncs every open build track, so a
// change goes through review rather than a drive-by commit. If a track needs
// a field that no fixture carries, that is a change here, not a local
// invention: two tracks inventing the same field differently is the failure
// this contract exists to prevent.

// An agent's input and output are opaque above the runner, so they are typed
// as JSON rather than `unknown` (rules.mdc Rule 0). The recursion is why
// this needs an explicit annotation and z.lazy.
// The one format `startedAt`/`endedAt` are written in, beside the schemas
// that require it. Every runner and the orchestrator write these fields, so a
// second copy of the format string is a second thing to get wrong.
const UTC_ISO = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"

export const isoUtc = (date: Date): string =>
  formatInTimeZone(date, 'UTC', UTC_ISO)

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
)

export const AgentShapeSchema = z.enum(['chat', 'background'])
export type AgentShape = z.infer<typeof AgentShapeSchema>

export const ArmSchema = z.enum(['base', 'candidate'])
export type Arm = z.infer<typeof ArmSchema>

// `produced` and `blocked` are both agent results and both get judged:
// blocked means the agent declined or returned its fallback, which is a
// behavior worth comparing between arms. `infraError` is never an agent
// result — it is excluded from the delta and counted separately.
export const RunStatusSchema = z.enum(['produced', 'blocked', 'infraError'])
export type RunStatus = z.infer<typeof RunStatusSchema>

// One step of the agent's execution. Recorded for every run and judged by
// nobody in v1, because the judge sees final outputs only. Carrying it from
// the start is what makes turning trace dimensions on later a normalizer
// change instead of a re-run of every sweep.
export const TraceStepSchema = z.object({
  index: z.number().int().nonnegative(),
  kind: z.enum(['text', 'tool', 'error']),
  // The tool's name on a tool step; absent on a text step.
  tool: z.string().min(1).optional(),
  // Present only when this step failed. A step carrying one is what
  // telemetry.toolErrors counts.
  error: z.string().min(1).optional(),
})
export type TraceStep = z.infer<typeof TraceStepSchema>

// Raw counts, split by how each kind is billed. Cache tokens are always
// present and always zero today, because prompt caching is not enabled —
// which is the reason to carry them now rather than later. The day it is
// switched on, a record without these fields prices a cache read at the full
// input rate, overstating it by roughly ten times, and every stored
// comparison silently becomes wrong with nothing to detect it.
export const TokenUsageSchema = z.object({
  input: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  cacheRead: z.number().int().nonnegative(),
  cacheWrite: z.number().int().nonnegative(),
})
export type TokenUsage = z.infer<typeof TokenUsageSchema>

// Cost is stored as a snapshot plus the table that produced it, never as a
// bare number to be compared. A cached base arm can predate its candidate by
// months, so comparing two stored figures measures the price list as much as
// the branch. Re-derive with `priceUsd` from pricing.ts instead; this field
// is for showing what a run cost at the time.
export const CostSchema = z.object({
  usdAtCapture: z.number().nonnegative(),
  pricingVersion: z.string().min(1),
})
export type Cost = z.infer<typeof CostSchema>

// A count of tool errors is not actionable: a sweep that excluded every pair
// said "9 tool error" and nothing else, and naming the failing tool meant a
// throwaway diagnostic branch. So each failure carries the tool and the
// error text, bounded because the base-arm cache stores the record and every
// later sweep re-downloads it, and redacted because the text is a vendor or
// shell string we do not control and it ends up in a public step summary.
export const MAX_TOOL_ERROR_DETAILS = 10
export const MAX_TOOL_ERROR_CHARS = 300

export const ToolErrorDetailSchema = z.object({
  tool: z.string().min(1),
  message: z.string().min(1).max(MAX_TOOL_ERROR_CHARS),
})
export type ToolErrorDetail = z.infer<typeof ToolErrorDetailSchema>

export const TelemetrySchema = z.object({
  latencyMs: z.number().int().nonnegative(),
  tokens: TokenUsageSchema,
  // Absent when the run could not be priced: an unpriced model, or cache
  // tokens with no rate yet.
  //
  // Absent rather than zero. A stored 0 under a real `pricingVersion` reads
  // as "this run was free", and `sharesPricing` would then report two arms
  // as comparably priced when one of them was never priced at all. Absent is
  // unmistakable.
  //
  // And absent rather than fatal: cost is measured evidence, measured
  // evidence never gates a verdict, so a run nobody can price keeps its
  // result and loses only its cost line. Scoring re-derives from `tokens`
  // anyway and reports "not derivable" when it cannot.
  cost: CostSchema.optional(),
  toolCalls: z.number().int().nonnegative(),
  toolErrors: z.number().int().nonnegative(),
  retries: z.number().int().nonnegative(),
})
export type Telemetry = z.infer<typeof TelemetrySchema>

// Where this run came from in GitHub, so a stored record traces back to the
// change it judged rather than only to a commit hash.
//
// `workflowRunId` is deliberately not called `runId`: that name is taken by
// the agent run above, and naming them alike is how someone ends up looking
// up the wrong thing. Absent on a local run, which has no CI to point at.
export const CiContextSchema = z.object({
  // owner/name and nothing else. The report renders it into links on a public
  // summary, so a record cannot carry markdown in it.
  repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  // A sweep can be dispatched without a PR, so this is optional.
  prNumber: z.number().int().positive().optional(),
  workflowRunId: z.string().min(1),
  workflowRunAttempt: z.number().int().positive(),
  // Stored rather than rebuilt from repo and id, because it is the link a
  // person actually follows. Treat it as a convenience: Actions logs expire,
  // so the identifiers above are the part that survives.
  workflowRunUrl: z.string().url(),
})
export type CiContext = z.infer<typeof CiContextSchema>

// What the agent actually read, hashed. For chat that is the rendered system
// prompt plus sorted tool names; for background the manifest plus
// instruction. The orchestrator compares it across arms and refuses to run
// when they match, since a branch that changed nothing the agent can see
// would spend real money proving two identical things identical.
export const VariantSchema = z.object({
  ref: z.string().min(1),
  commit: z.string().min(1),
  model: z.string().min(1),
  configDigest: z.string().min(1),
})
export type Variant = z.infer<typeof VariantSchema>

export const PayloadSchema = z.object({
  // A free-form discriminator the renderer switches on, e.g. 'question' for
  // chat or 'params' for background. Deliberately not an enum: a new agent
  // shape adds a runner and a renderer, not a change to this file.
  kind: z.string().min(1),
  value: JsonValueSchema,
})
export type Payload = z.infer<typeof PayloadSchema>

export const RunRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    sweepId: z.string().min(1),
    runId: z.string().min(1),
    agentId: z.string().min(1),
    agentShape: AgentShapeSchema,
    arm: ArmSchema,
    variant: VariantSchema,
    caseId: z.string().min(1),
    attempt: z.number().int().positive(),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime(),
    input: PayloadSchema,
    // Null only on infraError, where there is no agent result to judge.
    output: PayloadSchema.nullable(),
    trace: z.array(TraceStepSchema),
    telemetry: TelemetrySchema,
    // The SQL the agent generated, verbatim. The agent writes its own
    // queries, so capturing them lets the two arms' generated SQL be diffed
    // directly — a real regression class caught with no judge call.
    toolQueries: z.array(z.string().min(1)),
    // The first failures behind telemetry.toolErrors, in call order. Optional
    // so a record written before the field existed still parses; absent
    // also on a run with no tool error.
    toolErrorDetails: z
      .array(ToolErrorDetailSchema)
      .max(MAX_TOOL_ERROR_DETAILS)
      .optional(),
    // The Delta table version both arms read, so a verdict can never be an
    // artifact of the voter data moving between the two runs. Absent for a
    // run that touched no versioned table.
    dataVersion: z.string().min(1).optional(),
    // Stamped when the turn used native web search, which is the one input
    // we cannot hold still. The report says which cases saw the live world.
    liveWeb: z.boolean(),
    status: RunStatusSchema,
    ci: CiContextSchema.optional(),
  })
  .refine((r) => (r.status === 'infraError') === (r.output === null), {
    message:
      'output must be null exactly when status is infraError: an agent ' +
      'result is required for produced and blocked, and impossible for ' +
      'infraError',
    path: ['output'],
  })
  .refine((r) => r.telemetry.toolErrors <= r.telemetry.toolCalls, {
    message: 'toolErrors cannot exceed toolCalls',
    path: ['telemetry', 'toolErrors'],
  })
  .refine((r) => !isBefore(parseISO(r.endedAt), parseISO(r.startedAt)), {
    message: 'endedAt cannot precede startedAt',
    path: ['endedAt'],
  })

export type RunRecord = z.infer<typeof RunRecordSchema>

// A case is only comparable when both arms produced an agent result AND
// neither hit an infrastructure failure. A tool error is the subtle one: the
// Databricks client resolves lazily, so a broken credential still yields a
// coherent but worse-informed answer rather than a failed run. Both arms
// degrade identically and a judge would read that as a code regression, so
// these cases resolve to CAN'T SAY instead of entering the delta.
export const isComparable = (record: RunRecord): boolean =>
  record.status !== 'infraError' && record.telemetry.toolErrors === 0
