import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useTestService } from '@/test-service'
import { Campaign, OfficeLevel, UserRole } from '../../../generated/prisma'

const service = useTestService()

const OLD_NAME = 'The Committee to Elect Jane Doe'
const NEW_NAME = 'Committee to Elect Jane Doe for Council'

const renameUrl = (campaignId: number) =>
  `/v1/campaigns/tcr-compliance/admin/${campaignId}/committee-name`

describe('PATCH /v1/campaigns/tcr-compliance/admin/:campaignId/committee-name', () => {
  let campaign: Campaign

  const createComplianceRecord = (campaignId: number, suffix: string) =>
    service.prisma.tcrCompliance.create({
      data: {
        campaignId,
        ein: '12-3456789',
        postalAddress: '123 Main St',
        committeeName: OLD_NAME,
        websiteDomain: 'example.org',
        filingUrl: 'https://sos.example.gov/filing',
        phone: '555-000-1234',
        email: `candidate-${suffix}@example.com`,
        officeLevel: OfficeLevel.local,
      },
    })

  beforeEach(async () => {
    // AdminOrM2MGuard reads the session user's CURRENT roles.
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { roles: [UserRole.admin] },
    })
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`
    const slug = `rename-${suffix}`
    await service.prisma.organization.create({
      data: { slug, ownerId: service.user.id },
    })
    campaign = await service.prisma.campaign.create({
      data: {
        slug,
        organizationSlug: slug,
        userId: service.user.id,
        details: { campaignCommittee: OLD_NAME },
      },
    })
  })

  afterEach(async () => {
    await service.prisma.tcrCompliance.deleteMany({
      where: { campaignId: campaign.id },
    })
  })

  it('updates both persisted copies of the committee name', async () => {
    await createComplianceRecord(campaign.id, campaign.slug)

    const res = await service.client.patch(renameUrl(campaign.id), {
      committeeName: NEW_NAME,
    })

    expect(res.status).toBe(200)
    expect(res.data.committeeName).toBe(NEW_NAME)

    const record = await service.prisma.tcrCompliance.findUniqueOrThrow({
      where: { campaignId: campaign.id },
    })
    expect(record.committeeName).toBe(NEW_NAME)

    const updatedCampaign = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    expect(updatedCampaign.details.campaignCommittee).toBe(NEW_NAME)
  })

  it('trims the submitted name before persisting', async () => {
    await createComplianceRecord(campaign.id, campaign.slug)

    const res = await service.client.patch(renameUrl(campaign.id), {
      committeeName: `  ${NEW_NAME}  `,
    })

    expect(res.status).toBe(200)
    expect(res.data.committeeName).toBe(NEW_NAME)
  })

  it('returns 404 when the campaign has no compliance record', async () => {
    const res = await service.client.patch(renameUrl(campaign.id), {
      committeeName: NEW_NAME,
    })

    expect(res.status).toBe(404)
  })

  it('rejects a whitespace-only name without writing either copy', async () => {
    await createComplianceRecord(campaign.id, campaign.slug)

    const res = await service.client.patch(renameUrl(campaign.id), {
      committeeName: '   ',
    })

    expect(res.status).toBe(400)
    const record = await service.prisma.tcrCompliance.findUniqueOrThrow({
      where: { campaignId: campaign.id },
    })
    expect(record.committeeName).toBe(OLD_NAME)
  })

  it('is admin-gated', async () => {
    await createComplianceRecord(campaign.id, campaign.slug)
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { roles: [UserRole.candidate] },
    })

    const res = await service.client.patch(renameUrl(campaign.id), {
      committeeName: NEW_NAME,
    })

    expect(res.status).toBe(403)
    const record = await service.prisma.tcrCompliance.findUniqueOrThrow({
      where: { campaignId: campaign.id },
    })
    expect(record.committeeName).toBe(OLD_NAME)
  })
})
