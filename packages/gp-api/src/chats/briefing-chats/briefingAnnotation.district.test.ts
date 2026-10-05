import {
  AnnotationKind,
  AnnotationResourceType,
  ExperimentRunStatus,
} from '../../generated/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ElectionsService } from '@/elections/services/elections.service'
import type { DatabricksProvider } from '@/llm/tools/queryDatabricks.tool'
import type { OrganizationsService } from '@/organizations/services/organizations.service'
import { PrismaService } from '@/prisma/prisma.service'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { useTestService } from '@/test-service'
import type { S3Service } from '@/vendors/aws/services/s3.service'
import { BriefingAnnotationHandler } from './briefingAnnotation.handler'
import { BriefingArtifactCacheService } from './services/briefingArtifactCache.service'
import { BriefingContextService } from './services/briefingContext.service'
import type { BriefingNotesService } from './services/briefingNotes.service'
import { DistrictResolverService } from './services/districtResolver.service'

// A user can hold elected offices in more than one org (ElectedOffice.userId is
// not unique). A briefing chat must scope voter data to the briefing's own
// office, never to whichever of the user's offices a lookup happens to return.

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

const seedBriefingChat = async (userId: number, spec: OfficeSpec) => {
  const org = await service.prisma.organization.create({
    data: {
      slug: `org-${Math.random().toString(36).slice(2, 10)}`,
      ownerId: userId,
      positionId: spec.positionId,
    },
  })
  const electedOffice = await service.prisma.electedOffice.create({
    data: { organizationSlug: org.slug, userId },
  })
  const run = await service.prisma.experimentRun.create({
    data: {
      organizationSlug: org.slug,
      experimentType: 'meeting_briefing',
      status: ExperimentRunStatus.COMPLETED,
    },
  })
  const briefing = await service.prisma.meetingBriefing.create({
    data: {
      electedOfficeId: electedOffice.id,
      experimentRunId: run.runId,
      artifactBucket: 'briefings-bucket',
      artifactKey: `${org.slug}/briefing.md`,
      meetingDate: new Date('2026-06-01T00:00:00Z'),
      meetingTime: '18:00',
      meetingTimezone: 'America/New_York',
    },
  })
  const conversation = await service.prisma.chatConversation.create({
    data: { ownerUserId: userId },
  })
  const annotation = await service.prisma.annotation.create({
    data: {
      authorUserId: userId,
      kind: AnnotationKind.chat,
      resourceId: briefing.id,
      resourceType: AnnotationResourceType.briefing,
      chatConversationId: conversation.id,
    },
  })
  return { slug: org.slug, conversationId: conversation.id, annotation }
}

const filtersFor = (spec: OfficeSpec) => [
  { column: 'state_postal_code', value: spec.state },
  { column: 'City', value: spec.l2Name },
]

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

describe('BriefingAnnotationHandler district scoping (two orgs)', () => {
  let handler: BriefingAnnotationHandler
  const districtBySlug = new Map<string, OfficeSpec>()

  beforeEach(() => {
    districtBySlug.clear()
    const s3 = {
      getFile: vi.fn(() => Promise.resolve('# Briefing\n\nbody')),
    } as unknown as S3Service
    const briefingContext = withPrisma(
      new BriefingContextService(
        new BriefingArtifactCacheService(s3, createMockLogger()),
      ),
    )
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
    const resolver = withPrisma(
      new DistrictResolverService(organizations, elections),
    )
    const notes = {
      countNotesForUser: vi.fn(() => Promise.resolve(0)),
      loadNotesForChat: vi.fn(() => Promise.resolve([])),
    } as unknown as BriefingNotesService
    const databricks = {
      query: vi.fn(() => Promise.resolve({ columns: [], rows: [] })),
    } as unknown as DatabricksProvider
    handler = new BriefingAnnotationHandler(
      briefingContext,
      notes,
      databricks,
      resolver,
    )
  })

  it("scopes each briefing's chat to that briefing's own office district", async () => {
    const userId = service.user.id
    const a = await seedBriefingChat(userId, OFFICE_A)
    const b = await seedBriefingChat(userId, OFFICE_B)
    districtBySlug.set(a.slug, OFFICE_A)
    districtBySlug.set(b.slug, OFFICE_B)

    const ctxA = await handler.loadContext(a.conversationId, userId)
    const ctxB = await handler.loadContext(b.conversationId, userId)
    expect(ctxA.districtFilters).toEqual(filtersFor(OFFICE_A))
    expect(ctxB.districtFilters).toEqual(filtersFor(OFFICE_B))

    // The annotation-keyed entry (the /v1/briefing-chats send path) agrees.
    const viaAnnotationB = await handler.loadContextForAnnotation(
      b.annotation.id,
      userId,
    )
    expect(viaAnnotationB.districtFilters).toEqual(filtersFor(OFFICE_B))
  })
})
