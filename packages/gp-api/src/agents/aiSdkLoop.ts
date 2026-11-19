import {
  dynamicTool,
  jsonSchema,
  type JSONSchema7,
  type LanguageModel,
  type ModelMessage,
  type StepResult,
  streamText,
  tool,
  type ToolSet,
} from 'ai'
import { z } from 'zod'
import { AgentMessageRole } from '@/generated/prisma'
import {
  type AgentMessageRow,
  nudgeRow,
  type StepUsage,
  stepRows,
} from './agentMessages'
import { isRecord } from '@/llm/tools/util/isRecord.util'
import { instrumentTool } from './agentRunSpans'
import type { AgentTool, ToolContext } from './tools/tool'

export const SUBMIT_TOOL = 'submitOutput'

export const FINISH_INSTRUCTIONS = `

## Finishing

When the work is done, call \`${SUBMIT_TOOL}\` once with your structured output as \`output\`. That ends the run. If it returns an error, fix the output and call it again.`

// Sonnet 4.6's ceiling. A large structured output in one submitOutput call
// runs past 32k tokens.
const MAX_OUTPUT_TOKENS = 64_000

const LENGTH_NUDGE = `Your last reply hit the output limit before \`${SUBMIT_TOOL}\` finished, so nothing was submitted. Call \`${SUBMIT_TOOL}\` with no text before it, and keep every field as short as the instruction allows.`

const FINISH_NUDGE = `You ended your turn without calling \`${SUBMIT_TOOL}\`. Carry on with the work, or if it is done, call \`${SUBMIT_TOOL}\` now with your structured output.`

export class RunStoppedError extends Error {
  constructor() {
    super('run stopped after its current step; the job resumes it')
    this.name = 'RunStoppedError'
  }
}

export class RunBudgetError extends Error {
  constructor(agentName: string, maxSteps: number) {
    super(`${agentName} used its ${maxSteps} steps without submitting`)
    this.name = 'RunBudgetError'
  }
}

const SubmitCallSchema = z.object({
  type: z.literal('tool-call'),
  toolCallId: z.string(),
  toolName: z.literal(SUBMIT_TOOL),
  input: z.object({ output: z.unknown() }),
})

const SubmitResultSchema = z.object({
  type: z.literal('tool-result'),
  toolCallId: z.string(),
  toolName: z.literal(SUBMIT_TOOL),
  output: z.object({ type: z.enum(['text', 'json']) }),
})

// Every warehouse tool reports its outcome as `ok`, so this reads what the run
// actually got back rather than what it asked for: a rejected query, a timeout
// and a warehouse error all carry `ok: false`.
export const warehouseQuerySucceeded = (value: unknown): boolean =>
  isRecord(value) && value.ok === true

// A warehouse tool's result already in the run's saved messages.
const WarehouseResultSchema = z.object({
  type: z.literal('tool-result'),
  toolName: z.string(),
  output: z.object({ type: z.literal('json'), value: z.unknown() }),
})

// How many warehouse queries a run has already had back, counting the rows a
// killed attempt left behind. The loop counts the rest as they happen: inside
// one streamText the model queries and submits without the outer message list
// being rebuilt, so a count taken from it would read zero for every run.
export const savedWarehouseQueriesSucceeded = (
  messages: ModelMessage[],
  warehouseTools: readonly string[],
): number => {
  let succeeded = 0
  for (const message of messages) {
    if (typeof message.content === 'string') continue
    for (const part of message.content) {
      const result = WarehouseResultSchema.safeParse(part)
      if (
        result.success &&
        warehouseTools.includes(result.data.toolName) &&
        warehouseQuerySucceeded(result.data.output.value)
      ) {
        succeeded++
      }
    }
  }
  return succeeded
}

// The manifest's `data_required_unless`, applied as the broker applies it: the
// gate is skipped only when the named top-level field of the artifact carries
// one of the listed values. A malformed carve-out fails closed, so a typo
// costs a refused submit rather than an ungated one.
const carveOutApplies = (
  output: unknown,
  carveOut: { field: string; values: readonly string[] } | undefined,
): boolean => {
  if (!carveOut || !isRecord(output)) return false
  const value = output[carveOut.field]
  return typeof value === 'string' && carveOut.values.includes(value)
}

