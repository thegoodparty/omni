import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  LlmService,
  type LlmStreamOptions,
  type LlmStreamResult,
  type LlmStreamTool,
  type LlmStreamUsage,
  type LlmTool,
  type ToolCall,
} from '@/llm/services/llm.service'
import type { DatabricksProvider } from '@/llm/tools/queryDatabricks.tool'
import type { JsonValue, TraceStep } from '../record'

// The three seams a chat run is observed at. Each one is the only place the
// thing it captures exists:
//
//   LlmService.streamChatCompletion — the rendered system prompt, the tool
//     names the model was actually offered, the model that answered, and the
//     turn's aggregate token usage.
//   each tool's execute            — whether a tool step failed. A failed step
//     is converted by the AI SDK into a tool-error result and the loop carries
//     on, so nothing downstream of here ever sees it.
//   DatabricksProvider.query       — the generated SQL, after the validator has
//     passed it and before the warehouse runs it. Also the only place a Delta
//     version can be pinned, because `VERSION AS OF` does not survive the
//     agent-facing SQL validator.
//
// Patched by assignment rather than vi.spyOn (which is what the integration
// tests around here use) so this module stays importable outside vitest: the
// orchestrator imports the runner's types, and pulling vitest into that graph
// would break it.

const SSE_DATA_PREFIX = 'data: '

type ExecutableTool = LlmStreamTool<z.ZodTypeAny>
type ToolInput = Parameters<ExecutableTool['execute']>[0]

const isExecutable = (tool: LlmTool): tool is ExecutableTool =>
  'execute' in tool

// One step of the canned model's turn. A script is a flat list because that is
// all the shape a stubbed turn has: the real interleaving of text and tool
// calls is the model's to choose, and a run driven from here must never be
// mistaken for evidence about it.
export type ScriptedStep =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; tool: string; input: JsonValue }

export interface ChatTurnScript {
  steps: ScriptedStep[]
  // The turn's aggregate usage, standing in for what streamText reports as
  // `totalUsage` across the whole tool loop.
  usage: { inputTokens: number; outputTokens: number }
  // Defaults to the first model in the scope's chain, which is what
  // withModelFallback returns when the first model answers.
  model?: string
}

export interface ToolOutcome {
  tool: string
  error?: string
}

export interface TurnCapture {
  // Undefined until the turn reaches the LLM seam, which is how a run that
  // died in loadContext or in the guard is told apart from one that ran.
  systemPrompt?: string
  toolNames: string[]
  model?: string
  tokens?: { input: number; output: number }
  // Deferred on purpose: the usage promise only resolves once the stream has
  // been drained, so reading it at the seam would deadlock the turn.
  readUsage?: () => Promise<LlmStreamUsage>
  outcomes: ToolOutcome[]
}

// These helpers reach into a Nest singleton and into a live provider, and
// tsconfig.build.json compiles this directory into the deployed image. The
// patch is process-global for as long as it is installed, so a real request
// in flight would be answered by the canned script and have its SQL
// rewritten. Refuse to install outside a test process.
export const assertTestProcess = (what: string): void => {
  if (process.env.VITEST === undefined && process.env.NODE_ENV !== 'test') {
    throw new Error(
      `${what} patches a live singleton and may only run in a test process`,
    )
  }
}

// A patched instance may not be patched again. Each install captures its own
// TurnCapture, so two overlapping runs would file one run's prompt digest
// against the other's record — and restoring out of order leaves the patch on
// the singleton for the life of the process. Failing loudly is the only safe
// answer.
const installedOn = new WeakSet<object>()

const claim = (target: object, what: string): void => {
  if (installedOn.has(target)) {
    throw new Error(
      `${what} is already installed on this instance: the judge drives one ` +
        'arm at a time, and two overlapping installs corrupt both records',
    )
  }
  installedOn.add(target)
}

const MAX_ERROR_CHARS = 200

// A tool's own error text is a vendor string we do not control: the Databricks
// statement client throws with the raw HTTP body, which echoes the failing
// statement, and the voter SQL builder inlines contact ids by design. The
// judge needs the failure class, never the vendor's prose, so the message is
// redacted and bounded before it can reach a stored record.
export const traceErrorText = (err: unknown): string => {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  return raw
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      '[id]',
    )
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
    .replace(/\d{7,}/g, '[digits]')
    .slice(0, MAX_ERROR_CHARS)
}

const systemPromptOf = (options: LlmStreamOptions): string => {
  const system = options.messages.find((m) => m.role === 'system')
  if (!system) return ''
  return typeof system.content === 'string'
    ? system.content
    : JSON.stringify(system.content)
}

