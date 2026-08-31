import { useTestService } from '@/test-service'
import { ElectionsService } from '@/elections/services/elections.service'
import { ExperimentRunsService } from '@/agentExperiments/services/experimentRuns.service'
import { ElectedOfficeService } from '@/electedOffice/services/electedOffice.service'
import { ExperimentRunStatus } from '../generated/prisma'
import { afterEach, describe, expect, it, vi } from 'vitest'

const service = useTestService()

describe('GET /v1/organizations', () => {
  it('returns empty list when user has no organizations', async () => {
    const result = await service.client.get('/v1/organizations')

    expect(result).toMatchObject({
      status: 200,
      data: { organizations: [] },
    })
  })

  it('returns organizations with name from campaign electionDate', async () => {
    const electionsService = service.app.get(ElectionsService)
    vi.spyOn(electionsService, 'getPositionById').mockResolvedValue({
      id: 'pos-123',
      brPositionId: 'br-pos-123',
      brDatabaseId: 'br-db-123',
      state: 'CA',
      name: 'Mayor',
    })

    await service.prisma.organization.create({
      data: {
        slug: 'campaign-1',
        ownerId: service.user.id,
        positionId: 'br-pos-123',
      },
    })

    await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: 'test-campaign',
        details: { electionDate: '2026-11-03' },
        organizationSlug: 'campaign-1',
      },
    })

    const result = await service.client.get('/v1/organizations')

    expect(result).toMatchObject({
      status: 200,
      data: {
        organizations: [
          {
            slug: 'campaign-1',
            name: '2026 Campaign',
            campaignId: 1,
            electedOfficeId: null,
          },
        ],
      },
    })
  })

  it('still returns the org when election-api omits position/district leaves', async () => {
    const electionsService = service.app.get(ElectionsService)
    // A real position whose optional leaves are simply ABSENT (undefined), not
    // null — this is what election-api actually returns. z.string().nullable()
    // rejects undefined ("Required") and 500s the whole list, bouncing the
    // dashboard back into onboarding; the schema must be nullish.
    vi.spyOn(electionsService, 'getPositionById').mockResolvedValue({
      id: 'pos-sparse',
      brDatabaseId: 'br-db-sparse',
      name: 'City Council',
      // brPositionId + state intentionally absent
      district: {
        id: 'dist-sparse',
        // state + L2DistrictType + L2DistrictName intentionally absent
      },
    } as unknown as Awaited<ReturnType<ElectionsService['getPositionById']>>)

    await service.prisma.organization.create({
      data: {
        slug: 'campaign-5',
        ownerId: service.user.id,
        positionId: 'pos-sparse',
      },
    })
    await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: 'sparse-leaf-campaign',
        details: { electionDate: '2026-11-03' },
        organizationSlug: 'campaign-5',
      },
    })

    const result = await service.client.get('/v1/organizations')

    expect(result.status).toBe(200)
    expect(result.data.organizations).toHaveLength(1)
    expect(result.data.organizations[0]).toMatchObject({
      slug: 'campaign-5',
      campaignId: 5,
    })
  })

  it('returns "Campaign" as name when no electionDate', async () => {
    await service.prisma.organization.create({
      data: {
        slug: 'campaign-2',
        ownerId: service.user.id,
      },
    })

    await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: 'test-campaign-no-pos',
        details: {},
        organizationSlug: 'campaign-2',
      },
    })

    const result = await service.client.get('/v1/organizations')

    expect(result).toMatchObject({
      status: 200,
      data: {
        organizations: [
          {
            slug: 'campaign-2',
            name: 'Campaign',
            campaignId: 2,
            electedOfficeId: null,
          },
        ],
      },
    })
  })

  it('ignores customPositionName for campaign orgs', async () => {
    await service.prisma.organization.create({
      data: {
        slug: 'campaign-3',
        ownerId: service.user.id,
        customPositionName: 'Custom Office Name',
      },
    })

    await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: 'test-campaign-custom',
        details: { electionDate: '2026-11-03' },
        organizationSlug: 'campaign-3',
      },
    })

    const result = await service.client.get('/v1/organizations')

    expect(result).toMatchObject({
      status: 200,
      data: {
        organizations: [
          {
            slug: 'campaign-3',
            name: '2026 Campaign',
            positionName: 'Custom Office Name',
            campaignId: 3,
            electedOfficeId: null,
          },
        ],
      },
    })
  })

  it('returns positionName from position when no customPositionName', async () => {
    const electionsService = service.app.get(ElectionsService)
    vi.spyOn(electionsService, 'getPositionById').mockResolvedValue({
      id: 'pos-pn1',
      brPositionId: 'br-pos-pn1',
      brDatabaseId: 'br-db-pn1',
      state: 'CA',
      name: 'Mayor',
    })

    await service.prisma.organization.create({
      data: {
        slug: 'campaign-4',
        ownerId: service.user.id,
        positionId: 'br-pos-pn1',
      },
    })

    await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: 'test-campaign-pn1',
        details: { electionDate: '2026-11-03' },
        organizationSlug: 'campaign-4',
      },
    })

    const result = await service.client.get('/v1/organizations')

    expect(result).toMatchObject({
      status: 200,
      data: {
        organizations: [
          {
            slug: 'campaign-4',
            positionName: 'Mayor',
            name: '2026 Campaign',
          },
        ],
      },
    })
  })

  it('returns null positionName when no customPositionName or position', async () => {
    await service.prisma.organization.create({
      data: {
        slug: 'campaign-5',
        ownerId: service.user.id,
      },
    })

    await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: 'test-campaign-pn2',
        details: {},
        organizationSlug: 'campaign-5',
      },
    })

    const result = await service.client.get('/v1/organizations')

    expect(result).toMatchObject({
      status: 200,
      data: {
        organizations: [
          {
            slug: 'campaign-5',
            positionName: null,
          },
        ],
      },
    })
  })

  it('prefers customPositionName over position name for positionName', async () => {
    const electionsService = service.app.get(ElectionsService)
    vi.spyOn(electionsService, 'getPositionById').mockResolvedValue({
      id: 'pos-pn2',
      brPositionId: 'br-pos-pn2',
      brDatabaseId: 'br-db-pn2',
      state: 'NY',
      name: 'City Council',
    })

    await service.prisma.organization.create({
      data: {
        slug: 'campaign-6',
        ownerId: service.user.id,
        positionId: 'br-pos-pn2',
        customPositionName: 'Custom Council',
      },
    })

    await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: 'test-campaign-pn3',
        details: {},
        organizationSlug: 'campaign-6',
      },
    })

    const result = await service.client.get('/v1/organizations')

    expect(result).toMatchObject({
      status: 200,
      data: {
        organizations: [
          {
            slug: 'campaign-6',
            positionName: 'Custom Council',
          },
        ],
      },
    })
  })

  it('only returns organizations owned by the authenticated user', async () => {
    const otherUser = await service.prisma.user.create({
      data: { email: 'other@goodparty.org' },
    })

    await service.prisma.organization.create({
      data: {
        slug: 'other-org',
        ownerId: otherUser.id,
      },
    })

    await service.prisma.organization.create({
      data: {
        slug: 'campaign-700',
        ownerId: service.user.id,
      },
    })

    await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: 'my-campaign',
        details: {},
        organizationSlug: 'campaign-700',
      },
    })

    const result = await service.client.get('/v1/organizations')

    expect(result.status).toBe(200)
    expect(result.data.organizations).toHaveLength(1)
    expect(result.data.organizations[0].slug).toBe('campaign-700')
  })

  it('returns multiple organizations from both campaigns and elected offices', async () => {
    const electionsService = service.app.get(ElectionsService)
    vi.spyOn(electionsService, 'getPositionById').mockResolvedValue({
      id: 'pos-456',
      brPositionId: 'br-pos-456',
      brDatabaseId: 'br-db-456',
      state: 'NY',
      name: 'City Council',
    })

    await service.prisma.organization.create({
      data: {
        slug: 'campaign-10',
        ownerId: service.user.id,
        positionId: 'br-pos-456',
      },
    })

    const campaign = await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: 'test-campaign-multi',
        details: {},
        organizationSlug: 'campaign-10',
      },
    })

    await service.prisma.organization.create({
      data: {
        slug: 'eo-abc-123',
        ownerId: service.user.id,
        positionId: 'br-pos-456',
      },
    })

    await service.prisma.electedOffice.create({
      data: {
        organizationSlug: 'eo-abc-123',
        userId: service.user.id,
        campaignId: campaign.id,
        swornInDate: new Date('2026-01-15'),
      },
    })

    const result = await service.client.get('/v1/organizations')

    expect(result.status).toBe(200)
    expect(result.data.organizations).toHaveLength(2)

    const campaignOrg = result.data.organizations.find(
      (org: { slug: string }) => org.slug === 'campaign-10',
    )
    const eoOrg = result.data.organizations.find(
      (org: { slug: string }) => org.slug === 'eo-abc-123',
    )

    expect(campaignOrg).toMatchObject({
      slug: 'campaign-10',
      name: 'Campaign',
      campaignId: 10,
      electedOfficeId: null,
    })

    expect(eoOrg).toMatchObject({
      slug: 'eo-abc-123',
      name: 'City Council',
      positionName: 'City Council',
      electedOfficeId: 'abc-123',
      campaignId: null,
    })
  })

  it('marks the active campaign "active" and an ended office "past"', async () => {
    await service.prisma.organization.create({
      data: { slug: 'campaign-600', ownerId: service.user.id },
    })
    await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: 'active-run',
        details: { electionDate: '2099-11-03' },
        organizationSlug: 'campaign-600',
      },
    })

    await service.prisma.organization.create({
      data: { slug: 'eo-ended-1', ownerId: service.user.id },
    })
    await service.prisma.electedOffice.create({
      data: {
        organizationSlug: 'eo-ended-1',
        userId: service.user.id,
        termEndDate: new Date('2000-01-01'),
      },
    })

    const result = await service.client.get('/v1/organizations')

    expect(result.status).toBe(200)
    const campaignOrg = result.data.organizations.find(
      (org: { slug: string }) => org.slug === 'campaign-600',
    )
    const officeOrg = result.data.organizations.find(
      (org: { slug: string }) => org.slug === 'eo-ended-1',
    )
    expect(campaignOrg.status).toBe('active')
    expect(officeOrg.status).toBe('past')
  })

  it('marks a held office "active" when its term has not ended', async () => {
    await service.prisma.organization.create({
      data: { slug: 'eo-held-1', ownerId: service.user.id },
    })
    await service.prisma.electedOffice.create({
      data: {
        organizationSlug: 'eo-held-1',
        userId: service.user.id,
        // Active is derived from a future (exclusive) term end; a null end now
        // reads as not held, so use a far-future end to represent a held office.
        termEndDate: new Date('2999-01-01'),
      },
    })

    const result = await service.client.get('/v1/organizations')

    expect(result.status).toBe(200)
    const officeOrg = result.data.organizations.find(
      (org: { slug: string }) => org.slug === 'eo-held-1',
    )
    expect(officeOrg.status).toBe('active')
  })

  it('marks a concluded campaign (past election date) "past"', async () => {
    await service.prisma.organization.create({
      data: { slug: 'campaign-601', ownerId: service.user.id },
    })
    await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: 'concluded-run',
        details: { electionDate: '2000-11-07' },
        organizationSlug: 'campaign-601',
      },
    })

    const result = await service.client.get('/v1/organizations')

    expect(result.status).toBe(200)
    const campaignOrg = result.data.organizations.find(
      (org: { slug: string }) => org.slug === 'campaign-601',
    )
    expect(campaignOrg.status).toBe('past')
  })

  it('marks a primary-loss campaign "past" despite a future election date', async () => {
    await service.prisma.organization.create({
      data: { slug: 'campaign-602', ownerId: service.user.id },
    })
    await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: 'primary-loss-run',
        primaryResult: 'lost',
        details: { electionDate: '2099-11-03' },
        organizationSlug: 'campaign-602',
      },
    })

    const result = await service.client.get('/v1/organizations')

    expect(result.status).toBe(200)
    const campaignOrg = result.data.organizations.find(
      (org: { slug: string }) => org.slug === 'campaign-602',
    )
    expect(campaignOrg.status).toBe('past')
  })
})

