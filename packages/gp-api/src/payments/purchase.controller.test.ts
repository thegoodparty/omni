import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { firstOrThrow } from '@/shared/test-utils/arrays.util'
import { CampaignsService } from '@/campaigns/services/campaigns.service'
import { BadRequestException, ConflictException } from '@nestjs/common'
import { Campaign, Organization, User, UserRole } from '../generated/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UsersService } from '../users/services/users.service'
import { StripeService } from '../vendors/stripe/services/stripe.service'
import { PurchaseController } from './purchase.controller'
import {
  CompleteCheckoutSessionDto,
  CompleteFreePurchaseDto,
  CreateCheckoutSessionDto,
  PurchaseType,
} from './purchase.types'
import { PurchaseService } from './services/purchase.service'

const userId = 7

const mockUser: User = {
  id: userId,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  firstName: 'Test',
  lastName: 'User',
  name: 'Test User',
  avatar: null,
  password: null,
  hasPassword: false,
  email: 'buyer@example.com',
  phone: '5555555555',
  zip: '12345',
  roles: [UserRole.candidate],
  metaData: null,
  passwordResetToken: null,
  clerkId: null,
  personId: null,
}

const mockCampaign = {
  id: 111,
  slug: 'cmp',
  isPro: false,
} as unknown as Campaign
const mockOrganization = { slug: 'org-slug' } as unknown as Organization

