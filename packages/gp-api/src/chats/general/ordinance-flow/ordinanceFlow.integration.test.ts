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
import { useTestService } from '@/test-service'

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
})
