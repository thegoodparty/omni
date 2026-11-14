import {
  dynamicTool,
  generateText,
  type LanguageModel,
  type ModelMessage,
  modelMessageSchema,
  type StepResult,
  tool,
  type ToolSet,
} from 'ai'
import { z } from 'zod'
import { instrumentTool } from '../observability/agentRunSpans'
import type { AgentTool, ToolContext } from '../tools/tool'
import { aiSdkWebSearch, isProviderWebSearch } from '../tools/webSearch'

export const SUBMIT_TOOL = 'submitOutput'

export const FINISH_INSTRUCTIONS = `

## Finishing the stage

When the stage is done, call \`${SUBMIT_TOOL}\` once with your structured output as \`output\`. That ends the stage. If it returns an error, fix the output and call it again.`

const FINISH_NUDGE = `You ended your turn without calling \`${SUBMIT_TOOL}\`. Carry on with the stage, or if it is done, call \`${SUBMIT_TOOL}\` now with your structured output.`

export const StepUsageSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  webSearches: z.number(),
})
export type StepUsage = z.infer<typeof StepUsageSchema>

// What one ChatMessage row holds for a background step: the messages the
// step added (assistant content and tool results) and what it cost.
export const SavedStepSchema = z.object({
  messages: z.array(modelMessageSchema),
  usage: StepUsageSchema,
})
export type SavedStep = z.infer<typeof SavedStepSchema>

export class StageStoppedError extends Error {
  constructor() {
    super('stage stopped after its current step; the job resumes it')
    this.name = 'StageStoppedError'
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

// The stage's output is the input of the last accepted submitOutput call,
// whether it was made in this attempt or found in the saved steps.
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
  webSearches: step.toolCalls.filter((call) => call.toolName === 'web_search')
    .length,
})

export type StageLoopArgs = {
  stageName: string
  model: LanguageModel
  system: string
  // The stage's first message, its saved steps and any nudges, in order.
  messages: ModelMessage[]
  tools: AgentTool[]
  output: z.ZodType
  toolContext: Omit<ToolContext, 'stepKey'>
  savedSteps: number
  maxSteps: number
  maxNudges: number
  stopRequested: () => boolean
  abortSignal: AbortSignal
  saveStep: (step: SavedStep, text: string) => Promise<void>
  saveNudge: (text: string) => Promise<void>
}

// Runs one stage on the AI SDK's own tool loop, saving a row after every
// step (onStepFinish) so a retry continues from the last saved step. Stops
// after the current step when the job is told to stop.
export const runStageLoop = async (args: StageLoopArgs): Promise<unknown> => {
  const saved = submittedOutput(args.messages, args.output)
  if (saved.found) return saved.value

  let currentStep = args.savedSteps
  let callsThisStep = new Map<string, number>()
  const stepKey = (toolName: string): string => {
    const n = callsThisStep.get(toolName) ?? 0
    callsThisStep.set(toolName, n + 1)
    return `${args.stageName}:${currentStep}:${toolName}:${n}`
  }

  const tools: ToolSet = {
    [SUBMIT_TOOL]: tool({
      description:
        'Submit the stage output. Call once, at the end, with the whole structured output.',
      inputSchema: z.object({ output: args.output }),
      execute: async () => 'accepted',
    }),
  }
  for (const agentTool of args.tools) {
    if (isProviderWebSearch(agentTool)) {
      tools[agentTool.name] = aiSdkWebSearch(agentTool)
      continue
    }
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
  for (let nudges = 0; ; nudges++) {
    let seen = 0
    const result = await generateText({
      model: args.model,
      system: args.system,
      messages,
      tools,
      maxOutputTokens: 32_000,
      maxRetries: 4,
      abortSignal: args.abortSignal,
      experimental_telemetry: {
        isEnabled: true,
        functionId: `agent.${args.stageName}`,
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
      ],
      onStepFinish: async (step) => {
        const fresh = step.response.messages.slice(seen)
        seen = step.response.messages.length
        try {
          await args.saveStep(
            { messages: fresh, usage: stepUsage(step) },
            step.text,
          )
          currentStep++
        } catch (err) {
          saveError = err
        }
      },
    })
    if (saveError !== undefined) throw saveError
    messages.push(...result.response.messages)

    const submitted = submittedOutput(messages, args.output)
    if (submitted.found) return submitted.value
    if (args.stopRequested()) throw new StageStoppedError()
    if (currentStep >= args.maxSteps) {
      throw new Error(
        `${args.stageName} used its ${args.maxSteps} steps without submitting`,
      )
    }
    if (nudges >= args.maxNudges) {
      throw new Error(`${args.stageName} ended without submitting its output`)
    }
    await args.saveNudge(FINISH_NUDGE)
    messages.push({ role: 'user', content: FINISH_NUDGE })
  }
}
