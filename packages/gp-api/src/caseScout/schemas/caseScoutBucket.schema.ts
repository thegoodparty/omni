import { z } from 'zod'
import { DraftedCaseSchema } from './draftedCase.schema'

// The objects in case-scout-<env>, all gp-api's own. What leaves the bucket
// is the handoff (CaseScoutHandoffSchema in @goodparty_org/contracts), built
// from bundle.json.

export const RUN_ID_PATTERN = /^\d{4}-\d{2}-\d{2}$/
export const RunIdSchema = z.string().regex(RUN_ID_PATTERN)

const SeveritySchema = z.int().min(0).max(3)

// Read leniently: earlier markers were written by other code.
export const MarkerSchema = z.object({
  lastSessionStart: z.string().nullish(),
  processedSessionIds: z.array(z.string()).nullish(),
  updatedByRun: z.string().nullish(),
})
export type Marker = z.infer<typeof MarkerSchema>

export const NewMarkerSchema = z.strictObject({
  lastSessionStart: z.string().nullable(),
  processedSessionIds: z.array(z.string()),
})
export type NewMarker = z.infer<typeof NewMarkerSchema>

export const WrittenMarkerSchema = NewMarkerSchema.extend({
  updatedByRun: RunIdSchema,
})
export type WrittenMarker = z.infer<typeof WrittenMarkerSchema>

// Written once the swarm's webhook answered 2xx, so a retry never sends the
// night twice.
export const DeliverySchema = z.strictObject({
  runId: RunIdSchema,
  webhookId: z.string(),
  sentAt: z.iso.datetime(),
  status: z.int(),
})
export type Delivery = z.infer<typeof DeliverySchema>

export const ManifestSessionSchema = z.strictObject({
  sessionId: z.string().min(1),
  conversationId: z.string().min(1),
  scope: z.string(),
  startedAt: z.iso.datetime(),
  messageIds: z.array(z.string().min(1)).min(1),
})
export type ManifestSession = z.infer<typeof ManifestSessionSchema>

export const ManifestSchema = z.strictObject({
  runId: RunIdSchema,
  startedAt: z.iso.datetime(),
  windowStart: z.iso.datetime().nullable(),
  isInternalFilter: z.boolean(),
  excludedProcessedCount: z.int().min(0),
  cappedCount: z.int().min(0),
  oldMarker: NewMarkerSchema,
  sessions: z.array(ManifestSessionSchema),
  scoredSessionIds: z.array(z.string()),
})
export type Manifest = z.infer<typeof ManifestSchema>

export const RequestScoreSchema = z.strictObject({
  requestOrdinal: z.int(),
  primaryUseCase: z.string(),
  answeredRequest: z.string(),
  overallRating: z.string(),
  majorFailureType: z.string(),
  knownPattern: z.string(),
  severity: SeveritySchema,
  confidence: z.string(),
  humanReviewNeeded: z.string(),
  worthQuotingAnonymized: z.string(),
  summaryNonidentifying: z.string(),
  reasonNonidentifying: z.string(),
})
export type RequestScore = z.infer<typeof RequestScoreSchema>

export const ScoreStatus = {
  scored: 'scored',
  failed: 'failed',
  spendCapped: 'spendCapped',
} as const

export const SessionScoreSchema = z.discriminatedUnion('status', [
  z.strictObject({
    runId: RunIdSchema,
    sessionId: z.string(),
    status: z.literal(ScoreStatus.scored),
    severity: SeveritySchema,
    requests: z.array(RequestScoreSchema).min(1),
    costUsd: z.number().min(0),
  }),
  z.strictObject({
    runId: RunIdSchema,
    sessionId: z.string(),
    status: z.literal(ScoreStatus.failed),
    error: z.string(),
    costUsd: z.number().min(0),
  }),
  z.strictObject({
    runId: RunIdSchema,
    sessionId: z.string(),
    status: z.literal(ScoreStatus.spendCapped),
    costUsd: z.literal(0),
  }),
])
export type SessionScore = z.infer<typeof SessionScoreSchema>

const BundleDraftSchema = z.strictObject({
  agentId: z.string(),
  severity: SeveritySchema,
  case: DraftedCaseSchema,
  failureSummary: z.string(),
})
export type BundleDraft = z.infer<typeof BundleDraftSchema>

// A draft that passed the gate but names a year after its chat's, kept for a
// person and never handed off (util/dateDrift.util.ts).
const HeldDraftSchema = BundleDraftSchema.extend({ reason: z.string() })
export type HeldDraft = z.infer<typeof HeldDraftSchema>

const NeedsSetupSchema = z.strictObject({
  agentId: z.string(),
  severity: SeveritySchema,
  what: z.string(),
})

export const RemovalSchema = z.strictObject({
  caseId: z.string(),
  agentId: z.string(),
  reason: z.string(),
})
export type Removal = z.infer<typeof RemovalSchema>

export const BundleSchema = z.strictObject({
  runId: RunIdSchema,
  drafts: z.array(BundleDraftSchema),
  needsSetup: z.array(NeedsSetupSchema),
  listFull: z.array(BundleDraftSchema),
  // Defaulted so a bundle written before the date check still reads.
  held: z.array(HeldDraftSchema).default([]),
  removals: z.array(RemovalSchema),
})
export type Bundle = z.infer<typeof BundleSchema>

export const SourcesSchema = z.record(
  z.string(),
  z.strictObject({ conversationId: z.string(), sessionId: z.string() }),
)
export type Sources = z.infer<typeof SourcesSchema>

const CountSchema = z.int().min(0)

export const RecordSchema = z.strictObject({
  runId: RunIdSchema,
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime(),
  counts: z.strictObject({
    sessions: CountSchema,
    scored: CountSchema,
    candidates: CountSchema,
    proposed: CountSchema,
    covered: CountSchema,
    needsSetup: CountSchema,
    gated: CountSchema,
    capped: CountSchema,
    spendCapped: CountSchema,
    listFull: CountSchema,
    // Defaulted so the month's earlier records still read for its spend.
    heldForDate: CountSchema.default(0),
  }),
  spendUsd: z.strictObject({
    score: z.number().min(0),
    draft: z.number().min(0),
    gate: z.number().min(0),
    total: z.number().min(0),
  }),
  spendCapHit: z.boolean(),
  model: z.string(),
  errors: z.array(z.string()),
  newMarker: NewMarkerSchema,
})
export type RunRecord = z.infer<typeof RecordSchema>

// Outcomes this side writes. ledger.util.ts also reads PR outcome lines
// (merged, rejected, prClosedStale) leniently where the ledger holds them.
export const DraftOutcome = {
  proposed: 'proposed',
  covered: 'covered',
  needsSetup: 'needsSetup',
  gated: 'gated',
  capped: 'capped',
  spendCapped: 'spendCapped',
  listFull: 'listFull',
  heldForDate: 'heldForDate',
  suppressed: 'suppressed',
  error: 'error',
} as const
export type DraftOutcome = (typeof DraftOutcome)[keyof typeof DraftOutcome]

export const LedgerLineSchema = z.strictObject({
  runId: RunIdSchema,
  conversationId: z.string(),
  sessionId: z.string(),
  agentId: z.string(),
  severity: SeveritySchema,
  outcome: z.enum(DraftOutcome),
  caseId: z.string().nullable(),
  coveredBy: z.string().nullable(),
  needsSetup: z.string().nullable(),
  gateFailures: z.array(z.string()),
  prNumber: z.null(),
  failureSummary: z.string(),
  createdAt: z.iso.datetime(),
})
export type LedgerLine = z.infer<typeof LedgerLineSchema>
