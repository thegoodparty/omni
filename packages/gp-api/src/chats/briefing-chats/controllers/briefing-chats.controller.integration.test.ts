import { HttpStatus } from '@nestjs/common'
import {
  Annotation,
  AnnotationKind,
  AnnotationResourceType,
  ChatConversation,
  ChatMessageRole,
  ChatScope,
  ElectedOffice,
  ExperimentRunStatus,
  MeetingBriefing,
  OrganizationRole,
  User,
} from '../../../generated/prisma'
import jwt from 'jsonwebtoken'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ChatStreamChunk,
  ChatStreamService,
} from '@/chats/services/chatStream.service'
import { ChatStoreService } from '@/chats/services/chatStore.prisma'
import { useTestService } from '@/test-service'
import { S3Service } from '@/vendors/aws/services/s3.service'

const service = useTestService()

const BRIEFING_BUCKET = 'briefings-bucket'
const BRIEFING_KEY = 'integration/briefing.md'
const ARTIFACT_CONTENT = '# Briefing\n\nbody'
const MEETING_DATE = '2026-06-01'

interface Fixtures {
  slug: string
  electedOffice: ElectedOffice
  briefing: MeetingBriefing
  conversation: ChatConversation
  annotation: Annotation
}

const createOrgAndElectedOffice = async (userId: number) => {
  const slug = `org-${userId}-${Math.random().toString(36).slice(2, 10)}`
  await service.prisma.organization.create({
    data: { slug, ownerId: userId },
  })
  const electedOffice = await service.prisma.electedOffice.create({
    data: { organizationSlug: slug, userId },
  })
  return { slug, electedOffice }
}

const createBriefingFixtures = async (
  userId: number,
  meetingDate: string = MEETING_DATE,
): Promise<Fixtures> => {
  const { slug, electedOffice } = await createOrgAndElectedOffice(userId)
  const run = await service.prisma.experimentRun.create({
    data: {
      organizationSlug: slug,
      experimentType: 'meeting_briefing',
      status: ExperimentRunStatus.COMPLETED,
    },
  })
  const briefing = await service.prisma.meetingBriefing.create({
    data: {
      electedOfficeId: electedOffice.id,
      experimentRunId: run.runId,
      artifactBucket: BRIEFING_BUCKET,
      artifactKey: BRIEFING_KEY,
      meetingDate: new Date(`${meetingDate}T00:00:00Z`),
      meetingTime: '18:00',
      meetingTimezone: 'America/New_York',
    },
  })
  const conversation = await service.prisma.chatConversation.create({
    data: { ownerUserId: userId },
  })
  const annotation = await service.prisma.annotation.create({
    data: {
      authorUserId: userId,
      kind: AnnotationKind.chat,
      resourceId: briefing.id,
      resourceType: AnnotationResourceType.briefing,
      chatConversationId: conversation.id,
    },
  })
  return { slug, electedOffice, briefing, conversation, annotation }
}

const createOtherUser = async (suffix: string): Promise<User> =>
  service.prisma.user.create({
    data: {
      email: `other-${suffix}@goodparty.org`,
      firstName: 'Other',
      lastName: 'User',
    },
  })

const buildStream = (
  chunks: ChatStreamChunk[],
  hook?: () => Promise<void> | void,
): AsyncIterable<ChatStreamChunk> => ({
  [Symbol.asyncIterator]: async function* () {
    if (hook) await hook()
    for (const c of chunks) yield c
  },
})

const parseSseFrames = (
  body: string,
): Array<{ raw: string; parsed: unknown }> => {
  const frames: Array<{ raw: string; parsed: unknown }> = []
  const parts = body.split('\n\n').filter((p) => p.startsWith('data: '))
  for (const part of parts) {
    const raw = part.slice('data: '.length)
    frames.push({ raw, parsed: JSON.parse(raw) as unknown })
  }
  return frames
}

