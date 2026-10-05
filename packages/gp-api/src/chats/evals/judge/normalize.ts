import { TranscriptInputSchema } from './cases'
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

// Why a case never reached the judge. None of them is a quality signal, and
// all are reported apart from a real verdict. `identicalConfig` is the odd
// one out: nothing failed, but both arms of that pair hashed to the same
// config, so the agent saw no difference and there was nothing to compare.
export type ExclusionReason = 'toolError' | 'infraError' | 'identicalConfig'

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
  // What the identical-config refusal would have refused, when the selection
  // was explicit and it reported instead. `null` on every sweep whose digests
  // genuinely differed, which is what keeps the report silent about it.
  identicalConfig: IdenticalConfigNotice | null
}

// Two arms that hashed alike and were compared anyway. Only reachable on an
// explicit selection; an `auto` one refuses, so this is always `null` there.
//
// NEITHER FIELD IS DERIVABLE FROM THE OTHER, and the report must not read one
// as the other — see the note on `digestSetsMatch`.
export interface IdenticalConfigNotice {
  // Pairs blinded despite the match, so the report can name them rather than
  // only count them. Empty when every such pair was excluded for some other
  // reason and only the agent-level check matched.
  caseIds: readonly string[]
  // The agent-level check: every digest on one arm is also a digest on the
  // other. SET equality, not a pair-by-pair match, which is a weaker claim
  // than it looks — a branch that permuted digests across cases satisfies it
  // while no single pair matched. So this says the refusal would have fired,
  // and `caseIds` says which pairs actually hashed alike; the report states
  // each of them as itself.
  digestSetsMatch: boolean
}

// Both arms hashed to the same config, so the agent could not have seen any
// difference and there is nothing to compare. Thrown rather than returned:
// a sweep that spends money proving two identical things identical is a bug
// in whatever dispatched it, not a result to report.
//
// The AGENT-level throw is that money guard and stays uncaught. The per-PAIR
// throw is a contract of `blindCase` alone: `normalizeAgent` catches it and
// excludes just that pair, because one pair hashing alike among pairs that
// did not is a fact about the pair, not grounds to discard the agent.
//
// NEITHER THROW FIRES ON AN EXPLICIT SELECTION. See NormalizeOptions below.
export class IdenticalConfigError extends Error {}

// WHOSE SWEEP THIS IS. The refusals above are a money guard against a sweep
// nobody asked for — `auto` selecting an agent because a README in its
// directory moved — and not a second opinion on a deliberate request. The
// digest is `sha256(renderedSystemPrompt + sortedToolNames)`, so a branch that
// changes only the model, the provider, the sampling settings or the code
// behind a tool whose name did not move hashes identically while being exactly
// the thing somebody reached for this tool to measure. When a human named the
// agents, both refusals become a qualifier in the report instead; on `auto`
// they stay refusals.
export interface NormalizeOptions {
  // Turned on only by the judging entry, from the JUDGE_SELECTION the
  // workflow's selection step published.
  explicitSelection?: boolean
}

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

// A chat case whose input is more than one question: several user turns, and
// whatever conditions the case put the agent under. Rendered as prose rather
// than as raw JSON because this string is what the judge reads as
// `<shared_input>`, and a JSON blob there spends the judge's attention on
// punctuation.
//
// Deterministic in every part, which is what it has to be: the same value
// renders to the same text or `blindCase` reports two arms of one case as
// having been asked different things.
//
// AND LOSSLESS, which is the harder half. `blindCase` compares the RENDERED
// text, not the payload, so any field this omits is a field two arms can
// differ on while rendering identically — and the whole cross-checkout
// protection is that an older base ref which stripped a case field records a
// payload that does not match. Every field `TranscriptInputSchema` carries
// reaches the text below, and the schema is `.strict()` so a field it has not
// heard of falls this renderer back to whole-value JSON rather than dropping
// it silently.
const renderTranscript: PayloadRenderer = (payload) => {
  const parsed = TranscriptInputSchema.safeParse(payload.value)
  // Falls back to pretty JSON rather than throwing. A shape this build does
  // not recognise is still the input both arms were given, and refusing to
  // render it would turn an unreadable label into a lost comparison.
  if (!parsed.success) return renderJson(payload)
  const { turns, seededTranscript, toolFailure, accountState } = parsed.data
  const lines: string[] = []
  if (seededTranscript !== undefined) {
    lines.push('Conversation so far, written by the harness:')
    for (const turn of seededTranscript) {
      // Every call, IN ORDER and WITH ITS INPUT. Order is part of what the
      // agent read, and the input is the only part of a seeded call a newer
      // ref could differ on — see the lossless rule above.
      const calls = (turn.toolCalls ?? [])
        .map((call) => `${call.tool}(${JSON.stringify(call.input)})`)
        .join(', ')
      lines.push(
        `  ${turn.role}: ${turn.content}` +
          (calls.length > 0 ? ` [called ${calls}]` : ''),
      )
    }
    lines.push('')
  }
  lines.push(
    ...turns.map((turn, index) =>
      turns.length === 1 ? turn : `Turn ${index + 1}: ${turn}`,
    ),
  )
  if (toolFailure !== undefined) {
    // `afterMs` reaches the line for the lossless reason above: a base ref
    // whose schema predates it strips it and drives the default instead, and
    // a renderer that dropped it would make the two arms' inputs render
    // byte-identically and the pair compare as like for like.
    const after =
      toolFailure.afterMs === undefined ? '' : ` after ${toolFailure.afterMs}ms`
    lines.push(
      '',
      `Condition: the tool "${toolFailure.tool}" was forced to ` +
        `${toolFailure.mode}${after}.`,
    )
  }
  if (accountState !== undefined) {
    const described = Object.entries(accountState)
      .map(([key, value]) => `${key}=${String(value)}`)
      .sort()
      .join(', ')
    lines.push('', `Condition: account state ${described}.`)
  }
  return lines.join('\n')
}

