import { randomUUID } from 'node:crypto'
import { HttpStatus } from '@nestjs/common'
import {
  AgentMessageRole,
  ChatMessageRole,
  ChatMessageSegmentKind,
  ChatScope,
  ElectedOffice,
  OrganizationRole,
} from '../../../generated/prisma'
import jwt from 'jsonwebtoken'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ChatStreamChunk,
  ChatStreamService,
} from '@/chats/services/chatStream.service'
import { ChatStoreService } from '@/chats/services/chatStore.prisma'
import { LlmService, LlmStreamResult } from '@/llm/services/llm.service'
import { useTestService } from '@/test-service'

const service = useTestService()

interface Fixtures {
  slug: string
  electedOffice: ElectedOffice
}

const createOrgAndElectedOffice = async (userId: number): Promise<Fixtures> => {
  const slug = `eo-${userId}-${Math.random().toString(36).slice(2, 10)}`
  await service.prisma.organization.create({
    data: { slug, ownerId: userId, customPositionName: 'Council Member' },
  })
  const electedOffice = await service.prisma.electedOffice.create({
    data: { organizationSlug: slug, userId },
  })
  return { slug, electedOffice }
}

const createOrgAndCampaign = async (
  userId: number,
): Promise<{ slug: string }> => {
  const slug = `cam-${userId}-${Math.random().toString(36).slice(2, 10)}`
  await service.prisma.organization.create({
    data: { slug, ownerId: userId },
  })
  await service.prisma.campaign.create({
    data: { organizationSlug: slug, slug, userId },
  })
  return { slug }
}

const buildStream =
  (
    chunks: ChatStreamChunk[],
    hook?: (args: {
      conversationId: string
      userMessage: string
    }) => Promise<void>,
  ): ((args: {
    conversationId: string
    userMessage: string
  }) => AsyncIterable<ChatStreamChunk>) =>
  (args) => ({
    [Symbol.asyncIterator]: async function* () {
      if (hook) await hook(args)
      for (const c of chunks) yield c
    },
  })

const COS_SCOPE = ChatScope.chief_of_staff

const pricedTurn = (
  model: string,
  inputTokens: number,
  outputTokens: number,
): LlmStreamResult => ({
  textStream: (async function* () {
    yield 'A priced reply.'
  })(),
  finalText: Promise.resolve('A priced reply.'),
  toolCalls: Promise.resolve([]),
  usage: Promise.resolve({
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  }),
  model,
})