// Wraps every executable tool so a failed step is recorded. The AI SDK turns a
// throw here into a tool-error result and keeps going, so the run still
// produces an answer — a worse-informed one. Counting it is what keeps a dead
// credential from reading as a code regression.
const instrumentTools = (
  tools: Record<string, LlmTool> | undefined,
  outcomes: ToolOutcome[],
): Record<string, LlmTool> | undefined => {
  if (!tools) return undefined
  const wrapped: Record<string, LlmTool> = {}
  for (const [name, tool] of Object.entries(tools)) {
    if (!isExecutable(tool)) {
      wrapped[name] = tool
      continue
    }
    wrapped[name] = {
      description: tool.description,
      inputSchema: tool.inputSchema,
      execute: async (input: ToolInput) => {
        try {
          const output = await tool.execute(input)
          outcomes.push({ tool: name })
          return output
        } catch (err) {
          outcomes.push({ tool: name, error: traceErrorText(err) })
          throw err
        }
      },
    }
  }
  return wrapped
}

// Drives the canned turn through the same hooks the real stream fires, so the
// persisted transcript and the SSE frames a scripted run produces are the ones
// a real run would produce for the same steps.
const runScript = async (
  script: ChatTurnScript,
  options: LlmStreamOptions,
): Promise<LlmStreamResult> => {
  // Read off the script rather than accumulated as the generator runs:
  // finalText has to be resolvable before the stream is drained, the way the
  // real result's already-settled promise is.
  const fullText = script.steps
    .flatMap((step) => (step.kind === 'text' ? [step.text] : []))
    .join('')
  const emit = async function* (): AsyncGenerator<string, void, void> {
    for (const [index, step] of script.steps.entries()) {
      if (step.kind === 'text') {
        yield step.text
        continue
      }
      const tool = options.tools?.[step.tool]
      if (!tool || !isExecutable(tool)) {
        throw new Error(
          `scripted step ${index} calls "${step.tool}", which this turn ` +
            'did not register as an executable tool',
        )
      }
      // The AI SDK validates model-produced input before calling execute, so
      // a script that skipped this could drive input the real model could
      // never produce — and the record would describe unreachable behavior.
      if (!tool.inputSchema.safeParse(step.input).success) {
        throw new Error(
          `scripted step ${index} calls "${step.tool}" with input its own ` +
            'schema rejects, which the real model could not have produced',
        )
      }
      const toolCallId = `judge-${index}`
      options.onToolInputStart?.({ toolName: step.tool })
      options.onToolCallStart?.({
        name: step.tool,
        input: step.input,
        toolCallId,
      })
      try {
        const output = await tool.execute(step.input)
        options.onToolCallEnd?.({ name: step.tool, input: step.input, output })
      } catch {
        // Swallowed on purpose, to match production: the AI SDK turns a
        // throwing tool into a tool-error result and runs the next step, so
        // the turn still answers — with less information. Letting it escape
        // here would report a tool failure as a dead run and lose the answer
        // the judge is meant to compare. The failure itself is already on
        // record, from the execute seam that rethrew it.
      }
    }
  }

  const usage = Promise.resolve({
    inputTokens: script.usage.inputTokens,
    outputTokens: script.usage.outputTokens,
    totalTokens: script.usage.inputTokens + script.usage.outputTokens,
  })

  const toolCalls: ToolCall[] = script.steps.flatMap((step, index) =>
    step.kind === 'tool'
      ? [
          {
            id: `judge-${index}`,
            type: 'function',
            function: {
              name: step.tool,
              arguments: JSON.stringify(step.input),
            },
          },
        ]
      : [],
  )

  return {
    textStream: emit(),
    finalText: Promise.resolve(fullText),
    toolCalls: Promise.resolve(toolCalls),
    usage,
    model: script.model ?? options.models?.[0] ?? '',
  }
}

export interface InstalledLlmCapture {
  capture: TurnCapture
  restore: () => void
}

