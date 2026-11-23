import { HttpStatus } from '@nestjs/common'
import {
  Annotation,
  AnnotationKind,
  AnnotationResourceType,
  ChatConversation,
  ChatScope,
  ElectedOffice,
  ExperimentRunStatus,
  MeetingBriefing,
} from '../../../generated/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { S3Service } from '@/vendors/aws/services/s3.service'

const service = useTestService()

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

// A conversation created the way every conversation created before the
// shared /v1/chats routes existed looks: only its owner, scope left at the
// column default and no organizationSlug.
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
      artifactBucket: 'briefings-bucket',
      artifactKey: 'integration/briefing.md',
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

describe('BriefingChatsController (integration)', () => {
  let fixtures: Fixtures

  beforeEach(async () => {
    fixtures = await createBriefingFixtures(service.user.id)
    // Delete resolves the annotation's briefing through the context service,
    // which reads the artifact from S3.
    vi.spyOn(service.app.get(S3Service), 'getFile').mockResolvedValue(
      ARTIFACT_CONTENT,
    )
  })

  // Creation is the one thing a briefing chat cannot get from /v1/chats: the
  // conversation and its Annotation are written in one transaction, because a
  // conversation no annotation points at is one the briefing context cannot
  // load.
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
      const anchored = await service.prisma.annotation.findUnique({
        where: { id: first.data.annotationId },
      })
      expect(anchored).toMatchObject({ jsonPath: '$.a', start: 1, end: 5 })
    })

    // New conversations carry what the shared /v1/chats routes check
    // ownership by, so a briefing chat created here is reachable there too.
    it('writes the scope and the briefing’s own organizationSlug', async () => {
      const res = await service.client.post('/v1/briefing-chats', {
        meetingDate: MEETING_DATE,
        anchor: { jsonPath: '$.a', start: 1, end: 5 },
      })

      const conversation = await service.prisma.chatConversation.findUnique({
        where: { id: res.data.conversationId as string },
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
      const other = await service.prisma.user.create({
        data: {
          email: `other-post-create-idor-${Math.random().toString(36).slice(2, 8)}@goodparty.org`,
          firstName: 'Other',
          lastName: 'User',
        },
      })
      const otherMeetingDate = '2026-07-15'
      await createBriefingFixtures(other.id, otherMeetingDate)

      const res = await service.client.post('/v1/briefing-chats', {
        meetingDate: otherMeetingDate,
        anchor: { jsonPath: null, start: null, end: null },
      })

      expect(res.status).toBe(HttpStatus.NOT_FOUND)
    })
  })

  // Delete stays annotation-keyed because the briefing UI deletes the chat row
  // it renders, and that row is the annotation.
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

    it('returns 401 when Authorization is invalid', async () => {
      const res = await service.client.delete(
        `/v1/briefing-chats/${fixtures.annotation.id}`,
        { headers: { Authorization: 'Bearer invalid' } },
      )

      expect(res.status).toBe(HttpStatus.UNAUTHORIZED)
    })

    it('returns 404 when annotation belongs to another user (IDOR)', async () => {
      const other = await service.prisma.user.create({
        data: {
          email: `other-del-idor-${Math.random().toString(36).slice(2, 8)}@goodparty.org`,
          firstName: 'Other',
          lastName: 'User',
        },
      })
      const otherFixtures = await createBriefingFixtures(other.id)

      const res = await service.client.delete(
        `/v1/briefing-chats/${otherFixtures.annotation.id}`,
      )

      expect(res.status).toBe(HttpStatus.NOT_FOUND)
    })

    it('leaves a conversation with no chatConversationId untouched', async () => {
      const orphan = await service.prisma.annotation.create({
        data: {
          authorUserId: service.user.id,
          kind: AnnotationKind.chat,
          resourceId: fixtures.briefing.id,
          resourceType: AnnotationResourceType.briefing,
          jsonPath: '$.orphan',
          start: 0,
          end: 3,
        },
      })

      const res = await service.client.delete(`/v1/briefing-chats/${orphan.id}`)

      expect(res.status).toBe(HttpStatus.NOT_FOUND)
    })
  })
})
