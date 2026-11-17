import { HttpStatus } from '@nestjs/common'
import type { ModelMessage } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AgentMessageRole,
  ChatMessageSegmentKind,
  ChatScope,
} from '../../generated/prisma'
import {
  LlmService,
  LlmStreamOptions,
  LlmStreamResult,
} from '@/llm/services/llm.service'
import { useTestService } from '@/test-service'

const service = useTestService()

const COS = ChatScope.chief_of_staff

const usage = (inputTokens: number, outputTokens: number) => ({
  inputTokens,
  outputTokens,
  totalTokens: inputTokens + outputTokens,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
})

// One tool call (with a real result) and then the reply, the way the AI SDK
// reports a two-step turn.
const toolTurn =
  (toolCallId: string) =>
  async (options: LlmStreamOptions): Promise<LlmStreamResult> => {
    options.onToolCallStart?.({
      name: 'lookup_agenda',
      input: { item: 2 },
      toolCallId,
    })
    options.onToolCallEnd?.({
      name: 'lookup_agenda',
      input: { item: 2 },
      output: { fiscalImpact: '$40k' },
      toolCallId,
    })
    const responseMessages: ModelMessage[] = [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId,
            toolName: 'lookup_agenda',
            input: { item: 2 },
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId,
            toolName: 'lookup_agenda',
            output: { type: 'json', value: { fiscalImpact: '$40k' } },
          },
        ],
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'It costs $40k.' }],
      },
    ]
    return {
      textStream: (async function* () {
        yield 'It costs $40k.'
      })(),
      finalText: Promise.resolve('It costs $40k.'),
      toolCalls: Promise.resolve([]),
      usage: Promise.resolve(usage(300, 50)),
      responseMessages: Promise.resolve(responseMessages),
      stepUsages: Promise.resolve([usage(100, 20), usage(200, 30)]),
      model: 'claude-sonnet-4-6',
    }
  }

describe('chat on AgentMessage', () => {
  let headers: { headers: Record<string, string> }

  beforeEach(async () => {
    const slug = `eo-${service.user.id}-${Math.random().toString(36).slice(2, 10)}`
    await service.prisma.organization.create({
      data: { slug, ownerId: service.user.id, customPositionName: 'Mayor' },
    })
    await service.prisma.electedOffice.create({
      data: { organizationSlug: slug, userId: service.user.id },
    })
    headers = { headers: { 'X-Organization-Slug': slug } }
  })

  const createAndSend = async (toolCallId: string) => {
    vi.spyOn(
      service.app.get(LlmService),
      'streamChatCompletion',
    ).mockImplementation(toolTurn(toolCallId))
    const created = await service.client.post(
      '/v1/chats',
      { scope: COS },
      headers,
    )
    const conversationId = created.data.conversationId as string
    const sent = await service.client.post(
      `/v1/chats/${conversationId}/messages?scope=${COS}`,
      { content: 'What does item 2 cost?' },
      headers,
    )
    expect(sent.status).toBe(HttpStatus.OK)
    return conversationId
  }

  it('writes every turn to both tables, with the real tool result and per-step usage', async () => {
    const conversationId = await createAndSend('call-1')

    const chat = await service.prisma.chatMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    })
    const rows = await service.prisma.agentMessage.findMany({
      where: { conversationId },
      orderBy: { index: 'asc' },
    })
    expect(rows.map((r) => [r.index, r.role])).toEqual([
      [0, AgentMessageRole.user],
      [1, AgentMessageRole.assistant],
      [2, AgentMessageRole.tool],
      [3, AgentMessageRole.assistant],
    ])
    expect(rows[0]!.id).toBe(chat[0]!.id)
    expect(rows[3]!.id).toBe(chat[1]!.id)
    expect(rows[2]!.parts).toEqual([
      {
        type: 'tool-result',
        toolCallId: 'call-1',
        toolName: 'lookup_agenda',
        output: { type: 'json', value: { fiscalImpact: '$40k' } },
      },
    ])
    expect(rows[1]).toMatchObject({
      model: 'claude-sonnet-4-6',
      inputTokens: 100,
      outputTokens: 20,
    })
    expect(rows[3]).toMatchObject({ inputTokens: 200, outputTokens: 30 })
  })

  it('serves history, pills and usage from AgentMessage', async () => {
    const conversationId = await createAndSend('call-2')
    const history = await service.client.get(
      `/v1/chats/${conversationId}?scope=${COS}`,
      headers,
    )
    expect(history.status).toBe(HttpStatus.OK)
    expect(history.data.messages[1].segments).toEqual([
      {
        kind: ChatMessageSegmentKind.tool,
        text: null,
        toolName: 'lookup_agenda',
        toolCallId: 'call-2',
        payload: { item: 2 },
      },
      {
        kind: ChatMessageSegmentKind.text,
        text: 'It costs $40k.',
        toolName: null,
      },
    ])
    expect(history.data.usage).toEqual({
      complete: true,
      byModel: [
        { model: 'claude-sonnet-4-6', inputTokens: 300, outputTokens: 50 },
      ],
    })
  })

  it('rates a reply by the same id', async () => {
    const conversationId = await createAndSend('call-3')
    const history = await service.client.get(
      `/v1/chats/${conversationId}?scope=${COS}`,
      headers,
    )
    const assistantId = history.data.messages[1].id as string
    const set = await service.client.put(
      `/v1/chats/${conversationId}/messages/${assistantId}/feedback?scope=${COS}`,
      { feedback: 'positive' },
      headers,
    )
    expect(set.status).toBe(HttpStatus.OK)
    const reread = await service.client.get(
      `/v1/chats/${conversationId}?scope=${COS}`,
      headers,
    )
    expect(reread.data.messages[1].feedback).toEqual({
      feedback: 'positive',
      comment: null,
    })
  })

  it('replays the next turn from the tool results it stored', async () => {
    const llm = service.app.get(LlmService)
    const conversationId = await createAndSend('call-4')
    const seen: unknown[] = []
    vi.spyOn(llm, 'streamChatCompletion').mockImplementation(
      async (options) => {
        seen.push(options.messages)
        return toolTurn(`next-${seen.length}`)(options)
      },
    )
    await service.client.post(
      `/v1/chats/${conversationId}/messages?scope=${COS}`,
      { content: 'And item 3?' },
      headers,
    )
    const [history] = seen as unknown[][]
    // The stored user turn and reply, then the turn being sent, all from parts.
    expect(history!.slice(1)).toEqual([
      { role: 'user', content: 'What does item 2 cost?' },
      { role: 'assistant', content: 'It costs $40k.' },
      { role: 'user', content: 'And item 3?' },
    ])
  })
})
