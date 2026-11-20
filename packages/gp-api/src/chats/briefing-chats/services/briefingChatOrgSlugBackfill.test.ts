import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AnnotationKind,
  AnnotationResourceType,
  ChatScope,
  ExperimentRunStatus,
} from '../../../generated/prisma'
import { describe, expect, it } from 'vitest'
import { useTestService } from '@/test-service'

// The migration is what makes a briefing conversation created before the shared
// /v1/chats routes reachable on them: those rows carry the scope by column
// default but a NULL organization_slug, and the route's ownership check includes
// the slug. Run the real SQL against rows the test builds, rather than restating
// the join in TS, so a change to one without the other fails here.
const service = useTestService()

const BACKFILL_SQL = readFileSync(
  join(
    __dirname,
    '../../../../prisma/schema/migrations/20261120100000_backfill_briefing_chat_organization_slug/migration.sql',
  ),
  'utf8',
)

const seedBriefing = async (
  userId: number,
): Promise<{ briefingId: string; organizationSlug: string }> => {
  const organizationSlug = `backfill-${userId}-${Math.random().toString(36).slice(2, 10)}`
  await service.prisma.organization.create({
    data: { slug: organizationSlug, ownerId: userId },
  })
  const electedOffice = await service.prisma.electedOffice.create({
    data: { organizationSlug, userId },
  })
  const run = await service.prisma.experimentRun.create({
    data: {
      organizationSlug,
      experimentType: 'meeting_briefing',
      status: ExperimentRunStatus.COMPLETED,
    },
  })
  const briefing = await service.prisma.meetingBriefing.create({
    data: {
      electedOfficeId: electedOffice.id,
      experimentRunId: run.runId,
      artifactBucket: 'briefings-bucket',
      artifactKey: `${organizationSlug}/briefing.md`,
      meetingDate: new Date('2026-06-01T00:00:00Z'),
      meetingTime: '18:00',
      meetingTimezone: 'America/New_York',
    },
  })
  return { briefingId: briefing.id, organizationSlug }
}

// A conversation as the pre-#2464 create wrote it: default scope, no slug.
const seedLegacyConversation = async (
  userId: number,
  briefingId: string,
): Promise<{ conversationId: string }> => {
  const conversation = await service.prisma.chatConversation.create({
    data: {
      ownerUserId: userId,
      scope: ChatScope.briefing_annotation,
      organizationSlug: null,
    },
  })
  await service.prisma.annotation.create({
    data: {
      authorUserId: userId,
      kind: AnnotationKind.chat,
      resourceId: briefingId,
      resourceType: AnnotationResourceType.briefing,
      chatConversationId: conversation.id,
    },
  })
  return { conversationId: conversation.id }
}

describe('20261120100000 backfill briefing chat organization slug', () => {
  it("fills the slug from the conversation's briefing office", async () => {
    const { briefingId, organizationSlug } = await seedBriefing(service.user.id)
    const { conversationId } = await seedLegacyConversation(
      service.user.id,
      briefingId,
    )

    await service.prisma.$executeRawUnsafe(BACKFILL_SQL)

    const row = await service.prisma.chatConversation.findUniqueOrThrow({
      where: { id: conversationId },
    })
    expect(row.organizationSlug).toBe(organizationSlug)
  })

  it('leaves a slug-less conversation with no briefing annotation alone', async () => {
    const conversation = await service.prisma.chatConversation.create({
      data: {
        ownerUserId: service.user.id,
        scope: ChatScope.briefing_annotation,
        organizationSlug: null,
      },
    })

    await service.prisma.$executeRawUnsafe(BACKFILL_SQL)

    const row = await service.prisma.chatConversation.findUniqueOrThrow({
      where: { id: conversation.id },
    })
    expect(row.organizationSlug).toBeNull()
  })

  it('does not overwrite a slug the conversation already carries', async () => {
    const { briefingId } = await seedBriefing(service.user.id)
    const { conversationId } = await seedLegacyConversation(
      service.user.id,
      briefingId,
    )
    await service.prisma.chatConversation.update({
      where: { id: conversationId },
      data: { organizationSlug: 'already-set' },
    })

    await service.prisma.$executeRawUnsafe(BACKFILL_SQL)

    const row = await service.prisma.chatConversation.findUniqueOrThrow({
      where: { id: conversationId },
    })
    expect(row.organizationSlug).toBe('already-set')
  })
})
