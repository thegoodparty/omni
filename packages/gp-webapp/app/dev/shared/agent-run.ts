// Job-agnostic parser for a CAP agent run's session.jsonl + milestones.jsonl.
// Every CAP job emits these two logs, so nothing here is meeting_briefing-
// specific: it turns the raw JSONL text into a typed, render-ready structure of
// turns, milestones, and cost/token rollups. Per-turn cost mirrors the
// analyze-cap-agent-costs methodology (per-token USD rates by model family;
// cache_read dominates).

export type ToolCall = {
  name: string
  summary: string
}

export type TurnTokens = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export type Turn = {
  index: number
  ts: string
  deltaMs: number
  model: string
  toolCalls: ToolCall[]
  tokens: TurnTokens
  costUsd: number
  milestone: string
  isMilestoneStart: boolean
}

export type Milestone = {
  name: string
  ts: string
}

export type PerMilestone = {
  name: string
  costUsd: number
  turns: number
}

export type AgentRun = {
  turns: Turn[]
  milestones: Milestone[]
  totals: {
    costUsd: number
    turns: number
    tokens: TurnTokens
  }
  perMilestone: PerMilestone[]
}

type ModelRates = {
  input: number
  output: number
  cacheRead: number
  eph5m: number
  eph1h: number
}

const RATES: Record<'opus' | 'sonnet' | 'haiku', ModelRates> = {
  opus: {
    input: 5e-6,
    output: 25e-6,
    cacheRead: 0.5e-6,
    eph5m: 6.25e-6,
    eph1h: 10e-6,
  },
  sonnet: {
    input: 3e-6,
    output: 15e-6,
    cacheRead: 0.3e-6,
    eph5m: 3.75e-6,
    eph1h: 6e-6,
  },
  haiku: {
    input: 1e-6,
    output: 5e-6,
    cacheRead: 0.1e-6,
    eph5m: 1.25e-6,
    eph1h: 2e-6,
  },
}

// Unknown families fall back to sonnet rates — the common case for CAP jobs and
// the safest middle estimate. The real model string is preserved on the turn so
// a viewer can see when the fallback applied.
const ratesForModel = (model: string): ModelRates => {
  const m = model.toLowerCase()
  if (m.includes('opus')) return RATES.opus
  if (m.includes('haiku')) return RATES.haiku
  return RATES.sonnet
}

const PREAMBLE = 'preamble'

const toEpoch = (ts: string | number): number =>
  typeof ts === 'number' ? ts : Date.parse(ts)

// Keys tried in order to build a one-line summary of a tool call's input. Covers
// the common tools across CAP jobs (Bash, WebFetch/WebSearch, file edits, Agent)
// without hard-coding any single job's toolset.
const SUMMARY_KEYS = [
  'command',
  'query',
  'url',
  'prompt',
  'pattern',
  'file_path',
  'path',
  'description',
]

const summarizeInput = (input: unknown): string => {
  if (input === null || input === undefined) return ''
  if (typeof input !== 'object') return collapse(String(input))
  const record = input as Record<string, unknown>
  for (const key of SUMMARY_KEYS) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return collapse(value)
  }
  const firstString = Object.values(record).find(
    (v) => typeof v === 'string' && v.trim(),
  )
  if (typeof firstString === 'string') return collapse(firstString)
  return collapse(JSON.stringify(record))
}

const collapse = (text: string): string => {
  const single = text.replace(/\s+/g, ' ').trim()
  return single.length > 160 ? `${single.slice(0, 157)}…` : single
}

type RawUsage = {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  cache_creation?: {
    ephemeral_5m_input_tokens?: number
    ephemeral_1h_input_tokens?: number
  }
}

type RawContentBlock = {
  type?: string
  name?: string
  input?: unknown
}

type RawLine = {
  type?: string
  timestamp?: string
  message?: {
    model?: string
    usage?: RawUsage
    content?: RawContentBlock[]
  }
}

const parseJsonl = <T>(text: string): T[] => {
  const lines: T[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      lines.push(JSON.parse(trimmed) as T)
    } catch {
      // Skip malformed lines rather than failing the whole parse.
    }
  }
  return lines
}

