import { Inject, Injectable, Optional } from '@nestjs/common'
import { createAnthropic } from '@ai-sdk/anthropic'
import {
  generateObject as realGenerateObject,
  generateText as realGenerateText,
  jsonSchema,
  stepCountIs,
  streamText as realStreamText,
  tool,
  type LanguageModel,
  type Tool,
  type ToolSet,
  type TypedToolCall,
} from 'ai'
import retry from 'async-retry'
import { z } from 'zod'
import { PinoLogger } from 'nestjs-pino'
import {
  type LlmFunctionTool,
  type LlmMessage,
  type LlmToolChoice,
} from '../types/llmMessages.types'
import { toModelMessages } from './messageConversion'

export { toModelMessages } from './messageConversion'

export interface LlmChatCompletionOptions {
  messages: LlmMessage[]
  models?: string[]
  temperature?: number
  topP?: number
  maxTokens?: number
  userId?: string
  retries?: number
}

export interface LlmToolCompletionOptions extends LlmChatCompletionOptions {
  tools: LlmFunctionTool[]
  toolChoice?: LlmToolChoice
}

export interface LlmJsonCompletionOptions<T> extends LlmChatCompletionOptions {
  schema: z.ZodType<T>
}

export interface ToolCall {
  id: string
  type: string
  function: {
    name: string
    arguments: string
  }
}

export interface LlmCompletionResult {
  content: string
  tokens: number
  model: string
  toolCalls?: ToolCall[]
}

export type LlmStreamTool<
  TInput = unknown,
  TOutput = unknown,
> = TInput extends z.ZodTypeAny
  ? {
      description: string
      inputSchema: TInput
      // Method syntax (bivariant params) so concrete-input tools stay
      // assignable to the erased `LlmTool` registry, whose inferred input is
      // `unknown` under zod v4 (it was `any` in v3).
      execute(input: z.infer<TInput>): Promise<unknown> | unknown
    }
  : {
      description: string
      inputSchema: z.ZodType<TInput>
      execute(input: TInput): Promise<TOutput> | TOutput
    }

/**
 * Provider-run web search (Anthropic's native `webSearch_20250305`), as opposed
 * to a client `execute()` tool. The provider runs the search server-side, so
 * there's no execute hook — tool-call/result events are surfaced from the
 * stream instead. Only available on the Anthropic (Claude) path; ignored if
 * ANTHROPIC_API_KEY is unset or the resolved model isn't a Claude model.
 */
export interface NativeWebSearchSpec {
  kind: 'native_web_search'
  maxUses?: number
  allowedDomains?: string[]
  blockedDomains?: string[]
}

export type LlmTool = LlmStreamTool<z.ZodTypeAny> | NativeWebSearchSpec

const isNativeWebSearch = (t: LlmTool): t is NativeWebSearchSpec =>
  'kind' in t && t.kind === 'native_web_search'

export interface LlmStreamOptions {
  messages: LlmMessage[]
  tools?: Record<string, LlmTool>
  models?: string[]
  temperature?: number
  topP?: number
  maxOutputTokens?: number
  maxSteps?: number
  userId?: string
  retries?: number
  abortSignal?: AbortSignal
  onToolCallStart?: (event: { name: string; input: unknown }) => void
  onToolCallEnd?: (event: {
    name: string
    input: unknown
    output: unknown
  }) => void
  // Fires when the model starts writing a tool call's arguments, before the
  // call is complete. Lets the client show a per-tool "generating" indicator
  // during the gap the tool_call event used to leave blank.
  onToolInputStart?: (event: { toolName: string }) => void
}

export interface LlmStreamUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export interface LlmStreamResult {
  textStream: AsyncIterable<string>
  finalText: Promise<string>
  toolCalls: Promise<ToolCall[]>
  usage: Promise<LlmStreamUsage>
  model: string
}

export type StreamTextFn = typeof realStreamText
export type GenerateTextFn = typeof realGenerateText
export type GenerateObjectFn = typeof realGenerateObject

export const STREAM_TEXT_TOKEN = 'LLM_STREAM_TEXT_FN'
export const GENERATE_TEXT_TOKEN = 'LLM_GENERATE_TEXT_FN'
export const GENERATE_OBJECT_TOKEN = 'LLM_GENERATE_OBJECT_FN'
export const ANTHROPIC_PROVIDER_FACTORY_TOKEN = 'LLM_ANTHROPIC_PROVIDER_FACTORY'

