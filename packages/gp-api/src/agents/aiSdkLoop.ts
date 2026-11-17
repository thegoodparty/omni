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
import {
  type AgentMessageRow,
  nudgeRow,
  type StepUsage,
  stepRows,
} from './agentMessages'
import { instrumentTool } from './agentRunSpans'
import { recordOutputFailure } from './agentMetrics'
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
  tools: AgentTool[]
  output: z.ZodType
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
          recordOutputFailure(
            args.agentName,
            'submitOutput',
            problems.slice(0, 5).join('; '),
          )
          throw new Error(
            `The output does not match the schema. Fix these and call ${SUBMIT_TOOL} again:\n${problems.join('\n')}`,
          )
        }
        return 'accepted'
      },
    }),
  }
  // The one place an agent tool becomes an AI SDK tool, for every agent.
  for (const agentTool of args.tools) {
    const instrumented = instrumentTool(agentTool)
    tools[agentTool.name] = dynamicTool({
      description: agentTool.description,
      inputSchema: agentTool.input,
      execute: (input) =>
        instrumented.execute(input, {
          ...args.toolContext,
          stepKey: stepKey(agentTool.name),
        }),
    })
  }

  const messages = [...args.messages]
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
        try {
          await args.saveRows(
            stepRows(fresh, stepUsage(step), args.modelId),
          )
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
