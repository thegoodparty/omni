import { createAnthropic } from '@ai-sdk/anthropic'
import { HttpStatus } from '@nestjs/common'
import { simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  AgentMessageRole,
  ChatMessageSegmentKind,
  ChatScope,
} from '../../generated/prisma'
import { LlmService } from '@/llm/services/llm.service'
import { useTestService } from '@/test-service'

const service = useTestService()

const COS = ChatScope.chief_of_staff

type ScriptCall = {
  id: string
  name: string
  input: Record<string, unknown>
  providerExecuted?: boolean
}

// One model step as Anthropic streams it. A web search's result arrives at
// the start of the step after its call, as it does from the real API.
type ScriptStep = {
  providerResults?: string[]
  text?: string
  calls?: ScriptCall[]
  failMidStream?: boolean
}

const scriptedModel = (script: ScriptStep[]) => {
  let step = 0
  return new MockLanguageModelV3({
    doStream: async () => {
      const s = script[step] ?? {}
      step += 1
      const chunks: unknown[] = [{ type: 'stream-start', warnings: [] }]
      for (const id of s.providerResults ?? []) {
        chunks.push({
          type: 'tool-result',
          toolCallId: id,
          toolName: 'web_search',
          result: [
            {
              type: 'web_search_result',
              url: 'https://example.gov/agenda',
              title: 'Council agenda',
              pageAge: null,
              encryptedContent: 'enc',
            },
          ],
          providerExecuted: true,
        })
      }
      if (s.text !== undefined) {
        chunks.push({ type: 'text-start', id: `t-${step}` })
        chunks.push({ type: 'text-delta', id: `t-${step}`, delta: s.text })
        if (s.failMidStream) {
          chunks.push({ type: 'error', error: new Error('overloaded') })
        }
        chunks.push({ type: 'text-end', id: `t-${step}` })
      }
      for (const call of s.calls ?? []) {
        chunks.push({
          type: 'tool-call',
          toolCallId: call.id,
          toolName: call.name,
          input: JSON.stringify(call.input),
          ...(call.providerExecuted && { providerExecuted: true }),
        })
      }
      chunks.push({
        type: 'finish',
        finishReason: {
          unified: (s.calls ?? []).length > 0 ? 'tool-calls' : 'stop',
          raw: undefined,
        },
        usage: {
          inputTokens: {
            total: 100,
            noCache: 100,
            cacheRead: 0,
            cacheWrite: 0,
          },
          outputTokens: { total: 2, text: 2, reasoning: undefined },
        },
      })
      return {
        stream: simulateReadableStream({ chunks: chunks as never[] }),
      }
    },
  })
}

type ProviderSlot = { anthropicProvider: unknown }