export interface AnthropicProvider {
  languageModel: (model: string) => LanguageModel
  webSearchTool: (spec: NativeWebSearchSpec) => Tool
}

export type AnthropicProviderFactory = (opts: {
  apiKey: string
}) => AnthropicProvider

export const defaultAnthropicProviderFactory: AnthropicProviderFactory = ({
  apiKey,
}) => {
  const provider = createAnthropic({ apiKey })
  return {
    languageModel: (model: string) => provider(model),
    webSearchTool: (spec: NativeWebSearchSpec) =>
      provider.tools.webSearch_20250305({
        ...(spec.maxUses !== undefined && { maxUses: spec.maxUses }),
        ...(spec.allowedDomains && { allowedDomains: spec.allowedDomains }),
        ...(spec.blockedDomains && { blockedDomains: spec.blockedDomains }),
      }),
  }
}

@Injectable()
export class LlmService {
  private readonly defaultModels: string[]
  private readonly chatFallbackModel?: string
  private readonly defaultRetries = 3
  private readonly defaultMaxSteps = 5
  private readonly anthropicProvider: AnthropicProvider
  private readonly streamTextFn: StreamTextFn
  private readonly generateTextFn: GenerateTextFn
  private readonly generateObjectFn: GenerateObjectFn

  constructor(
    private readonly logger: PinoLogger,
    @Optional()
    @Inject(STREAM_TEXT_TOKEN)
    streamTextFn?: StreamTextFn,
    @Optional()
    @Inject(GENERATE_TEXT_TOKEN)
    generateTextFn?: GenerateTextFn,
    @Optional()
    @Inject(GENERATE_OBJECT_TOKEN)
    generateObjectFn?: GenerateObjectFn,
    @Optional()
    @Inject(ANTHROPIC_PROVIDER_FACTORY_TOKEN)
    anthropicProviderFactory?: AnthropicProviderFactory,
  ) {
    this.logger.setContext(LlmService.name)
    const { ANTHROPIC_API_KEY, AI_MODELS = '', AI_FALLBACK_MODEL } = process.env

    if (!ANTHROPIC_API_KEY) {
      throw new Error('Please set ANTHROPIC_API_KEY in your .env')
    }
    if (!AI_MODELS) {
      throw new Error('Please set AI_MODELS in your .env')
    }

    this.defaultModels = AI_MODELS.split(',')
      .map((m) => m.trim())
      .filter((m) => m.length > 0)

    if (this.defaultModels.length === 0) {
      throw new Error('AI_MODELS must contain at least one model')
    }

    const fallback = AI_FALLBACK_MODEL?.trim()
    if (fallback) {
      this.chatFallbackModel = fallback
    }

    this.anthropicProvider = (
      anthropicProviderFactory ?? defaultAnthropicProviderFactory
    )({ apiKey: ANTHROPIC_API_KEY })

    this.streamTextFn = streamTextFn ?? realStreamText
    this.generateTextFn = generateTextFn ?? realGenerateText
    this.generateObjectFn = generateObjectFn ?? realGenerateObject
  }

  getChatModelChain(): string[] {
    const chain = [...this.defaultModels]
    if (this.chatFallbackModel && !chain.includes(this.chatFallbackModel)) {
      chain.push(this.chatFallbackModel)
    }
    return chain
  }

  private resolveChatModel(model: string): LanguageModel {
    return this.anthropicProvider.languageModel(model)
  }

  async chatCompletion(
    options: LlmChatCompletionOptions,
  ): Promise<LlmCompletionResult> {
    const {
      messages,
      models: providedModels,
      temperature = 0.7,
      topP = 1.0,
      maxTokens,
      userId,
      retries = this.defaultRetries,
    } = options

    const models = this.prepareModelList(providedModels)

    const { model, result } = await this.withModelFallback(
      models,
      retries,
      'chat completion',
      (currentModel) =>
        this.callChatCompletion({
          model: currentModel,
          messages,
          temperature,
          topP,
          maxTokens,
          userId,
        }),
    )

    return { ...result, model }
  }