// The run's output is the input of the last accepted submitOutput call,
// whether it was made in this attempt or found in the saved rows.
export const submittedOutput = (
  messages: ModelMessage[],
  output: z.ZodType,
): { found: true; value: unknown } | { found: false } => {
  const accepted = new Set<string>()
  const calls = new Map<string, unknown>()
  for (const message of messages) {
    if (typeof message.content === 'string') continue
    for (const part of message.content) {
      const call = SubmitCallSchema.safeParse(part)
      if (call.success) calls.set(call.data.toolCallId, call.data.input.output)
      const result = SubmitResultSchema.safeParse(part)
      if (result.success) accepted.add(result.data.toolCallId)
    }
  }
  const last = [...accepted].filter((id) => calls.has(id)).at(-1)
  return last === undefined
    ? { found: false }
    : { found: true, value: output.parse(calls.get(last)) }
}

// Anthropic caches the prompt up to a breakpoint. Moving it to the newest
// message each step means every step re-reads the run so far from cache.
const withCacheBreakpoint = (messages: ModelMessage[]): ModelMessage[] =>
  messages.map((message, index) =>
    index === messages.length - 1
      ? {
          ...message,
          providerOptions: {
            ...message.providerOptions,
            anthropic: { cacheControl: { type: 'ephemeral' } },
          },
        }
      : message,
  )

const stepUsage = (step: StepResult<ToolSet>): StepUsage => ({
  inputTokens: step.usage.inputTokens ?? 0,
  outputTokens: step.usage.outputTokens ?? 0,
  cacheReadTokens: step.usage.inputTokenDetails.cacheReadTokens ?? 0,
  cacheWriteTokens: step.usage.inputTokenDetails.cacheWriteTokens ?? 0,
})

// Zod's own summary of a failed top-level union is "Invalid input" with no
// path, which tells the model nothing. Follow the branch that came closest.
const describeIssues = (
  issues: z.core.$ZodIssue[],
  path: PropertyKey[] = [],
): string[] =>
  issues
    .flatMap((issue) => {
      const at = [...path, ...issue.path]
      if (issue.code === 'invalid_union' && issue.errors.length > 0) {
        const closest = issue.errors.reduce((best, branch) =>
          branch.length < best.length ? branch : best,
        )
        return describeIssues(closest, at)
      }
      return [`- ${at.map(String).join('.') || '(root)'}: ${issue.message}`]
    })
    .slice(0, 50)

const isJsonSchema = (value: unknown): value is JSONSchema7 =>
  typeof value === 'object' && value !== null

export type AgentLoopArgs = {
  agentName: string
  model: LanguageModel
  modelId: string
  system: string
  // Every saved message of the run, in index order.
  messages: ModelMessage[]
  tools: Record<string, AgentTool>
  output: z.ZodType
  // The agent's anti-fabrication carve-out (defineAgent.ts). Absent means the
  // gate never applies, which is every agent that reads no warehouse table.
  dataRequiredUnless?: { field: string; values: readonly string[] }
  toolContext: Omit<ToolContext, 'stepKey'>
  savedSteps: number
  maxSteps: number
  maxNudges: number
  stopRequested: () => boolean
  abortSignal: AbortSignal
  saveRows: (rows: AgentMessageRow[]) => Promise<void>
}

