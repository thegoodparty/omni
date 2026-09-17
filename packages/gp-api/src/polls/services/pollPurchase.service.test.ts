import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
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

    it('throws BadRequestException when the buyer has no elected office', async () => {
      electedOfficeService.findFirst.mockResolvedValue(null)

      await expect(
        service.handlePollPostPurchase('sess_1', rawMetadata),
      ).rejects.toThrow(BadRequestException)
      expect(pollsService.expandPoll).not.toHaveBeenCalled()
    })
  })

  // The duplicate arrives because completeCheckoutSession can run twice for one
  // payment: the Stripe webhook and the browser redirect both call it, and the
  // postPurchaseCompletedAt marker is only written after the handler returns.
  // Both attempts carry the same client-minted pollId, so the second insert
  // trips the poll primary key.
  describe('handlePollPostPurchase - new poll duplicate fulfillment', () => {
    const rawMetadata = {
      pollPurchaseType: 'new',
      pollId: POLL_ID,
      name: 'Top Community Issues',
      message: 'What matters most to you?',
      audienceSize: 500,
      scheduledDate: '2026-09-20T00:00:00.000Z',
      userId: '1',
    }

    const uniqueConstraintError = () =>
      Object.assign(
        new Error('Unique constraint failed on the fields: (`id`)'),
        {
          name: 'PrismaClientKnownRequestError',
          code: 'P2002',
          meta: { target: ['id'] },
        },
      )

    beforeEach(() => {
      usersService.findUser.mockResolvedValue({ id: 1 })
      electedOfficeService.findFirst.mockResolvedValue({ id: 'eo-1' })
    })

    it('creates the poll with the checkout pollId on the first fulfillment', async () => {
      pollsService.create.mockResolvedValue({ id: POLL_ID })

      await service.handlePollPostPurchase('sess_1', rawMetadata)

      expect(pollsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          id: POLL_ID,
          electedOfficeId: 'eo-1',
          targetAudienceSize: 500,
        }),
      )
    })

    it('swallows the duplicate-create P2002 when the poll is already the buyer own', async () => {
      pollsService.create.mockRejectedValue(uniqueConstraintError())
      pollsService.findUnique.mockResolvedValue({
        id: POLL_ID,
        electedOfficeId: 'eo-1',
      })

      await expect(
        service.handlePollPostPurchase('sess_1', rawMetadata),
      ).resolves.toBeUndefined()
    })

    it('rejects permanently when the pollId belongs to another elected office', async () => {
      pollsService.create.mockRejectedValue(uniqueConstraintError())
      pollsService.findUnique.mockResolvedValue({
        id: POLL_ID,
        electedOfficeId: 'eo-victim',
      })

      // BadRequestException specifically: paymentEventsService acknowledges
      // BadRequest and retries everything else, and a client-chosen id owned by
      // another office is identical on every redelivery.
      await expect(
        service.handlePollPostPurchase('sess_1', rawMetadata),
      ).rejects.toThrow(BadRequestException)
    })

    it('stays retryable when the conflicting poll cannot be re-read', async () => {
      pollsService.create.mockRejectedValue(uniqueConstraintError())
      pollsService.findUnique.mockResolvedValue(null)

      const error = await service
        .handlePollPostPurchase('sess_1', rawMetadata)
        .catch((e: unknown) => e)

      expect(error).toBeInstanceOf(ConflictException)
      // Not a BadRequest, so the webhook rethrows and Stripe redelivers rather
      // than acknowledging a purchase that fulfilled nothing.
      expect(error).not.toBeInstanceOf(BadRequestException)
    })

    it('rethrows non-P2002 Prisma failures instead of reporting fulfillment', async () => {
      const poolTimeout = Object.assign(new Error('pool timeout'), {
        name: 'PrismaClientKnownRequestError',
        code: 'P2024',
      })
      pollsService.create.mockRejectedValue(poolTimeout)

      await expect(
        service.handlePollPostPurchase('sess_1', rawMetadata),
      ).rejects.toThrow('pool timeout')
      expect(pollsService.findUnique).not.toHaveBeenCalled()
    })
  })
})