describe('GET /v1/organizations/:slug', () => {
  it('returns an organization by slug with name', async () => {
    await service.prisma.organization.create({
      data: {
        slug: 'campaign-99',
        ownerId: service.user.id,
        positionId: 'br-pos-789',
      },
    })

    await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: 'test-campaign-99',
        details: { electionDate: '2026-11-03' },
        organizationSlug: 'campaign-99',
      },
    })

    const result = await service.client.get('/v1/organizations/campaign-99')

    expect(result).toMatchObject({
      status: 200,
      data: {
        slug: 'campaign-99',
        name: '2026 Campaign',
        campaignId: 99,
        electedOfficeId: null,
      },
    })
  })

  it('returns a campaign organization with "Campaign" name when no electionDate', async () => {
    await service.prisma.organization.create({
      data: {
        slug: 'campaign-50',
        ownerId: service.user.id,
      },
    })

    const result = await service.client.get('/v1/organizations/campaign-50')

    expect(result).toMatchObject({
      status: 200,
      data: {
        slug: 'campaign-50',
        name: 'Campaign',
        campaignId: 50,
        electedOfficeId: null,
      },
    })
  })

  it('returns an elected office organization with name from position', async () => {
    const electionsService = service.app.get(ElectionsService)
    vi.spyOn(electionsService, 'getPositionById').mockResolvedValue({
      id: 'pos-eo',
      brPositionId: 'br-pos-eo',
      brDatabaseId: 'br-db-eo',
      state: 'FL',
      name: 'School Board',
    })

    await service.prisma.organization.create({
      data: {
        slug: 'eo-def-456',
        ownerId: service.user.id,
        positionId: 'br-pos-eo',
      },
    })

    const result = await service.client.get('/v1/organizations/eo-def-456')

    expect(result).toMatchObject({
      status: 200,
      data: {
        slug: 'eo-def-456',
        name: 'School Board',
        positionName: 'School Board',
        electedOfficeId: 'def-456',
        campaignId: null,
      },
    })
  })

  it('returns positionName from customPositionName on elected office org', async () => {
    const electionsService = service.app.get(ElectionsService)
    vi.spyOn(electionsService, 'getPositionById').mockResolvedValue({
      id: 'pos-eo-custom',
      brPositionId: 'br-pos-eo-custom',
      brDatabaseId: 'br-db-eo-custom',
      state: 'TX',
      name: 'County Judge',
    })

    await service.prisma.organization.create({
      data: {
        slug: 'eo-custom-123',
        ownerId: service.user.id,
        positionId: 'br-pos-eo-custom',
        customPositionName: 'Custom Judge Title',
      },
    })

    const result = await service.client.get('/v1/organizations/eo-custom-123')

    expect(result).toMatchObject({
      status: 200,
      data: {
        slug: 'eo-custom-123',
        name: 'Custom Judge Title',
        positionName: 'Custom Judge Title',
        electedOfficeId: 'custom-123',
        campaignId: null,
      },
    })
  })

  it('ignores customPositionName for campaign orgs', async () => {
    await service.prisma.organization.create({
      data: {
        slug: 'campaign-100',
        ownerId: service.user.id,
        customPositionName: 'Custom Office Name',
      },
    })

    await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: 'test-campaign-100',
        details: { electionDate: '2026-11-03' },
        organizationSlug: 'campaign-100',
      },
    })

    const result = await service.client.get('/v1/organizations/campaign-100')

    expect(result).toMatchObject({
      status: 200,
      data: {
        slug: 'campaign-100',
        name: '2026 Campaign',
        campaignId: 100,
        electedOfficeId: null,
      },
    })
  })

  it('returns 404 for a non-existent slug', async () => {
    const result = await service.client.get('/v1/organizations/does-not-exist')

    expect(result.status).toBe(404)
  })

  it('returns 404 for an organization owned by another user', async () => {
    const otherUser = await service.prisma.user.create({
      data: { email: 'other2@goodparty.org' },
    })

    await service.prisma.organization.create({
      data: {
        slug: 'other-user-org',
        ownerId: otherUser.id,
      },
    })

    const result = await service.client.get('/v1/organizations/other-user-org')

    expect(result.status).toBe(404)
  })
})

