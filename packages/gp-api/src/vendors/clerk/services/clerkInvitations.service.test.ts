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
} = {}) => {
  const clerkClient = {
    invitations: { createInvitation, getInvitationList, revokeInvitation },
  } as unknown as ClerkClient
  return {
    service: new ClerkInvitationsService(clerkClient, createMockLogger()),
    createInvitation,
    getInvitationList,
    revokeInvitation,
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
})