  async jsonCompletion<T>(
    options: LlmJsonCompletionOptions<T>,
  ): Promise<{ object: T; tokens: number; model: string }> {
    const {
      messages,
      schema,
      models: providedModels,
      temperature = 0,
      topP = 1,
      maxTokens,
      userId,
      retries = this.defaultRetries,
    } = options

    const models = this.prepareModelList(providedModels)

    const { model, result } = await this.withModelFallback(
      models,
      retries,
      'json completion',
      (currentModel) =>
        this.callJsonCompletion({
          model: currentModel,
          messages,
          schema,
          temperature,
          topP,
          maxTokens,
          userId,
        }),
    )

    return { object: result.object, tokens: result.tokens, model }
  }

  async toolCompletion(
    options: LlmToolCompletionOptions,
  ): Promise<LlmCompletionResult> {
    const {
      messages,
      tools,
      toolChoice,
      models: providedModels,
      temperature = 0.1,
      topP = 0.1,
      maxTokens,
      userId,
      retries = this.defaultRetries,
    } = options

    if (!tools.length) {
      throw new Error('Tools must be provided for tool completion')
    }

    const models = this.prepareModelList(providedModels)

    const { model, result } = await this.withModelFallback(
      models,
      retries,
      'tool completion',
      (currentModel) =>
        this.callToolCompletion({
          model: currentModel,
          messages,
          tools,
          toolChoice,
          temperature,
          topP,
          maxTokens,
          userId,
        }),
    )

    return { ...result, model }
  }

  /**
   * Streams a chat completion as text deltas, with multi-step tool support.
   *
   * Model fallback applies only at connect-time (synchronous errors from
   * streamText). Once the result object is returned, errors during stream
   * consumption propagate without switching models — you can't restart a
   * partially-shipped response.
   */
  async streamChatCompletion(
    options: LlmStreamOptions,
  ): Promise<LlmStreamResult> {
    const {
      messages,
      tools,
      models: providedModels,
      temperature,
      topP,
      maxOutputTokens,
      maxSteps = this.defaultMaxSteps,
      userId,
      retries = this.defaultRetries,
      abortSignal,
      onToolCallStart,
      onToolCallEnd,
      onToolInputStart,
    } = options

    const models = this.prepareModelList(providedModels)
    const built = tools
      ? this.buildToolSet(tools, { onToolCallStart, onToolCallEnd })
      : undefined
    const toolSet = built?.toolSet
    const providerToolNames = built?.providerToolNames
    const modelMessages = toModelMessages(messages)

    const { model, result } = await this.withModelFallback(
      models,
      retries,
      'stream chat completion',
      (currentModel) =>
        Promise.resolve(
          this.streamTextFn({
            model: this.resolveChatModel(currentModel),
            messages: modelMessages,
            ...(toolSet && { tools: toolSet }),
            stopWhen: stepCountIs(maxSteps),
            ...(abortSignal && { abortSignal }),
            ...(temperature !== undefined && { temperature }),
            ...(topP !== undefined && { topP }),
            ...(maxOutputTokens !== undefined && { maxOutputTokens }),
            ...(userId && { headers: { 'X-User-Id': userId } }),
            // The model streams a tool call's arguments before the call is
            // complete; surface that start so the client can show a per-tool
            // "generating" indicator. Provider-run tools (Anthropic web search)
            // have no execute hook, so also surface their call/result from the
            // stream to drive the same onToolCallStart/End the client-tool
            // execute wrapper fires.
            ...((onToolInputStart ||
              (providerToolNames && providerToolNames.size > 0)) && {
              onChunk: ({ chunk }) => {
                if (chunk.type === 'tool-input-start') {
                  onToolInputStart?.({ toolName: chunk.toolName })
                  return
                }
                if (!providerToolNames || providerToolNames.size === 0) return
                if (
                  chunk.type === 'tool-call' &&
                  providerToolNames.has(chunk.toolName)
                ) {
                  onToolCallStart?.({
                    name: chunk.toolName,
                    input: chunk.input,
                  })
                } else if (
                  chunk.type === 'tool-result' &&
                  providerToolNames.has(chunk.toolName)
                ) {
                  onToolCallEnd?.({
                    name: chunk.toolName,
                    input: chunk.input,
                    output: chunk.output,
                  })
                }
              },
            }),
          }),
        ),
    )

    return {
      textStream: result.textStream,
      finalText: Promise.resolve(result.text),
      toolCalls: Promise.resolve(result.toolCalls).then((calls) =>
        this.mapAiSdkToolCalls(calls),
      ),
      usage: Promise.resolve(result.totalUsage).then((u) => ({
        inputTokens: u.inputTokens ?? 0,
        outputTokens: u.outputTokens ?? 0,
        totalTokens: u.totalTokens ?? 0,
      })),
      model,
    }
  }

