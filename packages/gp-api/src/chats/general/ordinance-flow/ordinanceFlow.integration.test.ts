import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ChatMessageRole,
  ChatMessageSegmentKind,
  ChatScope,
} from '../../../generated/prisma'
import {
  ChatStreamChunk,
  ChatStreamService,
} from '@/chats/services/chatStream.service'
import { ChatStoreService } from '@/chats/services/chatStore.prisma'
import { LlmService } from '@/llm/services/llm.service'
import { useTestService } from '@/test-service'
import { OrdinanceFlowSearchService } from './services/ordinanceFlowSearch.service'
import { OrdinanceFlowFetchService } from './services/ordinanceFlowFetch.service'

const service = useTestService()

const SCOPE = ChatScope.ordinance_flow

const seed = async (userId: number) => {
  const slug = `ord-eo-${userId}-${Math.random().toString(36).slice(2, 10)}`
  await service.prisma.organization.create({
    data: { slug, ownerId: userId, customPositionName: 'Council Member' },
  })
  const electedOffice = await service.prisma.electedOffice.create({
    data: { organizationSlug: slug, userId },
  })
  const ordinance = await service.prisma.ordinance.create({
    data: {
      electedOfficeId: electedOffice.id,
      seedType: 'new',
      goalText: 'Reduce late-night construction noise',
    },
  })
  return { slug, ordinanceId: ordinance.id }
}

const anchorFor = (ordinanceId: string, step: string) => ({
  resourceType: 'ordinance',
  resourceId: ordinanceId,
  url: `https://goodparty.org/ordinances/${ordinanceId}`,
  snapshot: { title: 'Noise ordinance', summary: 'Limit late-night noise.' },
  step,
})

const buildStream =
  (
    chunks: ChatStreamChunk[],
    hook: (conversationId: string) => Promise<void>,
  ) =>
  (args: { conversationId: string }): AsyncIterable<ChatStreamChunk> => ({
    [Symbol.asyncIterator]: async function* () {
      await hook(args.conversationId)
      for (const c of chunks) yield c
    },
  })

