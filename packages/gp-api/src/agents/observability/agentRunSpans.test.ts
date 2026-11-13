import { ROOT_CONTEXT } from '@opentelemetry/api'
import type { Span } from '@opentelemetry/sdk-trace-base'
import type { ModuleRef } from '@nestjs/core'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { AgentTool } from '@/agents/tools/tool'
import {
  agentRunFromContext,
  agentRunSpanProcessor,
  contextWithAgentRun,
  instrumentTool,
} from './agentRunSpans'

const identity = { runId: 'run-1', agent: 'meetingBriefing', shapeHash: 'abc' }

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
      'gen_ai.agent.name': 'meetingBriefing',
      'gen_ai.agent.version': 'abc',
      'agento11y.record': true,
    })

    const outside = recordingSpan()
    agentRunSpanProcessor.onStart(outside.span, ROOT_CONTEXT)
    expect(outside.attributes).toEqual({})
  })

  it('names a provider call inside a run as a chat generation', () => {
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
    stepKey: 'readPacket:3',
    organizationSlug: 'eo-test',
    signal: new AbortController().signal,
    moduleRef: {} as ModuleRef,
  }

  it('keeps the tool and passes its result through', async () => {
    const tool: AgentTool<typeof input> = {
      name: 'echo',
      description: 'echo',
      input,
      execute: async ({ q }) => ({ said: q }),
    }
    const wrapped = instrumentTool(tool)
    expect(wrapped.name).toBe('echo')
    await expect(wrapped.execute({ q: 'hi' }, ctx)).resolves.toEqual({
      said: 'hi',
    })
  })

  it('rethrows the tool error', async () => {
    const tool: AgentTool<typeof input> = {
      name: 'broken',
      description: 'broken',
      input,
      execute: async () => {
        throw new Error('down')
      },
    }
    await expect(
      instrumentTool(tool).execute({ q: 'hi' }, ctx),
    ).rejects.toThrow('down')
  })
})