  // Builds the AI SDK tool set. Client tools wrap their `execute` (and fire the
  // hooks from there); native provider tools (Anthropic web search) have no
  // execute — the provider runs them — so their names are returned in
  // `providerToolNames` for the caller to surface tool events from the stream.
  private buildToolSet(
    tools: Record<string, LlmTool>,
    hooks: {
      onToolCallStart?: (event: { name: string; input: unknown }) => void
      onToolCallEnd?: (event: {
        name: string
        input: unknown
        output: unknown
      }) => void
    } = {},
  ): { toolSet: ToolSet; providerToolNames: Set<string> } {
    const set: ToolSet = {}
    const providerToolNames = new Set<string>()
    for (const [name, t] of Object.entries(tools)) {
      if (isNativeWebSearch(t)) {
        set[name] = this.anthropicProvider.webSearchTool(t)
        providerToolNames.add(name)
        continue
      }
      set[name] = tool<unknown, unknown>({
        description: t.description,
        inputSchema: t.inputSchema,
        execute: async (input) => {
          hooks.onToolCallStart?.({ name, input })
          try {
            const result = await t.execute(input)
            this.logger.info(
              {
                toolName: name,
                inputPreview: safePreview(toPreviewInput(input)),
              },
              'LLM tool executed',
            )
            hooks.onToolCallEnd?.({ name, input, output: result })
            return result
          } catch (err) {
            this.logger.error(
              {
                err,
                toolName: name,
                inputPreview: safePreview(toPreviewInput(input)),
              },
              'LLM tool execution failed',
            )
            throw err
          }
        },
      })
    }
    return { toolSet: set, providerToolNames }
  }

  private mapAiSdkToolCalls(calls: TypedToolCall<ToolSet>[]): ToolCall[] {
    return calls.map((c) => ({
      id: c.toolCallId,
      type: 'function',
      function: {
        name: c.toolName,
        arguments: JSON.stringify(c.input),
      },
    }))
  }

  /**
   * Generic helper to run an operation with model fallbacks and retry logic.
   *
   * Permanent client errors (4xx) call `bail()` and return immediately —
   * async-retry rejects the outer promise without scheduling further retries
   * and without cascading to the next model in the list. Transient errors
   * fall through to the next model in this attempt; if all models in the
   * list fail with transient errors, the thrown error triggers async-retry
   * to retry the whole loop.
   */
  private async withModelFallback<R>(
    models: string[],
    retries: number,
    operationLabel: string,
    fn: (model: string) => Promise<R>,
  ): Promise<{ model: string; result: R }> {
    return retry(
      async () => {
        let lastError: Error | undefined

        for (let i = 0; i < models.length; i++) {
          const currentModel = models[i]
          if (currentModel === undefined) continue

          try {
            const result = await fn(currentModel)
            return { model: currentModel, result }
          } catch (error) {
            lastError =
              error instanceof Error ? error : new Error(String(error))

            if (this.isPermanentClientError(error)) {
              this.logger.error(
                lastError,
                `Permanent client error for ${operationLabel} with model ${currentModel}, not retrying`,
              )
              // Tag the error so async-retry's onError sees `err.bail === true`
              // and calls `bail()` instead of scheduling a retry. This stops
              // both the cascade to the next model AND the retry loop.
              const bailable: Error & { bail?: boolean } = lastError
              bailable.bail = true
              throw bailable
            }

            this.logger.warn(
              lastError,
              `Model ${currentModel} failed for ${operationLabel}, ${
                i < models.length - 1 ? 'trying fallback' : 'no more fallbacks'
              }`,
            )

            if (i === models.length - 1) {
              throw lastError
            }
          }
        }

        throw lastError || new Error('All models failed')
      },
      {
        retries,
        onRetry: (error, attempt) => {
          this.logger.warn(
            { error },
            `${operationLabel} attempt ${attempt} failed, retrying...`,
          )
        },
      },
    )
  }

