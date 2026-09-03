import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { ExecutionContext, NotFoundException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Organization, OrganizationRole } from '../../generated/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RequireOrganizationMetadata } from '../decorators/UseOrganization.decorator'
import { OrganizationMembershipService } from '../services/organizationMembership.service'
import { UseOrganizationGuard } from './UseOrganization.guard'

const mockOrg: Organization = {
  slug: 'campaign-100',
  ownerId: 1,
  positionId: null,
  overrideDistrictId: null,
  customPositionName: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

describe('UseOrganizationGuard', () => {
  let guard: UseOrganizationGuard
  let organizationMembership: OrganizationMembershipService
  let reflector: Reflector

  function buildContext(
    headers: Record<string, string> = {},
    userId: number | null = 1,
    actorUserId?: number,
  ): ExecutionContext {
    // null = unauthenticated: user is absent entirely on @PublicAccess
    // requests. (null rather than undefined — an explicit undefined
    // argument would re-trigger the default value.)
    const req = {
      headers,
      user: userId === null ? undefined : { id: userId },
      // actorUser mirrors what SessionGuard sets for an impersonating
      // admin — present here to prove the guard never reads it.
      actorUser: actorUserId != null ? { id: actorUserId } : undefined,
      organization: undefined,
      organizationRole: undefined,
    }
    return {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext
  }

  function mockMetadata(meta: RequireOrganizationMetadata = {}) {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(meta)
  }

  beforeEach(() => {
    organizationMembership = {
      resolveRole: vi.fn(),
    } as unknown as OrganizationMembershipService

    reflector = {
      getAllAndOverride: vi.fn().mockReturnValue({}),
    } as unknown as Reflector

    guard = new UseOrganizationGuard(
      organizationMembership,
      reflector,
      createMockLogger(),
    )
  })

  describe('header present', () => {
    it('attaches org and owner role and returns true when resolved', async () => {
      mockMetadata()
      vi.spyOn(organizationMembership, 'resolveRole').mockResolvedValue({
        role: OrganizationRole.owner,
        organization: mockOrg,
      })

      const ctx = buildContext({ 'x-organization-slug': 'campaign-100' })
      const result = await guard.canActivate(ctx)

      expect(result).toBe(true)
      expect(organizationMembership.resolveRole).toHaveBeenCalledWith(
        'campaign-100',
        1,
      )
      const req = ctx.switchToHttp().getRequest() as {
        organization?: Organization
        organizationRole?: OrganizationRole
      }
      expect(req.organization).toEqual(mockOrg)
      expect(req.organizationRole).toBe(OrganizationRole.owner)
    })

    it('attaches the resolved membership role for a non-owner member', async () => {
      mockMetadata()
      vi.spyOn(organizationMembership, 'resolveRole').mockResolvedValue({
        role: OrganizationRole.campaignAdmin,
        organization: mockOrg,
      })

      const ctx = buildContext({ 'x-organization-slug': 'campaign-100' }, 2)
      const result = await guard.canActivate(ctx)

      expect(result).toBe(true)
      expect(organizationMembership.resolveRole).toHaveBeenCalledWith(
        'campaign-100',
        2,
      )
      const req = ctx.switchToHttp().getRequest() as {
        organizationRole?: OrganizationRole
      }
      expect(req.organizationRole).toBe(OrganizationRole.campaignAdmin)
    })

    it('throws NotFoundException when no role resolves (non-member)', async () => {
      mockMetadata()
      vi.spyOn(organizationMembership, 'resolveRole').mockResolvedValue(null)

      const ctx = buildContext({ 'x-organization-slug': 'nonexistent' })

      await expect(guard.canActivate(ctx)).rejects.toThrow(NotFoundException)
    })

    it('returns true without org when continueIfNotFound', async () => {
      mockMetadata({ continueIfNotFound: true })
      vi.spyOn(organizationMembership, 'resolveRole').mockResolvedValue(null)

      const ctx = buildContext({ 'x-organization-slug': 'nonexistent' })
      const result = await guard.canActivate(ctx)

      expect(result).toBe(true)
      const req = ctx.switchToHttp().getRequest() as {
        organization?: Organization
      }
      expect(req.organization).toBeUndefined()
    })

    it('throws NotFoundException when the requesting user is not a member', async () => {
      mockMetadata()
      vi.spyOn(organizationMembership, 'resolveRole').mockResolvedValue(null)

      const ctx = buildContext({ 'x-organization-slug': 'campaign-100' }, 999)

      await expect(guard.canActivate(ctx)).rejects.toThrow(NotFoundException)
      expect(organizationMembership.resolveRole).toHaveBeenCalledWith(
        'campaign-100',
        999,
      )
    })

    // Impersonation (ENG-10818 correction): all five scoping guards resolve
    // against request.user.id, never request.actorUser — switching would
    // 404 every org-scoped route for an impersonating admin. request.user is
    // already the impersonated subject by the time SessionGuard runs, so
    // this proves the guard resolves that user's role and never the actor's.
    it('resolves the impersonated user role, not the admin actor', async () => {
      mockMetadata()
      vi.spyOn(organizationMembership, 'resolveRole').mockResolvedValue({
        role: OrganizationRole.campaignAdmin,
        organization: mockOrg,
      })

      const memberId = 2
      const adminActorId = 999
      const ctx = buildContext(
        { 'x-organization-slug': 'campaign-100' },
        memberId,
        adminActorId,
      )
      const result = await guard.canActivate(ctx)

      expect(result).toBe(true)
      expect(organizationMembership.resolveRole).toHaveBeenCalledWith(
        'campaign-100',
        memberId,
      )
      const req = ctx.switchToHttp().getRequest() as {
        organizationRole?: OrganizationRole
      }
      expect(req.organizationRole).toBe(OrganizationRole.campaignAdmin)
    })
  })

  describe('no header', () => {
    it('throws NotFoundException', async () => {
      mockMetadata()

      const ctx = buildContext()

      await expect(guard.canActivate(ctx)).rejects.toThrow(NotFoundException)
    })

    it('returns true when continueIfNotFound', async () => {
      mockMetadata({ continueIfNotFound: true })

      const ctx = buildContext()
      const result = await guard.canActivate(ctx)

      expect(result).toBe(true)
    })
  })

  // Unauthenticated requests reach this guard on @PublicAccess routes
  // (e.g. onboarding stats) — request.user is absent entirely.
  describe('no authenticated user', () => {
    it('continues without an org when continueIfNotFound, even with a slug header', async () => {
      mockMetadata({ continueIfNotFound: true })

      const ctx = buildContext({ 'x-organization-slug': 'campaign-100' }, null)
      const result = await guard.canActivate(ctx)

      expect(result).toBe(true)
      expect(organizationMembership.resolveRole).not.toHaveBeenCalled()
      const req = ctx.switchToHttp().getRequest() as {
        organization?: unknown
      }
      expect(req.organization).toBeUndefined()
    })

    it('throws NotFoundException without continueIfNotFound', async () => {
      mockMetadata()

      const ctx = buildContext({ 'x-organization-slug': 'campaign-100' }, null)

      await expect(guard.canActivate(ctx)).rejects.toThrow(NotFoundException)
    })
  })
})