describe('PATCH /v1/organizations/:slug', () => {
  it('updates customPositionName', async () => {
    await service.prisma.organization.create({
      data: {
        slug: 'campaign-200',
        ownerId: service.user.id,
      },
    })

    await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: 'test-campaign-200',
        details: { electionDate: '2026-11-03' },
        organizationSlug: 'campaign-200',
      },
    })

    const result = await service.client.patch(
      '/v1/organizations/campaign-200',
      {
        customPositionName: 'New Custom Name',
      },
    )

    expect(result).toMatchObject({
      status: 200,
      data: {
        slug: 'campaign-200',
        name: '2026 Campaign',
        campaignId: 200,
        electedOfficeId: null,
      },
    })
  })

  it('updates ballotReadyPositionId and resolves position', async () => {
    const electionsService = service.app.get(ElectionsService)
    vi.spyOn(electionsService, 'getPositionByBallotReadyId').mockResolvedValue({
      id: 'pos-new',
      brPositionId: 'br-pos-new',
      brDatabaseId: 'br-db-new',
      state: 'TX',
      name: 'Governor',
    })
    vi.spyOn(electionsService, 'getPositionById').mockResolvedValue({
      id: 'pos-new',
      brPositionId: 'br-pos-new',
      brDatabaseId: 'br-db-new',
      state: 'TX',
      name: 'Governor',
    })

    await service.prisma.organization.create({
      data: {
        slug: 'campaign-201',
        ownerId: service.user.id,
      },
    })

    await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: 'test-campaign-201',
        details: {},
        organizationSlug: 'campaign-201',
      },
    })

    const result = await service.client.patch(
      '/v1/organizations/campaign-201',
      {
        ballotReadyPositionId: 'br-pos-new',
      },
    )

    expect(result.status).toBe(200)
    expect(result.data.slug).toBe('campaign-201')
  })

  it('returns 400 when ballotReadyPositionId resolves to no position', async () => {
    const electionsService = service.app.get(ElectionsService)
    vi.spyOn(electionsService, 'getPositionByBallotReadyId').mockResolvedValue(
      null,
    )

    await service.prisma.organization.create({
      data: {
        slug: 'campaign-202',
        ownerId: service.user.id,
      },
    })

    await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: 'test-campaign-202',
        details: {},
        organizationSlug: 'campaign-202',
      },
    })

    const result = await service.client.patch(
      '/v1/organizations/campaign-202',
      {
        ballotReadyPositionId: 'nonexistent',
      },
    )

    expect(result.status).toBe(400)
  })

  it('ignores overrideDistrictId from a self-service caller (IDOR guard)', async () => {
    await service.prisma.organization.create({
      data: {
        slug: 'campaign-204',
        ownerId: service.user.id,
      },
    })

    await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: 'test-campaign-204',
        details: {},
        organizationSlug: 'campaign-204',
      },
    })

    const result = await service.client.patch(
      '/v1/organizations/campaign-204',
      {
        overrideDistrictId: 'attacker-chosen-district',
        customPositionName: 'Legit Name',
      },
    )

    expect(result.status).toBe(200)

    const updated = await service.prisma.organization.findUnique({
      where: { slug: 'campaign-204' },
    })
    expect(updated?.overrideDistrictId).toBeNull()
    expect(updated?.customPositionName).toBe('Legit Name')
  })

  it('returns 404 for a non-existent slug', async () => {
    const result = await service.client.patch(
      '/v1/organizations/does-not-exist',
      { customPositionName: 'test' },
    )

    expect(result.status).toBe(404)
  })

  it('returns 404 for an organization owned by another user', async () => {
    const otherUser = await service.prisma.user.create({
      data: { email: 'other-patch@goodparty.org' },
    })

    await service.prisma.organization.create({
      data: {
        slug: 'other-patch-org',
        ownerId: otherUser.id,
      },
    })

    const result = await service.client.patch(
      '/v1/organizations/other-patch-org',
      { customPositionName: 'test' },
    )

    expect(result.status).toBe(404)
  })

  it('ignores a null overrideDistrictId from a self-service caller', async () => {
    const electionsService = service.app.get(ElectionsService)
    vi.spyOn(electionsService, 'getDistrict').mockResolvedValue({
      id: 'existing-district',
      state: 'CA',
      L2DistrictType: 'County',
      L2DistrictName: 'Test County',
    })

    await service.prisma.organization.create({
      data: {
        slug: 'campaign-206',
        ownerId: service.user.id,
        overrideDistrictId: 'existing-district',
      },
    })

    await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: 'test-campaign-206',
        details: {},
        organizationSlug: 'campaign-206',
      },
    })

    const result = await service.client.patch(
      '/v1/organizations/campaign-206',
      {
        overrideDistrictId: null,
      },
    )

    expect(result.status).toBe(200)

    const updated = await service.prisma.organization.findUnique({
      where: { slug: 'campaign-206' },
    })
    expect(updated?.overrideDistrictId).toBe('existing-district')
  })

  it('preserves overrideDistrictId when not included in update', async () => {
    const electionsService = service.app.get(ElectionsService)
    vi.spyOn(electionsService, 'getDistrict').mockResolvedValue({
      id: 'keep-this-district',
      state: 'CA',
      L2DistrictType: 'County',
      L2DistrictName: 'Test County',
    })

    await service.prisma.organization.create({
      data: {
        slug: 'campaign-207',
        ownerId: service.user.id,
        overrideDistrictId: 'keep-this-district',
      },
    })

    await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: 'test-campaign-207',
        details: {},
        organizationSlug: 'campaign-207',
      },
    })

    const result = await service.client.patch(
      '/v1/organizations/campaign-207',
      {
        customPositionName: 'Some Name',
      },
    )

    expect(result.status).toBe(200)

    const updated = await service.prisma.organization.findUnique({
      where: { slug: 'campaign-207' },
    })
    expect(updated?.overrideDistrictId).toBe('keep-this-district')
  })

  it('passes includeDistrict: true when resolving position by ballotReadyPositionId', async () => {
    const electionsService = service.app.get(ElectionsService)
    const spy = vi
      .spyOn(electionsService, 'getPositionByBallotReadyId')
      .mockResolvedValue({
        id: 'pos-inc',
        brPositionId: 'br-pos-inc',
        brDatabaseId: 'br-db-inc',
        state: 'CA',
        name: 'Mayor',
        district: {
          id: 'dist-inc',
          state: 'CA',
          L2DistrictType: 'City',
          L2DistrictName: 'Oakland',
        },
      })
    vi.spyOn(electionsService, 'getPositionById').mockResolvedValue({
      id: 'pos-inc',
      brPositionId: 'br-pos-inc',
      brDatabaseId: 'br-db-inc',
      state: 'CA',
      name: 'Mayor',
    })

    await service.prisma.organization.create({
      data: {
        slug: 'campaign-208',
        ownerId: service.user.id,
      },
    })

    await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: 'test-campaign-208',
        details: {},
        organizationSlug: 'campaign-208',
      },
    })

    await service.client.patch('/v1/organizations/campaign-208', {
      ballotReadyPositionId: 'br-pos-inc',
    })

    expect(spy).toHaveBeenCalledWith('br-pos-inc', { includeDistrict: true })
  })

  it('clears customPositionName when set to null', async () => {
    await service.prisma.organization.create({
      data: {
        slug: 'campaign-205',
        ownerId: service.user.id,
        customPositionName: 'Old Name',
      },
    })

    await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: 'test-campaign-205',
        details: { electionDate: '2026-11-03' },
        organizationSlug: 'campaign-205',
      },
    })

    const result = await service.client.patch(
      '/v1/organizations/campaign-205',
      {
        customPositionName: null,
      },
    )

    expect(result).toMatchObject({
      status: 200,
      data: {
        slug: 'campaign-205',
        name: '2026 Campaign',
        campaignId: 205,
      },
    })
  })

  it('clears a stale customPositionName when a structured position is picked', async () => {
    const electionsService = service.app.get(ElectionsService)
    vi.spyOn(electionsService, 'getPositionByBallotReadyId').mockResolvedValue({
      id: 'pos-repick',
      brPositionId: 'br-pos-repick',
      brDatabaseId: 'br-db-repick',
      state: 'FL',
      name: 'City Council - District 1',
    })
    vi.spyOn(electionsService, 'getPositionById').mockResolvedValue({
      id: 'pos-repick',
      brPositionId: 'br-pos-repick',
      brDatabaseId: 'br-db-repick',
      state: 'FL',
      name: 'City Council - District 1',
    })

    await service.prisma.organization.create({
      data: {
        slug: 'campaign-209',
        ownerId: service.user.id,
        customPositionName: 'City Council',
      },
    })

    await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: 'test-campaign-209',
        details: {},
        organizationSlug: 'campaign-209',
      },
    })

    const result = await service.client.patch(
      '/v1/organizations/campaign-209',
      {
        ballotReadyPositionId: 'br-pos-repick',
      },
    )

    expect(result).toMatchObject({
      status: 200,
      data: {
        slug: 'campaign-209',
        positionName: 'City Council - District 1',
        customPositionName: null,
        position: { name: 'City Council - District 1' },
      },
    })

    const updated = await service.prisma.organization.findUnique({
      where: { slug: 'campaign-209' },
    })
    expect(updated?.customPositionName).toBeNull()
    expect(updated?.positionId).toBe('pos-repick')
  })

  it('keeps an explicit customPositionName sent alongside a position', async () => {
    const electionsService = service.app.get(ElectionsService)
    vi.spyOn(electionsService, 'getPositionByBallotReadyId').mockResolvedValue({
      id: 'pos-both',
      brPositionId: 'br-pos-both',
      brDatabaseId: 'br-db-both',
      state: 'FL',
      name: 'Mayor',
    })
    vi.spyOn(electionsService, 'getPositionById').mockResolvedValue({
      id: 'pos-both',
      brPositionId: 'br-pos-both',
      brDatabaseId: 'br-db-both',
      state: 'FL',
      name: 'Mayor',
    })

    await service.prisma.organization.create({
      data: {
        slug: 'campaign-210',
        ownerId: service.user.id,
      },
    })

    await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: 'test-campaign-210',
        details: {},
        organizationSlug: 'campaign-210',
      },
    })

    const result = await service.client.patch(
      '/v1/organizations/campaign-210',
      {
        ballotReadyPositionId: 'br-pos-both',
        customPositionName: 'Village Mayor',
      },
    )

    expect(result).toMatchObject({
      status: 200,
      data: {
        positionName: 'Village Mayor',
        customPositionName: 'Village Mayor',
      },
    })

    const updated = await service.prisma.organization.findUnique({
      where: { slug: 'campaign-210' },
    })
    expect(updated?.customPositionName).toBe('Village Mayor')
  })

  it('preserves customPositionName when the patch does not touch it', async () => {
    await service.prisma.organization.create({
      data: {
        slug: 'campaign-211',
        ownerId: service.user.id,
        customPositionName: 'Keep Me',
      },
    })

    await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: 'test-campaign-211',
        details: {},
        organizationSlug: 'campaign-211',
      },
    })

    const result = await service.client.patch(
      '/v1/organizations/campaign-211',
      {},
    )

    expect(result.status).toBe(200)

    const updated = await service.prisma.organization.findUnique({
      where: { slug: 'campaign-211' },
    })
    expect(updated?.customPositionName).toBe('Keep Me')
  })

  it('clears a stale customPositionName when the position is unlinked', async () => {
    await service.prisma.organization.create({
      data: {
        slug: 'campaign-212',
        ownerId: service.user.id,
        positionId: 'pos-unlink',
        customPositionName: 'City Council',
      },
    })

    await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: 'test-campaign-212',
        details: {},
        organizationSlug: 'campaign-212',
      },
    })

    const result = await service.client.patch(
      '/v1/organizations/campaign-212',
      { ballotReadyPositionId: null },
    )

    expect(result).toMatchObject({
      status: 200,
      data: { positionName: null, customPositionName: null },
    })

    const updated = await service.prisma.organization.findUnique({
      where: { slug: 'campaign-212' },
    })
    expect(updated?.positionId).toBeNull()
    expect(updated?.customPositionName).toBeNull()
  })

  it('rejects an empty-string ballotReadyPositionId', async () => {
    await service.prisma.organization.create({
      data: {
        slug: 'campaign-213',
        ownerId: service.user.id,
        customPositionName: 'Keep Me Too',
      },
    })

    await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: 'test-campaign-213',
        details: {},
        organizationSlug: 'campaign-213',
      },
    })

    const result = await service.client.patch(
      '/v1/organizations/campaign-213',
      { ballotReadyPositionId: '' },
    )

    expect(result.status).toBe(400)

    const updated = await service.prisma.organization.findUnique({
      where: { slug: 'campaign-213' },
    })
    expect(updated?.customPositionName).toBe('Keep Me Too')
  })
})

