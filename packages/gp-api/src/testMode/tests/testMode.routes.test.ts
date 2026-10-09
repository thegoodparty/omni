import { CampaignsService } from '@/campaigns/services/campaigns.service'
import { CrmCampaignsService } from '@/campaigns/services/crmCampaigns.service'
import { ElectedOfficeService } from '@/electedOffice/services/electedOffice.service'
import { ElectionsService } from '@/elections/services/elections.service'
import { RacesService } from '@/elections/services/races.service'
import { FeaturesService } from '@/features/services/features.service'
import { useTestService } from '@/test-service'
import {
  CreateTestOrganizationRequest,
  RaceListItem,
  TestModeState,
} from '@goodparty_org/contracts'
import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DomainStatus,
  OutreachStatus,
  OutreachType,
  TcrComplianceStatus,
  WebsiteStatus,
} from '../../generated/prisma'
import { TEST_ORGANIZATION_CAP } from '../services/testMode.service'

const service = useTestService()

const RACE: RaceListItem = {
  id: 'race_1',
  brPositionId: 'br_pos_1',
  position: {
    name: 'Cheyenne City Council - Ward 1',
    level: 'city',
    state: 'WY',
  },
  election: { electionDay: '2027-11-02' },
}

const campaignBundle = (
  overrides: Partial<
    Extract<CreateTestOrganizationRequest, { type: 'campaign' }>
  > = {},
): CreateTestOrganizationRequest => ({
  type: 'campaign',
  race: { zip: '82001', office: RACE.position.name },
  onboarding: 'complete',
  pro: 'off',
  election: 'in_8_weeks',
  tenDlc: 'none',
  ...overrides,
})

const officeBundle = (
  overrides: Partial<
    Extract<CreateTestOrganizationRequest, { type: 'elected_office' }>
  > = {},
): CreateTestOrganizationRequest => ({
  type: 'elected_office',
  onboarding: 'complete',
  term: 'active',
  ...overrides,
})

const campaignIdOf = (slug: string) =>
  parseInt(slug.replace('campaign-', ''), 10)

let isFeatureEnabled: ReturnType<typeof vi.fn>
let trackCampaign: ReturnType<typeof vi.fn>
let setIsPro: ReturnType<typeof vi.fn>
let electedOfficeCreate: ReturnType<typeof vi.fn>

const createOrg = async (body: CreateTestOrganizationRequest) => {
  const res = await service.client.post<TestModeState>(
    '/v1/test-mode/organizations',
    body,
  )
  expect(res.status).toBe(HttpStatus.CREATED)
  const active = res.data.active
  if (!active) {
    throw new Error('create returned no active organization')
  }
  return active
}

const apply = (slug: string, body: object) =>
  service.client.post<TestModeState>('/v1/test-mode/apply', body, {
    headers: { 'x-organization-slug': slug },
  })

