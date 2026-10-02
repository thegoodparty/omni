import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useTestService } from '@/test-service'
import { Campaign, OfficeLevel, UserRole } from '../../../generated/prisma'

const service = useTestService()

const OLD_URL = 'https://sos.example.gov/filings/jane-doe'
const NEW_URL = 'https://sos.example.gov/candidates/jane-doe/2026'
const HELD_AT = new Date('2026-09-01T00:00:00Z')
const HOLD_REASONS = ['The page shows no evidence of a filing']

const filingUrlRoute = (campaignId: number) =>
  `/v1/campaigns/tcr-compliance/admin/${campaignId}/filing-url`

describe('PATCH /v1/campaigns/tcr-compliance/admin/:campaignId/filing-url', () => {
  let campaign: Campaign

  const createHeldComplianceRecord = (
    campaignId: number,
    suffix: string,
    overrides: { peerlyIdentityId?: string } = {},
  ) =>
    service.prisma.tcrCompliance.create({
      data: {
        campaignId,
        ein: '12-3456789',
        postalAddress: '123 Main St',
        committeeName: 'Committee to Elect Jane Doe',
        websiteDomain: 'janedoe2026.org',
        filingUrl: OLD_URL,
        phone: '555-000-1234',
        email: `candidate-${suffix}@example.com`,
        officeLevel: OfficeLevel.local,
        cvValidationFailedAt: HELD_AT,
        cvValidationFailureReasons: HOLD_REASONS,
        cvValidationOverriddenAt: HELD_AT,
        cvValidationTransientCount: 2,
        ...overrides,
      },
    })

  const fetchRecord = () =>
    service.prisma.tcrCompliance.findUniqueOrThrow({
      where: { campaignId: campaign.id },
    })

  beforeEach(async () => {
    // AdminOrM2MGuard reads the session user's CURRENT roles.
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { roles: [UserRole.admin] },
    })
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`
    const slug = `filing-url-${suffix}`
    await service.prisma.organization.create({
      data: { slug, ownerId: service.user.id },
    })
    campaign = await service.prisma.campaign.create({
      data: {
        slug,
        organizationSlug: slug,
        userId: service.user.id,
        details: {},
      },
    })
  })

  afterEach(async () => {
    await service.prisma.tcrCompliance.deleteMany({
      where: { campaignId: campaign.id },
    })
  })

  it('updates the URL and clears the hold and override columns', async () => {
    await createHeldComplianceRecord(campaign.id, campaign.slug)

    const res = await service.client.patch(filingUrlRoute(campaign.id), {
      filingUrl: NEW_URL,
    })

    expect(res.status).toBe(200)
    expect(res.data.filingUrl).toBe(NEW_URL)

    const record = await fetchRecord()
    expect(record.filingUrl).toBe(NEW_URL)
    expect(record.cvValidationFailedAt).toBeNull()
    expect(record.cvValidationFailureReasons).toEqual([])
    expect(record.cvValidationOverriddenAt).toBeNull()
    expect(record.cvValidationTransientCount).toBe(0)
  })

  it('leaves the hold intact when the URL is unchanged', async () => {
    await createHeldComplianceRecord(campaign.id, campaign.slug)

    const res = await service.client.patch(filingUrlRoute(campaign.id), {
      filingUrl: OLD_URL,
    })

    expect(res.status).toBe(200)
    expect(res.data.filingUrl).toBe(OLD_URL)

    const record = await fetchRecord()
    expect(record.cvValidationFailedAt).toEqual(HELD_AT)
    expect(record.cvValidationFailureReasons).toEqual(HOLD_REASONS)
  })

  it('refuses with 409 once a Peerly identity exists', async () => {
    await createHeldComplianceRecord(campaign.id, campaign.slug, {
      peerlyIdentityId: 'identity-123',
    })

    const res = await service.client.patch(filingUrlRoute(campaign.id), {
      filingUrl: NEW_URL,
    })

    expect(res.status).toBe(409)
    expect((await fetchRecord()).filingUrl).toBe(OLD_URL)
  })

  it.each([
    ['a goodparty.org page', 'https://goodparty.org/candidate/jane-doe'],
    ['an FEC URL on a local record', 'https://www.fec.gov/data/candidate/x'],
    ["the candidate's own site", 'https://janedoe2026.org/about'],
    ['a URL without a path', 'https://sos.example.gov'],
  ])('rejects %s without writing', async (_label, badUrl) => {
    await createHeldComplianceRecord(campaign.id, campaign.slug)

    const res = await service.client.patch(filingUrlRoute(campaign.id), {
      filingUrl: badUrl,
    })

    expect(res.status).toBe(400)
    const record = await fetchRecord()
    expect(record.filingUrl).toBe(OLD_URL)
    expect(record.cvValidationFailedAt).toEqual(HELD_AT)
  })

  it('returns 404 when the campaign has no compliance record', async () => {
    const res = await service.client.patch(filingUrlRoute(campaign.id), {
      filingUrl: NEW_URL,
    })

    expect(res.status).toBe(404)
  })

  it('is admin-gated', async () => {
    await createHeldComplianceRecord(campaign.id, campaign.slug)
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { roles: [UserRole.candidate] },
    })

    const res = await service.client.patch(filingUrlRoute(campaign.id), {
      filingUrl: NEW_URL,
    })

    expect(res.status).toBe(403)
    expect((await fetchRecord()).filingUrl).toBe(OLD_URL)
  })
})
