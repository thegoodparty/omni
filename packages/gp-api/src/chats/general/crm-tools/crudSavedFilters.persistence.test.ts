import { describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { ContactsService } from '@/contacts/services/contacts.service'
import { ElectionsService } from '@/elections/services/elections.service'
import { FeaturesService } from '@/features/services/features.service'
import { VoterFileFilterService } from '@/voters/services/voterFileFilter.service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import {
  OutreachStatus,
  OutreachType,
  type Organization,
} from '../../../generated/prisma'
import { buildCrudSavedFiltersTool } from './crudSavedFilters.tool'

const service = useTestService()

// districtId and the resolved activity-condition id set both now flow
// through the real people-db Zod DTOs (ListPeopleDTO etc.), which require
// GUID-shaped strings — unlike the legacy people-api HTTP path, which just
// serialized these into a JSON body with no format validation.
const DISTRICT_ID = '30000000-0000-0000-0000-000000000000'
const PERSON_RESPONDED = '00000000-0000-0000-0000-000000000001'

// The tool runs against the REAL VoterFileFilterService + ContactsService so
// every route-side rule (Pro gate, completed-outreach validation, org
// scoping, locked-filter conflict) is exercised, not mocked. Only the
// people-db query hop is stubbed — this suite doesn't run a real people-db.
const buildTool = (organization: Organization) =>
  buildCrudSavedFiltersTool({
    voterFileFilters: service.app.get(VoterFileFilterService),
    contacts: service.app.get(ContactsService),
    organization,
  })

const seedWinOrg = async (slug: string, isPro = true) => {
  const organization = await service.prisma.organization.create({
    data: {
      slug,
      ownerId: service.user.id,
      overrideDistrictId: DISTRICT_ID,
    },
  })
  const campaign = await service.prisma.campaign.create({
    data: {
      userId: service.user.id,
      slug: `${slug}-campaign`,
      organizationSlug: slug,
      isPro,
    },
  })
  return { organization, campaign }
}

const stubPeopleApi = (totalResults: number) =>
  vi.spyOn(service.app.get(VoterQueryService), 'findPeople').mockResolvedValue({
    people: [],
    pagination: {
      totalResults,
      currentPage: 1,
      pageSize: 1,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    },
  } as never)

// The count path's Win eligibility check resolves the org's district +
// ballot level through election-api, which this suite doesn't run.
const stubCountEligibility = () => {
  vi.spyOn(
    service.app.get(FeaturesService),
    'isFeatureEnabled',
  ).mockResolvedValue(true)
  vi.spyOn(service.app.get(ElectionsService), 'getDistrict').mockResolvedValue({
    id: DISTRICT_ID,
    state: 'CA',
    L2DistrictType: 'County',
    L2DistrictName: 'Test County',
    projectedTurnout: null,
  })
}

