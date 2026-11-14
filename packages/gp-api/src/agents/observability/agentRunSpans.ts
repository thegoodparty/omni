import {
  type Attributes,
  type Context,
  context,
  createContextKey,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api'
import type {
  ReadableSpan,
  Span,
  SpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import type { AgentTool } from '../tools/tool'

// Grafana Agent Observability groups spans into one conversation by
// gen_ai.conversation.id and only ingests spans that carry
// agento11y.record=true (its OTLP path). Prompt and reply text are never set:
// no gen_ai.input.messages, gen_ai.output.messages, tool arguments or results.

export type AgentRunIdentity = {
  runId: string
  agent: string
  shapeHash: string
}

const AGENT_RUN = createContextKey('gp.agent.run')
const tracer = () => trace.getTracer('gp-api.agents')

const isAgentRunIdentity = (value: unknown): value is AgentRunIdentity =>
  typeof value === 'object' &&
  value !== null &&
  'runId' in value &&
  typeof value.runId === 'string' &&
  'agent' in value &&
  typeof value.agent === 'string' &&
  'shapeHash' in value &&
  typeof value.shapeHash === 'string'

export const agentRunAttributes = (identity: AgentRunIdentity): Attributes => ({
  'gen_ai.conversation.id': identity.runId,
  'gen_ai.agent.name': identity.agent,
  'gen_ai.agent.version': identity.shapeHash,
  'agento11y.record': true,
})

export const agentRunFromContext = (
  ctx: Context = context.active(),
): AgentRunIdentity | undefined => {
  const value = ctx.getValue(AGENT_RUN)
  return isAgentRunIdentity(value) ? value : undefined
}

export const contextWithAgentRun = (
  ctx: Context,
  identity: AgentRunIdentity,
): Context => ctx.setValue(AGENT_RUN, identity)

export const withAgentRun = <T>(
  identity: AgentRunIdentity,
  fn: () => Promise<T>,
): Promise<T> =>
  context.with(contextWithAgentRun(context.active(), identity), fn)

// Registered in otel.ts. Stamps the run onto every span started inside
// withAgentRun, so an engine's own model-call spans join the conversation
// without the engine knowing about it.
//
// It also names a provider call as a generation when the caller only set the
// older gen_ai.system (the AI SDK's doGenerate/doStream spans do), since the
// OTLP path keys generations on gen_ai.operation.name and
// gen_ai.provider.name.
export const agentRunSpanProcessor: SpanProcessor = {
  onStart: (span: Span, parentContext: Context) => {
    const identity = agentRunFromContext(parentContext)
    if (!identity) return
    span.setAttributes(agentRunAttributes(identity))
    const system = span.attributes['gen_ai.system']
    if (
      typeof system === 'string' &&
      span.attributes['gen_ai.operation.name'] === undefined
    ) {
      span.setAttributes({
        'gen_ai.operation.name': 'chat',
        'gen_ai.provider.name': system.split('.')[0] ?? system,
      })
    }
  },
  onEnd: (_span: ReadableSpan) => undefined,
  forceFlush: () => Promise.resolve(),
  shutdown: () => Promise.resolve(),
}

const inSpan = async <T>(
  name: string,
  attributes: Attributes,
  fn: () => Promise<T>,
): Promise<T> =>
  tracer().startActiveSpan(
    name,
    { kind: SpanKind.INTERNAL, attributes },
    async (span) => {
      try {
        return await fn()
      } catch (err) {
        span.setStatus({ code: SpanStatusCode.ERROR })
        span.setAttribute(
          'error.type',
          err instanceof Error ? err.name : 'unknown',
        )
        throw err
      } finally {
        span.end()
      }
    },
  )

export const withInvokeAgentSpan = <T>(
  agent: { name: string; model: string; provider: string },
  fn: () => Promise<T>,
): Promise<T> =>
  inSpan(
    `invoke_agent ${agent.name}`,
    {
      'gen_ai.operation.name': 'invoke_agent',
      'gen_ai.provider.name': agent.provider,
      'gen_ai.request.model': agent.model,
    },
    fn,
  )

export const instrumentTool = (tool: AgentTool): AgentTool => ({
  ...tool,
  execute: (input, ctx) =>
    inSpan(
      `execute_tool ${tool.name}`,
      {
        'gen_ai.operation.name': 'execute_tool',
        'gen_ai.tool.name': tool.name,
        'gen_ai.tool.call.id': `${ctx.runId}:${ctx.stepKey}`,
      },
      () => tool.execute(input, ctx),
    ),
})
