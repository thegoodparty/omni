import { BadRequestException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { PinoLogger } from 'nestjs-pino'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PrismaService } from '@/prisma/prisma.service'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { firstOrThrow, nthOrThrow } from 'src/shared/test-utils/arrays.util'
import { calcTextAmountInCents } from '@/shared/util/textPricing.util'
import { OutreachStatus, OutreachType } from 'src/generated/prisma'
import { QueueProducerService } from 'src/queue/producer/queueProducer.service'
import { QueueType } from 'src/queue/queue.types'
import { OutreachServeSmsPurchaseHandlerService } from './outreachServeSmsPurchase.service'

const OUTREACH_ID = 4242
const ORG = 'eo-city-council'
const SESSION_ID = 'cs_test_abc'

// What the checkout-create path hands the handler: the client's own JSON
// merged under the server-resolved org scope.
const metadata = { outreachId: OUTREACH_ID, organizationSlug: ORG }

// What the webhook path hands it: Stripe round-trips every value as a string.
const stripeMetadata = {
  outreachId: String(OUTREACH_ID),
  organizationSlug: ORG,
  purchaseType: 'SERVE_TEXT',
}

describe('OutreachServeSmsPurchaseHandlerService', () => {
  let service: OutreachServeSmsPurchaseHandlerService
  let prisma: {
    outreach: {
      findFirst: ReturnType<typeof vi.fn>
      updateMany: ReturnType<typeof vi.fn>
    }
  }
  let queueProducer: { sendMessage: ReturnType<typeof vi.fn> }

  beforeEach(async () => {
    prisma = { outreach: { findFirst: vi.fn(), updateMany: vi.fn() } }
    queueProducer = { sendMessage: vi.fn() }

    const module = await Test.createTestingModule({
      providers: [
        OutreachServeSmsPurchaseHandlerService,
        { provide: PrismaService, useValue: prisma },
        { provide: QueueProducerService, useValue: queueProducer },
        { provide: PinoLogger, useValue: createMockLogger() },
      ],
    }).compile()

    service = module.get(OutreachServeSmsPurchaseHandlerService)
  })

  describe('calculateAmount — server-side re-derivation', () => {
    it('prices the row’s server-written textCount, not the client’s', async () => {
      prisma.outreach.findFirst.mockResolvedValue({
        status: OutreachStatus.pending_payment,
        textCount: 2500,
      })

      const amount = await service.calculateAmount({
        ...metadata,
        // Everything below is client-controlled and must be ignored.
        contactCount: 1,
        textCount: 1,
        recipientCount: 1,
        amount: 1,
      })

      expect(amount).toBe(calcTextAmountInCents(2500))
      expect(amount).not.toBe(calcTextAmountInCents(1))
    })

    it('scopes the lookup to a Serve text draft in the caller’s org', async () => {
      prisma.outreach.findFirst.mockResolvedValue({
        status: OutreachStatus.pending_payment,
        textCount: 10,
      })

      await service.calculateAmount(metadata)

      expect(prisma.outreach.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: OUTREACH_ID,
            organizationSlug: ORG,
            campaignId: null,
            outreachType: OutreachType.text,
          },
        }),
      )
    })

    it('refuses a row that is not this org’s (no cross-org pricing)', async () => {
      prisma.outreach.findFirst.mockResolvedValue(null)

      await expect(service.calculateAmount(metadata)).rejects.toThrow(
        BadRequestException,
      )
    })

    it('refuses a draft with no server-derived recipient count', async () => {
      prisma.outreach.findFirst.mockResolvedValue({
        status: OutreachStatus.pending_payment,
        textCount: null,
      })

      await expect(
        service.calculateAmount({ ...metadata, contactCount: 5000 }),
      ).rejects.toThrow(BadRequestException)
    })

    it('refuses malformed metadata rather than pricing a guess', async () => {
      await expect(
        service.calculateAmount({ organizationSlug: ORG }),
      ).rejects.toThrow(BadRequestException)
      expect(prisma.outreach.findFirst).not.toHaveBeenCalled()
    })
  })

  describe('validatePurchase', () => {
    it('accepts a draft awaiting payment', async () => {
      prisma.outreach.findFirst.mockResolvedValue({
        status: OutreachStatus.pending_payment,
        textCount: 100,
      })

      await expect(service.validatePurchase(metadata)).resolves.toBeUndefined()
    })

    it('refuses a second checkout for an already-paid send', async () => {
      prisma.outreach.findFirst.mockResolvedValue({
        status: OutreachStatus.pending,
        textCount: 100,
      })

      await expect(service.validatePurchase(metadata)).rejects.toThrow(
        BadRequestException,
      )
    })
  })

  describe('executePostPurchase — claim and enqueue', () => {
    it('claims pending_payment -> pending and enqueues the send', async () => {
      prisma.outreach.findFirst.mockResolvedValue({ textCount: 300 })
      prisma.outreach.updateMany.mockResolvedValue({ count: 1 })

      await service.executePostPurchase(SESSION_ID, stripeMetadata)

      expect(prisma.outreach.updateMany).toHaveBeenCalledWith({
        where: {
          id: OUTREACH_ID,
          organizationSlug: ORG,
          campaignId: null,
          outreachType: OutreachType.text,
          status: OutreachStatus.pending_payment,
        },
        data: {
          status: OutreachStatus.pending,
          billableTextCount: 300,
          stripeCheckoutSessionId: SESSION_ID,
        },
      })
      expect(queueProducer.sendMessage).toHaveBeenCalledWith(
        {
          type: QueueType.OUTREACH_TEXT_SEND,
          data: { outreachId: OUTREACH_ID, sendSeq: 1 },
        },
        `outreachTextSend-${OUTREACH_ID}`,
        {
          throwOnError: true,
          deduplicationId: `${QueueType.OUTREACH_TEXT_SEND}-${OUTREACH_ID}-1`,
        },
      )
    })

    it('serializes deliveries per outreach and dedupes a racing duplicate', async () => {
      prisma.outreach.findFirst.mockResolvedValue({ textCount: 10 })
      prisma.outreach.updateMany.mockResolvedValue({ count: 1 })

      await service.executePostPurchase(SESSION_ID, stripeMetadata)

      const [, group, options] = firstOrThrow(
        queueProducer.sendMessage.mock.calls,
      )
      expect(group).toContain(String(OUTREACH_ID))
      expect(options.deduplicationId).toContain(String(OUTREACH_ID))
      expect(options.throwOnError).toBe(true)
    })

    it('does not persist a synthetic free-purchase session id', async () => {
      prisma.outreach.findFirst.mockResolvedValue({ textCount: 10 })
      prisma.outreach.updateMany.mockResolvedValue({ count: 1 })

      await service.executePostPurchase('free_confirmed_123', stripeMetadata)

      const [{ data }] = firstOrThrow(prisma.outreach.updateMany.mock.calls)
      expect(data).not.toHaveProperty('stripeCheckoutSessionId')
    })

    it('rejects an outreachId that names nothing in this org, without claiming', async () => {
      prisma.outreach.findFirst.mockResolvedValue(null)

      await expect(
        service.executePostPurchase(SESSION_ID, stripeMetadata),
      ).rejects.toThrow(BadRequestException)
      expect(prisma.outreach.updateMany).not.toHaveBeenCalled()
      expect(queueProducer.sendMessage).not.toHaveBeenCalled()
    })
  })

  describe('executePostPurchase — idempotency on redelivery', () => {
    it('does not claim or enqueue twice when the row already moved on', async () => {
      prisma.outreach.findFirst
        .mockResolvedValueOnce({ textCount: 300 })
        .mockResolvedValueOnce({ status: OutreachStatus.in_progress })
      prisma.outreach.updateMany.mockResolvedValue({ count: 0 })

      await service.executePostPurchase(SESSION_ID, stripeMetadata)

      expect(queueProducer.sendMessage).not.toHaveBeenCalled()
    })

    it('re-enqueues a claimed-but-unproven send rather than assuming it happened', async () => {
      prisma.outreach.findFirst
        .mockResolvedValueOnce({ textCount: 300 })
        .mockResolvedValueOnce({ status: OutreachStatus.pending })
      prisma.outreach.updateMany.mockResolvedValue({ count: 0 })

      await service.executePostPurchase(SESSION_ID, stripeMetadata)

      expect(queueProducer.sendMessage).toHaveBeenCalledTimes(1)
      expect(firstOrThrow(queueProducer.sendMessage.mock.calls)[2]).toEqual(
        expect.objectContaining({
          deduplicationId: `${QueueType.OUTREACH_TEXT_SEND}-${OUTREACH_ID}-1`,
        }),
      )
    })

    it('throws a retryable error when a lost claim left the row unpaid-looking', async () => {
      prisma.outreach.findFirst
        .mockResolvedValueOnce({ textCount: 300 })
        .mockResolvedValueOnce({ status: OutreachStatus.pending_payment })
      prisma.outreach.updateMany.mockResolvedValue({ count: 0 })

      const error = await service
        .executePostPurchase(SESSION_ID, stripeMetadata)
        .catch((err: unknown) => err)

      // NOT a BadRequestException: the webhook acks those permanently, and
      // this one has to come back.
      expect(error).toBeInstanceOf(Error)
      expect(error).not.toBeInstanceOf(BadRequestException)
      expect(queueProducer.sendMessage).not.toHaveBeenCalled()
    })

    it('refuses to send against a canceled draft', async () => {
      prisma.outreach.findFirst
        .mockResolvedValueOnce({ textCount: 300 })
        .mockResolvedValueOnce({ status: OutreachStatus.canceled })
      prisma.outreach.updateMany.mockResolvedValue({ count: 0 })

      await expect(
        service.executePostPurchase(SESSION_ID, stripeMetadata),
      ).rejects.toThrow(BadRequestException)
      expect(queueProducer.sendMessage).not.toHaveBeenCalled()
    })
  })

  describe('executePostPurchase — failure after the claim', () => {
    it('reverts the claim and rethrows when the enqueue fails', async () => {
      prisma.outreach.findFirst.mockResolvedValue({ textCount: 300 })
      prisma.outreach.updateMany.mockResolvedValue({ count: 1 })
      queueProducer.sendMessage.mockRejectedValue(new Error('sqs down'))

      await expect(
        service.executePostPurchase(SESSION_ID, stripeMetadata),
      ).rejects.toThrow('sqs down')

      expect(prisma.outreach.updateMany).toHaveBeenCalledTimes(2)
      expect(prisma.outreach.updateMany).toHaveBeenLastCalledWith({
        where: {
          id: OUTREACH_ID,
          organizationSlug: ORG,
          status: OutreachStatus.pending,
        },
        data: { status: OutreachStatus.pending_payment },
      })
    })

    it('leaves the checkout session id on the reverted row', async () => {
      prisma.outreach.findFirst.mockResolvedValue({ textCount: 300 })
      prisma.outreach.updateMany.mockResolvedValue({ count: 1 })
      queueProducer.sendMessage.mockRejectedValue(new Error('sqs down'))

      await service
        .executePostPurchase(SESSION_ID, stripeMetadata)
        .catch(() => undefined)

      const [{ data }] = nthOrThrow(prisma.outreach.updateMany.mock.calls, 1)
      expect(data).not.toHaveProperty('stripeCheckoutSessionId')
    })

    it('surfaces an enqueue failure as retryable, not permanently rejected', async () => {
      prisma.outreach.findFirst.mockResolvedValue({ textCount: 300 })
      prisma.outreach.updateMany.mockResolvedValue({ count: 1 })
      queueProducer.sendMessage.mockRejectedValue(new Error('sqs down'))

      const error = await service
        .executePostPurchase(SESSION_ID, stripeMetadata)
        .catch((err: unknown) => err)

      expect(error).not.toBeInstanceOf(BadRequestException)
    })
  })
})
