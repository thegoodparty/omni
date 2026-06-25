import { useTestService } from '@/test-service'
import { Campaign, TcrComplianceStatus } from '../../generated/prisma'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const service = useTestService()

const DEV_APPROVE_URL = '/v1/campaigns/tcr-compliance/mine/dev-approve'

describe('POST /campaigns/tcr-compliance/mine/dev-approve', () => {
  let campaign: Campaign
  let headers: { 'x-organization-slug': string }

  beforeEach(async () => {
    const suffix = Date.now()
    const orgSlug = `tcr-dev-approve-${suffix}`
    headers = { 'x-organization-slug': orgSlug }
    await service.prisma.organization.create({
      data: { slug: orgSlug, ownerId: service.user.id },
    })
    campaign = await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: `tcr-dev-approve-campaign-${suffix}`,
        organizationSlug: orgSlug,
      },
    })
    await service.prisma.tcrCompliance.create({
      data: {
        campaignId: campaign.id,
        status: TcrComplianceStatus.submitted,
        ein: '12-3456789',
        postalAddress: '123 Main St',
        committeeName: 'Test Committee',
        websiteDomain: 'example.com',
        filingUrl: 'https://example.gov/filing',
        phone: '5555555555',
        email: 'test@example.com',
        officeLevel: 'local',
      },
    })
  })

  afterEach(() => {
    delete process.env.OTEL_SERVICE_ENVIRONMENT
  })

  it('makes the caller campaign pro + tcr approved with a synthetic id', async () => {
    const result = await service.client.post(DEV_APPROVE_URL, null, {
      headers,
    })

    expect(result.status).toBe(200)
    expect(result.data.status).toBe(TcrComplianceStatus.approved)
    expect(result.data.peerlyIdentityId).toBe(`e2e-approved-${campaign.id}`)

    const row = await service.prisma.tcrCompliance.findUnique({
      where: { campaignId: campaign.id },
    })
    expect(row?.status).toBe(TcrComplianceStatus.approved)
    expect(row?.peerlyIdentityId).toBe(`e2e-approved-${campaign.id}`)

    const updatedCampaign = await service.prisma.campaign.findUnique({
      where: { id: campaign.id },
    })
    expect(updatedCampaign?.isPro).toBe(true)
  })

  it('404s and leaves campaign + record untouched on a prod deploy', async () => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'prod'

    const result = await service.client.post(DEV_APPROVE_URL, null, {
      headers,
    })

    expect(result.status).toBe(404)

    const row = await service.prisma.tcrCompliance.findUnique({
      where: { campaignId: campaign.id },
    })
    expect(row?.status).toBe(TcrComplianceStatus.submitted)
    expect(row?.peerlyIdentityId).toBeNull()

    const untouchedCampaign = await service.prisma.campaign.findUnique({
      where: { id: campaign.id },
    })
    expect(untouchedCampaign?.isPro).toBe(false)
  })
})
