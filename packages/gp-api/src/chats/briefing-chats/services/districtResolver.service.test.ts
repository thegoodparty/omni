import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PrismaService } from '@/prisma/prisma.service'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { useTestService } from '@/test-service'
import type { ElectionsService } from '@/elections/services/elections.service'
import type { OrganizationsService } from '@/organizations/services/organizations.service'
import { DistrictResolverService } from './districtResolver.service'

const service = useTestService()

const createOrg = async (
  userId: number,
  opts: { positionId?: string | null; overrideDistrictId?: string | null } = {},
) =>
  service.prisma.organization.create({
    data: {
      slug: `org-${Math.random().toString(36).slice(2, 10)}`,
      ownerId: userId,
      positionId: opts.positionId ?? null,
      overrideDistrictId: opts.overrideDistrictId ?? null,
    },
  })

const createElectedOffice = async (userId: number, organizationSlug: string) =>
  service.prisma.electedOffice.create({
    data: {
      organizationSlug,
      userId,
    },
  })

describe('DistrictResolverService', () => {
  let resolver: DistrictResolverService
  let elections: { getPositionById: ReturnType<typeof vi.fn> }
  let organizations: { getDistrictForOrgSlug: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    const prisma = service.app.get(PrismaService)
    elections = {
      getPositionById: vi.fn(),
    }
    organizations = {
      getDistrictForOrgSlug: vi.fn(),
    }
    resolver = new DistrictResolverService(
      organizations as unknown as OrganizationsService,
      elections as unknown as ElectionsService,
    )
    Object.defineProperty(resolver, '_prisma', {
      get: () => prisma,
      configurable: true,
    })
    Object.defineProperty(resolver, 'logger', {
      get: () => createMockLogger(),
      configurable: true,
    })
    resolver.onModuleInit()
  })

  describe('resolveByUserId', () => {
    it('returns null when user has no electedOffice', async () => {
      const newUser = await service.prisma.user.create({
        data: {
          id: 5001,
          email: 'no-office@goodparty.org',
          firstName: 'No',
          lastName: 'Office',
        },
      })
      const result = await resolver.resolveByUserId(newUser.id)
      expect(result).toBeNull()
    })

    it('returns null when org has no positionId or overrideDistrictId', async () => {
      const newUser = await service.prisma.user.create({
        data: {
          id: 5002,
          email: 'empty-org@goodparty.org',
          firstName: 'Empty',
          lastName: 'Org',
        },
      })
      const org = await createOrg(newUser.id)
      await createElectedOffice(newUser.id, org.slug)

      const result = await resolver.resolveByUserId(newUser.id)
      expect(result).toBeNull()
    })

    it('returns null when district lookup yields no district', async () => {
      const newUser = await service.prisma.user.create({
        data: {
          id: 5003,
          email: 'no-district@goodparty.org',
          firstName: 'No',
          lastName: 'District',
        },
      })
      const org = await createOrg(newUser.id, { positionId: 'pos-1' })
      await createElectedOffice(newUser.id, org.slug)

      organizations.getDistrictForOrgSlug.mockResolvedValueOnce(null)
      elections.getPositionById.mockResolvedValueOnce({
        id: 'pos-1',
        state: 'CA',
      })

      const result = await resolver.resolveByUserId(newUser.id)
      expect(result).toBeNull()
    })

    it('returns null when position has no state', async () => {
      const newUser = await service.prisma.user.create({
        data: {
          id: 5004,
          email: 'no-state@goodparty.org',
          firstName: 'No',
          lastName: 'State',
        },
      })
      const org = await createOrg(newUser.id, { positionId: 'pos-2' })
      await createElectedOffice(newUser.id, org.slug)

      organizations.getDistrictForOrgSlug.mockResolvedValueOnce({
        id: 'd-1',
        l2Type: 'City',
        l2Name: 'San Francisco',
      })
      elections.getPositionById.mockResolvedValueOnce({
        id: 'pos-2',
        state: '',
      })

      const result = await resolver.resolveByUserId(newUser.id)
      expect(result).toBeNull()
    })

    it('returns the resolved district when district + position state are present', async () => {
      const newUser = await service.prisma.user.create({
        data: {
          id: 5005,
          email: 'ok@goodparty.org',
          firstName: 'Ok',
          lastName: 'Resolved',
        },
      })
      const org = await createOrg(newUser.id, { positionId: 'pos-3' })
      await createElectedOffice(newUser.id, org.slug)

      organizations.getDistrictForOrgSlug.mockResolvedValueOnce({
        id: 'd-2',
        l2Type: 'City',
        l2Name: 'Oakland',
      })
      elections.getPositionById.mockResolvedValueOnce({
        id: 'pos-3',
        state: 'CA',
      })

      const result = await resolver.resolveByUserId(newUser.id)
      expect(result).toEqual({
        state: 'CA',
        l2DistrictType: 'City',
        l2DistrictName: 'Oakland',
        level: null,
      })
    })
  })

  describe('resolveByOrgSlug', () => {
    it('returns null when no org exists for the slug', async () => {
      const result = await resolver.resolveByOrgSlug('missing-slug')
      expect(result).toBeNull()
    })

    it('returns null when the org has no positionId', async () => {
      const org = await createOrg(service.user.id)
      const result = await resolver.resolveByOrgSlug(org.slug)
      expect(result).toBeNull()
    })

    it('resolves the district from the org position (no elected office)', async () => {
      const org = await createOrg(service.user.id, { positionId: 'pos-cam' })
      organizations.getDistrictForOrgSlug.mockResolvedValueOnce({
        id: 'd-cam',
        l2Type: 'City',
        l2Name: 'Springfield',
      })
      elections.getPositionById.mockResolvedValueOnce({
        id: 'pos-cam',
        state: 'IL',
      })

      const result = await resolver.resolveByOrgSlug(org.slug)
      expect(result).toEqual({
        state: 'IL',
        l2DistrictType: 'City',
        l2DistrictName: 'Springfield',
        level: null,
      })
    })

    // The position's BallotReady level distinguishes a state legislator from
    // a city councilor; consumers (the ordinance flow) frame the entire
    // drafting exercise off it, so the resolver must not drop it.
    it('carries the position level through the resolution', async () => {
      const org = await createOrg(service.user.id, { positionId: 'pos-lvl' })
      organizations.getDistrictForOrgSlug.mockResolvedValueOnce({
        id: 'd-lvl',
        l2Type: 'State_House_District',
        l2Name: 'State House District 12',
      })
      elections.getPositionById.mockResolvedValueOnce({
        id: 'pos-lvl',
        state: 'NC',
        level: 'STATE',
      })

      const result = await resolver.resolveByOrgSlug(org.slug)
      expect(result).toEqual({
        state: 'NC',
        l2DistrictType: 'State_House_District',
        l2DistrictName: 'State House District 12',
        level: 'STATE',
      })
    })
  })

  describe('toMandatoryFilters', () => {
    it('returns filters with state_postal_code and l2 district columns', () => {
      const filters = resolver.toMandatoryFilters({
        state: 'CA',
        l2DistrictType: 'City',
        l2DistrictName: 'Oakland',
        level: null,
      })
      expect(filters).toEqual([
        { column: 'state_postal_code', value: 'CA' },
        { column: 'City', value: 'Oakland' },
      ])
    })
  })
})