// Installs the LLM seam. With a script the model is replaced entirely and
// nothing is spent; without one the real call runs and the same fields are
// captured from it, so a later real sweep needs no second code path.
export const installLlmCapture = (
  llm: LlmService,
  script?: ChatTurnScript,
): InstalledLlmCapture => {
  assertTestProcess('installLlmCapture')
  claim(llm, 'installLlmCapture')
  const capture: TurnCapture = { toolNames: [], outcomes: [] }
  // .bind() returns any — TypeScript cannot infer the bound method signature
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const original: LlmService['streamChatCompletion'] =
    llm.streamChatCompletion.bind(llm)
  // A class instance carries the method on its prototype, so deleting the
  // patch restores it; a hand-built stand-in carries it as an own property,
  // where deleting would remove the method altogether.
  const owned = Object.hasOwn(llm, 'streamChatCompletion')

  const patched = async (
    options: LlmStreamOptions,
  ): Promise<LlmStreamResult> => {
    capture.systemPrompt = systemPromptOf(options)
    capture.toolNames = Object.keys(options.tools ?? {}).sort()
    const instrumented: LlmStreamOptions = {
      ...options,
      ...(options.tools && {
        tools: instrumentTools(options.tools, capture.outcomes) ?? {},
      }),
    }
    const result = script
      ? await runScript(script, instrumented)
      : await original(instrumented)
    capture.model = result.model
    capture.readUsage = () => result.usage
    return result
  }

  Object.assign(llm, { streamChatCompletion: patched })
  return {
    capture,
    restore: () => {
      if (owned) Object.assign(llm, { streamChatCompletion: original })
      else Reflect.deleteProperty(llm, 'streamChatCompletion')
      installedOn.delete(llm)
    },
  }
}

// Reads the turn's aggregate usage. Deliberately one read of one promise:
// llm.service stops the loop with `stepCountIs(maxSteps + 1)`, so a single
// streamText call spans every step and `totalUsage` — which is what
// LlmStreamResult.usage carries — already covers the whole turn. Summing per
// step here would double-count it.
export const readTurnTokens = async (capture: TurnCapture): Promise<void> => {
  if (!capture.readUsage) return
  const usage = await capture.readUsage()
  capture.tokens = { input: usage.inputTokens, output: usage.outputTokens }
}

export class UnpinnableSqlError extends Error {}

// Pins a generated query to one Delta table version. Both arms read the same
// version or a verdict can be an artifact of the voter data moving between the
// two runs, which is the one input a comparison cannot hold still by rerunning.
//
// Applied at the provider seam rather than to the agent's own SQL because the
// agent-facing validator parses the statement and `VERSION AS OF` is not
// something it accepts. Throws rather than passing the query through
// unpinned — an unpinned arm is exactly the silent failure the field exists to
// prevent.
// A Delta version is a whole number. Checked because this string is spliced
// into a statement that has already cleared the agent-facing validator, whose
// aggregate-only, allowlisted-column guarantees are the whole reason the tool
// is safe — anything else here would be SQL nobody validated.
export const assertDeltaVersion = (version: string): void => {
  if (!/^\d+$/.test(version)) {
    throw new UnpinnableSqlError(
      `"${version}" is not a Delta table version; only a whole number can ` +
        'be spliced into an already-validated query',
    )
  }
}

