import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { PinoLogger } from 'nestjs-pino'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ElectedOfficeService } from 'src/electedOffice/services/electedOffice.service'
import { UsersService } from 'src/users/services/users.service'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { PollPurchaseHandlerService } from './pollPurchase.service'
import { PollsService } from './polls.service'

const POLL_ID = '0190f8c7-9b3a-7c41-a8e2-1234567890ab'

describe('PollPurchaseHandlerService', () => {
  let service: PollPurchaseHandlerService
  let pollsService: {
    expandPoll: ReturnType<typeof vi.fn>
    findUnique: ReturnType<typeof vi.fn>
    create: ReturnType<typeof vi.fn>
  }
  let electedOfficeService: { findFirst: ReturnType<typeof vi.fn> }
  let usersService: { findUser: ReturnType<typeof vi.fn> }

  beforeEach(async () => {
    pollsService = {
      expandPoll: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    }
    electedOfficeService = { findFirst: vi.fn() }
    usersService = { findUser: vi.fn() }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PollPurchaseHandlerService,
        { provide: PollsService, useValue: pollsService },
        { provide: ElectedOfficeService, useValue: electedOfficeService },
        { provide: UsersService, useValue: usersService },
        { provide: PinoLogger, useValue: createMockLogger() },
      ],
    }).compile()

    service = module.get(PollPurchaseHandlerService)
    vi.clearAllMocks()
  })

  describe('handlePollPostPurchase - expansion ownership', () => {
    const rawMetadata = {
      pollPurchaseType: 'expansion',
      pollId: POLL_ID,
      count: 5,
      userId: '1',
    }

    beforeEach(() => {
      usersService.findUser.mockResolvedValue({ id: 1 })
      electedOfficeService.findFirst.mockResolvedValue({ id: 'eo-1' })
    })

    it("expands the poll when it belongs to the buyer's elected office", async () => {
      pollsService.findUnique.mockResolvedValue({
        id: POLL_ID,
        electedOfficeId: 'eo-1',
      })

      await service.handlePollPostPurchase('sess_1', rawMetadata)

      expect(pollsService.expandPoll).toHaveBeenCalledWith(
        expect.objectContaining({
          pollId: POLL_ID,
          additionalRecipientCount: 5,
        }),
      )
    })

    it('throws ForbiddenException and does not expand another office poll', async () => {
      pollsService.findUnique.mockResolvedValue({
        id: POLL_ID,
        electedOfficeId: 'eo-victim',
      })

      await expect(
        service.handlePollPostPurchase('sess_1', rawMetadata),
      ).rejects.toThrow(ForbiddenException)
      expect(pollsService.expandPoll).not.toHaveBeenCalled()
    })

    it('throws NotFoundException when the poll does not exist', async () => {
      pollsService.findUnique.mockResolvedValue(null)

      await expect(
        service.handlePollPostPurchase('sess_1', rawMetadata),
      ).rejects.toThrow(NotFoundException)
      expect(pollsService.expandPoll).not.toHaveBeenCalled()
    })
  })
})
