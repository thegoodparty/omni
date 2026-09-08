import { ExecutionContext, ForbiddenException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { OrganizationRole } from '../../generated/prisma'
import { describe, expect, it, vi } from 'vitest'
import { ALLOW_VOLUNTEER_KEY } from '../decorators/AllowVolunteer.decorator'
import { OWNER_ONLY_KEY } from '../decorators/OwnerOnly.decorator'
import { OrganizationRoleGuard } from './OrganizationRole.guard'

const buildContext = (
  organizationRole: OrganizationRole | undefined,
): ExecutionContext => {
  const req = { organizationRole }
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext
}

// Metadata keys are mutually exclusive per route in real usage (a route
// carries at most one of @OwnerOnly() / @AllowVolunteer()), so the reflector
// stub returns each key's own value independently, like Reflector does.
const reflectorReturning = (
  metadata: { ownerOnly?: boolean; allowVolunteer?: boolean } = {},
): Reflector =>
  ({
    getAllAndOverride: vi.fn((key: string) => {
      if (key === OWNER_ONLY_KEY) return metadata.ownerOnly
      if (key === ALLOW_VOLUNTEER_KEY) return metadata.allowVolunteer
      return undefined
    }),
  }) as unknown as Reflector

describe('OrganizationRoleGuard', () => {
  describe('request.organizationRole unset', () => {
    it('passes through when no scoping guard ran', () => {
      const guard = new OrganizationRoleGuard(reflectorReturning())
      expect(guard.canActivate(buildContext(undefined))).toBe(true)
    })

    it('passes through even under @OwnerOnly()', () => {
      const guard = new OrganizationRoleGuard(
        reflectorReturning({ ownerOnly: true }),
      )
      expect(guard.canActivate(buildContext(undefined))).toBe(true)
    })
  })

  describe('no decorator (manager-or-above default)', () => {
    const guard = () => new OrganizationRoleGuard(reflectorReturning())

    it('allows owner', () => {
      expect(guard().canActivate(buildContext(OrganizationRole.owner))).toBe(
        true,
      )
    })

    it('allows campaignAdmin', () => {
      expect(
        guard().canActivate(buildContext(OrganizationRole.campaignAdmin)),
      ).toBe(true)
    })

    it('denies volunteer with 403', () => {
      expect(() =>
        guard().canActivate(buildContext(OrganizationRole.volunteer)),
      ).toThrow(ForbiddenException)
    })
  })

  describe('@OwnerOnly()', () => {
    const guard = () =>
      new OrganizationRoleGuard(reflectorReturning({ ownerOnly: true }))

    it('allows owner', () => {
      expect(guard().canActivate(buildContext(OrganizationRole.owner))).toBe(
        true,
      )
    })

    it('denies campaignAdmin with 403', () => {
      expect(() =>
        guard().canActivate(buildContext(OrganizationRole.campaignAdmin)),
      ).toThrow(ForbiddenException)
    })

    it('denies volunteer with 403', () => {
      expect(() =>
        guard().canActivate(buildContext(OrganizationRole.volunteer)),
      ).toThrow(ForbiddenException)
    })
  })

  // Phase 1.5: UseOrganizationGuard / UseCampaignGuard now resolve and
  // attach any membership, including volunteer, so this branch is reachable
  // end-to-end as soon as a route carries @AllowVolunteer() — no route does
  // yet (that's later tickets' work to open specific surfaces).
  describe('@AllowVolunteer()', () => {
    const guard = () =>
      new OrganizationRoleGuard(reflectorReturning({ allowVolunteer: true }))

    it('allows owner', () => {
      expect(guard().canActivate(buildContext(OrganizationRole.owner))).toBe(
        true,
      )
    })

    it('allows campaignAdmin', () => {
      expect(
        guard().canActivate(buildContext(OrganizationRole.campaignAdmin)),
      ).toBe(true)
    })

    it('allows volunteer', () => {
      expect(
        guard().canActivate(buildContext(OrganizationRole.volunteer)),
      ).toBe(true)
    })
  })
})