  private isPermanentClientError(error: unknown): boolean {
    if (error && typeof error === 'object') {
      const status =
        'status' in error && typeof error.status === 'number'
          ? error.status
          : 'statusCode' in error && typeof error.statusCode === 'number'
            ? error.statusCode
            : undefined
      if (status !== undefined && status >= 400 && status < 500) return true
    }
    return false
  }

  private prepareModelList(models?: string[]): string[] {
    return models && models.length > 0 ? models : this.defaultModels
  }

  private async callChatCompletion({
    model,
    messages,
    temperature,
    topP,
    maxTokens,
    userId,
  }: {
    model: string
    messages: LlmMessage[]
    temperature: number
    topP: number
    maxTokens?: number
    userId?: string
  }): Promise<Omit<LlmCompletionResult, 'model'>> {
    const result = await this.generateTextFn({
      model: this.resolveChatModel(model),
      messages: toModelMessages(messages),
      temperature,
      topP,
      ...(maxTokens !== undefined && { maxOutputTokens: maxTokens }),
      ...(userId && { headers: { 'X-User-Id': userId } }),
    })
    return {
      content: result.text.trim(),
      tokens: result.totalUsage.totalTokens ?? 0,
    }
  }

  private async callJsonCompletion<T>({
    model,
    messages,
    schema,
    temperature,
    topP,
    maxTokens,
    userId,
  }: {
    model: string
    messages: LlmMessage[]
    schema: z.ZodType<T>
    temperature: number
    topP: number
    maxTokens?: number
    userId?: string
  }): Promise<{ object: T; tokens: number }> {
    const result = await this.generateObjectFn({
      model: this.resolveChatModel(model),
      messages: toModelMessages(messages),
      schema,
      temperature,
      topP,
      ...(maxTokens !== undefined && { maxOutputTokens: maxTokens }),
      ...(userId && { headers: { 'X-User-Id': userId } }),
    })
    return {
      object: result.object,
      tokens: result.usage.totalTokens ?? 0,
    }
  }

  private async callToolCompletion({
    model,
    messages,
    tools,
    toolChoice,
    temperature,
    topP,
    maxTokens,
    userId,
  }: {
    model: string
    messages: LlmMessage[]
    tools: LlmFunctionTool[]
    toolChoice?: LlmToolChoice
    temperature: number
    topP: number
    maxTokens?: number
    userId?: string
  }): Promise<Omit<LlmCompletionResult, 'model'>> {
    const toolSet: ToolSet = {}
    for (const t of tools) {
      toolSet[t.function.name] = tool({
        description: t.function.description ?? '',
        inputSchema: jsonSchema(t.function.parameters ?? {}),
      })
    }

    const sdkToolChoice:
      | 'auto'
      | 'none'
      | 'required'
      | { type: 'tool'; toolName: string }
      | undefined =
      toolChoice === undefined
        ? undefined
        : typeof toolChoice === 'string'
          ? toolChoice
          : { type: 'tool' as const, toolName: toolChoice.function.name }

    const result = await this.generateTextFn({
      model: this.resolveChatModel(model),
      messages: toModelMessages(messages),
      tools: toolSet,
      ...(sdkToolChoice && { toolChoice: sdkToolChoice }),
      temperature,
      topP,
      ...(maxTokens !== undefined && { maxOutputTokens: maxTokens }),
      ...(userId && { headers: { 'X-User-Id': userId } }),
    })

    const toolCalls = this.mapAiSdkToolCalls(
      result.toolCalls as TypedToolCall<ToolSet>[],
    )
    return {
      content: result.text.trim(),
      tokens: result.totalUsage.totalTokens ?? 0,
      ...(toolCalls.length > 0 && { toolCalls }),
    }
  }
}

type PreviewInput = string | number | boolean | bigint | object | null

const toPreviewInput = (value: unknown): PreviewInput => {
  if (value === undefined) return null
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint' ||
    typeof value === 'object'
  ) {
    return value
  }
  return String(value)
}

const safePreview = (input: PreviewInput): string => {
  try {
    const replacer = (_key: string, value: unknown): unknown =>
      typeof value === 'bigint' ? value.toString() : value
    const str = JSON.stringify(input, replacer)
    if (str === undefined) {
      return '[unstringifiable]'
    }
    return str.slice(0, 500)
  } catch {
    return '[unstringifiable]'
  }
}
