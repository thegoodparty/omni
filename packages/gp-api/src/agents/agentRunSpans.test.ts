import { ROOT_CONTEXT, trace } from '@opentelemetry/api'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
  type Span,
} from '@opentelemetry/sdk-trace-base'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  agentRunFromContext,
  agentRunSpanProcessor,
  contextWithAgentRun,
  instrumentTool,
  ToolRefusalError,
  withToolSpan,
} from './agentRunSpans'
import type { AgentTool } from './tools/tool'

const identity = { runId: 'run-1', agent: 'testAgent', shapeHash: 'abc' }

const recordingSpan = (initial: Record<string, unknown> = {}) => {
  const attributes: Record<string, unknown> = { ...initial }
  const span = {
    attributes,
    setAttributes: (values: Record<string, unknown>) => {
      Object.assign(attributes, values)
      return span
    },
  }
  return { attributes, span: span as unknown as Span }
}

describe('agentRunSpanProcessor', () => {
  it('stamps the run onto spans started inside it, and nothing else', () => {
    const inside = recordingSpan()
    agentRunSpanProcessor.onStart(
      inside.span,
      contextWithAgentRun(ROOT_CONTEXT, identity),
    )
    expect(inside.attributes).toEqual({
      'gen_ai.conversation.id': 'run-1',
      'gen_ai.agent.name': 'testAgent',
      'gen_ai.agent.version': 'abc',
      'agento11y.record': true,
    })

    const outside = recordingSpan()
    agentRunSpanProcessor.onStart(outside.span, ROOT_CONTEXT)
    expect(outside.attributes).toEqual({})
  })

  it('names a provider call inside a run as a chat generation, with no prompt text', () => {
    const call = recordingSpan({
      'gen_ai.system': 'anthropic.messages',
      'gen_ai.request.model': 'claude-sonnet-4-6',
    })
    agentRunSpanProcessor.onStart(
      call.span,
      contextWithAgentRun(ROOT_CONTEXT, identity),
    )
    expect(call.attributes).toMatchObject({
      'gen_ai.operation.name': 'chat',
      'gen_ai.provider.name': 'anthropic',
      'gen_ai.conversation.id': 'run-1',
    })
    expect(call.attributes).not.toHaveProperty('gen_ai.input.messages')
    expect(call.attributes).not.toHaveProperty('gen_ai.output.messages')
  })

  it('leaves an operation the caller already named alone', () => {
    const named = recordingSpan({
      'gen_ai.system': 'anthropic',
      'gen_ai.operation.name': 'invoke_agent',
    })
    agentRunSpanProcessor.onStart(
      named.span,
      contextWithAgentRun(ROOT_CONTEXT, identity),
    )
    expect(named.attributes['gen_ai.operation.name']).toBe('invoke_agent')
  })

  it('reads back only a well-formed identity', () => {
    expect(
      agentRunFromContext(contextWithAgentRun(ROOT_CONTEXT, identity)),
    ).toEqual(identity)
    expect(agentRunFromContext(ROOT_CONTEXT)).toBeUndefined()
  })
})

describe('instrumentTool', () => {
  const input = z.object({ q: z.string() })
  const ctx = {
    runId: 'run-1',
    stepKey: '3:echo:0',
    organizationSlug: 'eo-test',
    signal: new AbortController().signal,
    get: () => {
      throw new Error('unused')
    },
  }

  it('keeps the tool and passes its result through', async () => {
    const tool: AgentTool<typeof input> = {
      description: 'echo',
      input,
      execute: async ({ q }) => ({ said: q }),
    }
    const wrapped = instrumentTool('echo', tool)
    await expect(wrapped.execute({ q: 'hi' }, ctx)).resolves.toEqual({
      said: 'hi',
    })
  })

  it('rethrows the tool error', async () => {
    const tool: AgentTool<typeof input> = {
      description: 'broken',
      input,
      execute: async () => {
        throw new Error('down')
      },
    }
    await expect(
      instrumentTool('broken', tool).execute({ q: 'hi' }, ctx),
    ).rejects.toThrow('down')
  })
})

