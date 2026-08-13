import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { Campaign, User } from '../../generated/prisma'
import Stripe from 'stripe'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { firstOrThrow } from 'src/shared/test-utils/arrays.util'
import { EVENTS } from 'src/vendors/segment/segment.types'
import { CheckoutSessionMode, WebhookEventType } from '../payments.types'
import { PaymentEventsService } from './paymentEventsService'

describe('PaymentEventsService', () => {
  let service: PaymentEventsService
  const logger = createMockLogger()

  const usersService = {
    findUser: vi.fn(),
    findByCustomerId: vi.fn(),
    patchUserMetaData: vi.fn(),
    compareAndSwapCheckoutSessionId: vi.fn(),
  }
  const campaignsService = {
    findActiveByUserId: vi.fn(),
    patchCampaignDetails: vi.fn(),
    setIsPro: vi.fn(),
  }
  const analytics = {
    trackProPayment: vi.fn(),
    track: vi.fn(),
  }
  const slackService = { message: vi.fn() }
  const voterFileDownloadAccess = { downloadAccessAlert: vi.fn() }
  const organizationsService = {
    getDistrictAndBallotLevelForOrgSlug: vi.fn(),
    resolvePositionNameByOrganizationSlug: vi.fn(),
  }
  const crm = { getCrmCompanyOwnerName: vi.fn() }
  const tcrComplianceService = { enqueueAgenticKickoffIfNeeded: vi.fn() }
  const purchaseService = { completeCheckoutSession: vi.fn() }
  const raceOpponentService = { autoCollectOnProUpgrade: vi.fn() }
  const moduleRef = { get: vi.fn() }

  const mockUser = { id: 1, email: 'test@example.com' } as User
  const mockCampaign = {
    id: 111,
    organizationSlug: null,
    details: {
      electionDate: new Date(Date.now() + 365 * 86_400_000).toISOString(),
    },
    data: {},
  } as unknown as Campaign

  const subscriptionEvent = {
    type: WebhookEventType.CheckoutSessionCompleted,
    data: {
      object: {
        id: 'cs_test',
        mode: CheckoutSessionMode.SUBSCRIPTION,
        customer: 'cus_test',
        subscription: 'sub_test',
        metadata: { userId: '1' },
      },
    },
  } as unknown as Stripe.CheckoutSessionCompletedEvent

  const asyncPaymentEvent = {
    type: WebhookEventType.CheckoutSessionAsyncPaymentSucceeded,
    data: {
      object: {
        id: 'cs_async_test',
        mode: CheckoutSessionMode.PAYMENT,
        metadata: { userId: '1', purchaseType: 'poll' },
      },
    },
  } as unknown as Stripe.CheckoutSessionAsyncPaymentSucceededEvent

  const oneTimePaymentEvent = {
    type: WebhookEventType.CheckoutSessionCompleted,
    data: {
      object: {
        id: 'cs_paid_test',
        mode: CheckoutSessionMode.PAYMENT,
        metadata: { userId: '1', purchaseType: 'poll' },
      },
    },
  } as unknown as Stripe.CheckoutSessionCompletedEvent

  const subscriptionResumedEvent = {
    type: WebhookEventType.CustomerSubscriptionResumed,
    data: {
      object: { id: 'sub_resumed', customer: 'cus_test' },
    },
  } as unknown as Stripe.CustomerSubscriptionResumedEvent

  beforeEach(() => {
    vi.clearAllMocks()
    purchaseService.completeCheckoutSession.mockResolvedValue({
      alreadyProcessed: false,
    })
    usersService.findUser.mockResolvedValue(mockUser)
    usersService.findByCustomerId.mockResolvedValue(mockUser)
    usersService.patchUserMetaData.mockResolvedValue(undefined)
    campaignsService.findActiveByUserId.mockResolvedValue(mockCampaign)
    campaignsService.patchCampaignDetails.mockResolvedValue(undefined)
    campaignsService.setIsPro.mockResolvedValue({ becamePro: true })
    raceOpponentService.autoCollectOnProUpgrade.mockResolvedValue(undefined)
    moduleRef.get.mockReturnValue(raceOpponentService)
    analytics.trackProPayment.mockResolvedValue(undefined)
    analytics.track.mockResolvedValue(undefined)
    slackService.message.mockResolvedValue(undefined)
    voterFileDownloadAccess.downloadAccessAlert.mockResolvedValue(undefined)
    tcrComplianceService.enqueueAgenticKickoffIfNeeded.mockResolvedValue(
      undefined,
    )

    service = new PaymentEventsService(
      usersService as never,
      campaignsService as never,
      slackService as never,
      {} as never,
      crm as never,
      voterFileDownloadAccess as never,
      organizationsService as never,
      analytics as never,
      purchaseService as never,
      tcrComplianceService as never,
      moduleRef as never,
      logger,
    )
  })

  describe('handleEvent — checkout.session.completed (subscription)', () => {
    it('fires pro_upgrade_complete with the correct user id and payload', async () => {
      await service.handleEvent(subscriptionEvent)

      expect(analytics.track).toHaveBeenCalledExactlyOnceWith(
        mockUser.id,
        EVENTS.Account.ProUpgradeComplete,
        { pro: true },
      )
      expect(usersService.patchUserMetaData).toHaveBeenCalled()
    })

    it('patches customerId unconditionally but clears the session id via compare-and-swap', async () => {
      await service.handleEvent(subscriptionEvent)

      expect(usersService.patchUserMetaData).toHaveBeenCalledWith(1, {
        customerId: 'cus_test',
      })
      expect(usersService.compareAndSwapCheckoutSessionId).toHaveBeenCalledWith(
        1,
        'cs_test',
        null,
      )
    })

    it('resolves the authoritative ballot level and forwards it to the voter-file alert', async () => {
      campaignsService.findActiveByUserId.mockResolvedValue({
        ...mockCampaign,
        organizationSlug: 'team-acme',
      })
      organizationsService.getDistrictAndBallotLevelForOrgSlug.mockResolvedValue(
        {
          district: { id: 'd1', state: 'CA', l2Type: 'City', l2Name: 'Acme' },
          ballotLevel: 'FEDERAL',
        },
      )

      await service.handleEvent(subscriptionEvent)

      expect(
        organizationsService.getDistrictAndBallotLevelForOrgSlug,
      ).toHaveBeenCalledWith('team-acme')
      // The alert must judge eligibility by the server-determined level, not the
      // user-editable details.ballotLevel.
      expect(voterFileDownloadAccess.downloadAccessAlert).toHaveBeenCalledWith(
        expect.objectContaining({ organizationSlug: 'team-acme' }),
        mockUser,
        expect.objectContaining({ id: 'd1' }),
        'FEDERAL',
      )
    })

    it('swallows analytics.track errors and continues the flow', async () => {
      const trackError = new Error('segment down')
      analytics.track.mockRejectedValueOnce(trackError)

      await expect(
        service.handleEvent(subscriptionEvent),
      ).resolves.not.toThrow()

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ error: trackError }),
        expect.stringContaining('pro_upgrade_complete'),
      )
      expect(usersService.patchUserMetaData).toHaveBeenCalled()
    })

    it('fires pro_upgrade_complete even when trackProPayment throws', async () => {
      analytics.trackProPayment.mockRejectedValueOnce(new Error('boom'))

      await service.handleEvent(subscriptionEvent)

      expect(analytics.track).toHaveBeenCalledWith(
        mockUser.id,
        EVENTS.Account.ProUpgradeComplete,
        { pro: true },
      )
    })

    it('enqueues the agentic kickoff after marking the campaign Pro', async () => {
      await service.handleEvent(subscriptionEvent)

      expect(campaignsService.setIsPro).toHaveBeenCalledWith(mockCampaign.id)
      expect(
        tcrComplianceService.enqueueAgenticKickoffIfNeeded,
      ).toHaveBeenCalledExactlyOnceWith(mockCampaign.id)
      expect(
        campaignsService.setIsPro.mock.invocationCallOrder[0],
      ).toBeLessThan(
        firstOrThrow(
          tcrComplianceService.enqueueAgenticKickoffIfNeeded.mock
            .invocationCallOrder,
        ),
      )
    })

    it('does not fail the webhook when the kickoff enqueue throws', async () => {
      const enqueueError = new Error('SQS down')
      tcrComplianceService.enqueueAgenticKickoffIfNeeded.mockRejectedValueOnce(
        enqueueError,
      )

      await expect(
        service.handleEvent(subscriptionEvent),
      ).resolves.not.toThrow()

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ error: enqueueError }),
        expect.stringContaining('agentic compliance kickoff'),
      )
      expect(usersService.patchUserMetaData).toHaveBeenCalled()
    })
  })

  describe('auto-dispatch opponent collection on Pro upgrade', () => {
    it('dispatches collection once when checkout flips the campaign to Pro', async () => {
      campaignsService.setIsPro.mockResolvedValue({ becamePro: true })

      await service.handleEvent(subscriptionEvent)

      expect(
        raceOpponentService.autoCollectOnProUpgrade,
      ).toHaveBeenCalledExactlyOnceWith(mockCampaign.id)
    })

    it('dispatches collection once when a resumed subscription flips to Pro', async () => {
      campaignsService.setIsPro.mockResolvedValue({ becamePro: true })

      await service.handleEvent(subscriptionResumedEvent)

      expect(
        raceOpponentService.autoCollectOnProUpgrade,
      ).toHaveBeenCalledExactlyOnceWith(mockCampaign.id)
    })

    it('does not dispatch when the campaign was already Pro (no transition)', async () => {
      campaignsService.setIsPro.mockResolvedValue({ becamePro: false })

      await service.handleEvent(subscriptionEvent)

      expect(raceOpponentService.autoCollectOnProUpgrade).not.toHaveBeenCalled()
    })

    it('does not fail the webhook when the dispatch throws', async () => {
      campaignsService.setIsPro.mockResolvedValue({ becamePro: true })
      const dispatchError = new Error('SQS down')
      raceOpponentService.autoCollectOnProUpgrade.mockRejectedValueOnce(
        dispatchError,
      )

      await expect(
        service.handleEvent(subscriptionEvent),
      ).resolves.not.toThrow()

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ error: dispatchError }),
        expect.stringContaining('auto-dispatch opponent collection'),
      )
      // The Pro upgrade itself still completes.
      expect(usersService.patchUserMetaData).toHaveBeenCalled()
    })
  })

  describe('handleEvent — customer.subscription.resumed', () => {
    it('resolves the authoritative ballot level and forwards it to the voter-file alert', async () => {
      campaignsService.findActiveByUserId.mockResolvedValue({
        ...mockCampaign,
        organizationSlug: 'team-acme',
      })
      organizationsService.getDistrictAndBallotLevelForOrgSlug.mockResolvedValue(
        {
          district: { id: 'd1', state: 'CA', l2Type: 'City', l2Name: 'Acme' },
          ballotLevel: 'FEDERAL',
        },
      )

      await service.handleEvent(subscriptionResumedEvent)

      expect(
        organizationsService.getDistrictAndBallotLevelForOrgSlug,
      ).toHaveBeenCalledWith('team-acme')
      // Same server-authoritative requirement as the checkout-completed path:
      // the resumed handler must not let details.ballotLevel decide the alert.
      expect(voterFileDownloadAccess.downloadAccessAlert).toHaveBeenCalledWith(
        expect.objectContaining({ organizationSlug: 'team-acme' }),
        mockUser,
        expect.objectContaining({ id: 'd1' }),
        'FEDERAL',
      )
    })
  })

  describe('handleEvent — checkout.session.async_payment_succeeded', () => {
    it('completes the deferred one-time purchase using the confirmed event session', async () => {
      await service.handleEvent(asyncPaymentEvent)

      expect(purchaseService.completeCheckoutSession).toHaveBeenCalledWith(
        { checkoutSessionId: 'cs_async_test' },
        asyncPaymentEvent.data.object,
      )
    })

    it('propagates errors from completeCheckoutSession so Stripe retries', async () => {
      const fulfillmentError = new Error('DB unavailable')
      purchaseService.completeCheckoutSession.mockRejectedValueOnce(
        fulfillmentError,
      )

      await expect(service.handleEvent(asyncPaymentEvent)).rejects.toThrow(
        fulfillmentError,
      )
    })
  })

  describe('handleEvent — checkout.session.completed (one-time payment)', () => {
    it('delegates to completeCheckoutSession without a prefetched session', async () => {
      await service.handleEvent(oneTimePaymentEvent)

      expect(purchaseService.completeCheckoutSession).toHaveBeenCalledWith(
        { checkoutSessionId: 'cs_paid_test' },
        undefined,
      )
    })

    it('does not throw when fulfillment is deferred (unpaid)', async () => {
      purchaseService.completeCheckoutSession.mockResolvedValueOnce({
        alreadyProcessed: false,
        deferred: true,
      })

      await expect(
        service.handleEvent(oneTimePaymentEvent),
      ).resolves.not.toThrow()
    })

    it('propagates errors from completeCheckoutSession so Stripe retries', async () => {
      const fulfillmentError = new Error('DB unavailable')
      purchaseService.completeCheckoutSession.mockRejectedValueOnce(
        fulfillmentError,
      )

      await expect(service.handleEvent(oneTimePaymentEvent)).rejects.toThrow(
        fulfillmentError,
      )
    })
  })

  describe('active-campaign selection (multi-org)', () => {
    const activeCampaign = {
      id: 222,
      organizationSlug: null,
      details: {
        electionDate: new Date(Date.now() + 365 * 86_400_000).toISOString(),
      },
      data: {},
    } as unknown as Campaign

    it('writes Pro state to the active campaign for a multi-campaign user', async () => {
      campaignsService.findActiveByUserId.mockResolvedValue(activeCampaign)

      await service.handleEvent(subscriptionEvent)

      expect(campaignsService.findActiveByUserId).toHaveBeenCalledWith(
        mockUser.id,
      )
      expect(campaignsService.patchCampaignDetails).toHaveBeenCalledWith(
        activeCampaign.id,
        expect.objectContaining({ subscriptionId: 'sub_test' }),
      )
      expect(campaignsService.setIsPro).toHaveBeenCalledWith(activeCampaign.id)
    })

    it('completes an election-day checkout for the active campaign', async () => {
      const today = new Date()
      const electionDayCampaign = {
        id: 333,
        organizationSlug: null,
        details: { electionDate: today.toISOString() },
        data: {},
      } as unknown as Campaign
      campaignsService.findActiveByUserId.mockResolvedValue(electionDayCampaign)

      await expect(
        service.handleEvent(subscriptionEvent),
      ).resolves.not.toThrow()

      expect(campaignsService.setIsPro).toHaveBeenCalledWith(
        electionDayCampaign.id,
      )
    })

    it('no-ops and warns on checkout when the user has no active campaign', async () => {
      campaignsService.findActiveByUserId.mockResolvedValue(null)

      await expect(
        service.handleEvent(subscriptionEvent),
      ).resolves.not.toThrow()

      expect(campaignsService.patchCampaignDetails).not.toHaveBeenCalled()
      expect(campaignsService.setIsPro).not.toHaveBeenCalled()
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ userId: mockUser.id }),
        expect.stringContaining('active campaign'),
      )
    })
  })

  describe('checkoutSessionExpiredHandler', () => {
    const expiredEvent = (sessionId: string) =>
      ({
        type: WebhookEventType.CheckoutSessionExpired,
        data: {
          object: { id: sessionId, metadata: { userId: '1' } },
        },
      }) as unknown as Stripe.CheckoutSessionExpiredEvent

    it('conditionally clears the stored session id via compare-and-swap', async () => {
      usersService.compareAndSwapCheckoutSessionId.mockResolvedValue(true)

      await service.checkoutSessionExpiredHandler(expiredEvent('cs_expired'))

      expect(usersService.compareAndSwapCheckoutSessionId).toHaveBeenCalledWith(
        1,
        'cs_expired',
        null,
      )
    })

    it('tolerates a lost swap (newer session stored or user missing)', async () => {
      usersService.compareAndSwapCheckoutSessionId.mockResolvedValue(false)

      await expect(
        service.checkoutSessionExpiredHandler(expiredEvent('cs_expired')),
      ).resolves.toBeUndefined()
      expect(usersService.patchUserMetaData).not.toHaveBeenCalled()
    })

    it('logs and returns when the expired session carries no userId metadata', async () => {
      const event = {
        type: WebhookEventType.CheckoutSessionExpired,
        data: { object: { id: 'cs_expired', metadata: {} } },
      } as unknown as Stripe.CheckoutSessionExpiredEvent

      await expect(
        service.checkoutSessionExpiredHandler(event),
      ).resolves.toBeUndefined()
      expect(
        usersService.compareAndSwapCheckoutSessionId,
      ).not.toHaveBeenCalled()
    })
  })

  describe('customerSubscriptionCreatedHandler', () => {
    const createdEvent = {
      data: { object: { id: 'sub_new', customer: 'cus_test' } },
    } as unknown as Stripe.CustomerSubscriptionCreatedEvent

    it('persists the subscriptionId on the active campaign', async () => {
      await service.customerSubscriptionCreatedHandler(createdEvent)

      expect(campaignsService.patchCampaignDetails).toHaveBeenCalledWith(
        mockCampaign.id,
        expect.objectContaining({ subscriptionId: 'sub_new' }),
      )
    })

    it('no-ops and warns when the user has no active campaign', async () => {
      campaignsService.findActiveByUserId.mockResolvedValue(null)

      await expect(
        service.customerSubscriptionCreatedHandler(createdEvent),
      ).resolves.not.toThrow()

      expect(campaignsService.patchCampaignDetails).not.toHaveBeenCalled()
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ userId: mockUser.id }),
        expect.stringContaining('active campaign'),
      )
    })
  })

  describe('customerSubscriptionResumedHandler', () => {
    const resumedEvent = {
      data: { object: { id: 'sub_resumed', customer: 'cus_test' } },
    } as unknown as Stripe.CustomerSubscriptionResumedEvent

    it('marks the active campaign Pro', async () => {
      await service.customerSubscriptionResumedHandler(resumedEvent)

      expect(campaignsService.patchCampaignDetails).toHaveBeenCalledWith(
        mockCampaign.id,
        expect.objectContaining({ subscriptionId: 'sub_resumed' }),
      )
      expect(campaignsService.setIsPro).toHaveBeenCalledWith(mockCampaign.id)
    })

    it('no-ops and warns when the user has no active campaign', async () => {
      campaignsService.findActiveByUserId.mockResolvedValue(null)

      await expect(
        service.customerSubscriptionResumedHandler(resumedEvent),
      ).resolves.not.toThrow()

      expect(campaignsService.patchCampaignDetails).not.toHaveBeenCalled()
      expect(campaignsService.setIsPro).not.toHaveBeenCalled()
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ userId: mockUser.id }),
        expect.stringContaining('active campaign'),
      )
    })
  })
})
