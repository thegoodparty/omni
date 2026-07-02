import { HttpStatus } from '@nestjs/common'
import {
  ChatMessageRole,
  ChatScope,
  ElectedOffice,
} from '../../../generated/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ChatStreamChunk,
  ChatStreamService,
} from '@/chats/services/chatStream.service'
import { ChatStoreService } from '@/chats/services/chatStore.prisma'
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