describe('a tool span reports whether the tool worked', () => {
  const input = z.object({ q: z.string() })
  const ctx = {
    runId: 'run-1',
    stepKey: '3:queryDatabricks:0',
    organizationSlug: 'eo-test',
    signal: new AbortController().signal,
    get: () => {
      throw new Error('unused')
    },
  }
  let exporter: InMemorySpanExporter
  let provider: BasicTracerProvider

  const toolSpan = (): ReadableSpan => {
    const spans = exporter
      .getFinishedSpans()
      .filter((s) => s.attributes['gen_ai.operation.name'] === 'execute_tool')
    expect(spans).toHaveLength(1)
    return spans[0] as ReadableSpan
  }

  const run = async (
    value: unknown | (() => Promise<unknown>),
  ): Promise<void> => {
    const tool: AgentTool<typeof input> = {
      description: 'read the warehouse',
      input,
      execute: async () =>
        typeof value === 'function'
          ? await (value as () => Promise<unknown>)()
          : value,
    }
    try {
      await instrumentTool('queryDatabricks', tool).execute({ q: 'hi' }, ctx)
    } catch {
      // the span is what this asserts, and a throw is one of the cases
    }
  }

  beforeEach(() => {
    exporter = new InMemorySpanExporter()
    provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    })
    trace.setGlobalTracerProvider(provider)
  })

  afterEach(() => {
    trace.disable()
  })

  it('marks a success ok with no reason', async () => {
    await run({ ok: true, rows: [] })

    expect(toolSpan().attributes).toMatchObject({
      'gen_ai.tool.name': 'queryDatabricks',
      'gen_ai.tool.ok': true,
    })
    expect(toolSpan().attributes).not.toHaveProperty('gen_ai.tool.reason')
  })

  it("records the tool's own reason code when it reports a failure", async () => {
    await run({ ok: false, reason: 'timeout', detail: 'the query passed' })

    expect(toolSpan().attributes).toMatchObject({
      'gen_ai.tool.ok': false,
      'gen_ai.tool.reason': 'timeout',
    })
  })

  it('marks a thrown tool failed, with reason thrown', async () => {
    await run(async () => {
      throw new Error('the warehouse is down')
    })

    expect(toolSpan().attributes).toMatchObject({
      'gen_ai.tool.ok': false,
      'gen_ai.tool.reason': 'thrown',
    })
  })

  it("names submitOutput's refusal by its code, never its message", async () => {
    await withToolSpan(
      'submitOutput',
      { runId: 'run-1', stepKey: '4:submitOutput:0' },
      async () => {
        throw new ToolRefusalError('schema', 'output.title: expected a string')
      },
    ).catch(() => undefined)

    expect(toolSpan().attributes).toMatchObject({
      'gen_ai.tool.ok': false,
      'gen_ai.tool.reason': 'schema',
    })
  })

  it('keeps no URL, SQL or page text, and no reason over 40 characters', async () => {
    await run({
      ok: false,
      reason: 'https://example.com/ward-2?x=1',
      detail:
        "every SELECT that reads gp_api_voters must guarantee Residence_Addresses_State = 'NC' in its own WHERE",
      url: 'https://example.com/a-page-that-was-refused',
      sql: 'SELECT COUNT(*) FROM goodparty_data_catalog.dbt.voters',
      content: 'the councillor said the drainage bond would pass in May',
    })

    const attributes = Object.values(toolSpan().attributes)
    for (const value of attributes) {
      if (typeof value !== 'string') continue
      expect(value.length).toBeLessThanOrEqual(40)
      expect(value).not.toContain('://')
      expect(value).not.toMatch(/SELECT|FROM|WHERE/i)
    }
    expect(toolSpan().attributes).toMatchObject({ 'gen_ai.tool.ok': false })
    expect(toolSpan().attributes).not.toHaveProperty('gen_ai.tool.reason')
  })

  it('caps an over-long code rather than clipping it into a reason', async () => {
    await run({
      ok: false,
      reason: 'a_reason_code_that_is_far_too_long_to_be_a_code',
    })

    expect(toolSpan().attributes).not.toHaveProperty('gen_ai.tool.reason')
  })
})
