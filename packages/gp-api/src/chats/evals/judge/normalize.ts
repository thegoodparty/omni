import { DEFAULT_JUDGE_CONFIG, type JudgeConfig, type Rng } from './config'
import {
  isComparable,
  type AgentShape,
  type Arm,
  type Payload,
  type RunRecord,
} from './record'

// Turns stored records into the one thing a judge is allowed to see.
//
// Deterministic and model-free. Two jobs: pair the arms by case, and blind
// the pair so nothing in the payload says which side is new. The second job
// is the load-bearing one — without it the judge leans toward whatever it
// believes is the candidate, and every verdict after that is measuring the
// judge's prior rather than the branch.

export type Slot = 'X' | 'Y'

export const SLOTS: readonly Slot[] = ['X', 'Y']

// Which arm each slot holds. Kept on our side and never put in a payload;
// scoring re-orients with it after the judge has answered.
export type SlotMap = Readonly<Record<Slot, Arm>>

export interface BlindedRun {
  id: Slot
  // The agent's final output, rendered and scrubbed. v1 judges final
  // outputs only: the trace is in the record but stays out of here, so
  // turning trace dimensions on later is a change to this renderer and a
  // re-grade of stored records rather than a re-run of any agent.
  finalOutput: string
  // Set when the output was cut to fit render.maxRenderedChars.
  truncatedChars: number
}

// Everything the judge sees, and nothing else. Structurally separate from
// the slot map so no code path can send one by reaching for the other.
export interface JudgePayload {
  agentId: string
  agentShape: AgentShape
  caseId: string
  // Identical across arms by construction, so it is shown once.
  sharedInput: string
  runs: readonly [BlindedRun, BlindedRun]
}

export interface NormalizedCase {
  agentId: string
  caseId: string
  attempt: number
  payload: JudgePayload
  slotMap: SlotMap
  // Kept here so scoring can re-derive cost, latency and tool-error
  // evidence from the raw numbers. Deliberately NOT reachable from the
  // payload.
  records: { base: RunRecord; candidate: RunRecord }
}

// Why a case never reached the judge. Both are infrastructure, not quality,
// and both are reported apart from a real verdict.
export type ExclusionReason = 'toolError' | 'infraError'

export interface ExcludedCase {
  agentId: string
  caseId: string
  attempt: number
  reason: ExclusionReason
  // Which arms were affected, for the report line.
  arms: readonly Arm[]
  // Kept for the same reason the judgeable cases keep theirs: cost and
  // latency are measurements, so an excluded case still contributes
  // evidence even though it contributes no verdict.
  records: { base: RunRecord; candidate: RunRecord }
}

export interface UnpairedRecord {
  agentId: string
  caseId: string
  attempt: number
  // The arm we have. The other one never arrived.
  arm: Arm
}

export interface NormalizedAgent {
  agentId: string
  shape: AgentShape
  judgeable: NormalizedCase[]
  excluded: ExcludedCase[]
  unpaired: UnpairedRecord[]
}

// Both arms hashed to the same config, so the agent could not have seen any
// difference and there is nothing to compare. Thrown rather than returned:
// a sweep that spends money proving two identical things identical is a bug
// in whatever dispatched it, not a result to report.
export class IdenticalConfigError extends Error {}

// A runner handed us two arms of one case with different inputs, so the
// comparison would not be like for like.
export class MismatchedInputError extends Error {}

export class UnrenderableRecordError extends Error {}

// Renderers are keyed on `payload.kind`, which is a free-form string in the
// record precisely so that a third agent shape adds an entry here rather
// than a schema migration. Anything unrecognised falls through to pretty
// JSON, which is correct for an opaque value and never silently empty.
export type PayloadRenderer = (payload: Payload) => string

const renderJson: PayloadRenderer = (payload) =>
  typeof payload.value === 'string'
    ? payload.value
    : JSON.stringify(payload.value, null, 2)

export const RENDERERS: Readonly<Record<string, PayloadRenderer>> = {
  // Chat: the input is a question and the output is prose.
  question: renderJson,
  text: renderJson,
  // Background: the input is a params object and the output an artifact.
  params: renderJson,
  artifact: renderJson,
}

export const renderPayload = (payload: Payload): string =>
  (RENDERERS[payload.kind] ?? renderJson)(payload)

// Literal strings from the records that would say which arm is which. Built
// from BOTH records and applied to BOTH rendered outputs, which is the part
// that matters: scrubbing each arm with only its own values would mangle one
// side's text and leave the other intact, and asymmetric mangling is itself
// a direction signal.
//
// Deliberately absent: the words "base" and "candidate". The arm label is
// blinded by never being a field in the payload, and stripping those two
// words from agent text would gut the product's own vocabulary — a
// candidate for office is the domain here.
const stripList = (records: readonly RunRecord[]): [string, string][] => {
  const entries: [string, string][] = []
  for (const r of records) {
    entries.push([r.variant.commit, '[commit]'])
    entries.push([r.variant.configDigest, '[digest]'])
    entries.push([r.variant.ref, '[ref]'])
    entries.push([r.variant.model, '[assistant]'])
    entries.push([r.runId, '[run]'])
    entries.push([r.sweepId, '[sweep]'])
  }
  // Longest first, so a value that contains another is replaced whole.
  // Deduped because both arms usually share a model.
  return [...new Map(entries.map((e) => [e[0], e])).values()]
    .filter(([needle]) => needle.length > 0)
    .sort((a, b) => b[0].length - a[0].length)
}