describe('chat turns stored on AgentMessage from the real model loop', () => {
  let headers: { headers: Record<string, string> }
  let originalProvider: unknown

  beforeEach(async () => {
    const slug = `tm-${service.user.id}-${Math.random().toString(36).slice(2, 10)}`
    await service.prisma.organization.create({
      data: { slug, ownerId: service.user.id, customPositionName: 'Mayor' },
    })
    await service.prisma.electedOffice.create({
      data: { organizationSlug: slug, userId: service.user.id },
    })
    headers = { headers: { 'X-Organization-Slug': slug } }
    originalProvider = (service.app.get(LlmService) as unknown as ProviderSlot)
      .anthropicProvider
  })

  afterEach(() => {
    ;(
      service.app.get(LlmService) as unknown as ProviderSlot
    ).anthropicProvider = originalProvider
  })

  const send = async (script: ScriptStep[], content: string) => {
    const anthropic = createAnthropic({ apiKey: 'test' })
    const model = scriptedModel(script)
    ;(
      service.app.get(LlmService) as unknown as ProviderSlot
    ).anthropicProvider = {
      languageModel: () => model,
      webSearchTool: (spec: { maxUses?: number }) =>
        anthropic.tools.webSearch_20250305(spec),
    }
    const created = await service.client.post(
      '/v1/chats',
      { scope: COS },
      headers,
    )
    const conversationId = created.data.conversationId as string
    const sent = await service.client.post(
      `/v1/chats/${conversationId}/messages?scope=${COS}`,
      { content },
      headers,
    )
    expect(sent.status).toBe(HttpStatus.OK)
    const rows = await service.prisma.agentMessage.findMany({
      where: { conversationId },
      orderBy: { index: 'asc' },
    })
    const history = await service.client.get(
      `/v1/chats/${conversationId}?scope=${COS}`,
      headers,
    )
    return { rows, history: history.data }
  }

  const partTypes = (parts: unknown): string[] =>
    (parts as Array<{ type: string; toolCallId?: string }>).map((p) =>
      p.toolCallId ? `${p.type}:${p.toolCallId}` : p.type,
    )

  it('stores parallel tool calls with their results', async () => {
    const { rows, history } = await send(
      [
        {
          calls: [
            { id: 'brief-1', name: 'list_briefings', input: {} },
            { id: 'issues-1', name: 'read_community_issues', input: {} },
          ],
        },
        { text: 'No briefings or issues yet.' },
      ],
      'What is new?',
    )
    expect(rows.map((r) => r.role)).toEqual([
      AgentMessageRole.user,
      AgentMessageRole.assistant,
      AgentMessageRole.tool,
      AgentMessageRole.assistant,
    ])
    expect(partTypes(rows[1]!.parts)).toEqual([
      'tool-call:brief-1',
      'tool-call:issues-1',
    ])
    expect(partTypes(rows[2]!.parts)).toEqual([
      'tool-result:brief-1',
      'tool-result:issues-1',
    ])
    expect(history.messages[1].content).toBe('No briefings or issues yet.')
    expect(
      history.messages[1].segments.map(
        (s: { kind: string; toolCallId: string | null }) => [
          s.kind,
          s.toolCallId,
        ],
      ),
    ).toEqual([
      [ChatMessageSegmentKind.tool, 'brief-1'],
      [ChatMessageSegmentKind.tool, 'issues-1'],
      [ChatMessageSegmentKind.text, undefined],
    ])
  })

  it('stores a web search whose result arrives in the next step', async () => {
    const { rows, history } = await send(
      [
        {
          calls: [
            { id: 'brief-2', name: 'list_briefings', input: {} },
            {
              id: 'srv-1',
              name: 'web_search',
              input: { query: 'council agenda' },
              providerExecuted: true,
            },
          ],
        },
        { providerResults: ['srv-1'], text: 'The council meets Tuesday.' },
      ],
      'When does the council meet?',
    )
    expect(rows.map((r) => r.role)).toEqual([
      AgentMessageRole.user,
      AgentMessageRole.assistant,
      AgentMessageRole.tool,
      AgentMessageRole.assistant,
    ])
    expect(partTypes(rows[1]!.parts)).toEqual([
      'tool-call:brief-2',
      'tool-call:srv-1',
    ])
    expect(partTypes(rows[2]!.parts)).toEqual(['tool-result:brief-2'])
    expect(partTypes(rows[3]!.parts)).toEqual(['tool-result:srv-1', 'text'])
    expect(
      history.messages[1].segments.map(
        (s: { kind: string; toolName: string | null }) => [s.kind, s.toolName],
      ),
    ).toEqual([
      [ChatMessageSegmentKind.tool, 'list_briefings'],
      [ChatMessageSegmentKind.tool, 'web_search'],
      [ChatMessageSegmentKind.text, null],
    ])
  })

  it('stores a card turn that ends on an empty step and keeps its usage', async () => {
    const { rows, history } = await send(
      [
        {
          text: 'Let me ask you one thing.',
          calls: [
            {
              id: 'card-1',
              name: 'ask_clarify_question',
              input: {
                questionId: 'focus',
                question: 'Which issue matters most?',
                options: [{ label: 'Roads' }, { label: 'Water' }],
              },
            },
          ],
        },
        {},
      ],
      'Help me choose a focus',
    )
    expect(rows.map((r) => r.role)).toEqual([
      AgentMessageRole.user,
      AgentMessageRole.assistant,
      AgentMessageRole.tool,
    ])
    expect(partTypes(rows[1]!.parts)).toEqual(['text', 'tool-call:card-1'])
    expect(partTypes(rows[2]!.parts)).toEqual(['tool-result:card-1'])
    expect(rows[1]).toMatchObject({ inputTokens: 200, outputTokens: 4 })
    expect(history.messages[1].id).toBe(rows[1]!.id)
    expect(history.messages[1].content).toBe('Let me ask you one thing.')
    expect(history.messages[1].segments[1]).toMatchObject({
      kind: ChatMessageSegmentKind.tool,
      toolName: 'ask_clarify_question',
      toolCallId: 'card-1',
      payload: {
        questionId: 'focus',
        question: 'Which issue matters most?',
        options: [{ label: 'Roads' }, { label: 'Water' }],
        multiSelect: false,
      },
    })
  })

  it('stores the legal disclaimer appendix in the last assistant row', async () => {
    const { rows, history } = await send(
      [
        { calls: [{ id: 'brief-3', name: 'list_briefings', input: {} }] },
        { text: 'Under RCW 42.30 the meeting must be public.' },
      ],
      'Does the meeting have to be public?',
    )
    expect(rows.map((r) => r.role)).toEqual([
      AgentMessageRole.user,
      AgentMessageRole.assistant,
      AgentMessageRole.tool,
      AgentMessageRole.assistant,
    ])
    const lastText = (rows[3]!.parts as Array<{ text?: string }>)
      .map((p) => p.text ?? '')
      .join('')
    expect(
      lastText.startsWith('Under RCW 42.30 the meeting must be public.'),
    ).toBe(true)
    expect(lastText.length).toBeGreaterThan(
      'Under RCW 42.30 the meeting must be public.'.length,
    )
    expect(history.messages[1].content).toBe(lastText)
  })

  it('stores an interrupted tool turn without tool results', async () => {
    const { rows, history } = await send(
      [
        { calls: [{ id: 'brief-4', name: 'list_briefings', input: {} }] },
        { text: 'Partial answer', failMidStream: true },
      ],
      'What is new?',
    )
    expect(rows.map((r) => r.role)).toEqual([
      AgentMessageRole.user,
      AgentMessageRole.assistant,
    ])
    expect(history.messages).toHaveLength(2)
  })
})