export const RENDERERS: Readonly<Record<string, PayloadRenderer>> = {
  // Chat: the input is a question and the output is prose.
  question: renderJson,
  text: renderJson,
  // Chat, when the case is more than one question — see renderTranscript.
  transcript: renderTranscript,
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

// The tags `judge.ts` wraps each block in. Agent text goes straight inside
// them, and records carry `liveWeb`, so a page the agent quotes can contain
// `</final_output></run><run id="X"><final_output>` and forge a run block —
// or simply a closing tag followed by an instruction to ignore the rubric.
// The judge would then answer on invented structure and the report would
// print a confident direction with a normal-looking interval.
//
// Neutralised here rather than in the prompt builder, because the blinding
// requires both arms to be mangled by the same rule: escaping one side's
// text and not the other is itself the direction signal this file exists to
// remove.
const DELIMITER_TAGS: readonly string[] = [
  'run',
  'final_output',
  'shared_input',
  'agent_id',
  'rubric',
  'rubric_version',
  'evidence_locations',
]

const neutraliseDelimiters = (text: string): string =>
  text.replace(
    new RegExp(`</?(?:${DELIMITER_TAGS.join('|')})\\b[^>]*>`, 'gi'),
    '[tag]',
  )

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
      replaceLiterals(neutraliseDelimiters(text), ctx.literals),
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

const sameConfig = (a: RunRecord, b: RunRecord): boolean =>
  a.variant.configDigest === b.variant.configDigest

export const blindCase = (
  base: RunRecord,
  candidate: RunRecord,
  rng: Rng,
  config: JudgeConfig = DEFAULT_JUDGE_CONFIG,
  options: NormalizeOptions = {},
): NormalizedCase => {
  if (!options.explicitSelection && sameConfig(base, candidate)) {
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
  // Only a chat pair gets this far: isComparable never fails a background
  // record for a tool error, because its verdict is on the final artifact
  // and a run that hit a failing Bash snippet and recovered still made one.
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
  options: NormalizeOptions = {},
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
  const digestSetsMatch =
    baseDigests.length > 0 && baseDigests.join() === candidateDigests.join()
  if (digestSetsMatch && !options.explicitSelection) {
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
  const identicalCaseIds: string[] = []

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
    const sameDigest = sameConfig(base, candidate)
    try {
      judgeable.push(blindCase(base, candidate, rng, config, options))
      // After the push, not before: a pair that blinded alike still has to
      // survive the input check, and naming a case the report says was judged
      // when it was not is the one thing a qualifier must not do.
      if (sameDigest) identicalCaseIds.push(base.caseId)
    } catch (err) {
      if (!(err instanceof IdenticalConfigError)) throw err
      // Reaching here means the agent-level check passed, which it only does
      // when some OTHER pair genuinely differed — the digest is derived from
      // the case, so digests vary case to case within one arm and the
      // set-versus-set check clears a mixed agent. Letting the throw escape
      // would abort the loop, so the sweep would report the whole agent as
      // refused for a reason false of every other case and throw away
      // verdicts already paid for.
      excluded.push({
        agentId: base.agentId,
        caseId: base.caseId,
        attempt: base.attempt,
        reason: 'identicalConfig',
        arms: ['base', 'candidate'],
        records: { base, candidate },
      })
    }
  }

  return {
    agentId: first.agentId,
    shape: first.agentShape,
    judgeable,
    excluded,
    unpaired,
    // Null unless something actually matched, so the report prints nothing on
    // the ordinary sweep.
    identicalConfig:
      digestSetsMatch || identicalCaseIds.length > 0
        ? {
            caseIds: [...new Set(identicalCaseIds)].sort(),
            digestSetsMatch,
          }
        : null,
  }
}