describe('GET /v1/organizations/admin/:slug', () => {
  it('returns 403 for non-admin users without an M2M token', async () => {
    await service.prisma.organization.create({
      data: {
        slug: 'campaign-401',
        ownerId: service.user.id,
      },
    })

    const result = await service.client.get(
      '/v1/organizations/admin/campaign-401',
    )

    expect(result.status).toBe(403)
  })

  it('returns an organization owned by another user when caller is admin', async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { roles: ['admin'] },
    })

    const otherUser = await service.prisma.user.create({
      data: { email: 'admin-target@goodparty.org' },
    })

    await service.prisma.organization.create({
      data: {
        slug: 'campaign-402',
        ownerId: otherUser.id,
      },
    })

    await service.prisma.campaign.create({
      data: {
        userId: otherUser.id,
        slug: 'admin-target-campaign',
        details: { electionDate: '2026-11-03' },
        organizationSlug: 'campaign-402',
      },
    })

    const result = await service.client.get(
      '/v1/organizations/admin/campaign-402',
    )

    expect(result).toMatchObject({
      status: 200,
      data: {
        slug: 'campaign-402',
        name: '2026 Campaign',
        campaignId: 402,
        electedOfficeId: null,
      },
    })
  })

  it('returns an EO organization owned by another user when caller is admin', async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { roles: ['admin'] },
    })

    const electionsService = service.app.get(ElectionsService)
    vi.spyOn(electionsService, 'getPositionById').mockResolvedValue({
      id: 'pos-eo-admin',
      brPositionId: 'br-pos-eo-admin',
      brDatabaseId: 'br-db-eo-admin',
      state: 'CO',
      name: 'County Commissioner',
    })

    const otherUser = await service.prisma.user.create({
      data: { email: 'admin-eo-target@goodparty.org' },
    })

    await service.prisma.organization.create({
      data: {
        slug: 'eo-admin-1',
        ownerId: otherUser.id,
        positionId: 'br-pos-eo-admin',
      },
    })

    const result = await service.client.get(
      '/v1/organizations/admin/eo-admin-1',
    )

    expect(result).toMatchObject({
      status: 200,
      data: {
        slug: 'eo-admin-1',
        name: 'County Commissioner',
        positionName: 'County Commissioner',
        electedOfficeId: 'admin-1',
        campaignId: null,
      },
    })
  })

  it('returns 404 for a non-existent slug when caller is admin', async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { roles: ['admin'] },
    })

    const result = await service.client.get(
      '/v1/organizations/admin/does-not-exist',
    )

    expect(result.status).toBe(404)
  })
})