// Whole-token and case-insensitive, because a ref is routinely an ordinary
// word: a plain substring strip turns "domain" into "do[ref]" and
// "remaining" into "re[ref]ing", and when one arm capitalises the word and
// the other does not it mangles one side only — which is itself the
// direction signal the blinding exists to remove. Boundaries are
// alphanumeric rather than \b so a needle ending in punctuation still
// matches, and a hyphenated extension such as "main-2" still strips.
const literalPattern = (needle: string): RegExp =>
  new RegExp(
    `(?<![0-9A-Za-z])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` +
      '(?![0-9A-Za-z])',
    'gi',
  )

const replaceLiterals = (
  text: string,
  list: readonly [string, string][],
): string =>
  list.reduce(
    (acc, [needle, token]) => acc.replace(literalPattern(needle), token),
    text,
  )

// Opaque ids an agent may echo into its answer. Rewritten to sequential
// handles against one table per case, so an id that appears in both arms
// gets the SAME handle in both — a per-arm table would hand the judge a
// spurious difference to notice.
const ID_PATTERN =
  /\b(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32,64})\b/gi

const neutraliseIds = (text: string, table: Map<string, string>): string =>
  text.replace(ID_PATTERN, (match) => {
    const key = match.toLowerCase()
    const existing = table.get(key)
    if (existing !== undefined) return existing
    const handle = `[id-${table.size + 1}]`
    table.set(key, handle)
    return handle
  })

// Rebuilt per call rather than used as given: a module-level /g/ regex
// carries lastIndex between calls, and a config value shared by nine tracks
// is exactly where that would bite.
const scrubIdentity = (text: string, patterns: readonly RegExp[]): string =>
  patterns.reduce(
    (acc, p) => acc.replace(new RegExp(p.source, 'gi'), '[assistant]'),
    text,
  )

interface ScrubContext {
  literals: readonly [string, string][]
  idTable: Map<string, string>
  config: JudgeConfig
}

const scrub = (
  text: string,
  ctx: ScrubContext,
): { text: string; truncatedChars: number } => {
  const cleaned = neutraliseIds(
    scrubIdentity(
      replaceLiterals(text, ctx.literals),
      ctx.config.render.identityPatterns,
    ),
    ctx.idTable,
  )
  const limit = ctx.config.render.maxRenderedChars
  if (cleaned.length <= limit) return { text: cleaned, truncatedChars: 0 }
  const dropped = cleaned.length - limit
  return {
    text: `${cleaned.slice(0, limit)}\n[truncated: ${dropped} chars]`,
    truncatedChars: dropped,
  }
}

const outputOf = (record: RunRecord): Payload => {
  if (record.output === null) {
    throw new UnrenderableRecordError(
      `record ${record.runId} has no output, so it cannot be blinded: a ` +
        'null output means infraError, which is excluded before this point',
    )
  }
  return record.output
}

// The one random step. Slots are drawn per case rather than per sweep: a
// single draw for a whole sweep would put every candidate in the same slot,
// so any position bias the judge has would land entirely on one arm and
// read as a real effect.
export const assignSlots = (rng: Rng): SlotMap =>
  rng() < 0.5 ? { X: 'base', Y: 'candidate' } : { X: 'candidate', Y: 'base' }

export const blindCase = (
  base: RunRecord,
  candidate: RunRecord,
  rng: Rng,
  config: JudgeConfig = DEFAULT_JUDGE_CONFIG,
): NormalizedCase => {
  if (base.variant.configDigest === candidate.variant.configDigest) {
    throw new IdenticalConfigError(
      `both arms of ${base.agentId}/${base.caseId} hash to config digest ` +
        `"${base.variant.configDigest}", so the agent saw no difference ` +
        'and there is nothing to compare',
    )
  }

  const ctx: ScrubContext = {
    literals: stripList([base, candidate]),
    idTable: new Map<string, string>(),
    config,
  }

  const baseInput = scrub(renderPayload(base.input), ctx).text
  const candidateInput = scrub(renderPayload(candidate.input), ctx).text
  if (baseInput !== candidateInput) {
    throw new MismatchedInputError(
      `the two arms of ${base.agentId}/${base.caseId} were given ` +
        'different inputs, so comparing them would not be like for like',
    )
  }

  const slotMap = assignSlots(rng)
  const byArm = { base, candidate }
  const runs = SLOTS.map((slot) => {
    const scrubbed = scrub(renderPayload(outputOf(byArm[slotMap[slot]])), ctx)
    return {
      id: slot,
      finalOutput: scrubbed.text,
      truncatedChars: scrubbed.truncatedChars,
    }
  })
  const [x, y] = runs
  if (x === undefined || y === undefined) {
    throw new UnrenderableRecordError('a blinded pair needs exactly two runs')
  }

  return {
    agentId: base.agentId,
    caseId: base.caseId,
    attempt: base.attempt,
    payload: {
      agentId: base.agentId,
      agentShape: base.agentShape,
      caseId: base.caseId,
      sharedInput: baseInput,
      runs: [x, y],
    },
    slotMap,
    records: { base, candidate },
  }
}

