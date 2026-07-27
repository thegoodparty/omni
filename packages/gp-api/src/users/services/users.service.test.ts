import { useTestService } from '@/test-service'
import { CLERK_CLIENT_PROVIDER_TOKEN } from '@/vendors/clerk/providers/clerk-client.provider'
import { ClerkClient } from '@clerk/backend'
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EXISTING_ACCOUNT_MAGIC_LINK_ERROR,
  UsersService,
  type ResolvedActorIdentity,
} from './users.service'
import { AnalyticsService } from '@/analytics/analytics.service'
import { CrmUsersService } from './crmUsers.service'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import { UserRole } from '../../generated/prisma'
import { subDays } from 'date-fns'

const service = useTestService()

describe('UsersService', () => {
  let usersService: UsersService

  beforeEach(async () => {
    usersService = service.app.get(UsersService)
  })

  describe('findUserByEmail', () => {
    it('should find user with exact email match', async () => {
      const user = await usersService.findUserByEmail('tests@goodparty.org')
      expect(user).not.toBeNull()
      expect(user?.id).toBe(service.user.id)
    })

    it('should find user with case-insensitive email', async () => {
      const user = await usersService.findUserByEmail('TESTS@GOODPARTY.ORG')
      expect(user).not.toBeNull()
      expect(user?.id).toBe(service.user.id)
    })

    it('should find user with mixed case email', async () => {
      const user = await usersService.findUserByEmail('Tests@GoodParty.Org')
      expect(user).not.toBeNull()
      expect(user?.id).toBe(service.user.id)
    })

    it('should return null for non-existent email', async () => {
      const user = await usersService.findUserByEmail('nonexistent@example.com')
      expect(user).toBeNull()
    })
  })

  describe('compareAndSwapCheckoutSessionId', () => {
    const createUserWithMeta = (
      email: string,
      metaData: PrismaJson.UserMetaData | undefined,
    ) =>
      service.prisma.user.create({
        data: {
          email,
          firstName: 'Cas',
          lastName: 'Swap',
          ...(metaData ? { metaData } : {}),
        },
      })

    it('swaps when the stored id matches the expected value', async () => {
      const user = await createUserWithMeta('cas.match@example.com', {
        checkoutSessionId: 'cs_old',
        customerId: 'cus_keep',
      })

      const swapped = await usersService.compareAndSwapCheckoutSessionId(
        user.id,
        'cs_old',
        'cs_new',
      )

      expect(swapped).toBe(true)
      const updated = await service.prisma.user.findUnique({
        where: { id: user.id },
      })
      expect(updated?.metaData?.checkoutSessionId).toBe('cs_new')
      expect(updated?.metaData?.customerId).toBe('cus_keep')
    })

    it('swaps from a missing id when null is expected', async () => {
      const user = await createUserWithMeta('cas.null@example.com', undefined)

      const swapped = await usersService.compareAndSwapCheckoutSessionId(
        user.id,
        null,
        'cs_first',
      )

      expect(swapped).toBe(true)
      const updated = await service.prisma.user.findUnique({
        where: { id: user.id },
      })
      expect(updated?.metaData?.checkoutSessionId).toBe('cs_first')
    })

    it('refuses the swap when another id is stored', async () => {
      const user = await createUserWithMeta('cas.mismatch@example.com', {
        checkoutSessionId: 'cs_current',
      })

      const swapped = await usersService.compareAndSwapCheckoutSessionId(
        user.id,
        'cs_stale',
        'cs_new',
      )

      expect(swapped).toBe(false)
      const unchanged = await service.prisma.user.findUnique({
        where: { id: user.id },
      })
      expect(unchanged?.metaData?.checkoutSessionId).toBe('cs_current')
    })

    it('clears to null and treats the cleared value as null on the next swap', async () => {
      const user = await createUserWithMeta('cas.clear@example.com', {
        checkoutSessionId: 'cs_done',
      })

      const cleared = await usersService.compareAndSwapCheckoutSessionId(
        user.id,
        'cs_done',
        null,
      )
      expect(cleared).toBe(true)

      const swappedAfterClear =
        await usersService.compareAndSwapCheckoutSessionId(
          user.id,
          null,
          'cs_next',
        )
      expect(swappedAfterClear).toBe(true)
    })

    it('returns false for a non-existent user', async () => {
      const swapped = await usersService.compareAndSwapCheckoutSessionId(
        999999999,
        null,
        'cs_new',
      )
      expect(swapped).toBe(false)
    })
  })

  describe('user email case-insensitive unique index', () => {
    it('rejects a case-variant duplicate at the DB level', async () => {
      await service.prisma.user.create({
        data: {
          email: 'indexed.unique@example.com',
          firstName: 'Index',
          lastName: 'Guard',
        },
      })

      await expect(
        service.prisma.user.create({
          data: {
            email: 'Indexed.Unique@Example.com',
            firstName: 'Index',
            lastName: 'Bypass',
          },
        }),
      ).rejects.toThrow(/unique/i)
    })
  })

  describe('createUser', () => {
    const stubCrm = () => {
      const crm = service.app.get(CrmUsersService)
      vi.spyOn(crm, 'submitCrmForm').mockResolvedValue(undefined)
      vi.spyOn(crm, 'trackUserUpdate').mockResolvedValue(undefined)
    }

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('rejects a lowercase email when a MixedCase row exists', async () => {
      stubCrm()
      await service.prisma.user.create({
        data: {
          email: 'MixedCase.Dup@Example.com',
          firstName: 'Mixed',
          lastName: 'Case',
          name: 'Mixed Case',
        },
      })

      await expect(
        usersService.createUser({
          email: 'mixedcase.dup@example.com',
          firstName: 'New',
          lastName: 'User',
        }),
      ).rejects.toThrow(ConflictException)
    })

    it('rejects a MixedCase email when a lowercase row exists', async () => {
      stubCrm()
      await expect(
        usersService.createUser({
          email: 'Tests@GoodParty.Org',
          firstName: 'New',
          lastName: 'User',
        }),
      ).rejects.toThrow(ConflictException)
    })

    it('persists the email lowercased and trimmed', async () => {
      stubCrm()
      const user = await usersService.createUser({
        email: ' Fresh.Signup@Example.com ',
        firstName: 'Fresh',
        lastName: 'Signup',
      })

      expect(user.email).toBe('fresh.signup@example.com')
      const persisted = await service.prisma.user.findUnique({
        where: { id: user.id },
      })
      expect(persisted?.email).toBe('fresh.signup@example.com')
    })
  })

  describe('listUsers', () => {
    let proUserId: number
    let nonProUserId: number
    let noCampaignUserId: number

    beforeEach(async () => {
      const prisma = service.prisma
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

      const proUser = await prisma.user.create({
        data: {
          email: `pro-user-${suffix}@test.goodparty.org`,
          firstName: 'Pro',
          lastName: 'User',
          name: 'Pro User',
        },
      })
      proUserId = proUser.id

      const orgProSlug = `org-pro-${suffix}`
      await prisma.organization.create({
        data: {
          slug: orgProSlug,
          ownerId: proUserId,
        },
      })
      await prisma.campaign.create({
        data: {
          slug: `camp-pro-${suffix}`,
          organizationSlug: orgProSlug,
          userId: proUserId,
          isPro: true,
        },
      })

      const nonProUser = await prisma.user.create({
        data: {
          email: `non-pro-user-${suffix}@test.goodparty.org`,
          firstName: 'NonPro',
          lastName: 'User',
          name: 'NonPro User',
        },
      })
      nonProUserId = nonProUser.id

      const orgNpSlug = `org-np-${suffix}`
      await prisma.organization.create({
        data: {
          slug: orgNpSlug,
          ownerId: nonProUserId,
        },
      })
      await prisma.campaign.create({
        data: {
          slug: `camp-np-${suffix}`,
          organizationSlug: orgNpSlug,
          userId: nonProUserId,
          isPro: false,
        },
      })

      const noCampaignUser = await prisma.user.create({
        data: {
          email: `no-camp-user-${suffix}@test.goodparty.org`,
          firstName: 'NoCamp',
          lastName: 'User',
          name: 'NoCamp User',
        },
      })
      noCampaignUserId = noCampaignUser.id
    })

    it('returns only users with at least one Pro campaign when isPro=true', async () => {
      const { data, meta } = await usersService.listUsers({
        isPro: true,
        email: '@test.goodparty.org',
      })
      const ids = data.map((u) => u.id)
      expect(ids).toContain(proUserId)
      expect(ids).not.toContain(nonProUserId)
      expect(ids).not.toContain(noCampaignUserId)
      expect(meta.total).toBe(1)
    })

    it('excludes users with any Pro campaign when isPro=false', async () => {
      const { data, meta } = await usersService.listUsers({
        isPro: false,
        email: '@test.goodparty.org',
      })
      const ids = data.map((u) => u.id)
      expect(ids).not.toContain(proUserId)
      expect(ids).toContain(nonProUserId)
      expect(ids).toContain(noCampaignUserId)
      expect(meta.total).toBe(2)
    })

    it('returns all seeded users when isPro is omitted', async () => {
      const { data, meta } = await usersService.listUsers({
        email: '@test.goodparty.org',
      })
      const ids = data.map((u) => u.id)
      expect(meta.total).toBe(3)
      expect(ids.sort((a, b) => a - b)).toEqual(
        [proUserId, nonProUserId, noCampaignUserId].sort((a, b) => a - b),
      )
    })
  })

  describe('patchUserMetaData', () => {
    it('should set metadata on user with no existing metadata', async () => {
      const updated = await usersService.patchUserMetaData(service.user.id, {
        sessionCount: 5,
      })

      expect(updated.metaData).toEqual({ sessionCount: 5 })
    })

    it('should merge new metadata with existing metadata', async () => {
      // Set initial metadata
      await usersService.patchUserMetaData(service.user.id, {
        sessionCount: 1,
        lastVisited: 1000,
      })

      // Patch with new data
      const updated = await usersService.patchUserMetaData(service.user.id, {
        customerId: 'cus_123',
      })

      expect(updated.metaData).toEqual({
        sessionCount: 1,
        lastVisited: 1000,
        customerId: 'cus_123',
      })
    })

    it('should overwrite existing keys when patching', async () => {
      await usersService.patchUserMetaData(service.user.id, {
        sessionCount: 1,
      })

      const updated = await usersService.patchUserMetaData(service.user.id, {
        sessionCount: 10,
      })

      expect(updated.metaData).toEqual({ sessionCount: 10 })
    })

    it('should not lose metadata for racing requests', async () => {
      // Run multiple concurrent updates, each adding a unique key
      const updates = Array.from({ length: 5 }, (_, i) => ({
        [`key${i}`]: `value${i}`,
      }))

      const results = await Promise.allSettled(
        updates.map((metadata) =>
          usersService.patchUserMetaData(service.user.id, metadata),
        ),
      )

      // All updates should succeed (with retries if needed)
      for (const result of results) {
        expect(result).toMatchObject({ status: 'fulfilled' })
      }

      // All values should be preserved - no data loss from race conditions
      const user = await usersService.findUser({ id: service.user.id })
      expect(user?.metaData).toMatchObject({
        key0: 'value0',
        key1: 'value1',
        key2: 'value2',
        key3: 'value3',
        key4: 'value4',
      })
    })
  })

  describe('findByCustomerId', () => {
    it('should find user by customerId in metadata', async () => {
      await usersService.patchUserMetaData(service.user.id, {
        customerId: 'cus_test_123',
      })

      const found = await usersService.findByCustomerId('cus_test_123')
      expect(found).not.toBeNull()
      expect(found?.id).toBe(service.user.id)
    })

    it('should return null for non-existent customerId', async () => {
      const found = await usersService.findByCustomerId('cus_nonexistent')
      expect(found).toBeNull()
    })
  })

  describe('updatePassword', () => {
    it('should hash and update the password', async () => {
      const originalUser = await usersService.findUser({ id: service.user.id })
      expect(originalUser?.password).toBeNull()

      await usersService.updatePassword(service.user.id, 'newPassword123')

      const updatedUser = await usersService.findUser({ id: service.user.id })
      expect(updatedUser?.password).not.toBeNull()
      expect(updatedUser?.password).not.toBe('newPassword123') // Should be hashed
    })

    it('should clear reset token when specified', async () => {
      await usersService.setResetToken(service.user.id, 'reset-token-123')

      let user = await usersService.findUser({ id: service.user.id })
      expect(user?.passwordResetToken).toBe('reset-token-123')

      await usersService.updatePassword(service.user.id, 'newPassword', true)

      user = await usersService.findUser({ id: service.user.id })
      expect(user?.passwordResetToken).toBeNull()
    })
  })

  describe('setResetToken', () => {
    it('should set the password reset token', async () => {
      await usersService.setResetToken(service.user.id, 'my-reset-token')

      const user = await usersService.findUser({ id: service.user.id })
      expect(user?.passwordResetToken).toBe('my-reset-token')
    })
  })

  describe('findUserByResetToken', () => {
    it('should find user by email and reset token', async () => {
      await usersService.setResetToken(service.user.id, 'valid-token')

      const user = await usersService.findUserByResetToken(
        'tests@goodparty.org',
        'valid-token',
      )
      expect(user.id).toBe(service.user.id)
    })

    it('should throw for invalid token', async () => {
      await usersService.setResetToken(service.user.id, 'valid-token')

      await expect(
        usersService.findUserByResetToken('tests@goodparty.org', 'wrong-token'),
      ).rejects.toThrow()
    })
  })

  describe('resolveClerkIdByEmail', () => {
    let clerkClient: ClerkClient

    beforeEach(() => {
      clerkClient = service.app.get<ClerkClient>(CLERK_CLIENT_PROVIDER_TOKEN)
    })

    it('returns clerk source when Clerk returns a user for the email', async () => {
      vi.spyOn(clerkClient.users, 'getUserList').mockResolvedValue({
        data: [{ id: 'user_from_clerk_lookup' } as never],
        totalCount: 1,
      } as Awaited<ReturnType<typeof clerkClient.users.getUserList>>)

      const result: ResolvedActorIdentity =
        await usersService.resolveClerkIdByEmail('anyone@example.com')

      expect(result).toEqual({
        source: 'clerk',
        clerkId: 'user_from_clerk_lookup',
      })
      expect(clerkClient.users.getUserList).toHaveBeenCalledWith({
        emailAddress: ['anyone@example.com'],
        limit: 1,
      })
    })

    it('returns email-fallback source when Clerk returns no users', async () => {
      vi.spyOn(clerkClient.users, 'getUserList').mockResolvedValue({
        data: [],
        totalCount: 0,
      } as Awaited<ReturnType<typeof clerkClient.users.getUserList>>)

      const result =
        await usersService.resolveClerkIdByEmail('nobody@example.com')

      expect(result).toEqual({
        source: 'email-fallback',
        email: 'nobody@example.com',
      })
    })
  })

  describe('provisionMagicLinkUser', () => {
    let clerkClient: ClerkClient

    const uniqueSuffix = () =>
      `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    beforeEach(() => {
      clerkClient = service.app.get<ClerkClient>(CLERK_CLIENT_PROVIDER_TOKEN)
      vi.spyOn(clerkClient.signInTokens, 'createSignInToken').mockResolvedValue(
        {
          token: 'signin_token_abc',
        } as Awaited<
          ReturnType<typeof clerkClient.signInTokens.createSignInToken>
        >,
      )
    })

    // The suite runs with clearMocks (not restoreMocks), so a spied
    // clerkClient.users.getUserList would otherwise leak into later tests and
    // trip the lazy Clerk email-enrichment in findUser. Restore after each.
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('provisions a brand-new email and mints a sign-in token', async () => {
      const email = `eo-new-${uniqueSuffix()}@example.com`
      vi.spyOn(clerkClient.users, 'getUserList').mockResolvedValue({
        data: [],
        totalCount: 0,
      } as Awaited<ReturnType<typeof clerkClient.users.getUserList>>)
      const createUser = vi
        .spyOn(clerkClient.users, 'createUser')
        .mockResolvedValue({ id: 'clerk_brand_new' } as never)

      const result = await usersService.provisionMagicLinkUser({
        email,
        firstName: 'New',
        lastName: 'Lead',
      })

      expect(createUser).toHaveBeenCalled()
      expect(result.token).toBe('signin_token_abc')
      expect(result.clerkId).toBe('clerk_brand_new')
      expect(result.user.email).toBe(email)
    })

    it('normalizes a MixedCase email before provisioning', async () => {
      const suffix = uniqueSuffix()
      const email = `EO-Mixed-${suffix}@Example.com`
      vi.spyOn(clerkClient.users, 'getUserList').mockResolvedValue({
        data: [],
        totalCount: 0,
      } as Awaited<ReturnType<typeof clerkClient.users.getUserList>>)
      const createUser = vi
        .spyOn(clerkClient.users, 'createUser')
        .mockResolvedValue({ id: `clerk_mixed_${suffix}` } as never)

      const result = await usersService.provisionMagicLinkUser({
        email,
        firstName: 'Mixed',
        lastName: 'Case',
      })

      expect(createUser).toHaveBeenCalledWith(
        expect.objectContaining({ emailAddress: [email.toLowerCase()] }),
      )
      expect(result.user.email).toBe(email.toLowerCase())
    })

    it('recovers from a concurrent create that lost the duplicate-email race', async () => {
      // Two concurrent magic-link requests both miss the initial lookup and
      // race on createUser; the loser gets Clerk's 422 form_identifier_exists.
      // It must re-resolve the winner's identity and reuse it, not 500.
      const suffix = uniqueSuffix()
      const email = `eo-race-${suffix}@example.com`
      const clerkId = `clerk_race_${suffix}`
      // First lookup misses (email not yet visible), the catch-path re-lookup
      // finds the identity the winner just created.
      vi.spyOn(clerkClient.users, 'getUserList')
        .mockResolvedValueOnce({
          data: [],
          totalCount: 0,
        } as Awaited<ReturnType<typeof clerkClient.users.getUserList>>)
        .mockResolvedValue({
          data: [{ id: clerkId } as never],
          totalCount: 1,
        } as Awaited<ReturnType<typeof clerkClient.users.getUserList>>)
      vi.spyOn(clerkClient.users, 'getUser').mockResolvedValue({
        passwordEnabled: false,
      } as Awaited<ReturnType<typeof clerkClient.users.getUser>>)
      const createUser = vi
        .spyOn(clerkClient.users, 'createUser')
        .mockRejectedValue(
          Object.assign(new Error('form_identifier_exists'), {
            status: 422,
            errors: [{ code: 'form_identifier_exists' }],
          }),
        )

      const result = await usersService.provisionMagicLinkUser({
        email,
        firstName: 'Race',
        lastName: 'Loser',
      })

      expect(createUser).toHaveBeenCalledTimes(1)
      expect(result.clerkId).toBe(clerkId)
      expect(result.token).toBe('signin_token_abc')
    })

    it('reuses an existing passwordless EO lead without a campaign', async () => {
      const suffix = uniqueSuffix()
      const email = `eo-lead-${suffix}@example.com`
      const clerkId = `clerk_lead_${suffix}`
      const user = await service.prisma.user.create({
        data: {
          email,
          firstName: 'Lead',
          lastName: 'Person',
          name: 'Lead Person',
          clerkId,
        },
      })
      // The existing identity is a real EO lead: it already owns an
      // ElectedOffice (provisioned on the first magic link). Only such an
      // account may be reused for a fresh sign-in token.
      const eoOrgSlug = `eo-org-${suffix}`
      await service.prisma.organization.create({
        data: { slug: eoOrgSlug, ownerId: user.id },
      })
      await service.prisma.electedOffice.create({
        data: { userId: user.id, organizationSlug: eoOrgSlug },
      })
      vi.spyOn(clerkClient.users, 'getUserList').mockResolvedValue({
        data: [{ id: clerkId } as never],
        totalCount: 1,
      } as Awaited<ReturnType<typeof clerkClient.users.getUserList>>)
      vi.spyOn(clerkClient.users, 'getUser').mockResolvedValue({
        passwordEnabled: false,
      } as Awaited<ReturnType<typeof clerkClient.users.getUser>>)
      const createUser = vi.spyOn(clerkClient.users, 'createUser')

      const result = await usersService.provisionMagicLinkUser({
        email,
        firstName: 'Lead',
        lastName: 'Person',
      })

      expect(createUser).not.toHaveBeenCalled()
      expect(result.clerkId).toBe(clerkId)
      expect(result.token).toBe('signin_token_abc')
    })

    it('reuses a passwordless, campaign-less account that has no EO yet (retry after a stranded partial create)', async () => {
      // If a first magic-link attempt provisioned the Clerk + local user but
      // failed before the ElectedOffice was created, the account is a stranded
      // partial lead — admins must be able to retry. Campaign ownership is the
      // only block; a missing ElectedOffice must NOT permanently reject reuse.
      const suffix = uniqueSuffix()
      const email = `eo-retry-${suffix}@example.com`
      const clerkId = `clerk_retry_${suffix}`
      await service.prisma.user.create({
        data: {
          email,
          firstName: 'Stranded',
          lastName: 'Lead',
          name: 'Stranded Lead',
          clerkId,
        },
      })
      vi.spyOn(clerkClient.users, 'getUserList').mockResolvedValue({
        data: [{ id: clerkId } as never],
        totalCount: 1,
      } as Awaited<ReturnType<typeof clerkClient.users.getUserList>>)
      vi.spyOn(clerkClient.users, 'getUser').mockResolvedValue({
        passwordEnabled: false,
      } as Awaited<ReturnType<typeof clerkClient.users.getUser>>)
      const createUser = vi.spyOn(clerkClient.users, 'createUser')

      const result = await usersService.provisionMagicLinkUser({
        email,
        firstName: 'Stranded',
        lastName: 'Lead',
      })

      expect(createUser).not.toHaveBeenCalled()
      expect(result.clerkId).toBe(clerkId)
      expect(result.token).toBe('signin_token_abc')
    })

    it('refuses an existing account that has a Clerk password set', async () => {
      const suffix = uniqueSuffix()
      const email = `eo-pw-${suffix}@example.com`
      const clerkId = `clerk_pw_${suffix}`
      await service.prisma.user.create({
        data: {
          email,
          firstName: 'Real',
          lastName: 'User',
          name: 'Real User',
          clerkId,
        },
      })
      vi.spyOn(clerkClient.users, 'getUserList').mockResolvedValue({
        data: [{ id: clerkId } as never],
        totalCount: 1,
      } as Awaited<ReturnType<typeof clerkClient.users.getUserList>>)
      vi.spyOn(clerkClient.users, 'getUser').mockResolvedValue({
        passwordEnabled: true,
      } as Awaited<ReturnType<typeof clerkClient.users.getUser>>)
      const signIn = vi.spyOn(clerkClient.signInTokens, 'createSignInToken')

      await expect(
        usersService.provisionMagicLinkUser({
          email,
          firstName: 'Real',
          lastName: 'User',
        }),
      ).rejects.toThrow(ConflictException)
      await expect(
        usersService.provisionMagicLinkUser({
          email,
          firstName: 'Real',
          lastName: 'User',
        }),
      ).rejects.toThrow(EXISTING_ACCOUNT_MAGIC_LINK_ERROR)
      expect(signIn).not.toHaveBeenCalled()
    })

    it('refuses an existing account linked to an OAuth/SSO identity', async () => {
      // A Google (or other OAuth) user has passwordEnabled: false but still
      // controls the account via SSO, so the magic link must not mint a token
      // for it even though no password is set and no campaign is owned.
      const suffix = uniqueSuffix()
      const email = `eo-oauth-${suffix}@example.com`
      const clerkId = `clerk_oauth_${suffix}`
      await service.prisma.user.create({
        data: {
          email,
          firstName: 'Google',
          lastName: 'User',
          name: 'Google User',
          clerkId,
        },
      })
      vi.spyOn(clerkClient.users, 'getUserList').mockResolvedValue({
        data: [{ id: clerkId } as never],
        totalCount: 1,
      } as Awaited<ReturnType<typeof clerkClient.users.getUserList>>)
      vi.spyOn(clerkClient.users, 'getUser').mockResolvedValue({
        passwordEnabled: false,
        externalAccounts: [{ provider: 'oauth_google' }],
      } as Awaited<ReturnType<typeof clerkClient.users.getUser>>)
      const signIn = vi.spyOn(clerkClient.signInTokens, 'createSignInToken')

      await expect(
        usersService.provisionMagicLinkUser({
          email,
          firstName: 'Google',
          lastName: 'User',
        }),
      ).rejects.toThrow(EXISTING_ACCOUNT_MAGIC_LINK_ERROR)
      expect(signIn).not.toHaveBeenCalled()
    })

    it('refuses an existing account secured with a TOTP authenticator', async () => {
      // A TOTP/2FA user can have passwordEnabled: false but still controls the
      // account via their authenticator, so the magic link must not reuse it.
      const suffix = uniqueSuffix()
      const email = `eo-totp-${suffix}@example.com`
      const clerkId = `clerk_totp_${suffix}`
      await service.prisma.user.create({
        data: {
          email,
          firstName: 'Totp',
          lastName: 'User',
          name: 'Totp User',
          clerkId,
        },
      })
      vi.spyOn(clerkClient.users, 'getUserList').mockResolvedValue({
        data: [{ id: clerkId } as never],
        totalCount: 1,
      } as Awaited<ReturnType<typeof clerkClient.users.getUserList>>)
      vi.spyOn(clerkClient.users, 'getUser').mockResolvedValue({
        passwordEnabled: false,
        totpEnabled: true,
      } as Awaited<ReturnType<typeof clerkClient.users.getUser>>)
      const signIn = vi.spyOn(clerkClient.signInTokens, 'createSignInToken')

      await expect(
        usersService.provisionMagicLinkUser({
          email,
          firstName: 'Totp',
          lastName: 'User',
        }),
      ).rejects.toThrow(EXISTING_ACCOUNT_MAGIC_LINK_ERROR)
      expect(signIn).not.toHaveBeenCalled()
    })

    it('refuses an existing account that owns a campaign', async () => {
      const suffix = uniqueSuffix()
      const email = `eo-camp-${suffix}@example.com`
      const clerkId = `clerk_camp_${suffix}`
      const user = await service.prisma.user.create({
        data: {
          email,
          firstName: 'Campaign',
          lastName: 'Owner',
          name: 'Campaign Owner',
          clerkId,
        },
      })
      const orgSlug = `org-eo-camp-${suffix}`
      await service.prisma.organization.create({
        data: { slug: orgSlug, ownerId: user.id },
      })
      await service.prisma.campaign.create({
        data: {
          slug: `camp-eo-${suffix}`,
          organizationSlug: orgSlug,
          userId: user.id,
        },
      })
      vi.spyOn(clerkClient.users, 'getUserList').mockResolvedValue({
        data: [{ id: clerkId } as never],
        totalCount: 1,
      } as Awaited<ReturnType<typeof clerkClient.users.getUserList>>)
      vi.spyOn(clerkClient.users, 'getUser').mockResolvedValue({
        passwordEnabled: false,
      } as Awaited<ReturnType<typeof clerkClient.users.getUser>>)
      const signIn = vi.spyOn(clerkClient.signInTokens, 'createSignInToken')

      await expect(
        usersService.provisionMagicLinkUser({
          email,
          firstName: 'Campaign',
          lastName: 'Owner',
        }),
      ).rejects.toThrow(EXISTING_ACCOUNT_MAGIC_LINK_ERROR)
      expect(signIn).not.toHaveBeenCalled()
    })

    it('refuses a legacy campaign-owning local user with no Clerk identity', async () => {
      // The email matches a campaign-owning local row whose clerkId is null. The
      // gate must run on this pre-existing row BEFORE any Clerk identity is
      // minted or bound — so no Clerk user is created and the row's clerkId is
      // left untouched.
      const suffix = uniqueSuffix()
      const email = `eo-legacy-camp-${suffix}@example.com`
      const user = await service.prisma.user.create({
        data: {
          email,
          firstName: 'Legacy',
          lastName: 'Candidate',
          name: 'Legacy Candidate',
          clerkId: null,
        },
      })
      const orgSlug = `org-legacy-camp-${suffix}`
      await service.prisma.organization.create({
        data: { slug: orgSlug, ownerId: user.id },
      })
      await service.prisma.campaign.create({
        data: {
          slug: `camp-legacy-${suffix}`,
          organizationSlug: orgSlug,
          userId: user.id,
        },
      })
      vi.spyOn(clerkClient.users, 'getUserList').mockResolvedValue({
        data: [],
        totalCount: 0,
      } as Awaited<ReturnType<typeof clerkClient.users.getUserList>>)
      const createUser = vi
        .spyOn(clerkClient.users, 'createUser')
        .mockResolvedValue({ id: `clerk_legacy_${suffix}` } as never)
      const signIn = vi.spyOn(clerkClient.signInTokens, 'createSignInToken')

      await expect(
        usersService.provisionMagicLinkUser({
          email,
          firstName: 'Legacy',
          lastName: 'Candidate',
        }),
      ).rejects.toThrow(EXISTING_ACCOUNT_MAGIC_LINK_ERROR)
      expect(createUser).not.toHaveBeenCalled()
      expect(signIn).not.toHaveBeenCalled()
      const refetched = await service.prisma.user.findUnique({
        where: { id: user.id },
      })
      expect(refetched?.clerkId).toBeNull()
    })

    it('refuses a legacy staff/admin local user with no Clerk identity and no campaign', async () => {
      // The account-takeover path: an admin-console-created staff row has
      // clerkId: null and owns NO campaign, so the campaign gate alone misses
      // it. The role gate refuses it — and runs before provisioning, so no Clerk
      // identity is minted or bound to the privileged row and no token issues.
      const suffix = uniqueSuffix()
      const email = `eo-admin-${suffix}@example.com`
      const user = await service.prisma.user.create({
        data: {
          email,
          firstName: 'Staff',
          lastName: 'Admin',
          name: 'Staff Admin',
          clerkId: null,
          roles: [UserRole.admin],
        },
      })
      vi.spyOn(clerkClient.users, 'getUserList').mockResolvedValue({
        data: [],
        totalCount: 0,
      } as Awaited<ReturnType<typeof clerkClient.users.getUserList>>)
      const createUser = vi
        .spyOn(clerkClient.users, 'createUser')
        .mockResolvedValue({ id: `clerk_admin_${suffix}` } as never)
      const signIn = vi.spyOn(clerkClient.signInTokens, 'createSignInToken')

      await expect(
        usersService.provisionMagicLinkUser({
          email,
          firstName: 'Staff',
          lastName: 'Admin',
        }),
      ).rejects.toThrow(EXISTING_ACCOUNT_MAGIC_LINK_ERROR)
      expect(createUser).not.toHaveBeenCalled()
      expect(signIn).not.toHaveBeenCalled()
      // No foreign Clerk identity was bound onto the privileged row.
      const refetched = await service.prisma.user.findUnique({
        where: { id: user.id },
      })
      expect(refetched?.clerkId).toBeNull()
    })

    it('refuses a role-bearing account that already has a Clerk identity', async () => {
      // A privileged account is refused even when the email already maps to a
      // (bare passwordless) Clerk identity — the role gate, not the passwordless
      // gate, is what blocks it, and no sign-in token is minted.
      const suffix = uniqueSuffix()
      const email = `eo-clerk-admin-${suffix}@example.com`
      const clerkId = `clerk_admin_existing_${suffix}`
      await service.prisma.user.create({
        data: {
          email,
          firstName: 'Clerk',
          lastName: 'Admin',
          name: 'Clerk Admin',
          clerkId,
          roles: [UserRole.admin],
        },
      })
      vi.spyOn(clerkClient.users, 'getUserList').mockResolvedValue({
        data: [{ id: clerkId } as never],
        totalCount: 1,
      } as Awaited<ReturnType<typeof clerkClient.users.getUserList>>)
      // Mocked so the read-enrichment wrapper (findUserByEmail enriches a row
      // that has a clerkId) doesn't reach the real Clerk API.
      vi.spyOn(clerkClient.users, 'getUser').mockResolvedValue({
        passwordEnabled: false,
      } as Awaited<ReturnType<typeof clerkClient.users.getUser>>)
      const signIn = vi.spyOn(clerkClient.signInTokens, 'createSignInToken')

      await expect(
        usersService.provisionMagicLinkUser({
          email,
          firstName: 'Clerk',
          lastName: 'Admin',
        }),
      ).rejects.toThrow(EXISTING_ACCOUNT_MAGIC_LINK_ERROR)
      expect(signIn).not.toHaveBeenCalled()
    })
  })

  describe('impersonateUser', () => {
    let clerkClient: ClerkClient

    beforeEach(() => {
      clerkClient = service.app.get<ClerkClient>(CLERK_CLIENT_PROVIDER_TOKEN)
    })

    it('returns an actor token when the target user has a clerkId', async () => {
      vi.spyOn(clerkClient.actorTokens, 'create').mockResolvedValue({
        token: 'actor_token_abc',
      } as Awaited<ReturnType<typeof clerkClient.actorTokens.create>>)

      const result = await usersService.impersonateUser(
        service.user.id,
        'user_actor_clerk_id',
      )

      expect(result).toEqual({ token: 'actor_token_abc' })
      expect(clerkClient.actorTokens.create).toHaveBeenCalledWith({
        userId: service.user.clerkId,
        actor: { sub: 'user_actor_clerk_id' },
        expiresInSeconds: 3600,
      })
    })

    it('throws BadRequestException when target user has no clerkId', async () => {
      const userWithoutClerkId = await service.prisma.user.create({
        data: {
          email: 'noclerk@example.com',
          firstName: 'No',
          lastName: 'Clerk',
          clerkId: null,
        },
      })

      await expect(
        usersService.impersonateUser(
          userWithoutClerkId.id,
          'user_actor_clerk_id',
        ),
      ).rejects.toThrow(BadRequestException)
    })

    it('throws BadRequestException with message when user has no clerkId', async () => {
      const userWithoutClerkId = await service.prisma.user.create({
        data: {
          email: 'noclerk2@example.com',
          firstName: 'No',
          lastName: 'Clerk',
          clerkId: null,
        },
      })

      await expect(
        usersService.impersonateUser(userWithoutClerkId.id, 'actor_id'),
      ).rejects.toThrow('User does not have an associated Clerk ID')
    })

    it('throws BadGatewayException when Clerk API call fails', async () => {
      vi.spyOn(clerkClient.actorTokens, 'create').mockRejectedValue(
        new Error('Clerk API unavailable'),
      )

      await expect(
        usersService.impersonateUser(service.user.id, 'user_actor_clerk_id'),
      ).rejects.toThrow(BadGatewayException)
    })

    it('throws BadGatewayException with message when Clerk API call fails', async () => {
      vi.spyOn(clerkClient.actorTokens, 'create').mockRejectedValue(
        new Error('Network error'),
      )

      await expect(
        usersService.impersonateUser(service.user.id, 'user_actor_clerk_id'),
      ).rejects.toThrow('Failed to create impersonation token')
    })

    it('throws BadGatewayException when Clerk returns no token', async () => {
      vi.spyOn(clerkClient.actorTokens, 'create').mockResolvedValue({
        token: null,
      } as unknown as Awaited<
        ReturnType<typeof clerkClient.actorTokens.create>
      >)

      await expect(
        usersService.impersonateUser(service.user.id, 'user_actor_clerk_id'),
      ).rejects.toThrow(BadGatewayException)
    })
  })

  describe('findOrProvisionByClerk', () => {
    const provision = (
      clerkId: string,
      email: string,
      first = 'Test',
      last = 'User',
    ) =>
      usersService.findOrProvisionByClerk({
        clerkId,
        email,
        firstName: first,
        lastName: last,
      })

    const createUser = (email: string, clerkId: string | null = null) =>
      service.prisma.user.create({
        data: { email, clerkId },
      })

    it('persists a MixedCase email lowercased on create', async () => {
      const result = await provision(
        'user_mixed_case',
        'MixedCase.Clerk@Test.GoodParty.Org',
      )
      expect(result?.email).toBe('mixedcase.clerk@test.goodparty.org')
    })

    it('returns existing user when found by clerkId', async () => {
      const existing = await createUser(
        'clerk-existing@test.goodparty.org',
        'user_existing',
      )
      const result = await provision(
        'user_existing',
        'clerk-existing@test.goodparty.org',
      )
      expect(result?.id).toBe(existing.id)
    })

    it('returns user when a concurrent provision already bound the same clerkId', async () => {
      const existing = await createUser(
        'race-same@test.goodparty.org',
        'user_race_same',
      )
      vi.spyOn(usersService, 'findUser').mockResolvedValueOnce(null)
      const result = await provision(
        'user_race_same',
        'race-same@test.goodparty.org',
      )
      expect(result?.id).toBe(existing.id)
    })

    it('returns null and preserves clerkId when email matches a user that already has one', async () => {
      const victim = await createUser(
        'victim@test.goodparty.org',
        'user_victim',
      )
      const result = await provision(
        'user_attacker',
        'victim@test.goodparty.org',
      )
      expect(result).toBeNull()
      const after = await service.prisma.user.findUnique({
        where: { id: victim.id },
      })
      expect(after?.clerkId).toBe('user_victim')
    })

    it('links legacy user with null clerkId', async () => {
      const legacy = await createUser('legacy@test.goodparty.org')
      const result = await provision('user_new', 'legacy@test.goodparty.org')
      expect(result?.id).toBe(legacy.id)
      const after = await service.prisma.user.findUnique({
        where: { id: legacy.id },
      })
      expect(after?.clerkId).toBe('user_new')
    })

    it('creates a new user when no match', async () => {
      const result = await provision(
        'user_brand_new',
        'brand-new@test.goodparty.org',
      )
      expect(result?.clerkId).toBe('user_brand_new')
      expect(result?.email).toBe('brand-new@test.goodparty.org')
    })

    it('returns user when updateMany loses race to same clerkId', async () => {
      const legacy = await createUser('occ-same@test.goodparty.org')
      await service.prisma.user.update({
        where: { id: legacy.id },
        data: { clerkId: 'user_same' },
      })
      const result = await provision('user_same', 'occ-same@test.goodparty.org')
      expect(result?.id).toBe(legacy.id)
      expect(result?.clerkId).toBe('user_same')
    })

    describe('resolveAfterP2002 (race recovery)', () => {
      const resolveAfterP2002 = (clerkId: string, email: string) =>
        // @ts-expect-error accessing private method for test coverage
        usersService.resolveAfterP2002({ clerkId, email }) as Promise<
          Awaited<ReturnType<typeof usersService.findUser>>
        >

      it('returns the user found by clerkId (primary race recovery path)', async () => {
        const existing = await createUser(
          'p2002-same-clerk@test.goodparty.org',
          'user_p2002_same',
        )
        const result = await resolveAfterP2002(
          'user_p2002_same',
          'p2002-same-clerk@test.goodparty.org',
        )
        expect(result?.id).toBe(existing.id)
      })

      it('returns null when email match has different clerkId', async () => {
        await createUser('p2002-diff@test.goodparty.org', 'user_p2002_other')
        const result = await resolveAfterP2002(
          'user_p2002_attacker',
          'p2002-diff@test.goodparty.org',
        )
        expect(result).toBeNull()
      })

      it('links legacy user with null clerkId', async () => {
        const legacy = await createUser('p2002-legacy@test.goodparty.org')
        const result = await resolveAfterP2002(
          'user_p2002_linker',
          'p2002-legacy@test.goodparty.org',
        )
        expect(result?.id).toBe(legacy.id)
        const after = await service.prisma.user.findUnique({
          where: { id: legacy.id },
        })
        expect(after?.clerkId).toBe('user_p2002_linker')
      })

      it('returns null when neither lookup resolves', async () => {
        const result = await resolveAfterP2002(
          'user_p2002_ghost',
          'p2002-ghost@test.goodparty.org',
        )
        expect(result).toBeNull()
      })
    })
  })

  describe('deleteUser', () => {
    let clerkClient: ClerkClient
    let analyticsService: AnalyticsService
    let stripeService: StripeService

    beforeEach(() => {
      clerkClient = service.app.get<ClerkClient>(CLERK_CLIENT_PROVIDER_TOKEN)
      analyticsService = service.app.get<AnalyticsService>(AnalyticsService)
      stripeService = service.app.get<StripeService>(StripeService)
    })

    it('deletes the DB record and calls clerkClient.users.deleteUser when user has a clerkId', async () => {
      const targetUser = await service.prisma.user.create({
        data: {
          email: 'delete-me@example.com',
          clerkId: 'clerk_delete_test_id',
        },
      })
      vi.spyOn(clerkClient.users, 'deleteUser').mockResolvedValue(
        {} as Awaited<ReturnType<typeof clerkClient.users.deleteUser>>,
      )
      vi.spyOn(analyticsService, 'track').mockResolvedValue(
        {} as Awaited<ReturnType<typeof analyticsService.track>>,
      )

      await usersService.deleteUser(targetUser.id, service.user.id)

      const found = await service.prisma.user.findUnique({
        where: { id: targetUser.id },
      })
      expect(found).toBeNull()
      expect(clerkClient.users.deleteUser).toHaveBeenCalledWith(
        'clerk_delete_test_id',
      )
    })

    it('deletes the DB record and skips Clerk when user has no clerkId', async () => {
      const targetUser = await service.prisma.user.create({
        data: {
          email: 'no-clerk@example.com',
          clerkId: null,
        },
      })
      const deleteUserSpy = vi
        .spyOn(clerkClient.users, 'deleteUser')
        .mockResolvedValue(
          {} as Awaited<ReturnType<typeof clerkClient.users.deleteUser>>,
        )
      vi.spyOn(analyticsService, 'track').mockResolvedValue(
        {} as Awaited<ReturnType<typeof analyticsService.track>>,
      )

      await usersService.deleteUser(targetUser.id, service.user.id)

      const found = await service.prisma.user.findUnique({
        where: { id: targetUser.id },
      })
      expect(found).toBeNull()
      expect(deleteUserSpy).not.toHaveBeenCalled()
    })

    it('rolls back DB delete and throws BadGatewayException when Clerk deleteUser fails', async () => {
      const targetUser = await service.prisma.user.create({
        data: {
          email: 'clerk-fail@example.com',
          clerkId: 'clerk_fail_id',
        },
      })
      vi.spyOn(clerkClient.users, 'deleteUser').mockRejectedValue(
        new Error('Clerk API error'),
      )

      await expect(
        usersService.deleteUser(targetUser.id, service.user.id),
      ).rejects.toThrow(BadGatewayException)

      const found = await service.prisma.user.findUnique({
        where: { id: targetUser.id },
      })
      expect(found).not.toBeNull()
    })

    it('fires Account - User Deleted event with self initiatedBy when user deletes their own account', async () => {
      const targetUser = await service.prisma.user.create({
        data: {
          email: 'self-delete@example.com',
          clerkId: null,
        },
      })
      const trackSpy = vi
        .spyOn(analyticsService, 'track')
        .mockResolvedValue(
          {} as Awaited<ReturnType<typeof analyticsService.track>>,
        )

      await usersService.deleteUser(targetUser.id, targetUser.id)

      expect(trackSpy).toHaveBeenCalledWith(
        targetUser.id,
        'Account - User Deleted',
        expect.not.objectContaining({ initiatedByUserId: expect.anything() }),
        expect.objectContaining({ email: targetUser.email }),
      )
    })

    it('fires Account - User Deleted event with admin initiatedBy when an admin deletes an account', async () => {
      const targetUser = await service.prisma.user.create({
        data: {
          email: 'admin-deleted@example.com',
          clerkId: null,
        },
      })
      const trackSpy = vi
        .spyOn(analyticsService, 'track')
        .mockResolvedValue(
          {} as Awaited<ReturnType<typeof analyticsService.track>>,
        )

      await usersService.deleteUser(targetUser.id, service.user.id)

      expect(trackSpy).toHaveBeenCalledWith(
        targetUser.id,
        'Account - User Deleted',
        expect.objectContaining({
          initiatedBy: 'admin',
          initiatedByUserId: service.user.id,
        }),
        expect.objectContaining({ email: targetUser.email }),
      )
    })

    it('does not fire analytics event when Clerk deletion fails', async () => {
      const targetUser = await service.prisma.user.create({
        data: {
          email: 'analytics-no-fire@example.com',
          clerkId: 'clerk_analytics_fail_id',
        },
      })
      vi.spyOn(clerkClient.users, 'deleteUser').mockRejectedValue(
        new Error('Clerk API error'),
      )
      const trackSpy = vi
        .spyOn(analyticsService, 'track')
        .mockResolvedValue(
          {} as Awaited<ReturnType<typeof analyticsService.track>>,
        )

      await expect(
        usersService.deleteUser(targetUser.id, service.user.id),
      ).rejects.toThrow(BadGatewayException)

      expect(trackSpy).not.toHaveBeenCalled()
    })

    it('does not cancel Stripe subscription when Clerk deletion fails and transaction rolls back', async () => {
      const targetUser = await service.prisma.user.create({
        data: {
          email: 'stripe-rollback@example.com',
          clerkId: 'clerk_stripe_rollback_id',
        },
      })
      await service.prisma.organization.create({
        data: {
          slug: `org-stripe-rollback-${targetUser.id}`,
          ownerId: targetUser.id,
          positionId: 'br-pos-stripe-test',
        },
      })
      await service.prisma.campaign.create({
        data: {
          userId: targetUser.id,
          slug: `stripe-rollback-${targetUser.id}`,
          organizationSlug: `org-stripe-rollback-${targetUser.id}`,
          details: { subscriptionId: 'sub_should_not_cancel' },
        },
      })

      vi.spyOn(clerkClient.users, 'deleteUser').mockRejectedValue(
        new Error('Clerk API error'),
      )
      const cancelSpy = vi
        .spyOn(stripeService, 'cancelSubscription')
        .mockResolvedValue(undefined as never)

      await expect(
        usersService.deleteUser(targetUser.id, service.user.id),
      ).rejects.toThrow(BadGatewayException)

      expect(cancelSpy).not.toHaveBeenCalled()
      const found = await service.prisma.user.findUnique({
        where: { id: targetUser.id },
      })
      expect(found).not.toBeNull()
    })
  })

  describe('deleteTestUsers', () => {
    let clerkClient: ClerkClient

    beforeEach(() => {
      clerkClient = service.app.get<ClerkClient>(CLERK_CLIENT_PROVIDER_TOKEN)
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('deletes only test-domain DB users older than the cutoff', async () => {
      vi.spyOn(clerkClient.users, 'getUserList').mockResolvedValue({
        data: [],
        totalCount: 0,
      } as Awaited<ReturnType<typeof clerkClient.users.getUserList>>)

      const suffix = `${Date.now()}`
      const oldTest = await service.prisma.user.create({
        data: {
          email: `old-${suffix}@test.goodparty.org`,
          createdAt: subDays(new Date(), 2),
        },
      })
      const recentTest = await service.prisma.user.create({
        data: {
          email: `recent-${suffix}@test.goodparty.org`,
          createdAt: new Date(),
        },
      })
      const oldReal = await service.prisma.user.create({
        data: {
          email: `old-${suffix}@example.com`,
          createdAt: subDays(new Date(), 2),
        },
      })

      await usersService.deleteTestUsers()

      expect(
        await service.prisma.user.findUnique({ where: { id: oldTest.id } }),
      ).toBeNull()
      expect(
        await service.prisma.user.findUnique({ where: { id: recentTest.id } }),
      ).not.toBeNull()
      expect(
        await service.prisma.user.findUnique({ where: { id: oldReal.id } }),
      ).not.toBeNull()
    })

    it('pages through Clerk oldest-first, deleting test-domain users and advancing offset past the rest', async () => {
      // All mock users are created well before the 24h cutoff so they are
      // eligible for deletion.
      const oldCreatedAt = 1000
      const testUser = (i: number) =>
        ({
          id: `clerk_test_${i}`,
          createdAt: oldCreatedAt,
          emailAddresses: [{ emailAddress: `t${i}@test.goodparty.org` }],
        }) as never
      const realUser = (i: number) =>
        ({
          id: `clerk_real_${i}`,
          createdAt: oldCreatedAt,
          emailAddresses: [{ emailAddress: `r${i}@example.com` }],
        }) as never

      // Page 1 (full): 3 test users + 497 non-test.
      const pageOne = [
        testUser(1),
        testUser(2),
        testUser(3),
        ...Array.from({ length: 497 }, (_, i) => realUser(i)),
      ]
      // Page 2 (full): 1 test user + 499 non-test.
      const pageTwo = [
        testUser(4),
        ...Array.from({ length: 499 }, (_, i) => realUser(500 + i)),
      ]
      // Page 3 (short): 1 test user + 1 non-test -> loop stops.
      const pageThree = [testUser(5), realUser(9999)]

      const getUserList = vi
        .spyOn(clerkClient.users, 'getUserList')
        .mockResolvedValueOnce({ data: pageOne, totalCount: 1002 } as never)
        .mockResolvedValueOnce({ data: pageTwo, totalCount: 1002 } as never)
        .mockResolvedValueOnce({ data: pageThree, totalCount: 1002 } as never)
      const deleteUser = vi
        .spyOn(clerkClient.users, 'deleteUser')
        .mockResolvedValue(
          {} as Awaited<ReturnType<typeof clerkClient.users.deleteUser>>,
        )

      await usersService.deleteTestUsers()

      expect(deleteUser.mock.calls.map((c) => c[0])).toEqual([
        'clerk_test_1',
        'clerk_test_2',
        'clerk_test_3',
        'clerk_test_4',
        'clerk_test_5',
      ])
      expect(getUserList).toHaveBeenCalledTimes(3)
      expect(getUserList.mock.calls[0]?.[0]).toMatchObject({
        limit: 500,
        offset: 0,
        orderBy: '+created_at',
      })
      // offset advances past the non-deleted users left on each page:
      // page 1 leaves 497, page 2 leaves 499 -> cumulative 996.
      expect(getUserList.mock.calls[1]?.[0]).toMatchObject({ offset: 497 })
      expect(getUserList.mock.calls[2]?.[0]).toMatchObject({ offset: 996 })
    })
  })
})