describe('PATCH /v1/organizations/admin/:slug', () => {
  it('returns 403 for non-admin users without an M2M token', async () => {
    await service.prisma.organization.create({
      data: {
        slug: 'campaign-501',
        ownerId: service.user.id,
      },
    })

    const result = await service.client.patch(
      '/v1/organizations/admin/campaign-501',
      { customPositionName: 'Forbidden' },
    )

    expect(result.status).toBe(403)
  })

  it('updates an organization owned by another user when caller is admin', async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { roles: ['admin'] },
    })

    const otherUser = await service.prisma.user.create({
      data: { email: 'admin-patch-target@goodparty.org' },
    })

    await service.prisma.organization.create({
      data: {
        slug: 'campaign-502',
        ownerId: otherUser.id,
      },
    })

    await service.prisma.campaign.create({
      data: {
        userId: otherUser.id,
        slug: 'admin-patch-target-campaign',
        details: { electionDate: '2026-11-03' },
        organizationSlug: 'campaign-502',
      },
    })

    const result = await service.client.patch(
      '/v1/organizations/admin/campaign-502',
      { customPositionName: 'Admin Set Name' },
    )

    expect(result).toMatchObject({
      status: 200,
      data: {
        slug: 'campaign-502',
        name: '2026 Campaign',
        campaignId: 502,
      },
    })

    const updated = await service.prisma.organization.findUnique({
      where: { slug: 'campaign-502' },
    })
    expect(updated?.customPositionName).toBe('Admin Set Name')
  })

  it('resolves ballotReadyPositionId via election service when caller is admin', async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { roles: ['admin'] },
    })

    const electionsService = service.app.get(ElectionsService)
    vi.spyOn(electionsService, 'getPositionByBallotReadyId').mockResolvedValue({
      id: 'pos-admin-patch',
      brPositionId: 'br-pos-admin-patch',
      brDatabaseId: 'br-db-admin-patch',
      state: 'CA',
      name: 'Mayor',
    })
    vi.spyOn(electionsService, 'getPositionById').mockResolvedValue({
      id: 'pos-admin-patch',
      brPositionId: 'br-pos-admin-patch',
      brDatabaseId: 'br-db-admin-patch',
      state: 'CA',
      name: 'Mayor',
    })

    const otherUser = await service.prisma.user.create({
      data: { email: 'admin-patch-position@goodparty.org' },
    })

    await service.prisma.organization.create({
      data: {
        slug: 'campaign-503',
        ownerId: otherUser.id,
      },
    })

    await service.prisma.campaign.create({
      data: {
        userId: otherUser.id,
        slug: 'admin-patch-position-campaign',
        details: {},
        organizationSlug: 'campaign-503',
      },
    })

    const result = await service.client.patch(
      '/v1/organizations/admin/campaign-503',
      { ballotReadyPositionId: 'br-pos-admin-patch' },
    )

    expect(result.status).toBe(200)

    const updated = await service.prisma.organization.findUnique({
      where: { slug: 'campaign-503' },
    })
    expect(updated?.positionId).toBe('pos-admin-patch')
  })

  it('clears a stale customPositionName when admin picks a position', async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { roles: ['admin'] },
    })

    const electionsService = service.app.get(ElectionsService)
    vi.spyOn(electionsService, 'getPositionByBallotReadyId').mockResolvedValue({
      id: 'pos-admin-repick',
      brPositionId: 'br-pos-admin-repick',
      brDatabaseId: 'br-db-admin-repick',
      state: 'FL',
      name: 'City Council - District 1',
    })
    vi.spyOn(electionsService, 'getPositionById').mockResolvedValue({
      id: 'pos-admin-repick',
      brPositionId: 'br-pos-admin-repick',
      brDatabaseId: 'br-db-admin-repick',
      state: 'FL',
      name: 'City Council - District 1',
    })

    const otherUser = await service.prisma.user.create({
      data: { email: 'admin-repick-target@goodparty.org' },
    })

    await service.prisma.organization.create({
      data: {
        slug: 'campaign-506',
        ownerId: otherUser.id,
        customPositionName: 'City Council',
      },
    })

    await service.prisma.campaign.create({
      data: {
        userId: otherUser.id,
        slug: 'admin-repick-campaign',
        details: {},
        organizationSlug: 'campaign-506',
      },
    })

    const result = await service.client.patch(
      '/v1/organizations/admin/campaign-506',
      { ballotReadyPositionId: 'br-pos-admin-repick' },
    )

    expect(result).toMatchObject({
      status: 200,
      data: {
        positionName: 'City Council - District 1',
        customPositionName: null,
      },
    })

    const updated = await service.prisma.organization.findUnique({
      where: { slug: 'campaign-506' },
    })
    expect(updated?.customPositionName).toBeNull()
  })

  it('sets overrideDistrictId when caller is admin', async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { roles: ['admin'] },
    })

    const electionsService = service.app.get(ElectionsService)
    vi.spyOn(electionsService, 'getDistrict').mockResolvedValue({
      id: 'admin-set-district',
      state: 'CA',
      L2DistrictType: 'City',
      L2DistrictName: 'Oakland',
    })

    const otherUser = await service.prisma.user.create({
      data: { email: 'admin-override-target@goodparty.org' },
    })

    await service.prisma.organization.create({
      data: {
        slug: 'campaign-504',
        ownerId: otherUser.id,
      },
    })

    await service.prisma.campaign.create({
      data: {
        userId: otherUser.id,
        slug: 'admin-override-campaign',
        details: {},
        organizationSlug: 'campaign-504',
      },
    })

    const result = await service.client.patch(
      '/v1/organizations/admin/campaign-504',
      { overrideDistrictId: 'admin-set-district' },
    )

    expect(result.status).toBe(200)

    const updated = await service.prisma.organization.findUnique({
      where: { slug: 'campaign-504' },
    })
    expect(updated?.overrideDistrictId).toBe('admin-set-district')
  })

  it('clears overrideDistrictId via null when caller is admin', async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { roles: ['admin'] },
    })

    const otherUser = await service.prisma.user.create({
      data: { email: 'admin-clear-target@goodparty.org' },
    })

    await service.prisma.organization.create({
      data: {
        slug: 'campaign-505',
        ownerId: otherUser.id,
        overrideDistrictId: 'to-be-cleared',
      },
    })

    await service.prisma.campaign.create({
      data: {
        userId: otherUser.id,
        slug: 'admin-clear-campaign',
        details: {},
        organizationSlug: 'campaign-505',
      },
    })

    const result = await service.client.patch(
      '/v1/organizations/admin/campaign-505',
      { overrideDistrictId: null },
    )

    expect(result.status).toBe(200)

    const updated = await service.prisma.organization.findUnique({
      where: { slug: 'campaign-505' },
    })
    expect(updated?.overrideDistrictId).toBeNull()
  })

  it('returns 404 for a non-existent slug when caller is admin', async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { roles: ['admin'] },
    })

    const result = await service.client.patch(
      '/v1/organizations/admin/does-not-exist',
      { customPositionName: 'whatever' },
    )

    expect(result.status).toBe(404)
  })
})

