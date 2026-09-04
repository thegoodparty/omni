import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClerkClient } from '@clerk/backend'
import { BadGatewayException } from '@nestjs/common'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { CLERK_LIST_TIMEOUT_MS } from '@/vendors/clerk/clerk.consts'
import { ClerkInvitationsService } from './clerkInvitations.service'

// Stands in for a Clerk call that never settles, so the only way the
// caller can proceed is clerkCall's own timeout.
const hangForever = <T>(): Promise<T> => new Promise(() => undefined)

// ClerkClient is a type-only export, but SWC emits it as runtime decorator
// metadata for the constructor param, so the mock must expose a placeholder.
vi.mock('@clerk/backend', () => ({
  createClerkClient: vi.fn(),
  ClerkClient: class {},
}))

const metadata = {
  organizationSlug: 'acme',
  role: 'campaignAdmin' as const,
  name: 'Jamie Manager',
  invitedByUserId: 1,
}

const makeService = ({
  createInvitation = vi.fn(),
  getInvitationList = vi.fn(),
  revokeInvitation = vi.fn(),
  getUser = vi.fn(),
  updateUserMetadata = vi.fn(),
  getUserList = vi.fn(),
} = {}) => {
  const clerkClient = {
    invitations: { createInvitation, getInvitationList, revokeInvitation },
    users: { getUser, updateUserMetadata, getUserList },
  } as unknown as ClerkClient
  return {
    service: new ClerkInvitationsService(clerkClient, createMockLogger()),
    createInvitation,
    getInvitationList,
    revokeInvitation,
    getUser,
    updateUserMetadata,
    getUserList,
  }
}

