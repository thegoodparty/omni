import { NotFoundException } from '@nestjs/common'
import {
  Annotation,
  AnnotationKind,
  AnnotationResourceType,
  ChatScope,
  MeetingBriefing,
} from '../../../generated/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatStoreService } from '@/chats/services/chatStore.prisma'
import type { BriefingContextService } from './briefingContext.service'
import type { BriefingNotesService } from './briefingNotes.service'
import { BriefingChatsService } from './briefing-chats.service'

const CONVERSATION_ID = 'conv-123'
const ANNOTATION_ID = 'anno-123'
const USER_ID = 7
const ORG_SLUG = 'org-oakland'

const buildAnnotation = (overrides: Partial<Annotation> = {}): Annotation =>
  ({
    id: ANNOTATION_ID,
    authorUserId: USER_ID,
    kind: AnnotationKind.chat,
    resourceId: 'briefing-1',
    resourceType: AnnotationResourceType.briefing,
    jsonPath: null,
    start: null,
    end: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    noteId: null,
    chatConversationId: CONVERSATION_ID,
    annotationBugReportId: null,
    annotationReviewId: null,
    ...overrides,
  }) as unknown as Annotation

const buildBriefing = (): MeetingBriefing =>
  ({
    id: 'briefing-1',
    electedOfficeId: 'eo-1',
    experimentRunId: 'run-1',
    artifactBucket: 'b',
    artifactKey: 'k',
    meetingDate: new Date('2026-06-01T00:00:00Z'),
    meetingTime: '18:00',
    meetingTimezone: 'America/New_York',
  }) as unknown as MeetingBriefing

class FakeBriefingContext {
  loadContext = vi.fn(() =>
    Promise.resolve({
      annotation: buildAnnotation(),
      briefing: buildBriefing(),
      artifactContent: '# Briefing',
      user: { firstName: 'Jane', lastName: 'Doe' },
      office: { title: 'Council Member', jurisdiction: null },
      organizationSlug: ORG_SLUG,
      organization: { ownerId: 9, overrideDistrictId: null, positionId: null },
    }),
  )

  asService(): BriefingContextService {
    return this as unknown as BriefingContextService
  }
}

class FakeChatStore {
  softDeleteConversation = vi.fn<
    (id: string, ownerUserId: number) => Promise<void>
  >(() => Promise.resolve())

  asService(): ChatStoreService {
    return this as unknown as ChatStoreService
  }
}

const buildService = (
  briefingContext: FakeBriefingContext,
  chatStore: FakeChatStore,
  notes: BriefingNotesService,
): BriefingChatsService =>
  new BriefingChatsService(
    briefingContext.asService(),
    chatStore.asService(),
    notes,
  )

const buildNotes = (): BriefingNotesService =>
  ({
    countNotesForUser: vi.fn(() => Promise.resolve(0)),
    loadNotesForChat: vi.fn(() => Promise.resolve([])),
  }) as unknown as BriefingNotesService

describe('BriefingChatsService', () => {
  let briefingContext: FakeBriefingContext
  let chatStore: FakeChatStore
  let svc: BriefingChatsService

  beforeEach(() => {
    briefingContext = new FakeBriefingContext()
    chatStore = new FakeChatStore()
    svc = buildService(briefingContext, chatStore, buildNotes())
  })

  // The annotation-keyed half of the lifecycle. Turns and history are the
  // shared conversation-keyed routes; this module owns create (in
  // BriefingChatCreateService) and this delete.
  it('exposes its handler as the briefing_annotation scope', () => {
    expect(svc.handler.scope).toBe(ChatScope.briefing_annotation)
  })

  describe('deleteConversation', () => {
    it('calls chatStore.softDeleteConversation with conversationId + ownerUserId', async () => {
      await svc.deleteConversation(ANNOTATION_ID, USER_ID)

      expect(briefingContext.loadContext).toHaveBeenCalledWith(
        ANNOTATION_ID,
        USER_ID,
      )
      expect(chatStore.softDeleteConversation).toHaveBeenCalledWith(
        CONVERSATION_ID,
        USER_ID,
      )
    })

    it('throws NotFoundException when annotation.chatConversationId is null', async () => {
      briefingContext.loadContext.mockResolvedValueOnce({
        annotation: buildAnnotation({ chatConversationId: null }),
        briefing: buildBriefing(),
        artifactContent: '# Briefing',
        user: { firstName: 'Jane', lastName: 'Doe' },
        office: { title: 'Council Member', jurisdiction: null },
        organizationSlug: ORG_SLUG,
        organization: {
          ownerId: 9,
          overrideDistrictId: null,
          positionId: null,
        },
      })
      await expect(
        svc.deleteConversation(ANNOTATION_ID, USER_ID),
      ).rejects.toBeInstanceOf(NotFoundException)
    })
  })
})
