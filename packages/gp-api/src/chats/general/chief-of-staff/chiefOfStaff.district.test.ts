import { NotFoundException } from '@nestjs/common'
import { ChatScope } from '../../../generated/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DistrictResolverService } from '@/chats/briefing-chats/services/districtResolver.service'
import type { ElectionsService } from '@/elections/services/elections.service'
import { InMemoryDatabricksProvider } from '@/llm/tools/queryDatabricks.tool'
import type { OrganizationsService } from '@/organizations/services/organizations.service'
import { PrismaService } from '@/prisma/prisma.service'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { useTestService } from '@/test-service'
import { ChiefOfStaffHandler } from './chiefOfStaff.handler'
import type { ChiefOfStaffBriefingsService } from './services/chiefOfStaffBriefings.service'
import { ChiefOfStaffContextService } from './services/chiefOfStaffContext.service'
import type { PrioritiesToolPort } from './services/prioritiesPort'

// A user can hold elected offices in more than one org (ElectedOffice.userId is
// not unique). Each org's Chief of Staff conversation must scope constituent
// data to that org's district, never to whichever office a lookup returns.

const service = useTestService()

// Wire a Prisma-backed service the way the module would, without the module.
const withPrisma = <T extends { onModuleInit(): void }>(svc: T): T => {
  const prisma = service.app.get(PrismaService)
  Object.defineProperty(svc, '_prisma', {
    get: () => prisma,
    configurable: true,
  })
  Object.defineProperty(svc, 'logger', {
    get: () => createMockLogger(),
    configurable: true,
  })
  svc.onModuleInit()
  return svc
}

interface OfficeSpec {
  positionId: string
  state: string
  l2Name: string
}

const OFFICE_A: OfficeSpec = {
  positionId: 'pos-a',
  state: 'NC',
  l2Name: 'Hendersonville',
}
const OFFICE_B: OfficeSpec = {
  positionId: 'pos-b',
  state: 'CA',
  l2Name: 'Oakland',
}

const seedOffice = async (userId: number, spec: OfficeSpec) => {
  const org = await service.prisma.organization.create({
    data: {
      slug: `org-${Math.random().toString(36).slice(2, 10)}`,
      ownerId: userId,
      positionId: spec.positionId,
    },
  })
  await service.prisma.electedOffice.create({
    data: { organizationSlug: org.slug, userId },
  })
  return org.slug
}

const seedConversation = async (
  userId: number,
  organizationSlug: string | null,
) =>
  service.prisma.chatConversation.create({
    data: {
      ownerUserId: userId,
      scope: ChatScope.chief_of_staff,
      organizationSlug,
    },
  })

const filtersFor = (spec: OfficeSpec) => [
  { column: 'state_postal_code', value: spec.state },
  { column: 'City', value: spec.l2Name },
]

describe('ChiefOfStaffHandler district scoping (two orgs)', () => {
  let handler: ChiefOfStaffHandler
  const districtBySlug = new Map<string, OfficeSpec>()

  beforeEach(() => {
    districtBySlug.clear()
    const organizations = {
      getDistrictForOrgSlug: vi.fn((slug: string) => {
        const spec = districtBySlug.get(slug)
        return Promise.resolve(
          spec
            ? { id: `d-${slug}`, l2Type: 'City', l2Name: spec.l2Name }
            : null,
        )
      }),
    } as unknown as OrganizationsService
    const elections = {
      getPositionById: vi.fn((positionId: string) => {
        const spec = [OFFICE_A, OFFICE_B].find(
          (s) => s.positionId === positionId,
        )
        return Promise.resolve(
          spec ? { id: positionId, state: spec.state } : null,
        )
      }),
    } as unknown as ElectionsService
    const port = {
      listActive: vi.fn(() => Promise.resolve([])),
    } as unknown as PrioritiesToolPort
    handler = new ChiefOfStaffHandler(
      withPrisma(new ChiefOfStaffContextService()),
      {} as ChiefOfStaffBriefingsService,
      port,
      [{ table: 'constituent_aggregates', dimensions: ['age_band'] }],
      new InMemoryDatabricksProvider(new Map()),
      withPrisma(new DistrictResolverService(organizations, elections)),
    )
  })

  it("scopes each org's conversation to that org's own district", async () => {
    const userId = service.user.id
    const slugA = await seedOffice(userId, OFFICE_A)
    const slugB = await seedOffice(userId, OFFICE_B)
    districtBySlug.set(slugA, OFFICE_A)
    districtBySlug.set(slugB, OFFICE_B)
    const convA = await seedConversation(userId, slugA)
    const convB = await seedConversation(userId, slugB)

    const ctxA = await handler.loadContext(convA.id, userId)
    const ctxB = await handler.loadContext(convB.id, userId)

    expect(ctxA.organizationSlug).toBe(slugA)
    expect(ctxA.districtFilters).toEqual(filtersFor(OFFICE_A))
    expect(ctxA.jurisdiction).toBe('Hendersonville, NC')
    expect(ctxB.organizationSlug).toBe(slugB)
    expect(ctxB.districtFilters).toEqual(filtersFor(OFFICE_B))
    expect(ctxB.jurisdiction).toBe('Oakland, CA')
  })

  // Fail closed: a conversation with no org never falls back to the user's
  // first office (which would hand it some org's district).
  it('refuses a conversation that carries no org slug', async () => {
    const userId = service.user.id
    const slugA = await seedOffice(userId, OFFICE_A)
    districtBySlug.set(slugA, OFFICE_A)
    const conv = await seedConversation(userId, null)

    await expect(handler.loadContext(conv.id, userId)).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })
})
