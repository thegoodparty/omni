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
import { DatabricksSqlProvider } from '@/llm/tools/databricksProvider'
import type { DatabricksRowSet } from '@/llm/tools/queryDatabricks.tool'
import { toolFailureDelayMs, type ToolFailure } from '../cases'
import { SPEND_ENV, SPEND_VALUE, spendsRealMoney } from '../config'
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
  // Overwritten per turn, so on a multi-turn case this is the LAST turn's
  // prompt. That is the right one to hash: the scope handler rebuilds the
  // prompt each turn from the same context, and the growing conversation
  // travels in `messages` rather than in the prompt.
  systemPrompt?: string
  toolNames: string[]
  model?: string
  // ACCUMULATED across every turn of the case, not the last turn's alone.
  tokens?: { input: number; output: number }
  // How many turns have had their usage folded into `tokens`. A caller that
  // drove more turns than this prices nothing: a partial count under a real
  // pricingVersion reads as a cheaper run rather than an unknown one.
  turnsPriced: number
  // Deferred on purpose: the usage promise only resolves once the stream has
  // been drained, so reading it at the seam would deadlock the turn.
  readUsage?: () => Promise<LlmStreamUsage>
  outcomes: ToolOutcome[]
  // A directive the turn could not honour — today, a forced-failure tool the
  // turn never registered. Recorded rather than thrown BECAUSE the route
  // swallows a throw out of streamChatCompletion into an error chunk: the
  // run would come back as an ordinary infraError and the authoring mistake
  // would be invisible. The runner reads this after the turn and fails the
  // case by name. Nothing is spent either way — the refusal happens before
  // the model is called.
  directiveError?: string
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