describe('ClerkInvitationsService', () => {
  describe('createTeamInvitation', () => {
    it('passes emailAddress/redirectUrl/publicMetadata through and returns the created invitation', async () => {
      const createInvitation = vi
        .fn()
        .mockResolvedValue({ id: 'inv_1', emailAddress: 'a@b.com' })
      const { service } = makeService({ createInvitation })

      await expect(
        service.createTeamInvitation({
          emailAddress: 'a@b.com',
          redirectUrl: 'https://app.goodparty.org/team-invite',
          publicMetadata: metadata,
        }),
      ).resolves.toEqual({ id: 'inv_1', emailAddress: 'a@b.com' })
      expect(createInvitation).toHaveBeenCalledWith({
        emailAddress: 'a@b.com',
        redirectUrl: 'https://app.goodparty.org/team-invite',
        publicMetadata: metadata,
      })
    })

    it('throws BadGatewayException when Clerk rejects the invitation', async () => {
      const createInvitation = vi
        .fn()
        .mockRejectedValue(new Error('clerk_error: email already invited'))
      const { service } = makeService({ createInvitation })

      await expect(
        service.createTeamInvitation({
          emailAddress: 'a@b.com',
          redirectUrl: 'https://app.goodparty.org/team-invite',
          publicMetadata: metadata,
        }),
      ).rejects.toBeInstanceOf(BadGatewayException)
    })
  })

  describe('listPendingTeamInvitations', () => {
    it('returns only invitations whose metadata matches the given org slug', async () => {
      const getInvitationList = vi.fn().mockResolvedValue({
        data: [
          {
            id: 'inv_1',
            publicMetadata: { ...metadata, organizationSlug: 'acme' },
          },
          {
            id: 'inv_2',
            publicMetadata: { ...metadata, organizationSlug: 'other' },
          },
          { id: 'inv_3', publicMetadata: null },
        ],
        totalCount: 3,
      })
      const { service } = makeService({ getInvitationList })

      const result = await service.listPendingTeamInvitations('acme')

      expect(result.map((invitation) => invitation.id)).toEqual(['inv_1'])
      expect(getInvitationList).toHaveBeenCalledWith({
        status: 'pending',
        limit: 500,
        offset: 0,
      })
    })

    it('pages through the full instance-wide list before filtering', async () => {
      // getInvitationList has no server-side org filter, so a single
      // (even max-size) page can silently drop this org's invitations once
      // the instance-wide pending count exceeds it — pagination must
      // exhaust totalCount before filtering, not stop at the first page.
      // A page's worth of unrelated invitations from other orgs stands in
      // for the 500 that push this org's invite past the first page — the
      // response's `data.length` per page is what the loop advances on.
      const page1Data = Array.from({ length: 500 }, (_, i) => ({
        id: `inv_other_${i}`,
        publicMetadata: { ...metadata, organizationSlug: 'other' },
      }))
      const getInvitationList = vi
        .fn()
        .mockResolvedValueOnce({ data: page1Data, totalCount: 501 })
        .mockResolvedValueOnce({
          data: [
            {
              id: 'inv_page2',
              publicMetadata: { ...metadata, organizationSlug: 'acme' },
            },
          ],
          totalCount: 501,
        })
      const { service } = makeService({ getInvitationList })

      const result = await service.listPendingTeamInvitations('acme')

      expect(result.map((invitation) => invitation.id)).toEqual(['inv_page2'])
      expect(getInvitationList).toHaveBeenCalledTimes(2)
      expect(getInvitationList).toHaveBeenNthCalledWith(1, {
        status: 'pending',
        limit: 500,
        offset: 0,
      })
      expect(getInvitationList).toHaveBeenNthCalledWith(2, {
        status: 'pending',
        limit: 500,
        offset: 500,
      })
    })

    it('throws BadGatewayException when Clerk fails to list invitations', async () => {
      const getInvitationList = vi.fn().mockRejectedValue(new Error('down'))
      const { service } = makeService({ getInvitationList })

      await expect(
        service.listPendingTeamInvitations('acme'),
      ).rejects.toBeInstanceOf(BadGatewayException)
    })

    it('throws BadGatewayException when a later page fails', async () => {
      const getInvitationList = vi
        .fn()
        .mockResolvedValueOnce({
          data: [{ id: 'inv_1', publicMetadata: null }],
          totalCount: 501,
        })
        .mockRejectedValueOnce(new Error('down'))
      const { service } = makeService({ getInvitationList })

      await expect(
        service.listPendingTeamInvitations('acme'),
      ).rejects.toBeInstanceOf(BadGatewayException)
    })

    describe('page retries', () => {
      beforeEach(() => {
        vi.useFakeTimers()
      })

      afterEach(() => {
        vi.useRealTimers()
      })

      it('retries a page that times out once, then returns the full list', async () => {
        const getInvitationList = vi
          .fn()
          .mockImplementationOnce(hangForever)
          .mockResolvedValueOnce({
            data: [
              {
                id: 'inv_1',
                publicMetadata: { ...metadata, organizationSlug: 'acme' },
              },
            ],
            totalCount: 1,
          })
        const { service } = makeService({ getInvitationList })

        const pending = service.listPendingTeamInvitations('acme')
        // First attempt times out at CLERK_LIST_TIMEOUT_MS, then the retry
        // helper's fixed backoff elapses before the second (successful) try.
        await vi.advanceTimersByTimeAsync(CLERK_LIST_TIMEOUT_MS + 1_000)

        const result = await pending
        expect(result.map((invitation) => invitation.id)).toEqual(['inv_1'])
        expect(getInvitationList).toHaveBeenCalledTimes(2)
      })

      it('retries a page rejected with a 429 rate-limit error, honoring retryAfter', async () => {
        const rateLimitError = Object.assign(new Error('Too Many Requests'), {
          status: 429,
          retryAfter: 2,
        })
        const getInvitationList = vi
          .fn()
          .mockRejectedValueOnce(rateLimitError)
          .mockResolvedValueOnce({
            data: [
              {
                id: 'inv_1',
                publicMetadata: { ...metadata, organizationSlug: 'acme' },
              },
            ],
            totalCount: 1,
          })
        const { service } = makeService({ getInvitationList })

        const pending = service.listPendingTeamInvitations('acme')
        await vi.advanceTimersByTimeAsync(2_000)

        const result = await pending
        expect(result.map((invitation) => invitation.id)).toEqual(['inv_1'])
        expect(getInvitationList).toHaveBeenCalledTimes(2)
      })

      it('throws BadGatewayException once page retries are exhausted', async () => {
        // Exercises the real production error path: the dependency keeps
        // throwing the same 429 shape production would see from Clerk, not
        // a mock standing in for the retry helper itself.
        const rateLimitError = Object.assign(new Error('Too Many Requests'), {
          status: 429,
        })
        const getInvitationList = vi.fn().mockRejectedValue(rateLimitError)
        const { service } = makeService({ getInvitationList })

        const pending = service.listPendingTeamInvitations('acme')
        const assertion =
          expect(pending).rejects.toBeInstanceOf(BadGatewayException)
        await vi.advanceTimersByTimeAsync(2_000)

        await assertion
        expect(getInvitationList).toHaveBeenCalledTimes(3)
      })

      it('does not retry a non-timeout, non-429 failure', async () => {
        const getInvitationList = vi.fn().mockRejectedValue(new Error('down'))
        const { service } = makeService({ getInvitationList })

        await expect(
          service.listPendingTeamInvitations('acme'),
        ).rejects.toBeInstanceOf(BadGatewayException)
        expect(getInvitationList).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('revokeInvitation', () => {
    it('revokes the invitation by id', async () => {
      const revokeInvitation = vi
        .fn()
        .mockResolvedValue({ id: 'inv_1', revoked: true })
      const { service } = makeService({ revokeInvitation })

      await expect(service.revokeInvitation('inv_1')).resolves.toEqual({
        id: 'inv_1',
        revoked: true,
      })
      expect(revokeInvitation).toHaveBeenCalledWith('inv_1')
    })

    it('throws BadGatewayException when Clerk fails to revoke', async () => {
      const revokeInvitation = vi.fn().mockRejectedValue(new Error('down'))
      const { service } = makeService({ revokeInvitation })

      await expect(service.revokeInvitation('inv_1')).rejects.toBeInstanceOf(
        BadGatewayException,
      )
    })
  })

  describe('getTeamInviteState', () => {
    const emailAddresses = [
      {
        emailAddress: 'Verified@Example.com',
        verification: { status: 'verified' },
      },
      {
        emailAddress: 'unverified@example.com',
        verification: { status: 'unverified' },
      },
      { emailAddress: 'never-attempted@example.com', verification: null },
    ]

    it('parses valid metadata off the Clerk user and lowercases only verified emails', async () => {
      const getUser = vi
        .fn()
        .mockResolvedValue({ publicMetadata: metadata, emailAddresses })
      const { service } = makeService({ getUser })

      await expect(service.getTeamInviteState('user_1')).resolves.toEqual({
        metadata,
        verifiedEmails: ['verified@example.com'],
      })
      expect(getUser).toHaveBeenCalledWith('user_1')
    })

    it('returns null metadata when it does not parse as an invite', async () => {
      const getUser = vi
        .fn()
        .mockResolvedValue({ publicMetadata: {}, emailAddresses: [] })
      const { service } = makeService({ getUser })

      await expect(service.getTeamInviteState('user_1')).resolves.toEqual({
        metadata: null,
        verifiedEmails: [],
      })
    })

    it('throws BadGatewayException when Clerk fails to fetch the user', async () => {
      const getUser = vi.fn().mockRejectedValue(new Error('down'))
      const { service } = makeService({ getUser })

      await expect(service.getTeamInviteState('user_1')).rejects.toBeInstanceOf(
        BadGatewayException,
      )
    })
  })

  describe('findPendingTeamInvitationsByEmail', () => {
    it('queries pending invitations by email and keeps only exact-email team invites', async () => {
      const getInvitationList = vi.fn().mockResolvedValue({
        data: [
          {
            id: 'inv_1',
            emailAddress: 'Invitee@Example.com',
            publicMetadata: metadata,
          },
          // `query` can match partially — a different address must not redeem
          {
            id: 'inv_2',
            emailAddress: 'other-invitee@example.com',
            publicMetadata: metadata,
          },
          // a non-team invitation (e.g. waitlist) has no parseable metadata
          {
            id: 'inv_3',
            emailAddress: 'invitee@example.com',
            publicMetadata: {},
          },
        ],
        totalCount: 3,
      })
      const { service } = makeService({ getInvitationList })

      const result = await service.findPendingTeamInvitationsByEmail(
        'Invitee@example.com',
      )

      expect(result.map((invitation) => invitation.id)).toEqual(['inv_1'])
      expect(getInvitationList).toHaveBeenCalledWith({
        status: 'pending',
        query: 'invitee@example.com',
        limit: 500,
      })
    })

    it('throws BadGatewayException when Clerk fails to list', async () => {
      const getInvitationList = vi.fn().mockRejectedValue(new Error('down'))
      const { service } = makeService({ getInvitationList })

      await expect(
        service.findPendingTeamInvitationsByEmail('x@example.com'),
      ).rejects.toBeInstanceOf(BadGatewayException)
    })
  })

  describe('clearTeamInviteMetadata', () => {
    it('nulls out every invite metadata key', async () => {
      const updateUserMetadata = vi.fn().mockResolvedValue({})
      const { service } = makeService({ updateUserMetadata })

      await service.clearTeamInviteMetadata('user_1')

      expect(updateUserMetadata).toHaveBeenCalledWith('user_1', {
        publicMetadata: {
          organizationSlug: null,
          role: null,
          name: null,
          invitedByUserId: null,
        },
      })
    })

    it('throws BadGatewayException when Clerk fails to clear metadata', async () => {
      const updateUserMetadata = vi.fn().mockRejectedValue(new Error('down'))
      const { service } = makeService({ updateUserMetadata })

      await expect(
        service.clearTeamInviteMetadata('user_1'),
      ).rejects.toBeInstanceOf(BadGatewayException)
    })
  })

  describe('clearTeamInviteMetadataByEmail', () => {
    it('clears the matching Clerk user found by email', async () => {
      const getUserList = vi
        .fn()
        .mockResolvedValue({ data: [{ id: 'user_1' }] })
      const updateUserMetadata = vi.fn().mockResolvedValue({})
      const { service } = makeService({ getUserList, updateUserMetadata })

      await service.clearTeamInviteMetadataByEmail('revoked@x.com')

      expect(getUserList).toHaveBeenCalledWith({
        emailAddress: ['revoked@x.com'],
        limit: 1,
      })
      expect(updateUserMetadata).toHaveBeenCalledWith('user_1', {
        publicMetadata: {
          organizationSlug: null,
          role: null,
          name: null,
          invitedByUserId: null,
        },
      })
    })

    it('no-ops when no Clerk user matches the email', async () => {
      const getUserList = vi.fn().mockResolvedValue({ data: [] })
      const updateUserMetadata = vi.fn()
      const { service } = makeService({ getUserList, updateUserMetadata })

      await service.clearTeamInviteMetadataByEmail('never-signed-up@x.com')

      expect(updateUserMetadata).not.toHaveBeenCalled()
    })

    it('throws BadGatewayException when the Clerk lookup fails', async () => {
      const getUserList = vi.fn().mockRejectedValue(new Error('down'))
      const { service } = makeService({ getUserList })

      await expect(
        service.clearTeamInviteMetadataByEmail('x@y.com'),
      ).rejects.toBeInstanceOf(BadGatewayException)
    })
  })
})