const createRealOrg = async () => {
  const slug = `real-${Date.now()}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
  await service.prisma.campaign.create({
    data: { slug, organizationSlug: slug, userId: service.user.id },
  })
  return slug
}

beforeEach(() => {
  isFeatureEnabled = vi
    .spyOn(service.app.get(FeaturesService), 'isFeatureEnabled')
    .mockResolvedValue(true) as unknown as ReturnType<typeof vi.fn>
  vi.spyOn(service.app.get(RacesService), 'getRacesByZip').mockResolvedValue([
    RACE,
  ])
  vi.spyOn(
    service.app.get(ElectionsService),
    'getPositionByBallotReadyId',
  ).mockResolvedValue({
    id: 'pos_internal_1',
  } as unknown as Awaited<
    ReturnType<ElectionsService['getPositionByBallotReadyId']>
  >)
  trackCampaign = vi
    .spyOn(service.app.get(CrmCampaignsService), 'trackCampaign')
    .mockResolvedValue(undefined) as unknown as ReturnType<typeof vi.fn>
  setIsPro = vi.spyOn(
    service.app.get(CampaignsService),
    'setIsPro',
  ) as unknown as ReturnType<typeof vi.fn>
  electedOfficeCreate = vi.spyOn(
    service.app.get(ElectedOfficeService),
    'create',
  ) as unknown as ReturnType<typeof vi.fn>
})

describe('GET /v1/test-mode', () => {
  it('returns an empty state for a staff user with no test orgs', async () => {
    const res = await service.client.get<TestModeState>('/v1/test-mode')

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data).toEqual({ organizations: [], active: null })
  })

  it('refuses when the staff-test-mode flag is off', async () => {
    isFeatureEnabled.mockResolvedValue(false)

    const res = await service.client.get('/v1/test-mode')

    expect(res.status).toBe(HttpStatus.FORBIDDEN)
  })

  it('reports the active org families when the header names a test org', async () => {
    const created = await createOrg(campaignBundle({ pro: 'on' }))

    const res = await service.client.get<TestModeState>('/v1/test-mode', {
      headers: { 'x-organization-slug': created.slug },
    })

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.organizations).toHaveLength(1)
    expect(res.data.active?.families.pro?.current).toBe('on')
    expect(res.data.active?.families.onboarding?.current).toBe('complete')
    expect(res.data.active?.families.election?.current).toBe('in_8_weeks')
    expect(res.data.active?.families.tenDlc?.current).toBe('none')
  })
})

describe('POST /v1/test-mode/organizations', () => {
  it('creates a marked campaign org on the chosen race without CRM tracking', async () => {
    const created = await createOrg(campaignBundle())

    const org = await service.prisma.organization.findUniqueOrThrow({
      where: { slug: created.slug },
      include: { campaign: true },
    })
    expect(org.testModeCreatedAt).not.toBeNull()
    expect(org.ownerId).toBe(service.user.id)
    expect(org.positionId).toBe('pos_internal_1')
    expect(org.campaign?.isActive).toBe(true)
    expect(org.campaign?.details.raceId).toBe(RACE.id)
    expect(org.campaign?.details.pledged).toBe(true)
    expect(org.campaign?.details.wonGeneral).toBeUndefined()
    expect(trackCampaign).not.toHaveBeenCalled()
  })

  it('leaves a not-started campaign in onboarding step one', async () => {
    const created = await createOrg(
      campaignBundle({ onboarding: 'not_started' }),
    )

    const org = await service.prisma.organization.findUniqueOrThrow({
      where: { slug: created.slug },
      include: { campaign: true },
    })
    expect(org.positionId).toBeNull()
    expect(org.campaign?.isActive).toBe(false)
    expect(org.campaign?.details.pledged).toBeUndefined()
    expect(org.campaign?.data.launchStatus).toBeUndefined()
    expect(created.families.onboarding?.current).toBe('not_started')
  })

  it('creates an elected office org directly, never through the office service', async () => {
    const created = await createOrg(officeBundle({ term: 'ending_soon' }))

    const org = await service.prisma.organization.findUniqueOrThrow({
      where: { slug: created.slug },
      include: { electedOffice: true },
    })
    expect(org.testModeCreatedAt).not.toBeNull()
    expect(org.electedOffice?.onboardingCompletedAt).not.toBeNull()
    expect(org.electedOffice?.termEndDate).not.toBeNull()
    expect(created.type).toBe('elected_office')
    expect(created.families.term?.current).toBe('ending_soon')
    expect(electedOfficeCreate).not.toHaveBeenCalled()
  })

  it('creates the linked campaign and office pair for a won race', async () => {
    const created = await createOrg(campaignBundle({ election: 'passed_won' }))

    const campaignId = campaignIdOf(created.slug)
    const office = await service.prisma.electedOffice.findFirstOrThrow({
      where: { campaignId },
      include: { organization: true },
    })
    expect(office.organization.testModeCreatedAt).not.toBeNull()
    expect(office.selfReported).toBe(false)
    const campaign = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaignId },
    })
    expect(campaign.details.wonGeneral).toBe(true)
    expect(created.families.election?.current).toBe('passed_won')

    const state = await service.client.get<TestModeState>('/v1/test-mode')
    expect(state.data.organizations.map((o) => o.type)).toEqual([
      'campaign',
      'elected_office',
    ])
  })

  it('refuses the sixteenth test org', async () => {
    await Promise.all(
      Array.from({ length: TEST_ORGANIZATION_CAP }, (_, i) =>
        service.prisma.organization.create({
          data: {
            slug: `eo-cap-${i}`,
            ownerId: service.user.id,
            testModeCreatedAt: new Date(),
          },
        }),
      ),
    )

    const res = await service.client.post(
      '/v1/test-mode/organizations',
      officeBundle(),
    )

    expect(res.status).toBe(HttpStatus.CONFLICT)
  })
})

describe('POST /v1/test-mode/apply', () => {
  it('refuses a real organization', async () => {
    const slug = await createRealOrg()

    const res = await apply(slug, { family: 'pro', preset: 'on' })

    expect(res.status).toBe(HttpStatus.CONFLICT)
  })

  it('writes isPro directly, never through setIsPro', async () => {
    const created = await createOrg(campaignBundle())

    const res = await apply(created.slug, { family: 'pro', preset: 'on' })

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.active?.families.pro?.current).toBe('on')
    const campaign = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaignIdOf(created.slug) },
    })
    expect(campaign.isPro).toBe(true)
    expect(setIsPro).not.toHaveBeenCalled()
  })

  it('deletes wonGeneral when an upcoming election replaces a won one', async () => {
    const created = await createOrg(campaignBundle({ election: 'passed_won' }))

    const res = await apply(created.slug, {
      family: 'election',
      preset: 'in_8_weeks',
    })

    expect(res.status).toBe(HttpStatus.OK)
    const campaign = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaignIdOf(created.slug) },
    })
    expect('wonGeneral' in campaign.details).toBe(false)
    expect(campaign.didWin).toBeNull()
    expect(res.data.active?.families.election?.current).toBe('in_8_weeks')
  })

  it('writes a synthetic awaiting-PIN compliance row', async () => {
    const created = await createOrg(campaignBundle())
    const campaignId = campaignIdOf(created.slug)

    const res = await apply(created.slug, {
      family: 'tenDlc',
      preset: 'awaiting_pin',
    })

    expect(res.status).toBe(HttpStatus.OK)
    const row = await service.prisma.tcrCompliance.findUniqueOrThrow({
      where: { campaignId },
    })
    expect(row.internalTestingAt).not.toBeNull()
    expect(row.peerlyIdentityId).toBe(`test-mode-${campaignId}`)
    expect(row.status).toBe(TcrComplianceStatus.submitted)
    expect(res.data.active?.families.tenDlc?.current).toBe('awaiting_pin')

    const cleared = await apply(created.slug, {
      family: 'tenDlc',
      preset: 'none',
    })
    expect(cleared.data.active?.families.tenDlc?.current).toBe('none')
    expect(
      await service.prisma.tcrCompliance.findUnique({ where: { campaignId } }),
    ).toBeNull()
  })

  it('refuses to overwrite a real compliance registration on a test org', async () => {
    const created = await createOrg(campaignBundle())
    await service.prisma.tcrCompliance.create({
      data: {
        campaignId: campaignIdOf(created.slug),
        ein: '12-3456789',
        postalAddress: '123 Main St',
        committeeName: 'Friends of Test',
        websiteDomain: 'example.org',
        filingUrl: 'https://sos.example.gov/filing',
        phone: '555-000-1234',
        email: 'real@example.com',
        officeLevel: 'local',
      },
    })

    const res = await apply(created.slug, {
      family: 'tenDlc',
      preset: 'approved',
    })

    expect(res.status).toBe(HttpStatus.CONFLICT)
  })

  it('refuses a family that does not fit the org type', async () => {
    const created = await createOrg(officeBundle())

    const res = await apply(created.slug, { family: 'pro', preset: 'on' })

    expect(res.status).toBe(HttpStatus.CONFLICT)
  })
})

describe('DELETE /v1/test-mode/organizations/:slug', () => {
  it('refuses a real organization', async () => {
    const slug = await createRealOrg()

    const res = await service.client.delete(
      `/v1/test-mode/organizations/${slug}`,
    )

    expect(res.status).toBe(HttpStatus.CONFLICT)
  })

  it('refuses while a real subscription, live domain or outreach exists', async () => {
    const created = await createOrg(campaignBundle())
    const campaignId = campaignIdOf(created.slug)
    const url = `/v1/test-mode/organizations/${created.slug}`

    await service.prisma.campaign.update({
      where: { id: campaignId },
      data: { details: { subscriptionId: 'sub_123' } },
    })
    expect((await service.client.delete(url)).status).toBe(HttpStatus.CONFLICT)
    await service.prisma.campaign.update({
      where: { id: campaignId },
      data: { details: {} },
    })

    const website = await service.prisma.website.create({
      data: {
        campaignId,
        vanityPath: `test-mode-${campaignId}`,
        status: WebsiteStatus.unpublished,
      },
    })
    const domain = await service.prisma.domain.create({
      data: {
        websiteId: website.id,
        name: `test-mode-${campaignId}.org`,
        status: DomainStatus.registered,
      },
    })
    expect((await service.client.delete(url)).status).toBe(HttpStatus.CONFLICT)
    await service.prisma.domain.delete({ where: { id: domain.id } })

    const outreach = await service.prisma.outreach.create({
      data: {
        campaignId,
        outreachType: OutreachType.text,
        status: OutreachStatus.pending,
      },
    })
    expect((await service.client.delete(url)).status).toBe(HttpStatus.CONFLICT)
    await service.prisma.outreach.update({
      where: { id: outreach.id },
      data: { status: OutreachStatus.completed },
    })

    expect((await service.client.delete(url)).status).toBe(HttpStatus.OK)
  })

  it('unlinks the won-race office before the campaign org cascades away', async () => {
    const created = await createOrg(campaignBundle({ election: 'passed_won' }))
    const campaignId = campaignIdOf(created.slug)
    const office = await service.prisma.electedOffice.findFirstOrThrow({
      where: { campaignId },
    })

    const res = await service.client.delete<TestModeState>(
      `/v1/test-mode/organizations/${created.slug}`,
    )

    expect(res.status).toBe(HttpStatus.OK)
    expect(
      await service.prisma.organization.findUnique({
        where: { slug: created.slug },
      }),
    ).toBeNull()
    expect(
      await service.prisma.campaign.findUnique({ where: { id: campaignId } }),
    ).toBeNull()
    const survivor = await service.prisma.electedOffice.findUniqueOrThrow({
      where: { id: office.id },
    })
    expect(survivor.campaignId).toBeNull()
    expect(res.data.organizations.map((o) => o.type)).toEqual([
      'elected_office',
    ])
  })
})
