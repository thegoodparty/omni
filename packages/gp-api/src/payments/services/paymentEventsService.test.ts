import {
  BadGatewayException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { Campaign, User } from '../../generated/prisma'
import Stripe from 'stripe'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { firstOrThrow } from 'src/shared/test-utils/arrays.util'
import { EVENTS } from 'src/vendors/segment/segment.types'
import { CheckoutSessionMode, WebhookEventType } from '../payments.types'
import { OutreachRobocallWebhookService } from '../../outreach/services/outreachRobocallWebhook.service'
import { PaymentEventsService } from './paymentEventsService'

describe('PaymentEventsService', () => {
  let service: PaymentEventsService
  const logger = createMockLogger()

  const usersService = {
    findUser: vi.fn(),
    findByCustomerId: vi.fn(),
    findUserByEmail: vi.fn(),
    findByCampaign: vi.fn(),
    patchUserMetaData: vi.fn(),
    compareAndSwapCheckoutSessionId: vi.fn(),
  }
  const campaignsService = {
    findActiveByUserId: vi.fn(),
    findBySubscriptionId: vi.fn(),
    patchCampaignDetails: vi.fn(),
    persistCampaignProCancellation: vi.fn(),
    setIsPro: vi.fn(),
  }
  const emailService = { sendCancellationRequestConfirmationEmail: vi.fn() }
  const stripeService = { retrieveCustomer: vi.fn() }
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
  const robocallWebhookService = {
    cancelNotYetDialedForDetachedPaymentMethod: vi.fn(),
    markDisputedByIntent: vi.fn(),
    retryHoldFailedForAttachedCard: vi.fn(),
  }
  const moduleRef = { get: vi.fn() }

  const nowSeconds = () => Math.floor(Date.now() / 1000)

  const mockUser = { id: 1, email: 'test@example.com' } as User
  const mockCampaign = {
    id: 111,
    userId: 1,
    slug: 'test-campaign',
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
    usersService.findByCampaign.mockResolvedValue(mockUser)
    // The email fallback finds nothing unless a test says otherwise, so the
    // classification under test is the one the stored customer id produced.
    usersService.findUserByEmail.mockResolvedValue(null)
    stripeService.retrieveCustomer.mockResolvedValue({
      id: 'cus_test_unmatched',
      email: 'someone@example.com',
    })
    campaignsService.findActiveByUserId.mockResolvedValue(mockCampaign)
    campaignsService.findBySubscriptionId.mockResolvedValue(mockCampaign)
    campaignsService.patchCampaignDetails.mockResolvedValue(undefined)
    campaignsService.persistCampaignProCancellation.mockResolvedValue(undefined)
    emailService.sendCancellationRequestConfirmationEmail.mockResolvedValue(
      undefined,
    )
    campaignsService.setIsPro.mockResolvedValue({ becamePro: true })
    raceOpponentService.autoCollectOnProUpgrade.mockResolvedValue(undefined)
    robocallWebhookService.cancelNotYetDialedForDetachedPaymentMethod.mockResolvedValue(
      undefined,
    )
    robocallWebhookService.markDisputedByIntent.mockResolvedValue(undefined)
    robocallWebhookService.retryHoldFailedForAttachedCard.mockResolvedValue(
      undefined,
    )
    moduleRef.get.mockImplementation((token) =>
      token === OutreachRobocallWebhookService
        ? robocallWebhookService
        : raceOpponentService,
    )
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
      emailService as never,
      crm as never,
      voterFileDownloadAccess as never,
      organizationsService as never,
      analytics as never,
      purchaseService as never,
      tcrComplianceService as never,
      stripeService as never,
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

    it('error-logs a differing stored subscriptionId without blocking fulfillment', async () => {
      campaignsService.findActiveByUserId.mockResolvedValue({
        ...mockCampaign,
        details: { ...mockCampaign.details, subscriptionId: 'sub_previous' },
      })

      await service.handleEvent(subscriptionEvent)

      expect(logger.error).toHaveBeenCalledWith(
        {
          campaignId: mockCampaign.id,
          userId: mockUser.id,
          previousSubscriptionId: 'sub_previous',
          incomingSubscriptionId: 'sub_test',
        },
        expect.stringContaining('possible duplicate Pro subscription'),
      )
      expect(campaignsService.patchCampaignDetails).toHaveBeenCalledWith(
        mockCampaign.id,
        { subscriptionId: 'sub_test' },
      )
      expect(campaignsService.setIsPro).toHaveBeenCalledWith(mockCampaign.id)
    })

    it('does not log a duplicate alert when the stored subscriptionId matches (webhook replay)', async () => {
      campaignsService.findActiveByUserId.mockResolvedValue({
        ...mockCampaign,
        details: { ...mockCampaign.details, subscriptionId: 'sub_test' },
      })

      await service.handleEvent(subscriptionEvent)

      expect(logger.error).not.toHaveBeenCalled()
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

    // A 400 is a permanent content rejection (e.g. Peerly refusing the
    // script) — redelivery can never succeed, so the webhook must ack it.
    it('acknowledges a BadRequestException rejection instead of retrying', async () => {
      purchaseService.completeCheckoutSession.mockRejectedValueOnce(
        new BadRequestException(
          'Message cannot contain tinyurl.com links. Please correct your message.',
        ),
      )

      await expect(
        service.handleEvent(oneTimePaymentEvent),
      ).resolves.not.toThrow()
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

  // Both subscription handlers resolve their campaign through
  // details.subscriptionId and used to 502 when that lookup missed, which only
  // bought seven Stripe retries over ~68h on a state no redelivery can change.
  // The miss covers three conditions; these assert each one is separated and
  // that the two costly ones are louder than before, not quieter.
  describe('customerSubscriptionUpdatedHandler', () => {
    const updatedEvent = (
      subscription: Record<string, unknown> = {},
      previousAttributes: Record<string, unknown> = {},
    ) =>
      ({
        type: WebhookEventType.CustomerSubscriptionUpdated,
        data: {
          object: {
            id: 'sub_test_unmatched',
            customer: 'cus_test_unmatched',
            status: 'canceled',
            // Old enough that the fulfillment write that links a subscription
            // has long since either landed or failed.
            created: nowSeconds() - 86_400,
            cancel_at: null,
            canceled_at: 1_757_289_600,
            cancellation_details: { reason: 'cancellation_requested' },
            ...subscription,
          },
          previous_attributes: previousAttributes,
        },
      }) as unknown as Stripe.CustomerSubscriptionUpdatedEvent

    // The confirmation email is the candidate's only receipt for a scheduled
    // cancellation. It has to stay bound to a resolved campaign: the user it
    // addresses is read off that campaign, so an unmatched subscription has
    // nobody to send it to.
    it('confirms a cancellation request by email only when the subscription resolves to a campaign', async () => {
      const cancellationRequest = updatedEvent(
        { status: 'active', cancel_at: 1_760_000_000 },
        { cancel_at: 1_790_000_000 },
      )

      await service.customerSubscriptionUpdatedHandler(cancellationRequest)

      expect(
        emailService.sendCancellationRequestConfirmationEmail,
      ).toHaveBeenCalledExactlyOnceWith(mockUser, expect.any(String))

      campaignsService.findBySubscriptionId.mockResolvedValue(null)
      await service.customerSubscriptionUpdatedHandler(cancellationRequest)

      expect(
        emailService.sendCancellationRequestConfirmationEmail,
      ).toHaveBeenCalledOnce()
    })

    // The id this lookup reads is written by our own fulfillment, seconds after
    // checkout, and Stripe delivers a subscription's sibling events
    // concurrently with that write. Acknowledging a miss this young would drop
    // a first-time Pro upgrade's events and report the new customer as one we
    // are charging for nothing.
    it('asks Stripe to redeliver an unmatched subscription minted moments ago', async () => {
      campaignsService.findBySubscriptionId.mockResolvedValue(null)

      await expect(
        service.customerSubscriptionUpdatedHandler(
          updatedEvent({ status: 'active', created: nowSeconds() - 5 }),
        ),
      ).rejects.toThrow(ServiceUnavailableException)

      expect(logger.error).not.toHaveBeenCalled()
    })

    it('acknowledges an unmatched subscription instead of leaving Stripe to retry it', async () => {
      campaignsService.findBySubscriptionId.mockResolvedValue(null)

      await expect(
        service.customerSubscriptionUpdatedHandler(updatedEvent()),
      ).resolves.toBeUndefined()

      expect(campaignsService.patchCampaignDetails).not.toHaveBeenCalled()
    })

    // The worst case, and the one a bare warn-and-return would have buried: a
    // live subscription cannot be the residue of an account deletion, because
    // deleteUser cancels the subscription it deletes.
    it('error-logs an unmatched subscription that is still billing, naming the subscription and the customer', async () => {
      campaignsService.findBySubscriptionId.mockResolvedValue(null)

      await service.customerSubscriptionUpdatedHandler(
        updatedEvent({
          status: 'active',
          canceled_at: null,
          cancellation_details: null,
        }),
      )

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: 'sub_test_unmatched',
          customerId: 'cus_test_unmatched',
          status: 'active',
        }),
        expect.stringContaining('still billable'),
      )
      // The status settles it on its own — no account lookup can make a billing
      // subscription harmless.
      expect(usersService.findByCustomerId).not.toHaveBeenCalled()
    })

    it('error-logs an unmatched canceled subscription whose account is still live', async () => {
      campaignsService.findBySubscriptionId.mockResolvedValue(null)

      await service.customerSubscriptionUpdatedHandler(updatedEvent())

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: 'sub_test_unmatched',
          customerId: 'cus_test_unmatched',
          userId: mockUser.id,
          cancellationReason: 'cancellation_requested',
        }),
        expect.stringContaining('cancellation was never applied'),
      )
    })

    it('warns rather than alerting when an unmatched canceled subscription has no account behind it', async () => {
      campaignsService.findBySubscriptionId.mockResolvedValue(null)
      usersService.findByCustomerId.mockResolvedValue(null)

      await service.customerSubscriptionUpdatedHandler(updatedEvent())

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: 'sub_test_unmatched',
          userId: null,
        }),
        expect.stringContaining('account deletion'),
      )
      expect(logger.error).not.toHaveBeenCalled()
    })

    it('treats a soft-deleted account as a deletion rather than a lost cancellation', async () => {
      campaignsService.findBySubscriptionId.mockResolvedValue(null)
      usersService.findByCustomerId.mockResolvedValue({
        ...mockUser,
        metaData: { isDeleted: true },
      })

      await service.customerSubscriptionUpdatedHandler(updatedEvent())

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ userId: mockUser.id }),
        expect.stringContaining('account deletion'),
      )
      expect(logger.error).not.toHaveBeenCalled()
    })
  })

  describe('customerSubscriptionDeletedHandler', () => {
    const deletedEvent = (subscription: Record<string, unknown> = {}) =>
      ({
        type: WebhookEventType.CustomerSubscriptionDeleted,
        data: {
          object: {
            id: 'sub_test_unmatched',
            customer: 'cus_test_unmatched',
            status: 'canceled',
            created: nowSeconds() - 86_400,
            cancel_at: null,
            canceled_at: 1_757_289_600,
            cancellation_details: { reason: 'payment_failed' },
            ...subscription,
          },
        },
      }) as unknown as Stripe.CustomerSubscriptionDeletedEvent

    // Not one PRO PLAN CANCELLATION message reached Slack in the 30 days
    // measured: the Slack call is the last statement in the handler, so the
    // lookup throw took the de-Pro and the notification with it.
    it('un-Pros the campaign and reports the cancellation to Slack only when the subscription resolves', async () => {
      await service.customerSubscriptionDeletedHandler(deletedEvent())

      expect(
        campaignsService.persistCampaignProCancellation,
      ).toHaveBeenCalledExactlyOnceWith(mockCampaign)
      expect(slackService.message).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('PRO PLAN CANCELLATION'),
        }),
        expect.anything(),
      )

      campaignsService.findBySubscriptionId.mockResolvedValue(null)
      await service.customerSubscriptionDeletedHandler(deletedEvent())

      expect(
        campaignsService.persistCampaignProCancellation,
      ).toHaveBeenCalledOnce()
      expect(slackService.message).toHaveBeenCalledOnce()
    })

    // A cancellation that beat its own checkout's fulfillment write is the one
    // miss redelivery can still fix — acknowledging it would leave the campaign
    // Pro with nothing left to un-Pro it.
    it('asks Stripe to redeliver a cancellation that arrived before the link was written', async () => {
      campaignsService.findBySubscriptionId.mockResolvedValue(null)

      await expect(
        service.customerSubscriptionDeletedHandler(
          deletedEvent({ created: nowSeconds() - 5 }),
        ),
      ).rejects.toThrow(ServiceUnavailableException)

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ subscriptionId: 'sub_test_unmatched' }),
        expect.stringContaining('redeliver'),
      )
      expect(logger.error).not.toHaveBeenCalled()
    })

    it('acknowledges an unmatched cancellation instead of retrying it for three days', async () => {
      campaignsService.findBySubscriptionId.mockResolvedValue(null)

      await expect(
        service.customerSubscriptionDeletedHandler(deletedEvent()),
      ).resolves.toBeUndefined()

      expect(
        campaignsService.persistCampaignProCancellation,
      ).not.toHaveBeenCalled()
      expect(campaignsService.patchCampaignDetails).not.toHaveBeenCalled()
    })

    it('error-logs a cancellation whose account is still live, with the reason Stripe gave', async () => {
      campaignsService.findBySubscriptionId.mockResolvedValue(null)

      await service.customerSubscriptionDeletedHandler(deletedEvent())

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: WebhookEventType.CustomerSubscriptionDeleted,
          subscriptionId: 'sub_test_unmatched',
          customerId: 'cus_test_unmatched',
          userId: mockUser.id,
          cancellationReason: 'payment_failed',
        }),
        expect.stringContaining('cancellation was never applied'),
      )
    })

    it('warns when the account behind the canceled subscription is already gone', async () => {
      campaignsService.findBySubscriptionId.mockResolvedValue(null)
      usersService.findByCustomerId.mockResolvedValue(null)

      await service.customerSubscriptionDeletedHandler(deletedEvent())

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ subscriptionId: 'sub_test_unmatched' }),
        expect.stringContaining('account deletion'),
      )
      expect(logger.error).not.toHaveBeenCalled()
    })

    // Reconciling every unmatched production subscription on 2026-09-17
    // resolved meta_data.customerId on 1 of 20, and on none of the 6 canceled
    // ones — pre-ENG-11084 email-only checkout minted a fresh Stripe customer
    // per session, so the customer that bills is rarely the one stored. These
    // carry the real Stripe ids of one of the two lost cancellations that gap
    // hid; the address is synthetic and must stay that way.
    describe('resolving the account when the stored customer id misses', () => {
      const lostCancellation = () =>
        deletedEvent({
          id: 'sub_1TlI0T1taBPnTqn4wXcOjDJQ',
          customer: 'cus_Ukna4d5HsEPEVJ',
        })

      beforeEach(() => {
        campaignsService.findBySubscriptionId.mockResolvedValue(null)
        usersService.findByCustomerId.mockResolvedValue(null)
        stripeService.retrieveCustomer.mockResolvedValue({
          id: 'cus_Ukna4d5HsEPEVJ',
          // Mixed case on purpose: the match has to survive it.
          email: 'OrphanedCancellation@example.com',
        })
      })

      it('error-logs a cancellation whose live account is found by the Stripe customer email', async () => {
        usersService.findUserByEmail.mockResolvedValue({
          ...mockUser,
          id: 341311,
          metaData: { customerId: 'cus_UknccQ7rRAO1U5' },
        })

        await service.customerSubscriptionDeletedHandler(lostCancellation())

        // Lowercased: the uniqueness guarantee is the index on LOWER(email).
        expect(usersService.findUserByEmail).toHaveBeenCalledWith(
          'orphanedcancellation@example.com',
        )
        expect(logger.error).toHaveBeenCalledWith(
          expect.objectContaining({
            subscriptionId: 'sub_1TlI0T1taBPnTqn4wXcOjDJQ',
            userId: 341311,
            matchedBy: 'stripeCustomerEmail',
          }),
          expect.stringContaining('by the email on its Stripe customer'),
        )
        expect(logger.warn).not.toHaveBeenCalled()
      })

      // The disagreement is itself the ENG-11084 signature, so the line has to
      // carry the id that is billing and the id we stored, not just one.
      it('names both the billing customer and the stored one when they disagree', async () => {
        usersService.findUserByEmail.mockResolvedValue({
          ...mockUser,
          metaData: { customerId: 'cus_UknccQ7rRAO1U5' },
        })

        await service.customerSubscriptionDeletedHandler(lostCancellation())

        expect(logger.error).toHaveBeenCalledWith(
          expect.objectContaining({
            customerId: 'cus_Ukna4d5HsEPEVJ',
            storedCustomerId: 'cus_UknccQ7rRAO1U5',
          }),
          expect.any(String),
        )
      })

      it('warns when the email resolves to an account that is already deleted', async () => {
        usersService.findUserByEmail.mockResolvedValue({
          ...mockUser,
          metaData: { isDeleted: true },
        })

        await service.customerSubscriptionDeletedHandler(lostCancellation())

        expect(logger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ emailFallback: 'matched' }),
          expect.stringContaining('account deletion'),
        )
        expect(logger.error).not.toHaveBeenCalled()
      })

      it('warns without throwing when the Stripe customer itself was deleted', async () => {
        stripeService.retrieveCustomer.mockResolvedValue({
          id: 'cus_Ukna4d5HsEPEVJ',
          deleted: true,
        })

        await expect(
          service.customerSubscriptionDeletedHandler(lostCancellation()),
        ).resolves.toBeUndefined()

        expect(usersService.findUserByEmail).not.toHaveBeenCalled()
        expect(logger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ emailFallback: 'customer-has-no-email' }),
          expect.stringContaining('account deletion'),
        )
        expect(logger.error).not.toHaveBeenCalled()
      })

      // The fallback can only ever raise a warn to an error, so failing it must
      // cost the enrichment and nothing else — never the acknowledgement.
      it('acknowledges the event when the Stripe read fails, rather than failing it', async () => {
        stripeService.retrieveCustomer.mockRejectedValue(
          new BadGatewayException('Failed to retrieve customer'),
        )

        await expect(
          service.customerSubscriptionDeletedHandler(lostCancellation()),
        ).resolves.toBeUndefined()

        expect(logger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ customerId: 'cus_Ukna4d5HsEPEVJ' }),
          expect.stringContaining('Could not read the Stripe customer'),
        )
        expect(logger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ emailFallback: 'stripe-unavailable' }),
          expect.stringContaining('account deletion'),
        )
        expect(logger.error).not.toHaveBeenCalled()
      })
    })
  })

  describe('handleEvent — payment_method.detached', () => {
    const detachedEvent = (paymentMethodId: string) =>
      ({
        type: WebhookEventType.PaymentMethodDetached,
        data: { object: { id: paymentMethodId } },
      }) as unknown as Stripe.PaymentMethodDetachedEvent

    it('cancels not-yet-dialed robocalls bound to the detached card', async () => {
      await service.handleEvent(detachedEvent('pm_gone'))

      expect(
        robocallWebhookService.cancelNotYetDialedForDetachedPaymentMethod,
      ).toHaveBeenCalledExactlyOnceWith('pm_gone')
    })
  })

  describe('handleEvent — payment_method.attached', () => {
    const attachedEvent = (
      customer: string | { id: string } | null,
      type = 'card',
    ) =>
      ({
        type: WebhookEventType.PaymentMethodAttached,
        data: { object: { id: 'pm_new', customer, type } },
      }) as unknown as Stripe.PaymentMethodAttachedEvent

    it('retries the hold for the customer with the newly attached card', async () => {
      await service.handleEvent(attachedEvent('cus_1'))

      expect(
        robocallWebhookService.retryHoldFailedForAttachedCard,
      ).toHaveBeenCalledExactlyOnceWith('cus_1', 'pm_new')
    })

    it('unwraps an expanded customer object to its id', async () => {
      await service.handleEvent(attachedEvent({ id: 'cus_1' }))

      expect(
        robocallWebhookService.retryHoldFailedForAttachedCard,
      ).toHaveBeenCalledExactlyOnceWith('cus_1', 'pm_new')
    })

    it('no-ops when the payment method has no customer', async () => {
      await service.handleEvent(attachedEvent(null))

      expect(
        robocallWebhookService.retryHoldFailedForAttachedCard,
      ).not.toHaveBeenCalled()
    })

    it('no-ops for a non-card payment method', async () => {
      await service.handleEvent(attachedEvent('cus_1', 'us_bank_account'))

      expect(
        robocallWebhookService.retryHoldFailedForAttachedCard,
      ).not.toHaveBeenCalled()
    })
  })

  describe('handleEvent — charge.dispute.created', () => {
    const disputeEvent = (paymentIntent: string | null) =>
      ({
        type: WebhookEventType.ChargeDisputeCreated,
        data: {
          object: { id: 'dp_1', charge: 'ch_1', payment_intent: paymentIntent },
        },
      }) as unknown as Stripe.ChargeDisputeCreatedEvent

    it('marks the run disputed by the payment intent it maps to', async () => {
      await service.handleEvent(disputeEvent('pi_hold_1'))

      expect(
        robocallWebhookService.markDisputedByIntent,
      ).toHaveBeenCalledExactlyOnceWith('pi_hold_1')
    })

    it('skips and warns when the dispute carries no payment intent', async () => {
      await expect(
        service.handleEvent(disputeEvent(null)),
      ).resolves.not.toThrow()

      expect(robocallWebhookService.markDisputedByIntent).not.toHaveBeenCalled()
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ disputeId: 'dp_1' }),
        expect.stringContaining('no payment_intent'),
      )
    })
  })
})