// Records the target only once `install` has actually patched it. An install
// that throws leaves nothing patched, and recording it anyway would poison the
// instance for the life of the process: every later install on it would fail
// naming a concurrency bug that never happened, and the only thing that clears
// the entry is a `restore` that was never handed out.
const claim = <T>(target: object, what: string, install: () => T): T => {
  if (installedOn.has(target)) {
    throw new Error(
      `${what} is already installed on this instance: the judge drives one ` +
        'arm at a time, and two overlapping installs corrupt both records',
    )
  }
  const installed = install()
  installedOn.add(target)
  return installed
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

// The error a forced failure raises, named so a reader of a trace can tell an
// injected failure from a real one. The judge sees only the final output, so
// this text reaches a person rather than a model.
export const forcedFailureText = (failure: ToolFailure): string =>
  failure.mode === 'timeout'
    ? `forced timeout: the judge case asked "${failure.tool}" to time out`
    : `forced failure: the judge case asked "${failure.tool}" to fail`

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

// Named so a forced timeout is the same failure CLASS a real one is, rather
// than a generic Error a reader has to interpret.
class ForcedToolFailureError extends Error {
  constructor(failure: ToolFailure) {
    super(forcedFailureText(failure))
    this.name = failure.mode === 'timeout' ? 'TimeoutError' : 'ToolFailedError'
  }
}

// A forced failure that names no registered tool. The turn is refused rather
// than run: a directive nobody could honour reads, in the record, exactly
// like a case the agent simply never needed the tool for — so the verdict
// would be about an agent that was never put under the condition the case
// claims.
export const unknownToolText = (
  failure: ToolFailure,
  registered: readonly string[],
): string =>
  `the case asks "${failure.tool}" to ${failure.mode}, but this turn ` +
  `registered no such tool; it offered ${
    registered.length === 0 ? 'none' : [...registered].sort().join(', ')
  }`

// The reason a forced-failure directive cannot be honoured, or nothing.
// Checked against the tool names the turn ACTUALLY offered, which is the
// earliest point the set exists — the scope handler assembles it from its
// context, so no static list here could be right for every seed. It is still
// before the model is called, so a refused directive costs nothing.
//
// Separate from `instrumentTools` and called unconditionally, because a turn
// that registered no tools at all never reaches the wrapper — and that is
// exactly a turn where every named tool is unknown.
export const toolFailureRefusal = (
  failure: ToolFailure | undefined,
  registered: readonly string[],
): string | undefined =>
  failure === undefined || registered.includes(failure.tool)
    ? undefined
    : unknownToolText(failure, registered)

export interface ToolInstrumentation {
  outcomes: ToolOutcome[]
  failure?: ToolFailure
}

// Wraps every executable tool so a failed step is recorded. The AI SDK turns a
// throw here into a tool-error result and keeps going, so the run still
// produces an answer — a worse-informed one. Counting it is what keeps a dead
// credential from reading as a code regression.
//
// The same seam is where a case's forced failure is honoured, which is the
// reason the capability needed no new code path: a directive replaces the
// call to the real `execute` and pushes the same outcome a genuine failure
// pushes. The real tool is NOT called — an ordinance `present_*` tool commits
// its own record, and a case that says the tool failed must not leave that
// write behind.
export const instrumentTools = (
  tools: Record<string, LlmTool> | undefined,
  instrumentation: ToolInstrumentation,
): Record<string, LlmTool> | undefined => {
  const { outcomes, failure } = instrumentation
  if (!tools) return undefined
  const wrapped: Record<string, LlmTool> = {}
  for (const [name, tool] of Object.entries(tools)) {
    if (!isExecutable(tool)) {
      wrapped[name] = tool
      continue
    }
    const forced = failure?.tool === name ? failure : undefined
    wrapped[name] = {
      description: tool.description,
      inputSchema: tool.inputSchema,
      execute: async (input: ToolInput) => {
        if (forced) {
          await sleep(toolFailureDelayMs(forced))
          const err = new ForcedToolFailureError(forced)
          outcomes.push({ tool: name, error: traceErrorText(err) })
          throw err
        }
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

export interface LlmCaptureOptions {
  // The canned model. With it nothing is spent and the turn is deterministic.
  script?: ChatTurnScript
  // Ask for the real, paid Anthropic call instead. Needs the spend switch.
  realModel?: boolean
  // One tool the case asked to fail, honoured at the execute seam. Applies to
  // EVERY call of that tool for as long as the capture is installed, which on
  // a multi-turn case is every turn: a condition that healed itself halfway
  // through a conversation is not a condition anybody authored.
  toolFailure?: ToolFailure
}

// No script means the real model answers, which bills Anthropic for every
// turn of a sweep. A forgotten `script` field type-checks cleanly, so the paid
// path is opt-in twice over: the caller has to name it, and the process has to
// carry the explicit env flag every other paid path in this repo is gated on.
const assertMaySpend = (options: LlmCaptureOptions): void => {
  if (options.script) return
  if (options.realModel !== true) {
    throw new Error(
      'installLlmCapture was given no script: pass one, or set realModel ' +
        'to ask for the real, paid model on purpose',
    )
  }
  if (!spendsRealMoney(process.env)) {
    throw new Error(
      `installLlmCapture was asked for the real model, but ${SPEND_ENV} is ` +
        `not "${SPEND_VALUE}": a real turn spends money and has to be ` +
        'enabled explicitly',
    )
  }
}

// Installs the LLM seam. With a script the model is replaced entirely and
// nothing is spent; without one the real call runs and the same fields are
// captured from it, so a later real sweep needs no second code path.
export const installLlmCapture = (
  llm: LlmService,
  options: LlmCaptureOptions = {},
): InstalledLlmCapture => {
  assertTestProcess('installLlmCapture')
  // Both checks run before anything is claimed or patched, so a refusal
  // leaves the singleton exactly as it was.
  assertMaySpend(options)
  const { script } = options
  return claim(llm, 'installLlmCapture', () => {
    const capture: TurnCapture = {
      toolNames: [],
      turnsPriced: 0,
      outcomes: [],
    }
    // .bind() returns any — TypeScript cannot infer the bound method signature
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const original: LlmService['streamChatCompletion'] =
      llm.streamChatCompletion.bind(llm)
    // A class instance carries the method on its prototype, so deleting the
    // patch restores it; a hand-built stand-in carries it as an own property,
    // where deleting would remove the method altogether.
    const owned = Object.hasOwn(llm, 'streamChatCompletion')

    const patched = async (
      streamOptions: LlmStreamOptions,
    ): Promise<LlmStreamResult> => {
      capture.systemPrompt = systemPromptOf(streamOptions)
      capture.toolNames = Object.keys(streamOptions.tools ?? {}).sort()
      // First reason kept: on a multi-turn case every turn reports the same
      // unhonourable directive, and the later copies say nothing the first
      // did not.
      const refusal = toolFailureRefusal(options.toolFailure, capture.toolNames)
      capture.directiveError ??= refusal
      // RECORDED AND THEN THROWN, both, and neither is redundant. The throw
      // is what keeps the model from being called, which is the difference
      // between a refused directive costing nothing and costing a paid turn.
      // The record is what lets the runner name the authoring mistake: the
      // chat route catches a throw out of here and writes an error chunk, so
      // on the throw alone the run would come back as an ordinary infraError
      // and the directive nobody could honour would be invisible.
      if (refusal !== undefined) throw new Error(refusal)
      const instrumentation: ToolInstrumentation = {
        outcomes: capture.outcomes,
        ...(options.toolFailure && { failure: options.toolFailure }),
      }
      const instrumented: LlmStreamOptions = {
        ...streamOptions,
        ...(streamOptions.tools && {
          tools: instrumentTools(streamOptions.tools, instrumentation) ?? {},
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
  })
}

// Reads the turn's aggregate usage. Deliberately one read of one promise:
// llm.service stops the loop with `stepCountIs(maxSteps + 1)`, so a single
// streamText call spans every step and `totalUsage` — which is what
// LlmStreamResult.usage carries — already covers the whole turn. Summing per
// step here would double-count it.
// ACCUMULATES. One call folds one turn's usage into the running total and
// counts it, so a multi-turn case reports what the whole conversation cost
// rather than what its last turn cost. A single-turn case is unchanged: one
// read of one promise, and `tokens` is that turn's.
//
// llm.service stops the loop with `stepCountIs(maxSteps + 1)`, so one
// streamText call spans every step of ONE turn and `totalUsage` already
// covers it. Summing per step would double-count; summing per turn is the
// level at which there really are several numbers.
export const readTurnTokens = async (capture: TurnCapture): Promise<void> => {
  const read = capture.readUsage
  if (!read) return
  // Cleared before the await so a second call cannot fold the same turn in
  // twice, and so a rejected promise leaves `turnsPriced` behind the turn
  // count — which is what makes the run unpriceable rather than cheap.
  capture.readUsage = undefined
  const usage = await read()
  capture.tokens = {
    input: (capture.tokens?.input ?? 0) + usage.inputTokens,
    output: (capture.tokens?.output ?? 0) + usage.outputTokens,
  }
  capture.turnsPriced += 1
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

export interface DeltaPin {
  // The Delta table version BOTH arms must read.
  version: string
  // The scope's allowed table names, which are what makes a match a table
  // reference rather than a keyword. Required: with none, nothing can be
  // pinned and every query the agent writes would be refused.
  tables: readonly string[]
}

// Both halves of a pin, checked together so a bad one fails the run before the
// turn starts rather than at the first query the agent writes.
export const assertDeltaPin = (pin: DeltaPin): void => {
  assertDeltaVersion(pin.version)
  if (pin.tables.length === 0) {
    throw new UnpinnableSqlError(
      'a Delta pin needs the allowed table names from the scope: with none ' +
        'of them, every query the agent writes is refused as unpinnable',
    )
  }
}

// A candidate table reference. `FROM` alone does not make one: it is also
// SQL's argument separator in EXTRACT(... FROM col), SUBSTRING(... FROM n) and
// TRIM(... FROM col), and the agent-facing validator restricts which COLUMNS a
// function may read, not which functions may appear — so those arrive here as
// fully validated SQL. Which of these matches is a real table is decided by
// the name, against the scope's allowlist.
const TABLE_REF = /(\b(?:FROM|JOIN)\s+)([`\w.]+)/gi

// Backticks stripped and lower-cased, the two spellings the validator accepts
// for one allowlisted name.
const tableKey = (token: string): string =>
  token.replaceAll('`', '').toLowerCase()

// Rewrites only the parts of the statement that are not inside a string
// literal. A city name of "FROM DOWNTOWN" would otherwise be rewritten into
// the predicate and change which rows the query matches. Single quotes are the
// only string form the validator lets through, and odd-indexed segments of
// this split are exactly the quoted ones.
const outsideLiterals = (
  sql: string,
  rewrite: (segment: string) => string,
): string =>
  sql
    .split(/('(?:[^']|'')*')/)
    .map((segment, index) => (index % 2 === 1 ? segment : rewrite(segment)))
    .join('')

export const pinDeltaVersion = (
  sql: string,
  version: string,
  tables: readonly string[],
): string => {
  assertDeltaVersion(version)
  if (/\bVERSION\s+AS\s+OF\b/i.test(sql)) return sql
  const allowed = new Set(tables.map(tableKey))
  let pinned = 0
  // EVERY table reference, not just the first: the validator allowlists JOIN
  // targets rather than rejecting them, so a self-join arrives here fully
  // validated and a single-reference pin would leave its other side reading
  // whatever version the warehouse is at when that arm runs — the exact skew
  // this function exists to prevent. Pinned by table identity, not by the
  // keyword in front of it: rewriting a `FROM` that was a function argument
  // would splice VERSION AS OF into an expression and turn a validated query
  // into a Spark parse error — one the trace would blame on the vendor, and
  // only in whichever arm's model happened to write it.
  const out = outsideLiterals(sql, (segment) =>
    segment.replace(TABLE_REF, (match, keyword: string, table: string) => {
      if (!allowed.has(tableKey(table))) return match
      pinned += 1
      return `${keyword}${table} VERSION AS OF ${version}`
    }),
  )
  if (pinned === 0) {
    throw new UnpinnableSqlError(
      'cannot pin a Delta version: no reference to an allowed table ' +
        `(${tables.join(', ')}) found in "${sql}"`,
    )
  }
  return out
}

export interface InstrumentedProvider {
  // The SQL the agent generated, verbatim and unpinned, in call order.
  queries: string[]
  restore: () => void
}

// Captures and optionally pins every query the constituent-data tool runs.
//
// ON THE CLASS, NOT ON AN INSTANCE, and that is the correctness fix rather
// than a style choice. `CONSTITUENT_DATA_PROVIDER` is registered TWICE — once
// in chief-of-staff.module.ts and once in priority-flow.module.ts — each with
// its own factory building its own DatabricksSqlProvider. A container lookup
// by that token returns one of the two by Nest's internal ordering, not by
// the caller's intent, so an instance patch could instrument priority-flow's
// provider while the chief-of-staff handler queried its own: `toolQueries`
// would come back empty with no error, and a `VERSION AS OF` pin would
// silently not apply, which defeats the one invariant JUDGE_DATA_VERSION
// exists for. Patching the prototype makes which instance a handler holds
// unable to matter.
//
// The prototype cannot tell which agent is running, so which table names a
// pin may rewrite has to be handed in rather than read off the instrumented
// provider: the caller resolves them from the same app-layer allowlist the
// scope's handler injects into the tool and passes them in the `DeltaPin`.
// Without that, `pinDeltaVersion` would be back to pinning on the `FROM`
// keyword, which also introduces a function argument.
//
// It also means this records every Databricks query the PROCESS makes while
// installed, not only the agent's. In a judge arm nothing else is querying,
// and `assertTestProcess` is what keeps it out of a live one.
//
// No provider exists at all wherever no Databricks credential is configured,
// which is every local and CI run: the tool never registers and no query is
// ever made, so `queries` stays empty. That is why `pinDeltaVersion` is
// tested directly rather than through a live query.
export const instrumentDatabricksProvider = (
  pin?: DeltaPin,
): InstrumentedProvider => {
  assertTestProcess('instrumentDatabricksProvider')
  // Ahead of the claim, not after it: a prototype recorded as patched by an
  // install that then threw stays recorded, and every well-formed case behind
  // the malformed one would die naming a concurrency bug that does not
  // exist — and on the class, that entry outlives every instance.
  if (pin !== undefined) assertDeltaPin(pin)
  const target = DatabricksSqlProvider.prototype
  return claim(target, 'instrumentDatabricksProvider', () => {
    const queries: string[] = []
    const original = target.query
    const patch = {
      // Method shorthand rather than an arrow: a prototype method is called
      // with the instance as `this`, and the original needs it back.
      query(
        this: DatabricksSqlProvider,
        sql: string,
      ): Promise<DatabricksRowSet> {
        queries.push(sql)
        // Rebound per call: `this` is whichever provider the handler happens
        // to hold, which is the whole reason the patch is on the class.
        // .bind() returns any — TypeScript cannot infer the bound signature
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const unpatched: DatabricksSqlProvider['query'] = original.bind(this)
        return unpatched(
          pin ? pinDeltaVersion(sql, pin.version, pin.tables) : sql,
        )
      },
    }
    Object.assign(target, patch)
    return {
      queries,
      // Puts the original prototype method back rather than deleting the
      // property: deleting it would leave every provider in the process with
      // no query method at all.
      restore: () => {
        Object.assign(target, { query: original })
        installedOn.delete(target)
      },
    }
  })
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
