import { describe, expect, it, vi } from 'vitest'
import type { ClerkClient } from '@clerk/backend'
import { BadGatewayException } from '@nestjs/common'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { ClerkInvitationsService } from './clerkInvitations.service'

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

  describe('getTeamInviteMetadata', () => {
    it('parses valid metadata off the Clerk user', async () => {
      const getUser = vi.fn().mockResolvedValue({ publicMetadata: metadata })
      const { service } = makeService({ getUser })

      await expect(service.getTeamInviteMetadata('user_1')).resolves.toEqual(
        metadata,
      )
      expect(getUser).toHaveBeenCalledWith('user_1')
    })

    it('returns null when the metadata does not parse as an invite', async () => {
      const getUser = vi.fn().mockResolvedValue({ publicMetadata: {} })
      const { service } = makeService({ getUser })

      await expect(service.getTeamInviteMetadata('user_1')).resolves.toBeNull()
    })

    it('throws BadGatewayException when Clerk fails to fetch the user', async () => {
      const getUser = vi.fn().mockRejectedValue(new Error('down'))
      const { service } = makeService({ getUser })

      await expect(
        service.getTeamInviteMetadata('user_1'),
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