// Judging the same pair in both orders is how position bias is measured, so
// the swap has to produce a payload the judge cannot tell apart from a fresh
// one: the slot map inverts and the two outputs exchange places.
export const withSwappedSlots = (
  normalized: NormalizedCase,
): NormalizedCase => {
  const [x, y] = normalized.payload.runs
  return {
    ...normalized,
    slotMap: { X: normalized.slotMap.Y, Y: normalized.slotMap.X },
    payload: {
      ...normalized.payload,
      runs: [
        { ...y, id: 'X' },
        { ...x, id: 'Y' },
      ],
    },
  }
}

const keyOf = (r: RunRecord): string =>
  `${r.agentId}\u0000${r.caseId}\u0000${r.attempt}`

const exclusionFor = (
  base: RunRecord,
  candidate: RunRecord,
): { reason: ExclusionReason; arms: Arm[] } | null => {
  if (isComparable(base) && isComparable(candidate)) return null
  const infra: Arm[] = []
  if (base.status === 'infraError') infra.push('base')
  if (candidate.status === 'infraError') infra.push('candidate')
  // infraError first: a run that died never got far enough for a tool
  // error to mean anything about it.
  if (infra.length > 0) return { reason: 'infraError', arms: infra }
  const tool: Arm[] = []
  if (base.telemetry.toolErrors > 0) tool.push('base')
  if (candidate.telemetry.toolErrors > 0) tool.push('candidate')
  return { reason: 'toolError', arms: tool }
}

// Pairs one agent's records by case and attempt, and blinds every pair that
// is comparable. Attempt i of one arm pairs with attempt i of the other,
// per the run plan; judging all k x k combinations is not the design.
export const normalizeAgent = (
  records: readonly RunRecord[],
  rng: Rng,
  config: JudgeConfig = DEFAULT_JUDGE_CONFIG,
): NormalizedAgent => {
  const agentIds = new Set(records.map((r) => r.agentId))
  if (agentIds.size > 1) {
    throw new MismatchedInputError(
      'normalizeAgent takes one agent at a time: a delta is never blended ' +
        `across agents, and these records cover ${agentIds.size}`,
    )
  }
  const first = records[0]
  if (first === undefined) {
    throw new MismatchedInputError('no records to normalize')
  }

  // Checked over the whole agent as well as per pair, because the digest is
  // a property of the arm rather than of a case: a sweep whose every case
  // happened to be excluded would otherwise slip past the refusal.
  const digestsOf = (arm: Arm): Set<string> =>
    new Set(
      records.filter((r) => r.arm === arm).map((r) => r.variant.configDigest),
    )
  const baseDigests = [...digestsOf('base')].sort()
  const candidateDigests = [...digestsOf('candidate')].sort()
  if (
    baseDigests.length > 0 &&
    baseDigests.join() === candidateDigests.join()
  ) {
    throw new IdenticalConfigError(
      `both arms of ${first.agentId} hash to the same config ` +
        `(${baseDigests.join(', ')}), so the agent saw no difference and ` +
        'there is nothing to compare',
    )
  }

  const groups = new Map<string, { base?: RunRecord; candidate?: RunRecord }>()
  for (const record of records) {
    const key = keyOf(record)
    const group = groups.get(key) ?? {}
    if (group[record.arm] !== undefined) {
      throw new MismatchedInputError(
        `two ${record.arm} records for ${record.caseId} attempt ` +
          `${record.attempt}: attempts must be numbered, not repeated`,
      )
    }
    group[record.arm] = record
    groups.set(key, group)
  }

  const judgeable: NormalizedCase[] = []
  const excluded: ExcludedCase[] = []
  const unpaired: UnpairedRecord[] = []

  for (const { base, candidate } of groups.values()) {
    if (base === undefined || candidate === undefined) {
      const lone = base ?? candidate
      if (lone === undefined) continue
      unpaired.push({
        agentId: lone.agentId,
        caseId: lone.caseId,
        attempt: lone.attempt,
        arm: lone.arm,
      })
      continue
    }
    const exclusion = exclusionFor(base, candidate)
    if (exclusion !== null) {
      excluded.push({
        agentId: base.agentId,
        caseId: base.caseId,
        attempt: base.attempt,
        reason: exclusion.reason,
        arms: exclusion.arms,
        records: { base, candidate },
      })
      continue
    }
    judgeable.push(blindCase(base, candidate, rng, config))
  }

  return {
    agentId: first.agentId,
    shape: first.agentShape,
    judgeable,
    excluded,
    unpaired,
  }
}