const parseMilestones = (text: string): Milestone[] => {
  const raw = parseJsonl<{ ts?: string | number; name?: string }>(text)
  return raw
    .filter(
      (m): m is { ts: string | number; name: string } =>
        Boolean(m.name) &&
        (typeof m.ts === 'string' || typeof m.ts === 'number'),
    )
    .map((m) => ({ name: m.name, ts: String(m.ts) }))
    .sort((a, b) => toEpoch(a.ts) - toEpoch(b.ts))
}

// The active milestone for a turn is the most recent milestone whose ts <= the
// turn's ts. Turns before the first milestone are the "preamble".
const milestoneForTs = (milestones: Milestone[], tsEpoch: number): string => {
  let active = PREAMBLE
  for (const milestone of milestones) {
    if (toEpoch(milestone.ts) <= tsEpoch) active = milestone.name
    else break
  }
  return active
}

export const parseAgentRun = (
  sessionText: string,
  milestonesText = '',
): AgentRun => {
  const milestones = parseMilestones(milestonesText)
  const lines = parseJsonl<RawLine>(sessionText)

  const turns: Turn[] = []
  let prevEpoch: number | null = null
  let prevMilestone: string | null = null

  for (const line of lines) {
    if (line.type !== 'assistant' || !line.message) continue

    const ts = line.timestamp ?? ''
    const tsEpoch = ts ? toEpoch(ts) : NaN
    const model = line.message.model ?? 'unknown'
    const usage = line.message.usage ?? {}

    const input = usage.input_tokens ?? 0
    const output = usage.output_tokens ?? 0
    const cacheRead = usage.cache_read_input_tokens ?? 0
    const eph5m = usage.cache_creation?.ephemeral_5m_input_tokens ?? 0
    const eph1h = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0
    const cacheWrite = eph5m + eph1h || usage.cache_creation_input_tokens || 0

    const rates = ratesForModel(model)
    const costUsd =
      input * rates.input +
      output * rates.output +
      cacheRead * rates.cacheRead +
      eph5m * rates.eph5m +
      eph1h * rates.eph1h

    const toolCalls: ToolCall[] = (line.message.content ?? [])
      .filter((block) => block.type === 'tool_use')
      .map((block) => ({
        name: block.name ?? 'unknown',
        summary: summarizeInput(block.input),
      }))

    const milestone: string = Number.isNaN(tsEpoch)
      ? (prevMilestone ?? PREAMBLE)
      : milestoneForTs(milestones, tsEpoch)
    const deltaMs =
      prevEpoch === null || Number.isNaN(tsEpoch) ? 0 : tsEpoch - prevEpoch

    turns.push({
      index: turns.length + 1,
      ts,
      deltaMs,
      model,
      toolCalls,
      tokens: { input, output, cacheRead, cacheWrite },
      costUsd,
      milestone,
      isMilestoneStart: milestone !== prevMilestone,
    })

    prevEpoch = Number.isNaN(tsEpoch) ? prevEpoch : tsEpoch
    prevMilestone = milestone
  }

  const totals = turns.reduce(
    (acc, turn) => {
      acc.costUsd += turn.costUsd
      acc.tokens.input += turn.tokens.input
      acc.tokens.output += turn.tokens.output
      acc.tokens.cacheRead += turn.tokens.cacheRead
      acc.tokens.cacheWrite += turn.tokens.cacheWrite
      return acc
    },
    {
      costUsd: 0,
      turns: turns.length,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
  )

  const perMilestoneMap = new Map<string, PerMilestone>()
  const order: string[] = []
  for (const turn of turns) {
    let entry = perMilestoneMap.get(turn.milestone)
    if (!entry) {
      entry = { name: turn.milestone, costUsd: 0, turns: 0 }
      perMilestoneMap.set(turn.milestone, entry)
      order.push(turn.milestone)
    }
    entry.costUsd += turn.costUsd
    entry.turns += 1
  }
  const perMilestone = order.map((name) => {
    const entry = perMilestoneMap.get(name)
    return entry ?? { name, costUsd: 0, turns: 0 }
  })

  return { turns, milestones, totals, perMilestone }
}