describe('BriefingChatsController (integration)', () => {
  let fixtures: Fixtures
  let chatStream: ChatStreamService
  let chatStore: ChatStoreService
  let s3: S3Service

  beforeEach(async () => {
    fixtures = await createBriefingFixtures(service.user.id)

    chatStream = service.app.get(ChatStreamService)
    chatStore = service.app.get(ChatStoreService)
    s3 = service.app.get(S3Service)

    vi.spyOn(s3, 'getFile').mockResolvedValue(ARTIFACT_CONTENT)

    vi.spyOn(chatStream, 'stream').mockImplementation((args) =>
      buildStream(
        [
          { type: 'text', delta: 'hello' },
          { type: 'done', assistantMessageId: 'asst-1' },
        ],
        async () => {
          await chatStore.appendMessage({
            conversationId: args.conversationId,
            role: ChatMessageRole.user,
            content: args.userMessage,
            ...(args.clientMessageId && {
              clientMessageId: args.clientMessageId,
            }),
          })
        },
      ),
    )
  })

  describe('POST /v1/briefing-chats', () => {
    it('creates a top-level chat and returns annotationId + conversationId', async () => {
      const res = await service.client.post('/v1/briefing-chats', {
        meetingDate: MEETING_DATE,
        anchor: { jsonPath: null, start: null, end: null },
      })

      expect(res.status).toBe(HttpStatus.CREATED)
      const body = res.data as {
        annotationId: string
        conversationId: string
      }
      expect(typeof body.annotationId).toBe('string')
      expect(typeof body.conversationId).toBe('string')

      const annotation = await service.prisma.annotation.findUnique({
        where: { id: body.annotationId },
      })
      expect(annotation?.chatConversationId).toBe(body.conversationId)
      expect(annotation?.jsonPath).toBeNull()
    })

    it('returns the same ids on repeated top-level calls (idempotent)', async () => {
      const first = await service.client.post('/v1/briefing-chats', {
        meetingDate: MEETING_DATE,
        anchor: { jsonPath: null, start: null, end: null },
      })
      const second = await service.client.post('/v1/briefing-chats', {
        meetingDate: MEETING_DATE,
        anchor: { jsonPath: null, start: null, end: null },
      })

      expect(second.data.annotationId).toBe(first.data.annotationId)
      expect(second.data.conversationId).toBe(first.data.conversationId)
    })

    it('creates distinct rows for repeated anchored calls', async () => {
      const first = await service.client.post('/v1/briefing-chats', {
        meetingDate: MEETING_DATE,
        anchor: { jsonPath: '$.a', start: 1, end: 5 },
      })
      const second = await service.client.post('/v1/briefing-chats', {
        meetingDate: MEETING_DATE,
        anchor: { jsonPath: '$.a', start: 1, end: 5 },
      })

      expect(second.data.annotationId).not.toBe(first.data.annotationId)

      // New rows carry what the registry routes check ownership by.
      const conversation = await service.prisma.chatConversation.findUnique({
        where: { id: first.data.conversationId },
      })
      expect(conversation?.scope).toBe(ChatScope.briefing_annotation)
      expect(conversation?.organizationSlug).toBe(fixtures.slug)
    })

    it('returns 401 when Authorization is invalid', async () => {
      const res = await service.client.post(
        '/v1/briefing-chats',
        {
          meetingDate: MEETING_DATE,
          anchor: { jsonPath: null, start: null, end: null },
        },
        { headers: { Authorization: 'Bearer invalid' } },
      )

      expect(res.status).toBe(HttpStatus.UNAUTHORIZED)
    })

    it('returns 400 on mixed-nullness anchor', async () => {
      const res = await service.client.post('/v1/briefing-chats', {
        meetingDate: MEETING_DATE,
        anchor: { jsonPath: '$.foo', start: null, end: 10 },
      })

      expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    })

    it('returns 400 on invalid meetingDate format', async () => {
      const res = await service.client.post('/v1/briefing-chats', {
        meetingDate: 'not-a-date',
        anchor: { jsonPath: null, start: null, end: null },
      })

      expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    })

    it('returns 404 when no briefing exists for that meetingDate', async () => {
      const res = await service.client.post('/v1/briefing-chats', {
        meetingDate: '2099-01-01',
        anchor: { jsonPath: null, start: null, end: null },
      })

      expect(res.status).toBe(HttpStatus.NOT_FOUND)
    })

    it('returns 404 when briefing on that date belongs to another user (IDOR)', async () => {
      const other = await createOtherUser('post-create-idor')
      const otherMeetingDate = '2026-07-15'
      await createBriefingFixtures(other.id, otherMeetingDate)

      const res = await service.client.post('/v1/briefing-chats', {
        meetingDate: otherMeetingDate,
        anchor: { jsonPath: null, start: null, end: null },
      })

      expect(res.status).toBe(HttpStatus.NOT_FOUND)
    })
  })

  describe('POST /v1/briefing-chats/:annotationId/messages', () => {
    it('returns SSE response with JSON-framed chunks', async () => {
      const res = await service.client.post(
        `/v1/briefing-chats/${fixtures.annotation.id}/messages`,
        { content: 'hi there' },
      )

      expect(res.status).toBe(HttpStatus.OK)
      expect(String(res.headers['content-type'] ?? '')).toContain(
        'text/event-stream',
      )
      const frames = parseSseFrames(String(res.data))
      expect(frames.length).toBeGreaterThanOrEqual(1)
      const first = frames[0]?.parsed as { type?: string }
      expect(typeof first.type).toBe('string')
    })

    // Braintrust filters key on this trace name. The registry's default would
    // be `briefing_annotation-chat-stream`; the briefing turn also never passed
    // a scope (so no attachment injection or scope-tagged analytics).
    it('streams under the briefing-chat-stream trace name with no scope', async () => {
      const streamSpy = vi.spyOn(chatStream, 'stream')
      streamSpy.mockClear()

      await service.client.post(
        `/v1/briefing-chats/${fixtures.annotation.id}/messages`,
        { content: 'trace me' },
      )

      expect(streamSpy).toHaveBeenCalledTimes(1)
      const args = streamSpy.mock.calls[0]?.[0]
      expect(args?.traceName).toBe('briefing-chat-stream')
      expect(args).not.toHaveProperty('scope')
    })

    it('does not set a conversation title', async () => {
      await service.client.post(
        `/v1/briefing-chats/${fixtures.annotation.id}/messages`,
        { content: 'no title from me' },
      )

      const row = await service.prisma.chatConversation.findUnique({
        where: { id: fixtures.conversation.id },
      })
      expect(row?.title).toBeNull()
    })

    it('persists the user message visible via GET', async () => {
      await service.client.post(
        `/v1/briefing-chats/${fixtures.annotation.id}/messages`,
        { content: 'persisted message' },
      )

      const res = await service.client.get(
        `/v1/briefing-chats/${fixtures.annotation.id}`,
      )

      expect(res.status).toBe(HttpStatus.OK)
      const userMessages = (
        res.data.messages as Array<{ role: string; content: string }>
      ).filter((m) => m.role === ChatMessageRole.user)
      expect(userMessages).toHaveLength(1)
      expect(userMessages[0]?.content).toBe('persisted message')
    })

    it('returns 401 when Authorization is invalid', async () => {
      const res = await service.client.post(
        `/v1/briefing-chats/${fixtures.annotation.id}/messages`,
        { content: 'hi' },
        { headers: { Authorization: 'Bearer invalid' } },
      )

      expect(res.status).toBe(HttpStatus.UNAUTHORIZED)
    })

    it('does not deliver chunks for an annotation owned by another user', async () => {
      const other = await createOtherUser('post-idor')
      const otherFixtures = await createBriefingFixtures(other.id)

      const res = await service.client.post(
        `/v1/briefing-chats/${otherFixtures.annotation.id}/messages`,
        { content: 'hi' },
      )

      expect(res.status).toBe(HttpStatus.NOT_FOUND)
      const frames = parseSseFrames(String(res.data))
      expect(
        frames.find((f) => (f.parsed as { type?: string }).type === 'done'),
      ).toBeUndefined()
      expect(
        frames.find((f) => (f.parsed as { type?: string }).type === 'text'),
      ).toBeUndefined()
      const otherMessages = await service.prisma.chatMessage.findMany({
        where: { conversationId: otherFixtures.conversation.id },
      })
      expect(otherMessages).toHaveLength(0)
    })

    it('returns 400 and does not invoke chat stream when content is empty', async () => {
      const streamSpy = vi.spyOn(chatStream, 'stream')
      streamSpy.mockClear()

      const res = await service.client.post(
        `/v1/briefing-chats/${fixtures.annotation.id}/messages`,
        { content: '' },
      )

      expect(res.status).toBe(HttpStatus.BAD_REQUEST)
      expect(streamSpy).not.toHaveBeenCalled()
      const messages = await service.prisma.chatMessage.findMany({
        where: { conversationId: fixtures.conversation.id },
      })
      expect(messages).toHaveLength(0)
    })

    it('returns 400 and does not invoke chat stream when content exceeds 10000 chars', async () => {
      const streamSpy = vi.spyOn(chatStream, 'stream')
      streamSpy.mockClear()

      const res = await service.client.post(
        `/v1/briefing-chats/${fixtures.annotation.id}/messages`,
        { content: 'x'.repeat(10_001) },
      )

      expect(res.status).toBe(HttpStatus.BAD_REQUEST)
      expect(streamSpy).not.toHaveBeenCalled()
      const messages = await service.prisma.chatMessage.findMany({
        where: { conversationId: fixtures.conversation.id },
      })
      expect(messages).toHaveLength(0)
    })

    it('returns 400 and does not invoke chat stream when body has no content field', async () => {
      const streamSpy = vi.spyOn(chatStream, 'stream')
      streamSpy.mockClear()

      const res = await service.client.post(
        `/v1/briefing-chats/${fixtures.annotation.id}/messages`,
        {},
      )

      expect(res.status).toBe(HttpStatus.BAD_REQUEST)
      expect(streamSpy).not.toHaveBeenCalled()
      const messages = await service.prisma.chatMessage.findMany({
        where: { conversationId: fixtures.conversation.id },
      })
      expect(messages).toHaveLength(0)
    })

    it('returns 404 for a malformed annotationId', async () => {
      const res = await service.client.post(
        '/v1/briefing-chats/not-a-valid-id/messages',
        { content: 'hi' },
      )

      expect(res.status).toBe(HttpStatus.NOT_FOUND)
      const frames = parseSseFrames(String(res.data))
      expect(
        frames.find((f) => (f.parsed as { type?: string }).type === 'done'),
      ).toBeUndefined()
    })

    it('persists only one user message when clientMessageId is repeated', async () => {
      const clientMessageId = '11111111-1111-1111-1111-111111111111'
      const content = 'idempotent message'

      const first = await service.client.post(
        `/v1/briefing-chats/${fixtures.annotation.id}/messages`,
        { content, clientMessageId },
      )
      const second = await service.client.post(
        `/v1/briefing-chats/${fixtures.annotation.id}/messages`,
        { content, clientMessageId },
      )

      expect(first.status).toBe(HttpStatus.OK)
      expect(second.status).toBe(HttpStatus.OK)
      const userMessages = await service.prisma.chatMessage.findMany({
        where: {
          conversationId: fixtures.conversation.id,
          role: ChatMessageRole.user,
        },
      })
      expect(userMessages).toHaveLength(1)
      expect(userMessages[0]?.content).toBe(content)
      expect(userMessages[0]?.clientMessageId).toBe(clientMessageId)
    })

    it('rejects a clientMessageId reused with different content (mid-stream conflict)', async () => {
      // The chatStore enforces clientMessageId+content uniqueness by throwing
      // ConflictException from appendMessage. By the time that runs the SSE
      // response has already been opened (status 200), so the conflict is
      // surfaced as an in-stream error frame, not an HTTP 409. The behavioral
      // contract is: the second POST does NOT create a second user message.
      const clientMessageId = '22222222-2222-2222-2222-222222222222'

      const first = await service.client.post(
        `/v1/briefing-chats/${fixtures.annotation.id}/messages`,
        { content: 'original content', clientMessageId },
      )
      expect(first.status).toBe(HttpStatus.OK)

      await service.client.post(
        `/v1/briefing-chats/${fixtures.annotation.id}/messages`,
        { content: 'tampered content', clientMessageId },
      )

      const userMessages = await service.prisma.chatMessage.findMany({
        where: {
          conversationId: fixtures.conversation.id,
          role: ChatMessageRole.user,
        },
      })
      expect(userMessages).toHaveLength(1)
      expect(userMessages[0]?.content).toBe('original content')
    })
  })

  // Every conversation created before this branch has only ownerUserId: scope
  // falls to its default and organizationSlug is NULL. The shared fixture above
  // is shaped that way on purpose. These routes key on the annotation, so such
  // a row must stay fully usable here; only the registry's /v1/chats routes
  // (which check organizationSlug) cannot reach it until a backfill.
  describe('legacy conversations (no organizationSlug)', () => {
    it('streams, loads and deletes through the briefing routes', async () => {
      const row = await service.prisma.chatConversation.findUnique({
        where: { id: fixtures.conversation.id },
      })
      expect(row?.organizationSlug).toBeNull()
      expect(row?.scope).toBe(ChatScope.briefing_annotation)

      const streamed = await service.client.post(
        `/v1/briefing-chats/${fixtures.annotation.id}/messages`,
        { content: 'legacy hello' },
      )
      expect(streamed.status).toBe(HttpStatus.OK)
      expect(
        parseSseFrames(String(streamed.data)).map(
          (f) => (f.parsed as { type?: string }).type,
        ),
      ).toEqual(['text', 'done'])

      const loaded = await service.client.get(
        `/v1/briefing-chats/${fixtures.annotation.id}`,
      )
      expect(loaded.status).toBe(HttpStatus.OK)
      expect(loaded.data.conversationId).toBe(fixtures.conversation.id)
      expect(
        (loaded.data.messages as Array<{ content: string }>).map(
          (m) => m.content,
        ),
      ).toEqual(['legacy hello'])

      const deleted = await service.client.delete(
        `/v1/briefing-chats/${fixtures.annotation.id}`,
      )
      expect(deleted.status).toBe(HttpStatus.NO_CONTENT)
    })

    it('top-level create returns the existing legacy pair unchanged', async () => {
      const res = await service.client.post('/v1/briefing-chats', {
        meetingDate: MEETING_DATE,
        anchor: { jsonPath: null, start: null, end: null },
      })

      expect(res.status).toBe(HttpStatus.CREATED)
      expect(res.data).toEqual({
        annotationId: fixtures.annotation.id,
        conversationId: fixtures.conversation.id,
      })
      const row = await service.prisma.chatConversation.findUnique({
        where: { id: fixtures.conversation.id },
      })
      expect(row?.organizationSlug).toBeNull()
    })

    it('is not reachable through the registry route, while a new chat is', async () => {
      const headers = { headers: { 'X-Organization-Slug': fixtures.slug } }

      const legacy = await service.client.get(
        `/v1/chats/${fixtures.conversation.id}?scope=briefing_annotation`,
        headers,
      )
      expect(legacy.status).toBe(HttpStatus.NOT_FOUND)

      const created = await service.client.post('/v1/briefing-chats', {
        meetingDate: MEETING_DATE,
        anchor: { jsonPath: '$.a', start: 1, end: 5 },
      })
      const fresh = await service.client.get(
        `/v1/chats/${created.data.conversationId}?scope=briefing_annotation`,
        headers,
      )
      expect(fresh.status).toBe(HttpStatus.OK)
    })
  })

  // Registering the handler opens /v1/chats to briefing_annotation, where
  // ownership is (owner, scope, organizationSlug). Passing the org guard must
  // not be enough to reach someone else's briefing chat, and the owner must
  // not reach it under a different org of theirs.
  describe('registry route ownership (/v1/chats, briefing_annotation)', () => {
    const createNewChat = async (): Promise<string> => {
      const res = await service.client.post('/v1/briefing-chats', {
        meetingDate: MEETING_DATE,
        anchor: { jsonPath: '$.a', start: 1, end: 5 },
      })
      expect(res.status).toBe(HttpStatus.CREATED)
      const conversationId = res.data.conversationId as string
      const row = await service.prisma.chatConversation.findUnique({
        where: { id: conversationId },
      })
      expect(row?.organizationSlug).toBe(fixtures.slug)
      return conversationId
    }

    const expectUntouched = async (conversationId: string) => {
      const row = await service.prisma.chatConversation.findUnique({
        where: { id: conversationId },
      })
      expect(row?.deletedAt).toBeNull()
      expect(
        await service.prisma.chatMessage.count({ where: { conversationId } }),
      ).toBe(0)
    }

    const expectAll404 = async (
      conversationId: string,
      config: { headers: Record<string, string> },
    ) => {
      const path = `/v1/chats/${conversationId}`
      const query = '?scope=briefing_annotation'
      const got = await service.client.get(`${path}${query}`, config)
      expect(got.status).toBe(HttpStatus.NOT_FOUND)
      const sent = await service.client.post(
        `${path}/messages${query}`,
        { content: 'not yours' },
        config,
      )
      expect(sent.status).toBe(HttpStatus.NOT_FOUND)
      const deleted = await service.client.delete(`${path}${query}`, config)
      expect(deleted.status).toBe(HttpStatus.NOT_FOUND)
      await expectUntouched(conversationId)
    }

    it('404s another member of the same organization', async () => {
      const conversationId = await createNewChat()
      const clerkId = `user_briefing_member_${Math.random().toString(36).slice(2, 10)}`
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

      // Control: the member does pass the org guard on this route.
      const listed = await service.client.get(
        '/v1/chats?scope=briefing_annotation',
        asMember,
      )
      expect(listed.status).toBe(HttpStatus.OK)

      await expectAll404(conversationId, asMember)
    })

    it('does not title a briefing chat sent to through /v1/chats', async () => {
      const conversationId = await createNewChat()

      const sent = await service.client.post(
        `/v1/chats/${conversationId}/messages?scope=briefing_annotation`,
        { content: 'would become a title' },
        { headers: { 'X-Organization-Slug': fixtures.slug } },
      )

      expect(sent.status).toBe(HttpStatus.OK)
      expect(
        parseSseFrames(String(sent.data)).map(
          (f) => (f.parsed as { type?: string }).type,
        ),
      ).toEqual(['text', 'done'])
      const row = await service.prisma.chatConversation.findUnique({
        where: { id: conversationId },
      })
      expect(row?.title).toBeNull()
    })

    it("404s the owner under another of the owner's organizations", async () => {
      const conversationId = await createNewChat()
      const { slug: otherSlug } = await createOrgAndElectedOffice(
        service.user.id,
      )

      await expectAll404(conversationId, {
        headers: { 'X-Organization-Slug': otherSlug },
      })

      // Control: the same calls succeed under the conversation's own org.
      const own = await service.client.get(
        `/v1/chats/${conversationId}?scope=briefing_annotation`,
        { headers: { 'X-Organization-Slug': fixtures.slug } },
      )
      expect(own.status).toBe(HttpStatus.OK)
    })
  })

  describe('GET /v1/briefing-chats/:annotationId', () => {
    it('returns conversationId and seeded message history', async () => {
      await chatStore.appendMessage({
        conversationId: fixtures.conversation.id,
        role: ChatMessageRole.user,
        content: 'seeded user message',
      })
      await chatStore.appendMessage({
        conversationId: fixtures.conversation.id,
        role: ChatMessageRole.assistant,
        content: 'seeded assistant reply',
      })

      const res = await service.client.get(
        `/v1/briefing-chats/${fixtures.annotation.id}`,
      )

      expect(res.status).toBe(HttpStatus.OK)
      expect(res.data.conversationId).toBe(fixtures.conversation.id)
      const messages = res.data.messages as Array<{
        id: string
        role: string
        content: string
        createdAt: string
      }>
      expect(messages).toHaveLength(2)
      expect(messages[0]?.role).toBe(ChatMessageRole.user)
      expect(messages[0]?.content).toBe('seeded user message')
      expect(messages[1]?.role).toBe(ChatMessageRole.assistant)
      expect(messages[1]?.content).toBe('seeded assistant reply')
    })

    it('returns 401 when Authorization is invalid', async () => {
      const res = await service.client.get(
        `/v1/briefing-chats/${fixtures.annotation.id}`,
        { headers: { Authorization: 'Bearer invalid' } },
      )

      expect(res.status).toBe(HttpStatus.UNAUTHORIZED)
    })

    it('returns 404 when annotation belongs to another user (IDOR)', async () => {
      const other = await createOtherUser('get-idor')
      const otherFixtures = await createBriefingFixtures(other.id)

      const res = await service.client.get(
        `/v1/briefing-chats/${otherFixtures.annotation.id}`,
      )

      expect(res.status).toBe(HttpStatus.NOT_FOUND)
    })
  })

  describe('DELETE /v1/briefing-chats/:annotationId', () => {
    it('returns 204 with empty body on success', async () => {
      const res = await service.client.delete(
        `/v1/briefing-chats/${fixtures.annotation.id}`,
      )

      expect(res.status).toBe(HttpStatus.NO_CONTENT)
      expect(res.data === '' || res.data === undefined).toBe(true)
    })

    it('soft-deletes the conversation', async () => {
      await service.client.delete(
        `/v1/briefing-chats/${fixtures.annotation.id}`,
      )

      const updated = await service.prisma.chatConversation.findUnique({
        where: { id: fixtures.conversation.id },
      })
      expect(updated?.deletedAt).not.toBeNull()
    })

    it('returns 404 from GET after soft-delete', async () => {
      await chatStore.appendMessage({
        conversationId: fixtures.conversation.id,
        role: ChatMessageRole.user,
        content: 'pre-delete message',
      })
      await service.client.delete(
        `/v1/briefing-chats/${fixtures.annotation.id}`,
      )

      const res = await service.client.get(
        `/v1/briefing-chats/${fixtures.annotation.id}`,
      )

      expect(res.status).toBe(HttpStatus.NOT_FOUND)
    })

    it('returns 401 when Authorization is invalid', async () => {
      const res = await service.client.delete(
        `/v1/briefing-chats/${fixtures.annotation.id}`,
        { headers: { Authorization: 'Bearer invalid' } },
      )

      expect(res.status).toBe(HttpStatus.UNAUTHORIZED)
    })

    it('returns 404 when annotation belongs to another user (IDOR)', async () => {
      const other = await createOtherUser('del-idor')
      const otherFixtures = await createBriefingFixtures(other.id)

      const res = await service.client.delete(
        `/v1/briefing-chats/${otherFixtures.annotation.id}`,
      )

      expect(res.status).toBe(HttpStatus.NOT_FOUND)
    })
  })
})