describe('ordinance_flow chat (integration)', () => {
  let slug: string
  let ordinanceId: string
  let headers: { headers: Record<string, string> }
  let chatStore: ChatStoreService

  beforeEach(async () => {
    ;({ slug, ordinanceId } = await seed(service.user.id))
    headers = { headers: { 'X-Organization-Slug': slug } }
    chatStore = service.app.get(ChatStoreService)

    const chatStream = service.app.get(ChatStreamService)
    vi.spyOn(chatStream, 'stream').mockImplementation(
      buildStream(
        [
          { type: 'text', delta: 'hello' },
          { type: 'done', assistantMessageId: 'asst-1' },
        ],
        async (conversationId) => {
          await chatStore.appendMessage({
            conversationId,
            role: ChatMessageRole.user,
            content: 'seeded',
          })
        },
      ) as never,
    )
  })

  it('creates one conversation per (ordinance, step) and resumes it', async () => {
    const anchor = anchorFor(ordinanceId, 'clarify')

    const first = await service.client.post(
      '/v1/chats',
      { scope: SCOPE, anchor },
      headers,
    )
    expect(first.status).toBe(HttpStatus.CREATED)
    expect(first.data.created).toBe(true)

    // Same (ordinance, step) resumes the same thread (real JSON anchor query).
    const again = await service.client.post(
      '/v1/chats',
      { scope: SCOPE, anchor },
      headers,
    )
    expect(again.data.created).toBe(false)
    expect(again.data.conversationId).toBe(first.data.conversationId)

    // A different step of the same ordinance is its own thread.
    const authority = await service.client.post(
      '/v1/chats',
      { scope: SCOPE, anchor: anchorFor(ordinanceId, 'authority') },
      headers,
    )
    expect(authority.data.created).toBe(true)
    expect(authority.data.conversationId).not.toBe(first.data.conversationId)
  })

  it('requires an ordinance anchor', async () => {
    const res = await service.client.post(
      '/v1/chats',
      { scope: SCOPE },
      headers,
    )
    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('round-trips a message, loading context from the ordinance record', async () => {
    const created = await service.client.post(
      '/v1/chats',
      { scope: SCOPE, anchor: anchorFor(ordinanceId, 'clarify') },
      headers,
    )
    const conversationId = created.data.conversationId as string

    const res = await service.client.post(
      `/v1/chats/${conversationId}/messages?scope=${SCOPE}`,
      { content: 'What should this ordinance cover?' },
      headers,
    )
    expect(res.status).toBe(HttpStatus.OK)
    expect(String(res.data)).toContain('hello')

    const messages = await chatStore.listMessagesByConversation(conversationId)
    expect(messages.some((m) => m.role === ChatMessageRole.user)).toBe(true)
  })

  it('rejects creating a conversation for another user’s ordinance', async () => {
    const otherUser = await service.prisma.user.create({
      data: { email: 'other-ordinance@goodparty.org' },
    })
    const other = await seed(otherUser.id)

    // Authenticated as service.user (via their org slug header), anchor to the
    // other user's ordinance: ownership is checked before create, so this 404s
    // and no ChatConversation row is written.
    const res = await service.client.post(
      '/v1/chats',
      { scope: SCOPE, anchor: anchorFor(other.ordinanceId, 'clarify') },
      headers,
    )
    expect(res.status).toBe(HttpStatus.NOT_FOUND)

    const conversations = await service.prisma.chatConversation.findMany({
      where: { scope: SCOPE },
    })
    expect(conversations).toHaveLength(0)
  })

  it('replays a clarify-question widget from the persisted segment payload', async () => {
    const created = await service.client.post(
      '/v1/chats',
      { scope: SCOPE, anchor: anchorFor(ordinanceId, 'clarify') },
      headers,
    )
    const conversationId = created.data.conversationId as string

    const question = {
      questionId: 'q1',
      question: 'What hours should the limit cover?',
      options: [{ label: '10pm to 7am' }, { label: '11pm to 6am' }],
    }
    await chatStore.appendMessage({
      conversationId,
      role: ChatMessageRole.assistant,
      content: "Let's start with the hours.",
      segments: [
        { kind: ChatMessageSegmentKind.text, text: "Let's start." },
        {
          kind: ChatMessageSegmentKind.tool,
          toolName: 'ask_clarify_question',
          payload: question,
        },
      ],
    })

    const replay = await service.client.get(
      `/v1/chats/${conversationId}?scope=${SCOPE}`,
      headers,
    )
    expect(replay.status).toBe(HttpStatus.OK)
    const withWidget = (
      replay.data.messages as Array<{
        segments?: Array<{
          toolName?: string
          payload?: { questionId?: string }
        }>
      }>
    )
      .flatMap((m) => m.segments ?? [])
      .find((s) => s.toolName === 'ask_clarify_question')
    expect(withWidget?.payload?.questionId).toBe('q1')
  })

  it('runs brave_search through the real stream pipeline on current_law', async () => {
    // The real ChatStreamService must drive the handler-built tools, so undo the
    // wholesale stream mock (from beforeEach) and fake only the LLM decision +
    // the two HTTP ports.
    vi.spyOn(service.app.get(ChatStreamService), 'stream').mockRestore()
    const priorKey = process.env.BRAVE_API_KEY
    process.env.BRAVE_API_KEY = 'test-brave-key'

    const searchSpy = vi
      .spyOn(service.app.get(OrdinanceFlowSearchService), 'search')
      .mockResolvedValue({
        ok: true,
        query: 'noise ordinance amlegal',
        results: [
          {
            title: 'Chapter 9.16 Noise',
            url: 'https://codelibrary.amlegal.com/codes/x/9.16',
            description: 'Regulates noise levels.',
          },
        ],
      })
    vi.spyOn(
      service.app.get(OrdinanceFlowFetchService),
      'fetchUrl',
    ).mockResolvedValue({
      ok: true,
      status: HttpStatus.OK,
      finalUrl: 'https://library.municode.com/x',
      contentType: 'text/html',
      content: '',
      truncated: false,
      totalChars: 0,
    })

    const query = 'noise ordinance amlegal'
    const finalText = 'Here is a server-rendered copy of the chapter.'
    vi.spyOn(
      service.app.get(LlmService),
      'streamChatCompletion',
    ).mockImplementation(async (opts) => {
      const fetchTool = opts.tools?.fetch_url
      if (fetchTool && 'execute' in fetchTool) {
        await fetchTool.execute({ url: 'https://library.municode.com/x' })
      }
      const braveTool = opts.tools?.brave_search
      if (braveTool && 'execute' in braveTool) {
        opts.onToolCallStart?.({ name: 'brave_search', input: { query } })
        const output = await braveTool.execute({ query })
        opts.onToolCallEnd?.({
          name: 'brave_search',
          input: { query },
          output,
        })
      }
      return {
        textStream: (async function* () {
          yield finalText
        })(),
        finalText: Promise.resolve(finalText),
        toolCalls: Promise.resolve([]),
        usage: Promise.resolve({
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        }),
        model: 'claude-sonnet-4-6',
      }
    })

    try {
      const created = await service.client.post(
        '/v1/chats',
        { scope: SCOPE, anchor: anchorFor(ordinanceId, 'current_law') },
        headers,
      )
      const conversationId = created.data.conversationId as string

      const res = await service.client.post(
        `/v1/chats/${conversationId}/messages?scope=${SCOPE}`,
        { content: 'Find where this code lives.' },
        headers,
      )
      expect(res.status).toBe(HttpStatus.OK)
      expect(searchSpy).toHaveBeenCalledWith(query, undefined)
      const body = String(res.data)
      expect(body).toContain('brave_search')
      expect(body).toContain(finalText)

      const replay = await service.client.get(
        `/v1/chats/${conversationId}?scope=${SCOPE}`,
        headers,
      )
      const braveSegment = (
        replay.data.messages as Array<{
          segments?: Array<{ toolName?: string }>
        }>
      )
        .flatMap((m) => m.segments ?? [])
        .find((s) => s.toolName === 'brave_search')
      expect(braveSegment).toBeDefined()
    } finally {
      if (priorKey === undefined) delete process.env.BRAVE_API_KEY
      else process.env.BRAVE_API_KEY = priorKey
    }
  }, 30000)

  it('round-trips a widget-only turn (empty content, tool segment) via replay', async () => {
    const created = await service.client.post(
      '/v1/chats',
      { scope: SCOPE, anchor: anchorFor(ordinanceId, 'comparables') },
      headers,
    )
    const conversationId = created.data.conversationId as string

    // Mirrors exactly what ChatStreamService persists on a clean widget-only
    // finish: zero text, a single present_* tool segment. This must survive the
    // real DB write AND the GET response schema (ChatConversationSchema allows
    // empty content) so the widget replays on reload — a fake store can't prove
    // either, and a future `content.min(1)` would silently break it.
    const comparables = { comparables: [{ city: 'Riverton', state: 'WA' }] }
    await chatStore.appendMessage({
      conversationId,
      role: ChatMessageRole.assistant,
      content: '',
      segments: [
        {
          kind: ChatMessageSegmentKind.tool,
          toolName: 'present_comparables',
          payload: comparables,
        },
      ],
    })

    const replay = await service.client.get(
      `/v1/chats/${conversationId}?scope=${SCOPE}`,
      headers,
    )
    expect(replay.status).toBe(HttpStatus.OK)
    const assistant = (
      replay.data.messages as Array<{
        role: ChatMessageRole
        content: string
        segments?: Array<{
          toolName?: string
          payload?: { comparables?: Array<{ city?: string }> }
        }>
      }>
    ).find((m) => m.role === ChatMessageRole.assistant)
    expect(assistant?.content).toBe('')
    const widget = (assistant?.segments ?? []).find(
      (s) => s.toolName === 'present_comparables',
    )
    expect(widget?.payload?.comparables?.[0]?.city).toBe('Riverton')
  })
})