describe('crud_saved_filters against the real service pipeline', () => {
  it('create persists the filter + activity-condition rows and returns the live count', async () => {
    const { organization, campaign } = await seedWinOrg('campaign-crud-create')
    const completedText = await service.prisma.outreach.create({
      data: {
        campaignId: campaign.id,
        organizationSlug: organization.slug,
        outreachType: OutreachType.text,
        status: OutreachStatus.completed,
      },
    })
    // A responded interaction so the activity-condition resolution yields a
    // non-empty id set and the count actually reaches (stubbed) people-api.
    await service.prisma.contactInteractionText.create({
      data: {
        organizationSlug: organization.slug,
        personId: PERSON_RESPONDED,
        occurredAt: new Date('2026-07-01T12:00:00.000Z'),
        respondedAt: new Date('2026-07-02T12:00:00.000Z'),
        outreachId: completedText.id,
        manual: false,
      },
    })
    stubCountEligibility()
    stubPeopleApi(57)

    const tool = buildTool(organization)
    const result = await tool.execute(
      tool.inputSchema.parse({
        action: 'create',
        name: 'Texted responders',
        genderFemale: true,
        audienceSuperVoters: true,
        activityConditions: [
          {
            outreachType: 'text',
            outreachId: completedText.id,
            actions: ['responded'],
          },
        ],
      }),
    )

    expect(result).toEqual({
      id: expect.any(Number),
      name: 'Texted responders',
      count: 57,
    })
    const id = (result as { id: number }).id
    const persisted = await service.prisma.voterFileFilter.findUniqueOrThrow({
      where: { id },
      include: { activityConditions: true },
    })
    expect(persisted).toMatchObject({
      organizationSlug: organization.slug,
      name: 'Texted responders',
      genderFemale: true,
      audienceSuperVoters: true,
    })
    expect(persisted.activityConditions).toHaveLength(1)
    expect(persisted.activityConditions[0]).toMatchObject({
      outreachType: OutreachType.text,
      outreachId: completedText.id,
      actions: ['responded'],
    })
  })

  it('rejects an activity condition naming an incomplete outreach, persisting nothing', async () => {
    const { organization, campaign } = await seedWinOrg(
      'campaign-crud-incomplete',
    )
    const pending = await service.prisma.outreach.create({
      data: {
        campaignId: campaign.id,
        organizationSlug: organization.slug,
        outreachType: OutreachType.text,
        status: OutreachStatus.pending,
      },
    })
    stubCountEligibility()
    stubPeopleApi(0)

    const tool = buildTool(organization)
    const result = await tool.execute(
      tool.inputSchema.parse({
        action: 'create',
        name: 'Not completed',
        activityConditions: [
          {
            outreachType: 'text',
            outreachId: pending.id,
            actions: ['responded'],
          },
        ],
      }),
    )

    expect(result).toEqual({
      error: expect.stringContaining('has not completed'),
    })
    expect(
      await service.prisma.voterFileFilter.count({
        where: { organizationSlug: organization.slug },
      }),
    ).toBe(0)
  })

  it('update on a locked filter returns the duplicate-to-edit error and writes nothing', async () => {
    const { organization } = await seedWinOrg('campaign-crud-locked')
    const locked = await service.prisma.voterFileFilter.create({
      data: {
        organizationSlug: organization.slug,
        name: 'Locked list',
        firstUsedForOutreachAt: new Date(),
      },
    })

    const tool = buildTool(organization)
    const result = await tool.execute(
      tool.inputSchema.parse({
        action: 'update',
        id: locked.id,
        name: 'Try to edit',
      }),
    )

    expect(result).toEqual({ error: expect.stringContaining('duplicated') })
    const after = await service.prisma.voterFileFilter.findUniqueOrThrow({
      where: { id: locked.id },
    })
    expect(after.name).toBe('Locked list')

    const deleteResult = await tool.execute(
      tool.inputSchema.parse({ action: 'delete', id: locked.id }),
    )
    expect(deleteResult).toEqual({
      error: expect.stringContaining('duplicated'),
    })
    expect(
      await service.prisma.voterFileFilter.findUnique({
        where: { id: locked.id },
      }),
    ).not.toBeNull()
  })

  it('update goes through the same replace-conditions path as the route', async () => {
    const { organization } = await seedWinOrg('campaign-crud-update')
    const existing = await service.prisma.voterFileFilter.create({
      data: {
        organizationSlug: organization.slug,
        name: 'Door knocked',
        activityConditions: {
          create: [
            {
              outreachType: OutreachType.doorKnocking,
              actions: ['answered'],
            },
          ],
        },
      },
    })

    const tool = buildTool(organization)
    const result = await tool.execute(
      tool.inputSchema.parse({
        action: 'update',
        id: existing.id,
        name: 'Not home',
        activityConditions: [
          { outreachType: 'doorKnocking', actions: ['not_home'] },
        ],
      }),
    )

    expect(result).toEqual({ id: existing.id, name: 'Not home' })
    const conditions =
      await service.prisma.voterFileFilterActivityCondition.findMany({
        where: { voterFileFilterId: existing.id },
      })
    expect(conditions).toHaveLength(1)
    expect(conditions[0]).toMatchObject({
      outreachType: OutreachType.doorKnocking,
      actions: ['not_home'],
    })
  })

  it('delete removes the filter and cascades its condition rows', async () => {
    const { organization } = await seedWinOrg('campaign-crud-delete')
    const filter = await service.prisma.voterFileFilter.create({
      data: {
        organizationSlug: organization.slug,
        name: 'To delete',
        activityConditions: {
          create: [
            { outreachType: OutreachType.doorKnocking, actions: ['not_home'] },
          ],
        },
      },
    })

    const tool = buildTool(organization)
    const result = await tool.execute(
      tool.inputSchema.parse({ action: 'delete', id: filter.id }),
    )

    expect(result).toEqual({ deleted: true })
    expect(
      await service.prisma.voterFileFilter.findUnique({
        where: { id: filter.id },
      }),
    ).toBeNull()
    expect(
      await service.prisma.voterFileFilterActivityCondition.count({
        where: { voterFileFilterId: filter.id },
      }),
    ).toBe(0)
  })

  it("cannot list, update, or delete another org's filter", async () => {
    const { organization } = await seedWinOrg('campaign-crud-mine')
    await seedWinOrg('campaign-crud-other')
    const foreign = await service.prisma.voterFileFilter.create({
      data: { organizationSlug: 'campaign-crud-other', name: 'Foreign list' },
    })

    const tool = buildTool(organization)

    const listed = await tool.execute(
      tool.inputSchema.parse({ action: 'list' }),
    )
    expect(listed).toEqual({ filters: [] })

    const updated = await tool.execute(
      tool.inputSchema.parse({ action: 'update', id: foreign.id, name: 'X' }),
    )
    expect(updated).toEqual({
      error: expect.stringContaining(`No saved list with id ${foreign.id}`),
    })

    const deleted = await tool.execute(
      tool.inputSchema.parse({ action: 'delete', id: foreign.id }),
    )
    expect(deleted).toEqual({
      error: expect.stringContaining(`No saved list with id ${foreign.id}`),
    })
    expect(
      await service.prisma.voterFileFilter.findUnique({
        where: { id: foreign.id },
      }),
    ).not.toBeNull()
  })

  it('rejects every write for a non-Pro Win org with the Pro-upgrade error', async () => {
    const { organization } = await seedWinOrg('campaign-crud-nonpro', false)
    const existing = await service.prisma.voterFileFilter.create({
      data: { organizationSlug: organization.slug, name: 'Pre-existing' },
    })

    const tool = buildTool(organization)
    const proError = { error: expect.stringContaining('upgrading to Pro') }

    expect(
      await tool.execute(
        tool.inputSchema.parse({ action: 'create', name: 'Blocked' }),
      ),
    ).toEqual(proError)
    expect(
      await tool.execute(
        tool.inputSchema.parse({
          action: 'update',
          id: existing.id,
          name: 'Blocked',
        }),
      ),
    ).toEqual(proError)
    expect(
      await tool.execute(
        tool.inputSchema.parse({ action: 'delete', id: existing.id }),
      ),
    ).toEqual(proError)
    expect(
      await service.prisma.voterFileFilter.count({
        where: { organizationSlug: organization.slug },
      }),
    ).toBe(1)
  })
})