describe('GET /v1/organizations/admin/list', () => {
  it('returns 403 for non-admin users without an M2M token', async () => {
    const result = await service.client.get('/v1/organizations/admin/list')

    expect(result.status).toBe(403)
  })

  it('returns organizations with extra owner and campaign fields', async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { roles: ['admin'] },
    })

    const otherUser = await service.prisma.user.create({
      data: {
        email: 'org-owner@goodparty.org',
        firstName: 'Jane',
        lastName: 'Doe',
        phone: '555-1234',
      },
    })

    await service.prisma.organization.create({
      data: {
        slug: 'campaign-300',
        ownerId: otherUser.id,
      },
    })

    await service.prisma.campaign.create({
      data: {
        userId: otherUser.id,
        slug: 'admin-list-campaign',
        details: {},
        organizationSlug: 'campaign-300',
      },
    })

    const result = await service.client.get(
      '/v1/organizations/admin/list?slug=campaign-300',
    )

    expect(result.status).toBe(200)
    expect(result.data.organizations).toHaveLength(1)
    expect(result.data.organizations[0]).toMatchObject({
      slug: 'campaign-300',
      name: 'Campaign',
      campaignId: 300,
      electedOfficeId: null,
      extra: {
        owner: {
          id: otherUser.id,
          email: 'org-owner@goodparty.org',
          firstName: 'Jane',
          lastName: 'Doe',
          phone: '555-1234',
        },
        campaign: {
          slug: 'admin-list-campaign',
        },
      },
    })
  })

  it('returns null campaign in extra when org has no campaign', async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { roles: ['admin'] },
    })

    const otherUser = await service.prisma.user.create({
      data: { email: 'no-campaign-owner@goodparty.org' },
    })

    await service.prisma.organization.create({
      data: {
        slug: 'campaign-310',
        ownerId: otherUser.id,
      },
    })

    const result = await service.client.get(
      '/v1/organizations/admin/list?slug=campaign-310',
    )

    expect(result.status).toBe(200)
    expect(result.data.organizations[0].extra.campaign).toBeNull()
  })

  it('filters organizations by owner email', async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { roles: ['admin'] },
    })

    const user1 = await service.prisma.user.create({
      data: { email: 'alice@goodparty.org' },
    })
    const user2 = await service.prisma.user.create({
      data: { email: 'bob@example.com' },
    })

    await service.prisma.organization.create({
      data: { slug: 'campaign-301', ownerId: user1.id },
    })
    await service.prisma.campaign.create({
      data: {
        userId: user1.id,
        slug: 'alice-campaign',
        details: {},
        organizationSlug: 'campaign-301',
      },
    })

    await service.prisma.organization.create({
      data: { slug: 'campaign-302', ownerId: user2.id },
    })
    await service.prisma.campaign.create({
      data: {
        userId: user2.id,
        slug: 'bob-campaign',
        details: {},
        organizationSlug: 'campaign-302',
      },
    })

    const result = await service.client.get(
      '/v1/organizations/admin/list?email=alice',
    )

    expect(result.status).toBe(200)
    expect(result.data.organizations).toHaveLength(1)
    expect(result.data.organizations[0].slug).toBe('campaign-301')
  })

  it('returns empty list when filter matches no users', async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { roles: ['admin'] },
    })

    const result = await service.client.get(
      '/v1/organizations/admin/list?filter=nonexistent@nowhere.com',
    )

    expect(result.status).toBe(200)
    expect(result.data.organizations).toHaveLength(0)
  })
})

