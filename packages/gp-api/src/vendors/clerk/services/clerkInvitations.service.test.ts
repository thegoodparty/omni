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
} = {}) => {
  const clerkClient = {
    invitations: { createInvitation, getInvitationList, revokeInvitation },
    users: { getUser, updateUserMetadata },
  } as unknown as ClerkClient
  return {
    service: new ClerkInvitationsService(clerkClient, createMockLogger()),
    createInvitation,
    getInvitationList,
    revokeInvitation,
    getUser,
    updateUserMetadata,
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
      })
      const { service } = makeService({ getInvitationList })

      const result = await service.listPendingTeamInvitations('acme')

      expect(result.map((invitation) => invitation.id)).toEqual(['inv_1'])
      expect(getInvitationList).toHaveBeenCalledWith({
        status: 'pending',
        limit: 500,
      })
    })

    it('throws BadGatewayException when Clerk fails to list invitations', async () => {
      const getInvitationList = vi.fn().mockRejectedValue(new Error('down'))
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
})
