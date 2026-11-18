import {
  type Attributes,
  type Context,
  ROOT_CONTEXT,
  type Span,
  type SpanOptions,
  type Tracer,
  trace,
} from '@opentelemetry/api'

// Grafana Agent Observability ingests a span only when it carries
// agento11y.record=true, and it groups spans into one conversation by
// gen_ai.conversation.id. Without these the AI SDK's spans stay plain Tempo
// traces and never reach the app.
//
// Content stays out. The SDK writes gen_ai.input.messages and
// gen_ai.output.messages only when recordInputs/recordOutputs allow it, which
// llmTelemetry turns off because prompts here carry voter data.

export interface AgentTraceIdentity {
  conversationId: string
  agentName: string
}

// The AI SDK sets gen_ai.system (e.g. 'anthropic.messages') only on the
// provider call, and no operation anywhere, while the app keys spans on
// gen_ai.operation.name with gen_ai.provider.name. So: a tool call is its own
// operation carrying the tool's name but never its arguments, the provider call
// is the generation, and the surrounding step is the agent invocation.
const operationAttributes = (attributes?: Attributes): Attributes => {
  if (attributes?.['gen_ai.operation.name'] !== undefined) return {}
  const toolName = attributes?.['ai.toolCall.name']
  if (typeof toolName === 'string') {
    return {
      'gen_ai.operation.name': 'execute_tool',
      'gen_ai.tool.name': toolName,
    }
  }
  const system = attributes?.['gen_ai.system']
  if (typeof system === 'string') {
    return {
      'gen_ai.operation.name': 'chat',
      'gen_ai.provider.name': system.split('.')[0] ?? system,
    }
  }
  const provider = attributes?.['ai.model.provider']
  if (typeof provider !== 'string') return {}
  return {
    'gen_ai.operation.name': 'invoke_agent',
    'gen_ai.provider.name': provider.split('.')[0] ?? provider,
  }
}

class AgentTraceTracer implements Tracer {
  constructor(
    private readonly identity: AgentTraceIdentity,
    private readonly delegate: Tracer,
  ) {}

  private options(options?: SpanOptions): SpanOptions {
    const attributes = options?.attributes
    return {
      ...options,
      attributes: {
        ...attributes,
        ...operationAttributes(attributes),
        'agento11y.record': true,
        'gen_ai.conversation.id': this.identity.conversationId,
        'gen_ai.agent.name': this.identity.agentName,
      },
    }
  }

  startSpan(name: string, options?: SpanOptions, ctx?: Context): Span {
    return this.delegate.startSpan(name, this.options(options), ctx)
  }

  startActiveSpan<F extends (span: Span) => unknown>(
    name: string,
    fn: F,
  ): ReturnType<F>
  startActiveSpan<F extends (span: Span) => unknown>(
    name: string,
    options: SpanOptions,
    fn: F,
  ): ReturnType<F>
  startActiveSpan<F extends (span: Span) => unknown>(
    name: string,
    options: SpanOptions,
    ctx: Context,
    fn: F,
  ): ReturnType<F>
  startActiveSpan<F extends (span: Span) => unknown>(
    name: string,
    a?: SpanOptions | F,
    b?: Context | F,
    c?: F,
  ): ReturnType<F> {
    if (typeof a === 'function') {
      return this.delegate.startActiveSpan(name, this.options(), a)
    }
    if (typeof b === 'function') {
      return this.delegate.startActiveSpan(name, this.options(a), b)
    }
    if (typeof c !== 'function') {
      throw new Error('startActiveSpan requires a callback')
    }
    return this.delegate.startActiveSpan(
      name,
      this.options(a),
      b ?? ROOT_CONTEXT,
      c,
    )
  }
}

// Handed to the AI SDK as experimental_telemetry.tracer: the one hook that
// reaches every span it starts — each generation, each tool call, the outer
// step — rather than only the ones a caller names. Delegating to the tracer the
// SDK would have used itself leaves export to otel.ts untouched; this only adds
// attributes.
export const agentTraceTracer = (
  identity: AgentTraceIdentity,
  delegate: Tracer = trace.getTracer('ai'),
): Tracer => new AgentTraceTracer(identity, delegate)