describe('office-change invalidation', () => {
  // makeFriendly throws a 500 when positionId is set and getPositionById
  // resolves null, and every PATCH resolves the pre-update org through it.
  // Seeding a position therefore requires a matching mock or the request
  // fails before reaching any invalidation.
  const seedServeOrg = async (slug: string, positionId: string | null) => {
    await service.prisma.organization.create({
      data: { slug, ownerId: service.user.id, positionId },
    })
    if (positionId) {
      vi.spyOn(
        service.app.get(ElectionsService),
        'getPositionById',
      ).mockResolvedValue({
        id: positionId,
        brPositionId: `br-${positionId}`,
        brDatabaseId: `db-${positionId}`,
        state: 'MN',
        name: 'City Council',
      })
    }
    return service.prisma.electedOffice.create({
      data: { organizationSlug: slug, userId: service.user.id },
    })
  }

  const seedDerivedData = async (slug: string, electedOfficeId: string) => {
    await service.prisma.meetingResourceLocation.create({
      data: {
        electedOfficeId,
        type: 'SCHEDULE',
        description: 'https://old-city.example.gov/calendar',
      },
    })
    await service.prisma.ordinanceCodeRecord.create({
      data: {
        organizationSlug: slug,
        codeFound: true,
        dataQuality: 'OK',
        confidence: 'HIGH',
        place: 'Old City',
        state: 'MN',
        verifiedEvidence: 'seeded',
        artifactBucket: 'b',
        artifactKey: 'k',
        verifiedAt: new Date(),
      },
    })
    await service.prisma.communityIssue.create({
      data: {
        organizationSlug: slug,
        list: 'top_community',
        category: 'public_safety',
        priority: 'high',
        title: 'Old city issue',
        summary: 'seeded',
      },
    })
    // MeetingBriefing rows are an explicit non-goal for invalidation — they
    // must survive an office-identity change untouched (see the "briefings
    // survive" assertion below).
    const briefingRun = await service.prisma.experimentRun.create({
      data: {
        organizationSlug: slug,
        experimentType: 'meeting_briefing',
        status: ExperimentRunStatus.COMPLETED,
      },
    })
    await service.prisma.meetingBriefing.create({
      data: {
        electedOfficeId,
        meetingDate: new Date('2026-09-01T00:00:00Z'),
        meetingTime: '19:00',
        meetingTimezone: 'America/Chicago',
        experimentRunId: briefingRun.runId,
        artifactBucket: 'b',
        artifactKey: 'k',
      },
    })
  }

  const mockPosition = (id: string, brId: string) => {
    const elections = service.app.get(ElectionsService)
    vi.spyOn(elections, 'getPositionByBallotReadyId').mockResolvedValue({
      id,
      brPositionId: brId,
      brDatabaseId: `db-${id}`,
      state: 'MN',
      name: 'City Council',
    })
    vi.spyOn(elections, 'getPositionById').mockResolvedValue({
      id,
      brPositionId: brId,
      brDatabaseId: `db-${id}`,
      state: 'MN',
      name: 'City Council',
    })
  }

  it('invalidates derived data when the position changes', async () => {
    const slug = 'eo-change-1'
    const eo = await seedServeOrg(slug, 'pos-old')
    await seedDerivedData(slug, eo.id)
    mockPosition('pos-new', 'br-pos-new')

    const result = await service.client.patch(`/v1/organizations/${slug}`, {
      ballotReadyPositionId: 'br-pos-new',
    })
    expect(result.status).toBe(200)

    expect(
      await service.prisma.meetingResourceLocation.count({
        where: { electedOfficeId: eo.id },
      }),
    ).toBe(0)
    expect(
      await service.prisma.ordinanceCodeRecord.findUnique({
        where: { organizationSlug: slug },
      }),
    ).toBeNull()
    const issue = await service.prisma.communityIssue.findFirst({
      where: { organizationSlug: slug },
    })
    expect(issue?.archivedAt).toBeInstanceOf(Date)
    const org = await service.prisma.organization.findUnique({
      where: { slug },
    })
    expect(org?.officeIdentityChangedAt).toBeInstanceOf(Date)
    expect(
      await service.prisma.meetingBriefing.count({
        where: { electedOfficeId: eo.id },
      }),
    ).toBe(1)
  })

  // The self-service PATCH strips overrideDistrictId (IDOR guard, see
  // "ignores overrideDistrictId from a self-service caller"), so the only
  // route through applyPatch that can move this column is the admin one.
  it('invalidates when only overrideDistrictId changes', async () => {
    const slug = 'eo-change-2'
    const eo = await seedServeOrg(slug, 'pos-old')
    await seedDerivedData(slug, eo.id)
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { roles: ['admin'] },
    })
    vi.spyOn(
      service.app.get(ElectionsService),
      'getDistrict',
    ).mockResolvedValue({
      id: 'dist-new',
      state: 'MN',
      L2DistrictType: 'City',
      L2DistrictName: 'Minneapolis',
    })

    const result = await service.client.patch(
      `/v1/organizations/admin/${slug}`,
      { overrideDistrictId: 'dist-new' },
    )
    expect(result.status).toBe(200)

    expect(
      await service.prisma.ordinanceCodeRecord.findUnique({
        where: { organizationSlug: slug },
      }),
    ).toBeNull()
    const org = await service.prisma.organization.findUnique({
      where: { slug },
    })
    expect(org?.officeIdentityChangedAt).toBeInstanceOf(Date)
  })

  it('treats a first position (null -> set) as initialization', async () => {
    const slug = 'eo-init'
    const eo = await seedServeOrg(slug, null)
    await seedDerivedData(slug, eo.id)
    mockPosition('pos-first', 'br-pos-first')

    const result = await service.client.patch(`/v1/organizations/${slug}`, {
      ballotReadyPositionId: 'br-pos-first',
    })
    expect(result.status).toBe(200)

    expect(
      await service.prisma.ordinanceCodeRecord.findUnique({
        where: { organizationSlug: slug },
      }),
    ).not.toBeNull()
    const org = await service.prisma.organization.findUnique({
      where: { slug },
    })
    expect(org?.officeIdentityChangedAt).toBeNull()
  })

  it('does nothing for a campaign org with no elected office', async () => {
    const slug = 'campaign-900'
    await service.prisma.organization.create({
      data: { slug, ownerId: service.user.id, positionId: 'pos-old' },
    })
    await service.prisma.ordinanceCodeRecord.create({
      data: {
        organizationSlug: slug,
        codeFound: true,
        dataQuality: 'OK',
        confidence: 'HIGH',
        place: 'Old City',
        state: 'MN',
        verifiedEvidence: 'seeded',
        artifactBucket: 'b',
        artifactKey: 'k',
        verifiedAt: new Date(),
      },
    })
    mockPosition('pos-new', 'br-pos-new')

    const result = await service.client.patch(`/v1/organizations/${slug}`, {
      ballotReadyPositionId: 'br-pos-new',
    })
    expect(result.status).toBe(200)

    expect(
      await service.prisma.ordinanceCodeRecord.findUnique({
        where: { organizationSlug: slug },
      }),
    ).not.toBeNull()
  })

  it('does nothing when the patch does not move the identity', async () => {
    const slug = 'eo-noop'
    const eo = await seedServeOrg(slug, 'pos-old')
    await seedDerivedData(slug, eo.id)

    const result = await service.client.patch(`/v1/organizations/${slug}`, {
      customPositionName: 'Renamed Only',
    })
    expect(result.status).toBe(200)

    expect(
      await service.prisma.ordinanceCodeRecord.findUnique({
        where: { organizationSlug: slug },
      }),
    ).not.toBeNull()
    const org = await service.prisma.organization.findUnique({
      where: { slug },
    })
    expect(org?.officeIdentityChangedAt).toBeNull()
  })

  it('invalidates when the position is cleared for a custom name', async () => {
    const slug = 'eo-custom'
    const eo = await seedServeOrg(slug, 'pos-old')
    await seedDerivedData(slug, eo.id)

    const result = await service.client.patch(`/v1/organizations/${slug}`, {
      ballotReadyPositionId: null,
      customPositionName: 'Village Trustee',
    })
    expect(result.status).toBe(200)

    expect(
      await service.prisma.ordinanceCodeRecord.findUnique({
        where: { organizationSlug: slug },
      }),
    ).toBeNull()
  })

  afterEach(() => {
    delete process.env.ORDINANCES_AUTOMATION_ENABLED
  })

  it('re-dispatches ordinances despite a prior completed run', async () => {
    process.env.ORDINANCES_AUTOMATION_ENABLED = 'true'
    const slug = 'eo-redispatch'
    const eo = await seedServeOrg(slug, 'pos-old')
    await seedDerivedData(slug, eo.id)
    await service.prisma.experimentRun.create({
      data: {
        organizationSlug: slug,
        experimentType: 'find_existing_ordinances',
        status: ExperimentRunStatus.COMPLETED,
      },
    })

    const elections = service.app.get(ElectionsService)
    vi.spyOn(elections, 'getPositionByBallotReadyId').mockResolvedValue({
      id: 'pos-new',
      brPositionId: 'br-pos-new',
      brDatabaseId: 'db-new',
      state: 'MN',
      name: 'City Council',
    })
    vi.spyOn(elections, 'getPositionById').mockResolvedValue({
      id: 'pos-new',
      brPositionId: 'br-pos-new',
      brDatabaseId: 'db-new',
      state: 'MN',
      name: 'City Council',
      isServeIcp: true,
    })
    const dispatchRun = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockImplementation(async () => {
        // Pins the ordering two addenda protect: invalidation must commit
        // before dispatch fires, or the new run gets seeded with the old
        // city's portal. Assert it from inside the spy so a regression that
        // moves dispatch back inside the transaction fails this test.
        expect(
          await service.prisma.meetingResourceLocation.count({
            where: { electedOfficeId: eo.id },
          }),
        ).toBe(0)
        return { runId: 'run-new' } as never
      })

    const result = await service.client.patch(`/v1/organizations/${slug}`, {
      ballotReadyPositionId: 'br-pos-new',
    })
    expect(result.status).toBe(200)

    expect(dispatchRun).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'find_existing_ordinances' }),
    )
    dispatchRun.mockRestore()
  })

  it('warns when an invalidated org re-dispatched nothing', async () => {
    const slug = 'eo-nothing'
    const eo = await seedServeOrg(slug, 'pos-old')
    await seedDerivedData(slug, eo.id)

    const warn = vi.spyOn(
      service.app.get(ElectedOfficeService)['logger'],
      'warn',
    )

    // No position resolves, so nothing can dispatch.
    const result = await service.client.patch(`/v1/organizations/${slug}`, {
      ballotReadyPositionId: null,
      customPositionName: 'Village Trustee',
    })
    expect(result.status).toBe(200)

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ organizationSlug: slug }),
      expect.stringContaining('no_redispatch'),
    )
    warn.mockRestore()
  })
})