describe('GeneralChatsController (integration)', () => {
  let fixtures: Fixtures
  let chatStream: ChatStreamService
  let chatStore: ChatStoreService
  let headers: { headers: Record<string, string> }

  beforeEach(async () => {
    fixtures = await createOrgAndElectedOffice(service.user.id)
    headers = { headers: { 'X-Organization-Slug': fixtures.slug } }

    chatStream = service.app.get(ChatStreamService)
    chatStore = service.app.get(ChatStoreService)

    vi.spyOn(chatStream, 'stream').mockImplementation(
      buildStream(
        [
          { type: 'text', delta: 'hello' },
          { type: 'done', assistantMessageId: 'asst-1' },
        ],
        async ({ conversationId, userMessage }) => {
          await chatStore.appendMessage({
            conversationId,
            role: ChatMessageRole.user,
            content: userMessage,
          })
        },
      ) as never,
    )
  })

  describe('POST /v1/chats (always creates a new conversation)', () => {
    it('creates a distinct CoS conversation on each call', async () => {
      const first = await service.client.post(
        '/v1/chats',
        { scope: COS_SCOPE },
        headers,
      )
      expect(first.status).toBe(HttpStatus.CREATED)
      expect(first.data.created).toBe(true)
      expect(typeof first.data.conversationId).toBe('string')

      const second = await service.client.post(
        '/v1/chats',
        { scope: COS_SCOPE },
        headers,
      )
      expect(second.data.created).toBe(true)
      expect(second.data.conversationId).not.toBe(first.data.conversationId)

      const row = await service.prisma.chatConversation.findUnique({
        where: { id: first.data.conversationId },
      })
      expect(row?.scope).toBe(COS_SCOPE)
      expect(row?.organizationSlug).toBe(fixtures.slug)
    })

    it('requires the organization slug header', async () => {
      const res = await service.client.post('/v1/chats', { scope: COS_SCOPE })
      expect(res.status).toBe(HttpStatus.NOT_FOUND)
    })
  })

  describe('POST /v1/chats (campaign_assistant scope, Win candidate)', () => {
    it('creates a conversation for a candidate with a campaign and no elected office', async () => {
      const { slug } = await createOrgAndCampaign(service.user.id)
      const camHeaders = { headers: { 'X-Organization-Slug': slug } }

      const res = await service.client.post(
        '/v1/chats',
        { scope: ChatScope.campaign_assistant },
        camHeaders,
      )
      expect(res.status).toBe(HttpStatus.CREATED)
      expect(res.data.created).toBe(true)

      const row = await service.prisma.chatConversation.findUnique({
        where: { id: res.data.conversationId as string },
      })
      expect(row?.scope).toBe(ChatScope.campaign_assistant)
      expect(row?.organizationSlug).toBe(slug)
    })
  })

  describe('GET /v1/chats (history list)', () => {
    it('lists scoped conversations with titles after a message', async () => {
      const created = await service.client.post(
        '/v1/chats',
        { scope: COS_SCOPE },
        headers,
      )
      const conversationId = created.data.conversationId as string

      await service.client.post(
        `/v1/chats/${conversationId}/messages?scope=${COS_SCOPE}`,
        { content: 'Help me prep for the housing vote' },
        headers,
      )

      const history = await service.client.get(
        `/v1/chats?scope=${COS_SCOPE}`,
        headers,
      )
      expect(history.status).toBe(HttpStatus.OK)
      const conversations = history.data.conversations as Array<{
        conversationId: string
        title: string | null
      }>
      const match = conversations.find(
        (c) => c.conversationId === conversationId,
      )
      expect(match?.title).toBe('Help me prep for the housing vote')
    })
  })

  describe('GET /v1/chats/:id (replay) + DELETE (soft delete)', () => {
    it('replays then soft-deletes, after which replay 404s', async () => {
      const created = await service.client.post(
        '/v1/chats',
        { scope: COS_SCOPE },
        headers,
      )
      const conversationId = created.data.conversationId as string

      await service.client.post(
        `/v1/chats/${conversationId}/messages?scope=${COS_SCOPE}`,
        { content: 'First message' },
        headers,
      )

      const replay = await service.client.get(
        `/v1/chats/${conversationId}?scope=${COS_SCOPE}`,
        headers,
      )
      expect(replay.status).toBe(HttpStatus.OK)
      expect(replay.data.scope).toBe(COS_SCOPE)
      expect(
        (replay.data.messages as Array<{ role: string }>).some(
          (m) => m.role === ChatMessageRole.user,
        ),
      ).toBe(true)

      const del = await service.client.delete(
        `/v1/chats/${conversationId}?scope=${COS_SCOPE}`,
        headers,
      )
      expect(del.status).toBe(HttpStatus.NO_CONTENT)

      const afterDelete = await service.client.get(
        `/v1/chats/${conversationId}?scope=${COS_SCOPE}`,
        headers,
      )
      expect(afterDelete.status).toBe(HttpStatus.NOT_FOUND)
    })
  })

  // Org membership gets a caller past the guard; it must not reach another
  // member's conversation in the same org.
  it("404s another member of the same organization on the owner's conversation", async () => {
    const created = await service.client.post(
      '/v1/chats',
      { scope: COS_SCOPE },
      headers,
    )
    const conversationId = created.data.conversationId as string

    const clerkId = `user_cos_member_${Math.random().toString(36).slice(2, 10)}`
    const member = await service.prisma.user.create({
      data: {
        email: `${clerkId}@goodparty.org`,
        clerkId,
        firstName: 'Member',
        lastName: 'Other',
      },
    })
    await service.prisma.organizationMembership.create({
      data: {
        organizationSlug: fixtures.slug,
        userId: member.id,
        role: OrganizationRole.campaignAdmin,
      },
    })
    const asMember = {
      headers: {
        'X-Organization-Slug': fixtures.slug,
        Authorization: `Bearer ${jwt.sign(
          { sub: clerkId },
          process.env.AUTH_SECRET!,
          { expiresIn: '1h' },
        )}`,
      },
    }

    const listed = await service.client.get(
      `/v1/chats?scope=${COS_SCOPE}`,
      asMember,
    )
    expect(listed.status).toBe(HttpStatus.OK)

    const got = await service.client.get(
      `/v1/chats/${conversationId}?scope=${COS_SCOPE}`,
      asMember,
    )
    expect(got.status).toBe(HttpStatus.NOT_FOUND)
    const deleted = await service.client.delete(
      `/v1/chats/${conversationId}?scope=${COS_SCOPE}`,
      asMember,
    )
    expect(deleted.status).toBe(HttpStatus.NOT_FOUND)
    const row = await service.prisma.chatConversation.findUnique({
      where: { id: conversationId },
    })
    expect(row?.deletedAt).toBeNull()
  })

  // A chat card derives its identity from the tool call id: the outreach card
  // keys its outreach on it, so a replay that dropped the id rendered no card
  // at all. The live stream always carried it; the transcript has to as well.
  it('replays the tool call id a segment was persisted with', async () => {
    const created = await service.client.post(
      '/v1/chats',
      { scope: COS_SCOPE },
      headers,
    )
    const conversationId = created.data.conversationId as string
    const assistant = await chatStore.appendMessage({
      conversationId,
      role: ChatMessageRole.assistant,
      content: 'Here is a list you could call.',
      segments: [
        {
          kind: ChatMessageSegmentKind.tool,
          toolName: 'present_outreach_proposal',
          toolCallId: 'toolu_replay_1',
          payload: { audience: 'Maple Avenue' },
        },
      ],
    })

    const replay = await service.client.get(
      `/v1/chats/${conversationId}?scope=${COS_SCOPE}`,
      headers,
    )

    const message = (
      replay.data.messages as Array<{
        id: string
        segments?: Array<{ toolName: string; toolCallId?: string }>
      }>
    ).find((m) => m.id === assistant.id)
    expect(message?.segments?.[0]).toMatchObject({
      toolName: 'present_outreach_proposal',
      toolCallId: 'toolu_replay_1',
    })
  })

  describe('POST /v1/chats/:id/messages (SSE)', () => {
    it('streams assistant text and persists the user message', async () => {
      const created = await service.client.post(
        '/v1/chats',
        { scope: COS_SCOPE },
        headers,
      )
      const conversationId = created.data.conversationId as string

      const res = await service.client.post(
        `/v1/chats/${conversationId}/messages?scope=${COS_SCOPE}`,
        { content: 'What is on my agenda?' },
        headers,
      )
      expect(res.status).toBe(HttpStatus.OK)
      expect(String(res.data)).toContain('"type":"text"')
      expect(String(res.data)).toContain('hello')

      const messages =
        await chatStore.listMessagesByConversation(conversationId)
      expect(messages.some((m) => m.role === ChatMessageRole.user)).toBe(true)
    })
  })

  describe('user message id', () => {
    const userMessageIdOf = (rows: { role: string; id: string }[]) =>
      rows.find((r) => r.role === 'user')?.id

    // These exercise the store's own id logic, so they run the real stream
    // rather than the suite's stub.
    beforeEach(() => {
      vi.mocked(chatStream.stream).mockRestore()
    })

    const sendWithId = async (
      conversationId: string,
      body: Record<string, unknown>,
      requestHeaders = headers,
    ) =>
      service.client.post(
        `/v1/chats/${conversationId}/messages?scope=${COS_SCOPE}`,
        body,
        requestHeaders,
      )

    const createConversation = async (): Promise<string> => {
      const created = await service.client.post(
        '/v1/chats',
        { scope: COS_SCOPE },
        headers,
      )
      return created.data.conversationId as string
    }

    const seedRetryableTurn = async (): Promise<{
      conversationId: string
      id: string
    }> => {
      const conversationId = await createConversation()
      const id = randomUUID()
      await chatStore.appendUserMessageIfAlive({
        conversationId,
        ownerUserId: service.user.id,
        content: 'first delivery',
        id,
      })
      await chatStore.appendMessage({
        conversationId,
        role: ChatMessageRole.assistant,
        content: 'the stored reply',
      })
      return { conversationId, id }
    }

    it('stores the user turn under the id the client sent', async () => {
      const conversationId = await createConversation()
      const id = randomUUID()

      await sendWithId(conversationId, { content: 'hello', id })

      const rows = await service.prisma.agentMessage.findMany({
        where: { conversationId },
      })
      expect(userMessageIdOf(rows)).toBe(id)
    })

    it('answers a retry from the stored turn instead of running it again', async () => {
      const { conversationId, id } = await seedRetryableTurn()
      const llm = service.app.get(LlmService)
      const call = vi.spyOn(llm, 'streamChatCompletion')

      const retried = await sendWithId(conversationId, { content: 'again', id })

      expect(call).not.toHaveBeenCalled()
      expect(String(retried.data)).toContain('the stored reply')
      const rows = await service.prisma.agentMessage.findMany({
        where: { conversationId },
      })
      expect(rows.filter((r) => r.role === AgentMessageRole.user)).toHaveLength(
        1,
      )
    })

    it('takes the old clientMessageId name as the same id', async () => {
      const { conversationId, id } = await seedRetryableTurn()

      const retried = await sendWithId(conversationId, {
        content: 'again',
        clientMessageId: id,
      })

      expect(String(retried.data)).toContain('the stored reply')
    })

    it('409s an id already used by another conversation', async () => {
      const { id } = await seedRetryableTurn()
      const other = await createConversation()

      const res = await sendWithId(other, { content: 'hello', id })

      expect(res.status).toBe(HttpStatus.CONFLICT)
      expect(String(res.data)).not.toContain('first delivery')
    })

    it('409s an id already used by another owner', async () => {
      // Another user's turn holds the id; the caller sends it in their own
      // conversation. The answer must not describe the row that holds it.
      const otherUser = await service.prisma.user.create({
        data: {
          email: `other-${randomUUID()}@example.com`,
          firstName: 'Other',
          lastName: 'Person',
        },
      })
      const theirConversation = await service.prisma.chatConversation.create({
        data: {
          ownerUserId: otherUser.id,
          scope: COS_SCOPE,
          organizationSlug: fixtures.slug,
        },
      })
      const id = randomUUID()
      await service.prisma.agentMessage.create({
        data: {
          id,
          conversationId: theirConversation.id,
          index: 0,
          role: AgentMessageRole.user,
          parts: [{ type: 'text', text: 'their private question' }],
        },
      })
      const mine = await createConversation()

      const res = await sendWithId(mine, { content: 'hello', id })

      expect(res.status).toBe(HttpStatus.CONFLICT)
      expect(String(res.data)).not.toContain('their private question')
    })

    it('400s a message id that is not a UUID', async () => {
      const conversationId = await createConversation()

      const res = await sendWithId(conversationId, {
        content: 'hello',
        id: 'uuid-1',
      })

      expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    })
  })

  describe('message feedback', () => {
    const startThread = async (): Promise<{
      conversationId: string
      assistantMessageId: string
    }> => {
      const created = await service.client.post(
        '/v1/chats',
        { scope: COS_SCOPE },
        headers,
      )
      const conversationId = created.data.conversationId as string
      await chatStore.appendMessage({
        conversationId,
        role: ChatMessageRole.user,
        content: 'What is on my agenda?',
      })
      const assistant = await chatStore.appendMessage({
        conversationId,
        role: ChatMessageRole.assistant,
        content: 'Three items, two of them zoning.',
      })
      return { conversationId, assistantMessageId: assistant.id }
    }

    it('stores a rating with its note and replays it on the message', async () => {
      const { conversationId, assistantMessageId } = await startThread()

      const set = await service.client.put(
        `/v1/chats/${conversationId}/messages/${assistantMessageId}/feedback?scope=${COS_SCOPE}`,
        { feedback: 'negative', comment: 'Missed the budget item.' },
        headers,
      )
      expect(set.status).toBe(HttpStatus.OK)
      expect(set.data.conversationId).toBe(conversationId)
      expect(set.data.messageId).toBe(assistantMessageId)
      expect(set.data.feedback).toBe('negative')
      expect(set.data.comment).toBe('Missed the budget item.')

      const replay = await service.client.get(
        `/v1/chats/${conversationId}?scope=${COS_SCOPE}`,
        headers,
      )
      const rated = (
        replay.data.messages as Array<{
          id: string
          feedback?: { feedback: string; comment: string | null }
        }>
      ).find((m) => m.id === assistantMessageId)
      expect(rated?.feedback).toEqual({
        feedback: 'negative',
        comment: 'Missed the budget item.',
      })
    })

    it('re-rating without a comment keeps the stored note', async () => {
      const { conversationId, assistantMessageId } = await startThread()
      const url = `/v1/chats/${conversationId}/messages/${assistantMessageId}/feedback?scope=${COS_SCOPE}`

      await service.client.put(
        url,
        { feedback: 'negative', comment: 'Wrong meeting.' },
        headers,
      )
      const again = await service.client.put(
        url,
        { feedback: 'negative' },
        headers,
      )
      expect(again.data.comment).toBe('Wrong meeting.')

      const flipped = await service.client.put(
        url,
        { feedback: 'positive', comment: null },
        headers,
      )
      expect(flipped.data.feedback).toBe('positive')
      expect(flipped.data.comment).toBeNull()
    })

    it('clears a rating so the replayed message carries none', async () => {
      const { conversationId, assistantMessageId } = await startThread()
      const url = `/v1/chats/${conversationId}/messages/${assistantMessageId}/feedback?scope=${COS_SCOPE}`

      await service.client.put(url, { feedback: 'positive' }, headers)
      const cleared = await service.client.delete(url, headers)
      expect(cleared.status).toBe(HttpStatus.NO_CONTENT)

      const replay = await service.client.get(
        `/v1/chats/${conversationId}?scope=${COS_SCOPE}`,
        headers,
      )
      const rated = (
        replay.data.messages as Array<{ id: string; feedback?: unknown }>
      ).find((m) => m.id === assistantMessageId)
      expect(rated?.feedback).toBeUndefined()
    })

    it('404s on a message that belongs to another conversation', async () => {
      const first = await startThread()
      const second = await startThread()

      const res = await service.client.put(
        `/v1/chats/${second.conversationId}/messages/${first.assistantMessageId}/feedback?scope=${COS_SCOPE}`,
        { feedback: 'negative' },
        headers,
      )
      expect(res.status).toBe(HttpStatus.NOT_FOUND)
    })

    it('404s a retraction on a message outside the conversation', async () => {
      const first = await startThread()
      const second = await startThread()

      // The documented contract is that BOTH verbs reject an unratable id, so
      // a client bug surfaces instead of returning a silent 204.
      const res = await service.client.delete(
        `/v1/chats/${second.conversationId}/messages/${first.assistantMessageId}/feedback?scope=${COS_SCOPE}`,
        headers,
      )
      expect(res.status).toBe(HttpStatus.NOT_FOUND)
    })

    it('404s a retraction on a user turn', async () => {
      const created = await service.client.post(
        '/v1/chats',
        { scope: COS_SCOPE },
        headers,
      )
      const conversationId = created.data.conversationId as string
      const userTurn = await chatStore.appendMessage({
        conversationId,
        role: ChatMessageRole.user,
        content: 'Anything urgent?',
      })

      const res = await service.client.delete(
        `/v1/chats/${conversationId}/messages/${userTurn.id}/feedback?scope=${COS_SCOPE}`,
        headers,
      )
      expect(res.status).toBe(HttpStatus.NOT_FOUND)
    })

    it('updates a rating that was stored before agentMessageId was written', async () => {
      const { conversationId, assistantMessageId } = await startThread()
      // The previous deploy's state: it wrote a ChatMessage row too, and rated
      // by that. agentMessageId is still null on the rating.
      await service.prisma.chatMessage.create({
        data: {
          id: assistantMessageId,
          conversationId,
          role: ChatMessageRole.assistant,
          content: 'Three items, two of them zoning.',
        },
      })
      await service.prisma.chatMessageFeedback.create({
        data: {
          conversationId,
          chatMessageId: assistantMessageId,
          submitterUserId: service.user.id,
          feedback: 'negative',
          comment: 'Left on the old deploy.',
        },
      })

      const res = await service.client.put(
        `/v1/chats/${conversationId}/messages/${assistantMessageId}/feedback?scope=${COS_SCOPE}`,
        { feedback: 'positive' },
        headers,
      )
      expect(res.status).toBe(HttpStatus.OK)
      expect(res.data.feedback).toBe('positive')

      const rows = await service.prisma.chatMessageFeedback.findMany({
        where: { conversationId, chatMessageId: assistantMessageId },
      })
      expect(rows).toHaveLength(1)
      expect(rows[0]?.agentMessageId).toBe(assistantMessageId)
    })

    it('retracting a rating that was never left still succeeds', async () => {
      const { conversationId, assistantMessageId } = await startThread()

      // Idempotent on the ROW, strict on the id: deleting nothing is fine.
      const res = await service.client.delete(
        `/v1/chats/${conversationId}/messages/${assistantMessageId}/feedback?scope=${COS_SCOPE}`,
        headers,
      )
      expect(res.status).toBe(HttpStatus.NO_CONTENT)
    })

    it('404s on a user turn — only assistant replies are ratable', async () => {
      const created = await service.client.post(
        '/v1/chats',
        { scope: COS_SCOPE },
        headers,
      )
      const conversationId = created.data.conversationId as string
      const userTurn = await chatStore.appendMessage({
        conversationId,
        role: ChatMessageRole.user,
        content: 'Anything urgent?',
      })

      const res = await service.client.put(
        `/v1/chats/${conversationId}/messages/${userTurn.id}/feedback?scope=${COS_SCOPE}`,
        { feedback: 'positive' },
        headers,
      )
      expect(res.status).toBe(HttpStatus.NOT_FOUND)
    })
  })

  describe('POST /v1/chats with anchor', () => {
    it('persists anchor and title from snapshot.title', async () => {
      const anchor = {
        resourceType: 'community_issue',
        resourceId: 'issue-abc',
        url: 'https://goodparty.org/issues/issue-abc',
        snapshot: {
          title: 'Fix the potholes on Main Street',
          summary: 'Residents have complained about road conditions.',
        },
      }
      const res = await service.client.post(
        '/v1/chats',
        { scope: COS_SCOPE, anchor },
        headers,
      )
      expect(res.status).toBe(HttpStatus.CREATED)
      expect(res.data.created).toBe(true)

      const row = await service.prisma.chatConversation.findUnique({
        where: { id: res.data.conversationId as string },
      })
      expect(row?.anchor).toMatchObject(anchor)
      expect(row?.title).toBe('Fix the potholes on Main Street')
    })
  })

  describe('POST /v1/chats anchor snapshot field length limits', () => {
    it('rejects a snapshot.title longer than 500 chars with 400', async () => {
      const anchor = {
        resourceType: 'community_issue',
        resourceId: 'issue-abc',
        url: 'https://goodparty.org/issues/issue-abc',
        snapshot: {
          title: 'a'.repeat(501),
          summary: 'Short summary.',
        },
      }
      const res = await service.client.post(
        '/v1/chats',
        { scope: COS_SCOPE, anchor },
        headers,
      )
      expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    })
  })

  describe('GET /v1/chats/:id usage', () => {
    let llm: LlmService

    beforeEach(() => {
      vi.mocked(chatStream.stream).mockRestore()
      llm = service.app.get(LlmService)
    })

    const createConversation = async (
      scope: ChatScope,
      requestHeaders: { headers: Record<string, string> },
    ): Promise<string> => {
      const created = await service.client.post(
        '/v1/chats',
        { scope },
        requestHeaders,
      )
      return created.data.conversationId as string
    }

    const send = async (
      conversationId: string,
      scope: ChatScope,
      requestHeaders: { headers: Record<string, string> },
    ): Promise<string> => {
      const res = await service.client.post(
        `/v1/chats/${conversationId}/messages?scope=${scope}`,
        { content: 'How much did this cost?' },
        requestHeaders,
      )
      expect(res.status).toBe(HttpStatus.OK)
      return String(res.data)
    }

    const getUsage = async (
      conversationId: string,
      scope: ChatScope,
      requestHeaders: { headers: Record<string, string> },
    ) => {
      const res = await service.client.get(
        `/v1/chats/${conversationId}?scope=${scope}`,
        requestHeaders,
      )
      expect(res.status).toBe(HttpStatus.OK)
      return res.data.usage as {
        complete: boolean
        byModel: Array<{
          model: string
          inputTokens: number
          outputTokens: number
        }>
      }
    }

    it('reports an empty, complete usage before any assistant turn', async () => {
      const conversationId = await createConversation(COS_SCOPE, headers)

      expect(await getUsage(conversationId, COS_SCOPE, headers)).toEqual({
        complete: true,
        byModel: [],
      })
    })

    it('records a turn before its done frame and returns it on GET', async () => {
      vi.spyOn(llm, 'streamChatCompletion').mockResolvedValue(
        pricedTurn('claude-sonnet-4-6', 1200, 340),
      )
      const conversationId = await createConversation(COS_SCOPE, headers)

      const body = await send(conversationId, COS_SCOPE, headers)
      expect(body).toContain('"type":"done"')

      const assistant = await service.prisma.agentMessage.findFirst({
        where: { conversationId, role: AgentMessageRole.assistant },
      })
      expect(assistant).toMatchObject({
        model: 'claude-sonnet-4-6',
        inputTokens: 1200,
        outputTokens: 340,
      })
      expect(await getUsage(conversationId, COS_SCOPE, headers)).toEqual({
        complete: true,
        byModel: [
          {
            model: 'claude-sonnet-4-6',
            inputTokens: 1200,
            outputTokens: 340,
          },
        ],
      })
    })

    it('sums turns by the model that answered', async () => {
      vi.spyOn(llm, 'streamChatCompletion')
        .mockResolvedValueOnce(pricedTurn('claude-sonnet-4-6', 1000, 200))
        .mockResolvedValueOnce(pricedTurn('claude-sonnet-4-6', 1500, 300))
        .mockResolvedValueOnce(pricedTurn('claude-opus-4-7', 900, 100))
      const conversationId = await createConversation(COS_SCOPE, headers)

      await send(conversationId, COS_SCOPE, headers)
      await send(conversationId, COS_SCOPE, headers)
      await send(conversationId, COS_SCOPE, headers)

      expect(await getUsage(conversationId, COS_SCOPE, headers)).toEqual({
        complete: true,
        byModel: [
          {
            model: 'claude-sonnet-4-6',
            inputTokens: 2500,
            outputTokens: 500,
          },
          { model: 'claude-opus-4-7', inputTokens: 900, outputTokens: 100 },
        ],
      })
    })

    it('is incomplete when an assistant message has no recorded usage', async () => {
      vi.spyOn(llm, 'streamChatCompletion').mockResolvedValue(
        pricedTurn('claude-sonnet-4-6', 1200, 340),
      )
      const conversationId = await createConversation(COS_SCOPE, headers)
      await chatStore.appendMessage({
        conversationId,
        role: ChatMessageRole.assistant,
        content: 'A reply whose usage write failed.',
      })

      await send(conversationId, COS_SCOPE, headers)

      expect(await getUsage(conversationId, COS_SCOPE, headers)).toEqual({
        complete: false,
        byModel: [
          {
            model: 'claude-sonnet-4-6',
            inputTokens: 1200,
            outputTokens: 340,
          },
        ],
      })
    })

    it('leaves an aborted turn unpriced, so the conversation is incomplete', async () => {
      vi.spyOn(llm, 'streamChatCompletion').mockResolvedValue({
        ...pricedTurn('claude-sonnet-4-6', 1200, 340),
        textStream: (async function* () {
          yield 'Partial'
          throw Object.assign(new Error('aborted'), { name: 'AbortError' })
        })(),
      })
      const conversationId = await createConversation(COS_SCOPE, headers)

      await send(conversationId, COS_SCOPE, headers)

      const assistant = await service.prisma.agentMessage.findFirst({
        where: { conversationId, role: AgentMessageRole.assistant },
      })
      expect(assistant?.parts).toEqual([{ type: 'text', text: 'Partial' }])
      expect(assistant?.inputTokens).toBeNull()
      expect(await getUsage(conversationId, COS_SCOPE, headers)).toEqual({
        complete: false,
        byModel: [],
      })
    })

    it('counts the Campaign Manager greeting as recorded, so one priced turn is complete', async () => {
      vi.spyOn(llm, 'streamChatCompletion').mockResolvedValue(
        pricedTurn('claude-sonnet-4-6', 1200, 340),
      )
      const { slug } = await createOrgAndCampaign(service.user.id)
      const camHeaders = { headers: { 'X-Organization-Slug': slug } }
      const conversationId = await createConversation(
        ChatScope.campaign_assistant,
        camHeaders,
      )
      const greeting = await service.prisma.agentMessage.findFirst({
        where: { conversationId, role: AgentMessageRole.assistant },
      })
      expect(greeting).toMatchObject({
        model: null,
        inputTokens: 0,
        outputTokens: 0,
      })

      await send(conversationId, ChatScope.campaign_assistant, camHeaders)

      expect(
        await getUsage(
          conversationId,
          ChatScope.campaign_assistant,
          camHeaders,
        ),
      ).toEqual({
        complete: true,
        byModel: [
          {
            model: 'claude-sonnet-4-6',
            inputTokens: 1200,
            outputTokens: 340,
          },
        ],
      })
    })
  })

  describe('back-compat: briefing-annotation conversations', () => {
    it('defaults pre-existing conversations to briefing_annotation scope', async () => {
      const legacy = await service.prisma.chatConversation.create({
        data: { ownerUserId: service.user.id },
      })
      const row = await service.prisma.chatConversation.findUnique({
        where: { id: legacy.id },
      })
      expect(row?.scope).toBe(ChatScope.briefing_annotation)
      expect(row?.organizationSlug).toBeNull()

      // A briefing-annotation conversation must never surface through the CoS
      // history list — scopes are isolated.
      const history = await service.client.get(
        `/v1/chats?scope=${COS_SCOPE}`,
        headers,
      )
      const ids = (
        history.data.conversations as Array<{ conversationId: string }>
      ).map((c) => c.conversationId)
      expect(ids).not.toContain(legacy.id)
    })
  })
})