export const pinDeltaVersion = (sql: string, version: string): string => {
  assertDeltaVersion(version)
  if (/\bVERSION\s+AS\s+OF\b/i.test(sql)) return sql
  const from = /(\bFROM\s+)([`\w.]+)/i.exec(sql)
  if (!from) {
    throw new UnpinnableSqlError(
      `cannot pin a Delta version: no FROM clause found in "${sql}"`,
    )
  }
  const end = from.index + from[0].length
  return `${sql.slice(0, end)} VERSION AS OF ${version}${sql.slice(end)}`
}

export interface InstrumentedProvider {
  // The SQL the agent generated, verbatim and unpinned, in call order.
  queries: string[]
  restore: () => void
}

// Captures and optionally pins every query the constituent-data tool runs.
//
// The provider is null whenever no Databricks credential is configured, which
// is every local and CI run: the tool then never registers and there is no
// seam to instrument. That is why `pinDeltaVersion` is tested directly rather
// than through a live query.
export const instrumentDatabricksProvider = (
  provider: DatabricksProvider,
  pinnedVersion?: string,
): InstrumentedProvider => {
  assertTestProcess('instrumentDatabricksProvider')
  claim(provider, 'instrumentDatabricksProvider')
  // Checked here as well as at splice time, so a bad version fails the run
  // before the turn starts rather than at the first query the agent writes.
  if (pinnedVersion !== undefined) assertDeltaVersion(pinnedVersion)
  const queries: string[] = []
  // .bind() returns any — TypeScript cannot infer the bound method signature
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const original: DatabricksProvider['query'] = provider.query.bind(provider)
  const owned = Object.hasOwn(provider, 'query')
  Object.assign(provider, {
    query: (sql: string) => {
      queries.push(sql)
      return original(pinnedVersion ? pinDeltaVersion(sql, pinnedVersion) : sql)
    },
  })
  return {
    queries,
    restore: () => {
      if (owned) Object.assign(provider, { query: original })
      else Reflect.deleteProperty(provider, 'query')
      installedOn.delete(provider)
    },
  }
}

// What the agent actually read, hashed: the rendered system prompt plus the
// tool names it was offered. The orchestrator compares this across arms and
// refuses a comparison where they match, since a branch that changed nothing
// the agent can see would spend real money proving two identical things
// identical. Tool names are sorted so registration order cannot forge a
// difference, and joined on NUL, which no prompt or tool name contains, so no
// rearrangement of the two parts can collide.
export const configDigest = (
  systemPrompt: string,
  toolNames: string[],
): string => {
  const hash = createHash('sha256')
  hash.update(systemPrompt)
  hash.update('\0')
  hash.update([...toolNames].sort().join('\0'))
  return `sha256:${hash.digest('hex')}`
}

// The SSE frames the chat route writes. Declared as the subset this runner
// reads rather than reusing ChatStreamChunk: these arrive off the wire, so
// they are parsed, and a frame carrying a field this build does not know about
// must not fail a run.
const StreamEventSchema = z.object({
  type: z.string().min(1),
  delta: z.string().optional(),
  toolName: z.string().optional(),
  code: z.string().optional(),
  message: z.string().optional(),
  // Carried on the `done` frame. The only way to name the row THIS turn
  // wrote: a scope that seeds an opener (campaign_assistant) has an earlier
  // assistant row in the same conversation, and folding it into the output
  // would have the judge compare two arms on scripted boilerplate.
  assistantMessageId: z.string().optional(),
})
export type StreamEvent = z.infer<typeof StreamEventSchema>

// A stream cut off mid-frame leaves a partial JSON tail. Skipping it costs
// one trace step; throwing would turn the whole turn into an infraError and
// discard an answer that was already persisted. The cut itself still shows up,
// as a missing or sentinel assistant turn.
const parseFrame = (json: string): StreamEvent | null => {
  try {
    const parsed = StreamEventSchema.safeParse(JSON.parse(json))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export const parseStreamEvents = (body: string): StreamEvent[] => {
  const events: StreamEvent[] = []
  for (const frame of body.split('\n\n')) {
    const line = frame.trim()
    if (!line.startsWith(SSE_DATA_PREFIX)) continue
    const parsed = parseFrame(line.slice(SSE_DATA_PREFIX.length))
    if (parsed) events.push(parsed)
  }
  return events
}

// The ordered shape of the turn, from the frames the route actually wrote
// plus the per-tool outcomes only the execute seam saw. Judged by nobody in
// v1 — carrying it from the start is what makes turning trace dimensions on
// later a normalizer change rather than a re-run of every sweep.
// Outcomes are paired to frames per tool name, in order. The frame is written
// from onToolCallStart and the outcome pushed after execute resolves, so the
// two orders agree for the sequential calls a turn actually makes. Two
// concurrent calls to the SAME tool in one step could attach a failure to the
// wrong one of them; toolErrors stays right either way. Pairing on the call id
// would fix it, and needs LlmTool.execute to receive one — a change to
// llm.service.ts.
export const buildTrace = (
  events: StreamEvent[],
  outcomes: ToolOutcome[],
): TraceStep[] => {
  const pending = new Map<string, ToolOutcome[]>()
  for (const outcome of outcomes) {
    const queue = pending.get(outcome.tool) ?? []
    queue.push(outcome)
    pending.set(outcome.tool, queue)
  }

  const steps: TraceStep[] = []
  let openText = false
  for (const event of events) {
    if (event.type === 'text') {
      if (!openText) {
        steps.push({ index: steps.length, kind: 'text' })
        openText = true
      }
      continue
    }
    // Only a structural event closes the run of text. A keep-alive ping
    // carries no content, and letting one split a text run would invent a
    // step boundary out of how long the model happened to think.
    if (event.type === 'tool_call' && event.toolName !== undefined) {
      openText = false
      const outcome = pending.get(event.toolName)?.shift()
      steps.push({
        index: steps.length,
        kind: 'tool',
        tool: event.toolName,
        ...(outcome?.error !== undefined && { error: outcome.error }),
      })
      continue
    }
    if (event.type === 'error') {
      openText = false
      steps.push({
        index: steps.length,
        kind: 'error',
        error: event.message ?? event.code ?? 'unknown stream error',
      })
    }
  }

  // A provider-run tool (native web search) has no execute hook, so it leaves
  // no outcome; an outcome with no frame is the opposite and would mean a tool
  // ran without the route announcing it. Append those rather than drop them —
  // a tool error that never reached the trace is the failure isComparable
  // exists to catch.
  for (const queue of pending.values()) {
    for (const outcome of queue) {
      steps.push({
        index: steps.length,
        kind: 'tool',
        tool: outcome.tool,
        ...(outcome.error !== undefined && { error: outcome.error }),
      })
    }
  }
  return steps
}