// Runs the agent on the AI SDK's own tool loop, saving the messages of every
// step as it ends (onStepFinish) so a retry continues from the last saved one.
// Stops after the current step when the job is told to stop.
export const runAgentLoop = async (args: AgentLoopArgs): Promise<unknown> => {
  const saved = submittedOutput(args.messages, args.output)
  if (saved.found) return saved.value
  if (args.savedSteps >= args.maxSteps) {
    throw new RunBudgetError(args.agentName, args.maxSteps)
  }

  let currentStep = args.savedSteps
  let callsThisStep = new Map<string, number>()
  const stepKey = (toolName: string): string => {
    const n = callsThisStep.get(toolName) ?? 0
    callsThisStep.set(toolName, n + 1)
    return `${currentStep}:${toolName}:${n}`
  }

  const messages = [...args.messages]
  const warehouseTools = Object.entries(args.tools)
    .filter(([, agentTool]) => agentTool.readsWarehouse === true)
    .map(([name]) => name)
  let warehouseQueries = savedWarehouseQueriesSucceeded(
    messages,
    warehouseTools,
  )
  const submitJsonSchema: unknown = z.toJSONSchema(
    z.object({ output: args.output }),
    { unrepresentable: 'any' },
  )
  if (!isJsonSchema(submitJsonSchema)) {
    throw new Error(`${args.agentName}: output schema has no JSON schema`)
  }
  // The model sees the schema, but the AI SDK does not check against it: its
  // error repeats the whole input, which for a large output is tens of
  // thousands of tokens added to the context on every miss. Zod's own list of
  // what is wrong is enough to fix it.
  const tools: ToolSet = {
    [SUBMIT_TOOL]: tool({
      description:
        'Submit the output. Call once, at the end, with the whole structured output.',
      inputSchema: jsonSchema<{ output?: unknown }>(submitJsonSchema),
      execute: async ({ output }) => {
        const parsed = args.output.safeParse(output)
        if (!parsed.success) {
          const problems = describeIssues(parsed.error.issues, ['output'])
          throw new Error(
            `The output does not match the schema. Fix these and call ${SUBMIT_TOOL} again:\n${problems.join('\n')}`,
          )
        }
        // The anti-fabrication gate. Distinct from the schema check above on
        // purpose: an invented output is schema-valid, and the only evidence
        // that this one is not is that no warehouse query returned a row.
        if (
          warehouseTools.length > 0 &&
          warehouseQueries === 0 &&
          !carveOutApplies(parsed.data, args.dataRequiredUnless)
        ) {
          throw new Error(
            `No warehouse query succeeded, so this output cannot be submitted: ` +
              `it would report data this run never read. Run ${warehouseTools.join(' or ')} ` +
              `and read its result before calling ${SUBMIT_TOOL} again.`,
          )
        }
        return 'accepted'
      },
    }),
  }
  // The one place an agent's tools become AI SDK tools, for every agent.
  for (const [name, agentTool] of Object.entries(args.tools)) {
    const instrumented = instrumentTool(name, agentTool)
    tools[name] = dynamicTool({
      description: agentTool.description,
      inputSchema: agentTool.input,
      execute: async (input) => {
        const value = await instrumented.execute(input, {
          ...args.toolContext,
          stepKey: stepKey(name),
        })
        if (warehouseTools.includes(name) && warehouseQuerySucceeded(value)) {
          warehouseQueries++
        }
        return value
      },
    })
  }

  let saveError: unknown
  let cutOff = 0
  for (let nudges = 0; ; nudges++) {
    let seen = 0
    let streamError: unknown
    // Streamed even though nothing reads the tokens as they come: a
    // non-streaming call sends no headers until the whole reply is written,
    // and Node's fetch gives up on headers after five minutes, which a long
    // final output passes.
    const result = streamText({
      model: args.model,
      system: args.system,
      messages,
      tools,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      maxRetries: 4,
      abortSignal: args.abortSignal,
      experimental_telemetry: {
        isEnabled: true,
        functionId: `agent.${args.agentName}`,
        recordInputs: false,
        recordOutputs: false,
      },
      prepareStep: ({ messages: stepMessages }) => {
        callsThisStep = new Map()
        return { messages: withCacheBreakpoint(stepMessages) }
      },
      stopWhen: [
        ({ steps }) =>
          steps.at(-1)?.toolResults.some((r) => r.toolName === SUBMIT_TOOL) ??
          false,
        () => saveError !== undefined,
        () => args.stopRequested(),
        () => currentStep >= args.maxSteps,
        ({ steps }) => steps.at(-1)?.finishReason === 'length',
      ],
      onError: ({ error }) => {
        streamError = error
      },
      onStepFinish: async (step) => {
        const fresh = step.response.messages.slice(seen)
        seen = step.response.messages.length
        const rows = stepRows(fresh, stepUsage(step), args.modelId)
        // A step whose reply was cut off before any content saves nothing, so
        // it must not spend a step number: a resume counts saved assistant
        // rows, and a number it never saw would come back round and hand a
        // second step the same stepKey.
        if (!rows.some((row) => row.role === AgentMessageRole.assistant)) return
        try {
          await args.saveRows(rows)
          currentStep++
        } catch (err) {
          saveError = err
        }
      },
    })
    await result.consumeStream()
    if (saveError !== undefined) throw saveError
    if (streamError !== undefined) throw streamError
    messages.push(...(await result.response).messages)

    const submitted = submittedOutput(messages, args.output)
    if (submitted.found) return submitted.value
    if (args.stopRequested()) throw new RunStoppedError()
    if (currentStep >= args.maxSteps) {
      throw new RunBudgetError(args.agentName, args.maxSteps)
    }
    if ((await result.steps).at(-1)?.finishReason === 'length') {
      cutOff++
      if (cutOff >= 2) {
        throw new Error(
          `${args.agentName} hit the output limit twice without submitting`,
        )
      }
      await args.saveRows([nudgeRow(LENGTH_NUDGE)])
      messages.push({ role: 'user', content: LENGTH_NUDGE })
      continue
    }
    if (nudges >= args.maxNudges) {
      throw new Error(`${args.agentName} ended without submitting its output`)
    }
    await args.saveRows([nudgeRow(FINISH_NUDGE)])
    messages.push({ role: 'user', content: FINISH_NUDGE })
  }
}
