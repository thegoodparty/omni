import { User } from '../../../generated/prisma'
import { PinoLogger } from 'nestjs-pino'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import type { BriefingChatCreateService } from '../services/briefingChatCreate.service'
import type { BriefingChatsService } from '../services/briefing-chats.service'
import { BriefingChatsController } from './briefing-chats.controller'

const ANNOTATION_ID = 'anno-1'
const USER_ID = 42

const buildUser = (id: number): User => ({ id }) as unknown as User

const buildChats = (
  overrides: Partial<BriefingChatsService> = {},
): BriefingChatsService =>
  ({
    deleteConversation: vi.fn(() => Promise.resolve()),
    ...overrides,
  }) as unknown as BriefingChatsService

const buildCreateService = (
  overrides: Partial<BriefingChatCreateService> = {},
): BriefingChatCreateService =>
  ({
    findOrCreate: vi.fn(() =>
      Promise.resolve({
        annotationId: 'anno-new',
        conversationId: 'conv-new',
      }),
    ),
    ...overrides,
  }) as unknown as BriefingChatCreateService

// The annotation-keyed half of a briefing chat. Turns and history are on
// /v1/chats/:conversationId and are covered by general-chats' own tests.
describe('BriefingChatsController', () => {
  let logger: PinoLogger

  beforeEach(() => {
    logger = createMockLogger()
  })

  describe('createChat', () => {
    it('creates the annotation and its conversation in one call', async () => {
      const create = buildCreateService()
      const controller = new BriefingChatsController(
        buildChats(),
        create,
        logger,
      )
      const anchor = { jsonPath: null, start: null, end: null }

      const result = await controller.createChat(buildUser(USER_ID), {
        meetingDate: '2026-06-01',
        anchor,
      })

      expect(create.findOrCreate).toHaveBeenCalledWith({
        userId: USER_ID,
        meetingDate: '2026-06-01',
        anchor,
      })
      expect(result).toEqual({
        annotationId: 'anno-new',
        conversationId: 'conv-new',
      })
    })
  })

  describe('deleteConversation', () => {
    it('soft-deletes under the caller', async () => {
      const chats = buildChats()
      const controller = new BriefingChatsController(
        chats,
        buildCreateService(),
        logger,
      )

      await controller.deleteConversation(buildUser(USER_ID), ANNOTATION_ID)

      expect(chats.deleteConversation).toHaveBeenCalledWith(
        ANNOTATION_ID,
        USER_ID,
      )
    })
  })
})
