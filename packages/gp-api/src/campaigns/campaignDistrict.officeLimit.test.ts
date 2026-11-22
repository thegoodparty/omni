import { CrmCampaignsService } from '@/campaigns/services/crmCampaigns.service'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { useTestService } from '@/test-service'
import { describe, expect, it, vi } from 'vitest'

const service = useTestService()

const CAMPAIGN_ID = 98001
const ORG_SLUG = `campaign-${CAMPAIGN_ID}`

const seed = async (org: {
  positionId?: string
  overrideDistrictId?: string
  officeChangeCount?: number
}) => {
  await service.prisma.organization.create({
    data: { slug: ORG_SLUG, ownerId: service.user.id, ...org },
  })
  await service.prisma.campaign.create({
    data: {
      id: CAMPAIGN_ID,
      userId: service.user.id,
      slug: 'district-limit',
      details: { state: 'CA' },
      organizationSlug: ORG_SLUG,
    },
  })
  vi.spyOn(
    service.app.get(CrmCampaignsService),
    'trackCampaign',
  ).mockResolvedValue(undefined)
}

const pickDistrict = (resolvedDistrictId: string | null) => {
  vi.spyOn(
    service.app.get(OrganizationsService),
    'resolveOverrideDistrictId',
  ).mockResolvedValue(resolvedDistrictId)
  return service.client.put(
    '/v1/campaigns/mine/district',
    { L2DistrictType: 'City', L2DistrictName: 'Oakland' },
    { headers: { 'x-organization-slug': ORG_SLUG } },
  )
}

const org = () =>
  service.prisma.organization.findUniqueOrThrow({ where: { slug: ORG_SLUG } })

describe('PUT /v1/campaigns/mine/district office change limit', () => {
  it('spends a change when moving off the position district', async () => {
    await seed({ positionId: 'pos-1' })

    const result = await pickDistrict('district-2')

    expect(result.status).toBe(200)
    expect(await org()).toMatchObject({
      overrideDistrictId: 'district-2',
      officeChangeCount: 1,
    })
  })

  it('does not spend a change when the district stays the same', async () => {
    await seed({ positionId: 'pos-1', overrideDistrictId: 'district-2' })

    const result = await pickDistrict('district-2')

    expect(result.status).toBe(200)
    expect((await org()).officeChangeCount).toBe(0)
  })

  it('refuses the change once the limit is used up', async () => {
    await seed({
      positionId: 'pos-1',
      overrideDistrictId: 'district-2',
      officeChangeCount: 4,
    })

    const result = await pickDistrict('district-3')

    expect(result.status).toBe(403)
    expect(result.data).toMatchObject({
      code: 'OFFICE_CHANGE_LIMIT_REACHED',
    })
    expect(await org()).toMatchObject({
      overrideDistrictId: 'district-2',
      officeChangeCount: 4,
    })
  })
})