describe('PurchaseController', () => {
  let controller: PurchaseController
  let stripeService: {
    createCheckoutSession: ReturnType<typeof vi.fn>
    createEmbeddedProSubscriptionCheckoutSession: ReturnType<typeof vi.fn>
    createPortalSession: ReturnType<typeof vi.fn>
    expireCheckoutSession: ReturnType<typeof vi.fn>
    retrieveSubscription: ReturnType<typeof vi.fn>
  }
  let usersService: {
    patchUserMetaData: ReturnType<typeof vi.fn>
    compareAndSwapCheckoutSessionId: ReturnType<typeof vi.fn>
  }
  let purchaseService: {
    createCheckoutSession: ReturnType<typeof vi.fn>
    completeCheckoutSession: ReturnType<typeof vi.fn>
    completeFreePurchase: ReturnType<typeof vi.fn>
  }
  let campaignsService: {
    findActiveByUserId: ReturnType<typeof vi.fn>
    findMany: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    stripeService = {
      createCheckoutSession: vi.fn(),
      createEmbeddedProSubscriptionCheckoutSession: vi.fn(),
      createPortalSession: vi.fn(),
      expireCheckoutSession: vi.fn(),
      retrieveSubscription: vi.fn(),
    }
    usersService = {
      patchUserMetaData: vi.fn(),
      compareAndSwapCheckoutSessionId: vi.fn().mockResolvedValue(true),
    }
    purchaseService = {
      createCheckoutSession: vi.fn(),
      completeCheckoutSession: vi.fn(),
      completeFreePurchase: vi.fn(),
    }
    campaignsService = {
      findActiveByUserId: vi.fn().mockResolvedValue(mockCampaign),
      findMany: vi.fn().mockResolvedValue([]),
    }

    controller = new PurchaseController(
      stripeService as unknown as StripeService,
      usersService as unknown as UsersService,
      purchaseService as unknown as PurchaseService,
      campaignsService as unknown as CampaignsService,
      createMockLogger(),
    )
  })

  describe('createProCheckoutSession', () => {
    const redirectUrl = 'https://stripe.test/checkout'

    it('creates the session and persists checkoutSessionId on the user', async () => {
      stripeService.createCheckoutSession.mockResolvedValue({
        redirectUrl,
        checkoutSessionId: 'cs_test_123',
      })

      const result = await controller.createProCheckoutSession(mockUser)

      expect(stripeService.createCheckoutSession).toHaveBeenCalledWith(
        userId,
        mockUser.email,
      )
      expect(usersService.compareAndSwapCheckoutSessionId).toHaveBeenCalledWith(
        userId,
        null,
        'cs_test_123',
      )
      expect(result).toEqual({ redirectUrl })
    })

    it('returns a client_secret and persists checkoutSessionId for the embedded path', async () => {
      stripeService.createEmbeddedProSubscriptionCheckoutSession.mockResolvedValue(
        {
          clientSecret: 'cs_test_secret_abc',
          checkoutSessionId: 'cs_test_embedded',
        },
      )

      const result = await controller.createProCheckoutSession(mockUser, {
        embedded: true,
        returnUrl: 'https://app.test/dashboard/pro-upgrade',
      })

      expect(
        stripeService.createEmbeddedProSubscriptionCheckoutSession,
      ).toHaveBeenCalledWith(
        userId,
        mockUser.email,
        'https://app.test/dashboard/pro-upgrade',
      )
      expect(stripeService.createCheckoutSession).not.toHaveBeenCalled()
      expect(usersService.compareAndSwapCheckoutSessionId).toHaveBeenCalledWith(
        userId,
        null,
        'cs_test_embedded',
      )
      expect(result).toEqual({ clientSecret: 'cs_test_secret_abc' })
    })

    it('falls back to the redirect path when no body is supplied', async () => {
      stripeService.createCheckoutSession.mockResolvedValue({
        redirectUrl,
        checkoutSessionId: 'cs_test_123',
      })

      const result = await controller.createProCheckoutSession(mockUser)

      expect(
        stripeService.createEmbeddedProSubscriptionCheckoutSession,
      ).not.toHaveBeenCalled()
      expect(result).toEqual({ redirectUrl })
    })

    it('throws 400 before any Stripe call when there is no active campaign (redirect)', async () => {
      campaignsService.findActiveByUserId.mockResolvedValue(null)

      await expect(
        controller.createProCheckoutSession(mockUser),
      ).rejects.toThrow(BadRequestException)
      expect(stripeService.createCheckoutSession).not.toHaveBeenCalled()
      expect(
        usersService.compareAndSwapCheckoutSessionId,
      ).not.toHaveBeenCalled()
    })

    it('throws 400 before any Stripe call when there is no active campaign (embedded)', async () => {
      campaignsService.findActiveByUserId.mockResolvedValue(null)

      await expect(
        controller.createProCheckoutSession(mockUser, { embedded: true }),
      ).rejects.toThrow(BadRequestException)
      expect(
        stripeService.createEmbeddedProSubscriptionCheckoutSession,
      ).not.toHaveBeenCalled()
      expect(
        usersService.compareAndSwapCheckoutSessionId,
      ).not.toHaveBeenCalled()
    })

    it('throws 409 before any Stripe call when the campaign is already Pro (redirect)', async () => {
      campaignsService.findActiveByUserId.mockResolvedValue({
        ...mockCampaign,
        isPro: true,
      })

      await expect(
        controller.createProCheckoutSession(mockUser),
      ).rejects.toThrow(ConflictException)
      expect(stripeService.createCheckoutSession).not.toHaveBeenCalled()
      expect(stripeService.expireCheckoutSession).not.toHaveBeenCalled()
      expect(
        usersService.compareAndSwapCheckoutSessionId,
      ).not.toHaveBeenCalled()
    })

    it('throws 409 before any Stripe call when the campaign is already Pro (embedded)', async () => {
      campaignsService.findActiveByUserId.mockResolvedValue({
        ...mockCampaign,
        isPro: true,
      })

      await expect(
        controller.createProCheckoutSession(mockUser, { embedded: true }),
      ).rejects.toThrow(ConflictException)
      expect(
        stripeService.createEmbeddedProSubscriptionCheckoutSession,
      ).not.toHaveBeenCalled()
      expect(
        usersService.compareAndSwapCheckoutSessionId,
      ).not.toHaveBeenCalled()
    })

    it('expires the stored open checkout session before creating a new one', async () => {
      const userWithOpenSession: User = {
        ...mockUser,
        metaData: { checkoutSessionId: 'cs_previous_open' },
      }
      stripeService.createCheckoutSession.mockResolvedValue({
        redirectUrl,
        checkoutSessionId: 'cs_test_new',
      })

      await controller.createProCheckoutSession(userWithOpenSession)

      expect(stripeService.expireCheckoutSession).toHaveBeenCalledWith(
        'cs_previous_open',
      )
      const expireOrder = firstOrThrow(
        stripeService.expireCheckoutSession.mock.invocationCallOrder,
      )
      const createOrder = firstOrThrow(
        stripeService.createCheckoutSession.mock.invocationCallOrder,
      )
      expect(expireOrder).toBeLessThan(createOrder)
      expect(usersService.compareAndSwapCheckoutSessionId).toHaveBeenCalledWith(
        userId,
        'cs_previous_open',
        'cs_test_new',
      )
    })

    it('expires its own session and 409s when a concurrent request claimed first', async () => {
      stripeService.createCheckoutSession.mockResolvedValue({
        redirectUrl,
        checkoutSessionId: 'cs_test_loser',
      })
      usersService.compareAndSwapCheckoutSessionId.mockResolvedValue(false)

      await expect(
        controller.createProCheckoutSession(mockUser),
      ).rejects.toThrow(ConflictException)
      expect(stripeService.expireCheckoutSession).toHaveBeenCalledWith(
        'cs_test_loser',
      )
    })

    it('still 409s when expiring the losing session itself fails', async () => {
      stripeService.createCheckoutSession.mockResolvedValue({
        redirectUrl,
        checkoutSessionId: 'cs_test_loser',
      })
      usersService.compareAndSwapCheckoutSessionId.mockResolvedValue(false)
      stripeService.expireCheckoutSession.mockRejectedValue(
        new Error('stripe unavailable'),
      )

      await expect(
        controller.createProCheckoutSession(mockUser),
      ).rejects.toThrow(ConflictException)
    })

    it('expires the stored open checkout session on the embedded path too', async () => {
      const userWithOpenSession: User = {
        ...mockUser,
        metaData: { checkoutSessionId: 'cs_previous_open' },
      }
      stripeService.createEmbeddedProSubscriptionCheckoutSession.mockResolvedValue(
        {
          clientSecret: 'cs_test_secret_abc',
          checkoutSessionId: 'cs_test_embedded',
        },
      )

      await controller.createProCheckoutSession(userWithOpenSession, {
        embedded: true,
      })

      expect(stripeService.expireCheckoutSession).toHaveBeenCalledWith(
        'cs_previous_open',
      )
    })

    it('throws 409 without creating a session when the previous session was already paid', async () => {
      const userWithPaidSession: User = {
        ...mockUser,
        metaData: { checkoutSessionId: 'cs_paid_awaiting_webhook' },
      }
      stripeService.expireCheckoutSession.mockResolvedValue('complete')

      await expect(
        controller.createProCheckoutSession(userWithPaidSession, {
          embedded: true,
        }),
      ).rejects.toThrow(ConflictException)
      expect(
        stripeService.createEmbeddedProSubscriptionCheckoutSession,
      ).not.toHaveBeenCalled()
      expect(
        usersService.compareAndSwapCheckoutSessionId,
      ).not.toHaveBeenCalled()
    })

    it('skips expiry when the user has no stored checkout session', async () => {
      stripeService.createCheckoutSession.mockResolvedValue({
        redirectUrl,
        checkoutSessionId: 'cs_test_123',
      })

      await controller.createProCheckoutSession(mockUser)

      expect(stripeService.expireCheckoutSession).not.toHaveBeenCalled()
    })
  })

  describe('createPortalSession', () => {
    it('throws BadRequestException when the user has no customerId and no campaigns', async () => {
      campaignsService.findMany.mockResolvedValue([])

      await expect(controller.createPortalSession(mockUser)).rejects.toThrow(
        BadRequestException,
      )
      expect(stripeService.createPortalSession).not.toHaveBeenCalled()
      expect(stripeService.retrieveSubscription).not.toHaveBeenCalled()
    })

    it('returns the portal redirect URL when a customerId exists', async () => {
      const userWithCustomer: User = {
        ...mockUser,
        metaData: { customerId: 'cus_123' },
      }
      stripeService.createPortalSession.mockResolvedValue({
        url: 'https://stripe.test/portal',
      })

      const result = await controller.createPortalSession(userWithCustomer)

      expect(stripeService.createPortalSession).toHaveBeenCalledWith('cus_123')
      expect(stripeService.retrieveSubscription).not.toHaveBeenCalled()
      expect(result).toEqual({ redirectUrl: 'https://stripe.test/portal' })
    })

    it('recovers customerId from the stored subscription when metaData is missing it', async () => {
      campaignsService.findMany.mockResolvedValue([
        { ...mockCampaign, details: { subscriptionId: 'sub_recover' } },
      ])
      stripeService.retrieveSubscription.mockResolvedValue({
        id: 'sub_recover',
        customer: 'cus_recovered',
      })
      stripeService.createPortalSession.mockResolvedValue({
        url: 'https://stripe.test/portal-recovered',
      })

      const result = await controller.createPortalSession(mockUser)

      expect(stripeService.retrieveSubscription).toHaveBeenCalledWith(
        'sub_recover',
      )
      expect(usersService.patchUserMetaData).toHaveBeenCalledWith(userId, {
        customerId: 'cus_recovered',
      })
      expect(stripeService.createPortalSession).toHaveBeenCalledWith(
        'cus_recovered',
      )
      expect(result).toEqual({
        redirectUrl: 'https://stripe.test/portal-recovered',
      })
    })

    it('recovers from a campaign whose election has passed (no active campaign)', async () => {
      // The reported users' elections are over, so recovery must not depend
      // on the active-campaign predicate.
      campaignsService.findMany.mockResolvedValue([
        { ...mockCampaign, details: {} },
        { ...mockCampaign, id: 42, details: { subscriptionId: 'sub_past' } },
      ])
      stripeService.retrieveSubscription.mockResolvedValue({
        id: 'sub_past',
        customer: 'cus_past',
      })
      stripeService.createPortalSession.mockResolvedValue({
        url: 'https://stripe.test/portal-past',
      })

      const result = await controller.createPortalSession(mockUser)

      expect(campaignsService.findActiveByUserId).not.toHaveBeenCalled()
      expect(stripeService.retrieveSubscription).toHaveBeenCalledWith(
        'sub_past',
      )
      expect(result).toEqual({ redirectUrl: 'https://stripe.test/portal-past' })
    })

    it('still returns the portal URL when the customerId backfill write fails', async () => {
      campaignsService.findMany.mockResolvedValue([
        { ...mockCampaign, details: { subscriptionId: 'sub_recover' } },
      ])
      stripeService.retrieveSubscription.mockResolvedValue({
        id: 'sub_recover',
        customer: 'cus_recovered',
      })
      usersService.patchUserMetaData.mockRejectedValue(
        new Error('db unavailable'),
      )
      stripeService.createPortalSession.mockResolvedValue({
        url: 'https://stripe.test/portal-recovered',
      })

      const result = await controller.createPortalSession(mockUser)

      expect(stripeService.createPortalSession).toHaveBeenCalledWith(
        'cus_recovered',
      )
      expect(result).toEqual({
        redirectUrl: 'https://stripe.test/portal-recovered',
      })
    })

    it('recovers customerId when Stripe returns an expanded customer object', async () => {
      campaignsService.findMany.mockResolvedValue([
        { ...mockCampaign, details: { subscriptionId: 'sub_recover' } },
      ])
      stripeService.retrieveSubscription.mockResolvedValue({
        id: 'sub_recover',
        customer: { id: 'cus_expanded' },
      })
      stripeService.createPortalSession.mockResolvedValue({
        url: 'https://stripe.test/portal-expanded',
      })

      const result = await controller.createPortalSession(mockUser)

      expect(usersService.patchUserMetaData).toHaveBeenCalledWith(userId, {
        customerId: 'cus_expanded',
      })
      expect(stripeService.createPortalSession).toHaveBeenCalledWith(
        'cus_expanded',
      )
      expect(result).toEqual({
        redirectUrl: 'https://stripe.test/portal-expanded',
      })
    })

    it('throws the graceful 400 when the campaign lookup itself fails', async () => {
      campaignsService.findMany.mockRejectedValue(new Error('db unavailable'))

      await expect(controller.createPortalSession(mockUser)).rejects.toThrow(
        BadRequestException,
      )
      expect(stripeService.retrieveSubscription).not.toHaveBeenCalled()
      expect(stripeService.createPortalSession).not.toHaveBeenCalled()
    })

    it('throws BadRequestException when no campaign has a subscriptionId', async () => {
      campaignsService.findMany.mockResolvedValue([
        { ...mockCampaign, details: {} },
      ])

      await expect(controller.createPortalSession(mockUser)).rejects.toThrow(
        BadRequestException,
      )
      expect(stripeService.retrieveSubscription).not.toHaveBeenCalled()
      expect(usersService.patchUserMetaData).not.toHaveBeenCalled()
      expect(stripeService.createPortalSession).not.toHaveBeenCalled()
    })

    it('throws BadRequestException when Stripe subscription lookup fails', async () => {
      campaignsService.findMany.mockResolvedValue([
        { ...mockCampaign, details: { subscriptionId: 'sub_recover' } },
      ])
      stripeService.retrieveSubscription.mockRejectedValue(
        new Error('stripe unavailable'),
      )

      await expect(controller.createPortalSession(mockUser)).rejects.toThrow(
        BadRequestException,
      )
      expect(usersService.patchUserMetaData).not.toHaveBeenCalled()
      expect(stripeService.createPortalSession).not.toHaveBeenCalled()
    })

    it('throws BadRequestException when the retrieved subscription has no customer', async () => {
      campaignsService.findMany.mockResolvedValue([
        { ...mockCampaign, details: { subscriptionId: 'sub_recover' } },
      ])
      stripeService.retrieveSubscription.mockResolvedValue({
        id: 'sub_recover',
        customer: null,
      })

      await expect(controller.createPortalSession(mockUser)).rejects.toThrow(
        BadRequestException,
      )
      expect(usersService.patchUserMetaData).not.toHaveBeenCalled()
      expect(stripeService.createPortalSession).not.toHaveBeenCalled()
    })
  })

  describe('createCheckoutSession', () => {
    const dto: CreateCheckoutSessionDto<unknown> = {
      type: PurchaseType.TEXT,
      metadata: { contactCount: 100 },
    }

    it('throws BadRequestException when neither campaign nor organization is supplied', async () => {
      await expect(
        controller.createCheckoutSession(mockUser, dto, undefined, undefined),
      ).rejects.toThrow(BadRequestException)
      expect(purchaseService.createCheckoutSession).not.toHaveBeenCalled()
    })

    it('forwards campaignId and organizationSlug to the purchase service', async () => {
      const expected = {
        id: 'cs_x',
        clientSecret: 'cs_secret',
        amount: 50,
      }
      purchaseService.createCheckoutSession.mockResolvedValue(expected)

      const result = await controller.createCheckoutSession(
        mockUser,
        dto,
        mockCampaign,
        mockOrganization,
      )

      expect(purchaseService.createCheckoutSession).toHaveBeenCalledWith({
        user: mockUser,
        dto,
        metadata: {
          campaignId: mockCampaign.id,
          organizationSlug: mockOrganization.slug,
        },
      })
      expect(result).toBe(expected)
    })

    it('logs and rethrows errors from the purchase service', async () => {
      const error = new Error('boom')
      purchaseService.createCheckoutSession.mockRejectedValue(error)

      await expect(
        controller.createCheckoutSession(
          mockUser,
          dto,
          mockCampaign,
          undefined,
        ),
      ).rejects.toBe(error)
    })
  })

  describe('completeCheckoutSession', () => {
    it('delegates to PurchaseService.completeCheckoutSession', async () => {
      const dto: CompleteCheckoutSessionDto = {
        checkoutSessionId: 'cs_complete',
      }
      const response = { alreadyProcessed: false, result: { ok: true } }
      purchaseService.completeCheckoutSession.mockResolvedValue(response)

      await expect(controller.completeCheckoutSession(dto)).resolves.toBe(
        response,
      )
      expect(purchaseService.completeCheckoutSession).toHaveBeenCalledWith(dto)
    })
  })

  describe('completeFreePurchase', () => {
    const dto: CompleteFreePurchaseDto = {
      purchaseType: PurchaseType.TEXT,
      metadata: { campaignId: 111 },
    }

    it('forwards user, dto, and campaign to the purchase service', async () => {
      const response = { result: { ok: true } }
      purchaseService.completeFreePurchase.mockResolvedValue(response)

      const result = await controller.completeFreePurchase(
        mockUser,
        dto,
        mockCampaign,
      )

      expect(purchaseService.completeFreePurchase).toHaveBeenCalledWith({
        dto,
        campaign: mockCampaign,
        user: mockUser,
      })
      expect(result).toBe(response)
    })

    it('logs and rethrows errors from the purchase service', async () => {
      const error = new Error('boom')
      purchaseService.completeFreePurchase.mockRejectedValue(error)

      await expect(
        controller.completeFreePurchase(mockUser, dto, mockCampaign),
      ).rejects.toBe(error)
    })
  })
})
