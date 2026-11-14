import { createHash } from 'node:crypto'
import type { ModuleRef } from '@nestjs/core'
import { context, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import {
  AIMessage,
  type BaseMessage,
  HumanMessage,
} from '@langchain/core/messages'
import { DynamicStructuredTool } from '@langchain/core/tools'
import { ChatAnthropic } from '@langchain/anthropic'
import {
  Annotation,
  type BaseCheckpointSaver,
  END as GRAPH_END,
  type LangGraphRunnableConfig,
  START,
  StateGraph,
} from '@langchain/langgraph'
import {
  anthropicPromptCachingMiddleware,
  createAgent,
  createMiddleware,
  toolStrategy,
} from 'langchain'
import { z } from 'zod'
import { loadAgentPrompt } from '../agentPrompt'
import { instrumentTool, withStageSpan } from '../observability/agentRunSpans'
import type { AgentTool } from '../tools/tool'
import { isProviderWebSearch, langChainWebSearch } from '../tools/webSearch'
import {
  type BackgroundAgentDefinition,
  END,
  type StageDefinition,
} from '../types'

export type AgentDefinition = BackgroundAgentDefinition<z.ZodType, z.ZodType>

// One state field per stage, named apart from its node: LangGraph refuses a
// node and a channel with the same name.
export const stageField = (stage: string): string => `${stage}Output`

// A model step can take minutes; a stage's agent loop is one model call and
// one round of tools per two supersteps.
const STAGE_RECURSION_LIMIT = 400

const firstStage = (definition: AgentDefinition): string => {
  const [first] = Object.keys(definition.stages)
  if (!first) throw new Error('an agent needs at least one stage')
  return first
}

// What `reads` and `next` see: the run input and each finished stage's
// output under the stage's own name.
export const stageView = (
  definition: AgentDefinition,
  state: Record<string, unknown>,
): Record<string, unknown> => ({
  input: state.input,
  ...Object.fromEntries(
    Object.keys(definition.stages).flatMap((name) =>
      state[stageField(name)] === undefined
        ? []
        : [[name, state[stageField(name)]]],
    ),
  ),
})

const nextStage = (
  stage: StageDefinition,
  view: Record<string, unknown>,
): string => {
  if (stage.next === undefined) return END
  return typeof stage.next === 'string' ? stage.next : stage.next(view)
}

// The stages a finished run went through, in order, from the first stage
// along `next`. The last one's output is the artifact.
export const stagePath = (
  definition: AgentDefinition,
  state: Record<string, unknown>,
): string[] => {
  const view = stageView(definition, state)
  const path: string[] = []
  let name = firstStage(definition)
  while (name !== END && !path.includes(name)) {
    const stage = definition.stages[name]
    if (!stage || view[name] === undefined) break
    path.push(name)
    name = nextStage(stage, view)
  }
  return path
}

// The hash of an agent's shape: stage names, their order and their output
// schemas. Prompts, tools and models are left out on purpose, so tweaking
// them never restarts a run in flight.
export const shapeHash = (definition: AgentDefinition): string =>
  createHash('sha256')
    .update(
      JSON.stringify(
        Object.entries(definition.stages).map(([name, stage]) => [
          name,
          z.toJSONSchema(stage.output, { unrepresentable: 'any' }),
        ]),
      ),
    )
    .digest('hex')
    .slice(0, 12)

// The stage's output as the structured-output tool the model calls to
// finish. A top-level union becomes one tool per member, since a tool's
// input must be an object. Named, because LangChain otherwise numbers them
// per process and a resumed run would call a tool that no longer exists.
// Not strict: the result is parsed against the Zod schema afterwards.
const outputFormat = (stageName: string, output: z.ZodType) => {
  const members = output instanceof z.ZodUnion ? output.options : [output]
  return toolStrategy(
    members.map((member, index) => {
      const schema = z.toJSONSchema(member, { unrepresentable: 'any' })
      return {
        ...schema,
        type: 'object' as const,
        title:
          members.length === 1
            ? `${stageName}_result`
            : `${stageName}_result_${index + 1}`,
      }
    }),
  )
}

export type RunToolContext = {
  runId: string
  organizationSlug: string
  moduleRef: ModuleRef
  signal: AbortSignal
}

const toolResultText = (result: unknown): string =>
  typeof result === 'string' ? result : (JSON.stringify(result) ?? 'null')

// AgentTool to a LangChain tool. stepKey is the model's tool call id, which
// LangGraph saved with the step, so a resumed step keys its side effects the
// same way. A tool's error goes back to the model as text, as chat does.
export const toLangChainTool = (agentTool: AgentTool, run: RunToolContext) => {
  if (isProviderWebSearch(agentTool)) return langChainWebSearch(agentTool)
  const instrumented = instrumentTool(agentTool)
  return new DynamicStructuredTool({
    name: agentTool.name,
    description: agentTool.description,
    schema: z.toJSONSchema(agentTool.input, { unrepresentable: 'any' }),
    func: async (input: unknown, _runManager, config) => {
      const stepKey =
        config && 'toolCall' in config && isToolCall(config.toolCall)
          ? (config.toolCall.id ?? agentTool.name)
          : agentTool.name
      try {
        return toolResultText(
          await instrumented.execute(agentTool.input.parse(input), {
            runId: run.runId,
            stepKey,
            organizationSlug: run.organizationSlug,
            signal: config?.signal ?? run.signal,
            moduleRef: run.moduleRef,
          }),
        )
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`
      }
    },
  })
}

const isToolCall = (value: unknown): value is { id?: string } =>
  typeof value === 'object' && value !== null

export const chatModelFor = (model: string): BaseChatModel =>
  new ChatAnthropic({
    model,
    // A full briefing is one long structured-output call; at 32k tokens a
    // live run's tool input was cut off mid-document and failed its schema.
    // Anthropic requires streaming for requests this large.
    maxTokens: 64_000,
    streaming: true,
  })

const providerOf = (model: string): string =>
  model.startsWith('claude') ? 'anthropic' : 'unknown'

// One generation span per model call, inside the stage's span. LangChain
// emits no OpenTelemetry of its own. Token counts only; no prompt or reply.
export const modelCallSpans = (model: string) =>
  createMiddleware({
    name: 'ModelCallSpans',
    wrapModelCall: async (request, handler) => {
      const span = trace.getTracer('gp-api.agents').startSpan(`chat ${model}`, {
        kind: SpanKind.CLIENT,
        attributes: {
          'gen_ai.operation.name': 'chat',
          'gen_ai.provider.name': providerOf(model),
          'gen_ai.request.model': model,
        },
      })
      try {
        const response = await context.with(
          trace.setSpan(context.active(), span),
          () => handler(request),
        )
        const usage = AIMessage.isInstance(response)
          ? response.usage_metadata
          : undefined
        if (usage) {
          span.setAttributes({
            'gen_ai.usage.input_tokens': usage.input_tokens,
            'gen_ai.usage.output_tokens': usage.output_tokens,
            'gen_ai.usage.cache_read.input_tokens':
              usage.input_token_details?.cache_read ?? 0,
            'gen_ai.usage.cache_creation.input_tokens':
              usage.input_token_details?.cache_creation ?? 0,
          })
        }
        return response
      } catch (err) {
        span.setStatus({ code: SpanStatusCode.ERROR })
        throw err
      } finally {
        span.end()
      }
    },
  })

const firstMessage = (
  stage: StageDefinition,
  view: Record<string, unknown>,
): BaseMessage =>
  new HumanMessage(
    stage.reads
      .map(
        (key) =>
          `<${key}>\n${JSON.stringify(view[key] ?? null, null, 2)}\n</${key}>`,
      )
      .join('\n\n'),
  )

export type StageGraphDeps = {
  checkpointer: BaseCheckpointSaver
  chatModel: (model: string) => BaseChatModel
  run: RunToolContext
}

// defineAgent's stages as a LangGraph graph: the input plus one state field
// per stage, one node per stage, edges from `next`. Each node runs the
// stage's own agent (createAgent) inside it, so the agent's loop saves under
// the node's checkpoint namespace in the same thread and a resume picks up
// at the agent's last saved step.
export const buildStageGraph = (
  definition: AgentDefinition,
  deps: StageGraphDeps,
) => {
  const State = Annotation.Root({
    input: Annotation<unknown>(),
    ...Object.fromEntries(
      Object.keys(definition.stages).map((name) => [
        stageField(name),
        Annotation<unknown>(),
      ]),
    ),
  })
  const graph = new StateGraph<
    typeof State.spec,
    Record<string, unknown>,
    Record<string, unknown>,
    string
  >(State)

  for (const [name, stage] of Object.entries(definition.stages)) {
    const agent = createAgent({
      model: deps.chatModel(stage.model),
      tools: stage.tools.map((t) => toLangChainTool(t, deps.run)),
      systemPrompt: loadAgentPrompt(stage.prompt),
      responseFormat: outputFormat(name, stage.output),
      middleware: [
        anthropicPromptCachingMiddleware({
          minMessagesToCache: 1,
          unsupportedModelBehavior: 'ignore',
        }),
        modelCallSpans(stage.model),
      ],
    })
    graph.addNode(
      name,
      async (state: Record<string, unknown>, config: LangGraphRunnableConfig) =>
        withStageSpan(
          { name, model: stage.model, provider: providerOf(stage.model) },
          async () => {
            const view = stageView(definition, state)
            const result = await agent.invoke(
              { messages: [firstMessage(stage, view)] },
              { ...config, recursionLimit: STAGE_RECURSION_LIMIT },
            )
            return {
              [stageField(name)]: stage.output.parse(result.structuredResponse),
            }
          },
        ),
    )
  }

  graph.addEdge(START, firstStage(definition))
  for (const [name, stage] of Object.entries(definition.stages)) {
    const next = stage.next
    if (next === undefined) {
      graph.addEdge(name, GRAPH_END)
    } else if (typeof next === 'string') {
      graph.addEdge(name, next === END ? GRAPH_END : next)
    } else {
      graph.addConditionalEdges(name, (state: Record<string, unknown>) => {
        const target = next(stageView(definition, state))
        return target === END ? GRAPH_END : target
      })
    }
  }

  return graph.compile({ checkpointer: deps.checkpointer })
}
