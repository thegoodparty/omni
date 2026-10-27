import { UnprocessableEntityException } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AreaCodeFromZipService } from '@/ai/util/areaCodeFromZip.util'
import {
  Campaign,
  CommitteeType,
  DomainStatus,
  OfficeLevel,
  TcrCompliance,
  VendorMockVendor,
  WebsiteStatus,
} from '@/generated/prisma'
import { useTestService } from '@/test-service'
import { VendorMockRecordService } from '@/vendorMocks/vendorMockRecord.service'
import { PeerlyBaseConfig } from '@/vendors/peerly/config/peerlyBaseConfig'
import { PeerlyIdentityService } from '@/vendors/peerly/services/peerlyIdentity.service'
import { VercelService } from '@/vendors/vercel/services/vercel.service'
import { WebsitesService } from '@/websites/services/websites.service'
import { ComplianceStateService } from '../services/complianceState.service'
import { CampaignTcrComplianceService } from '../services/campaignTcrCompliance.service'
import { useAppEnvOverrides } from '@/shared/test-utils/appEnvOverrides'

// The Peerly and Vercel mocks write records only on a non-prod deploy; the test
// env isn't one. VENDOR_MODE resolves to mock in the test env, so
// the real code path runs against the mocks.
useAppEnvOverrides({ IS_NON_PROD_DEPLOY: true })

const service = useTestService()

const MOCK_PIN = '123456'
const PEERLY = '/v1/vendor-mocks/peerly'
const ACTIONS = '/v1/test-fixtures/vendor-mocks/actions'
const DOMAIN = 'mock-mode-bypass.example'

let counter = 0

// ENG-11402: in mock mode the non-prod fake-success bypasses no longer apply, so
// the compliance service runs its real code against the Peerly and Vercel mocks.
describe('10DLC non-prod bypasses in mock mode', () => {
  let campaign: Campaign
  let tcr: TcrCompliance
  let identityId: string

  beforeEach(async () => {
    vi.spyOn(
      service.app.get(AreaCodeFromZipService),
      'getAreaCodeFromZip',
    ).mockResolvedValue(['512'])
    // The test app listens on a random port while vendorBaseUrl targets
    // localhost:3000, so swap the port; the rest is the real client.
    vi.spyOn(PeerlyBaseConfig.prototype, 'baseUrl', 'get').mockReturnValue(
      `${String(service.client.defaults.baseURL)}${PEERLY}`,
    )
    vi.spyOn(
      PeerlyBaseConfig.prototype,
      'accountNumber',
      'get',
    ).mockReturnValue('12345678')
    vi.spyOn(PeerlyBaseConfig.prototype, 'email', 'get').mockReturnValue('mock')
    vi.spyOn(PeerlyBaseConfig.prototype, 'password', 'get').mockReturnValue(
      'mock',
    )

    counter += 1
    const ein = `12-${String(4_000_000 + counter)}`
    const slug = `bypass-mock-${counter}-${Math.random().toString(36).slice(2)}`
    await service.prisma.organization.create({
      data: { slug, ownerId: service.user.id },
    })
    campaign = await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug,
        organizationSlug: slug,
        details: {
          campaignCommittee: 'Friends of Test',
          electionDate: '2030-11-05',
        },
      },
    })
    tcr = await service.prisma.tcrCompliance.create({
      data: {
        campaignId: campaign.id,
        ein,
        postalAddress: '1 Main St, Austin, TX 78701',
        committeeName: 'Friends of Test',
        websiteDomain: 'friendsoftest.example',
        filingUrl: 'https://filing.example/test',
        phone: '+15125550123',
        email: 'candidate@example.com',
        officeLevel: OfficeLevel.state,
        committeeType: CommitteeType.CANDIDATE,
      },
    })

    const peerly = service.app.get(PeerlyIdentityService)
    const identity = await peerly.createIdentity(
      `TEST-Johnny Goodparty - ${ein}`,
      campaign,
    )
    if (!identity) throw new Error('mock returned no identity')
    identityId = identity.identity_id
    await peerly.submitIdentityProfile(identityId, campaign)
    await peerly.submitCampaignVerifyRequest(
      {
        email: 'candidate@example.com',
        ein,
        phone: '+15125550123',
        peerlyIdentityId: identityId,
        filingUrl: 'https://filing.example/test',
        officeLevel: OfficeLevel.state,
        fecCommitteeId: null,
        committeeType: CommitteeType.CANDIDATE,
        filingAddressLine1: '1 Main St',
        filingAddressLine2: null,
        filingCity: 'Austin',
        filingState: 'TX',
        filingZip: '78701',
      },
      service.user,
      campaign,
      'friendsoftest.example',
    )
    tcr = await service.prisma.tcrCompliance.update({
      where: { id: tcr.id },
      data: { peerlyIdentityId: identityId },
    })
  })

  afterEach(async () => {
    await service.app
      .get(VendorMockRecordService)
      .model.deleteMany({ where: { externalId: { in: [identityId, DOMAIN] } } })
  })

  const seedWebsite = async (
    status: WebsiteStatus,
    domainFields: Partial<{
      status: DomainStatus
      registrantVerifiedAt: Date
    }> = {},
  ) => {
    const website = await service.prisma.website.create({
      data: {
        campaignId: campaign.id,
        vanityPath: `bypass-${counter}-${Math.random().toString(36).slice(2)}`,
        status,
      },
    })
    await service.prisma.domain.create({
      data: { name: DOMAIN, websiteId: website.id, ...domainFields },
    })
  }

  afterEach(async () => {
    await service.prisma.domain.deleteMany({ where: { name: DOMAIN } })
    await service.prisma.website.deleteMany({
      where: { campaignId: campaign.id },
    })
  })

  const approve = () =>
    service.client.post(ACTIONS, {
      campaignId: campaign.id,
      action: 'peerly.cv.approve',
    })

  it('rejects a wrong PIN with the real 422 instead of accepting any PIN', async () => {
    await approve()

    await expect(
      service.app
        .get(CampaignTcrComplianceService)
        .retrieveCampaignVerifyToken('000000', tcr),
    ).rejects.toThrow(UnprocessableEntityException)
  })

  it('mints a token through verify_pin and create_cv_token once the CV is approved', async () => {
    await approve()

    const token = await service.app
      .get(CampaignTcrComplianceService)
      .retrieveCampaignVerifyToken(MOCK_PIN, tcr)

    expect(token).toBeTruthy()
    expect(token).not.toBe('non-prod-bypass-cv-token')
    const profile = await service.app
      .get(PeerlyIdentityService)
      .getIdentityProfile(identityId, campaign)
    expect(profile?.profile?.campaignVerifyToken).toBe(token)
  })

  it('refuses a PIN before the mock has approved the CV', async () => {
    await expect(
      service.app
        .get(CampaignTcrComplianceService)
        .retrieveCampaignVerifyToken(MOCK_PIN, tcr),
    ).rejects.toThrow()
  })

  it('reports the CV status from the mock in compliance-state, not a hardcoded APPROVED', async () => {
    await seedWebsite(WebsiteStatus.published, {
      status: DomainStatus.registered,
      registrantVerifiedAt: new Date(),
    })
    const state = () =>
      service.app.get(ComplianceStateService).findStateForCampaign(campaign.id)

    expect(await state()).toMatchObject({
      stage: 'awaiting_pin',
      peerlyCvStatus: 'IN_REVIEW',
    })
    await approve()
    expect(await state()).toMatchObject({ peerlyCvStatus: 'APPROVED' })
  })

  describe('verifyLive', () => {
    const attachInVercelMock = () =>
      service.app.get(VendorMockRecordService).upsert(
        VendorMockVendor.vercel,
        'project_domain',
        DOMAIN,
        {
          name: DOMAIN,
          projectId: service.app.get(VercelService).getProjectId(),
          verified: true,
          createdAt: Date.now(),
        },
        campaign.id,
      )

    it('verifies a published site whose domain is attached in the Vercel mock', async () => {
      await seedWebsite(WebsiteStatus.published)
      await attachInVercelMock()

      const result = await service.app
        .get(WebsitesService)
        .verifyLive(campaign.id)

      expect(result).toMatchObject({
        verified: true,
        reason: null,
        url: `https://${DOMAIN}/`,
      })
    })

    it('fails an unpublished site with not_live', async () => {
      await seedWebsite(WebsiteStatus.unpublished)
      await attachInVercelMock()

      const result = await service.app
        .get(WebsitesService)
        .verifyLive(campaign.id)

      expect(result).toMatchObject({ verified: false, reason: 'not_live' })
      expect(result.checks.http_200).toBe(false)
    })

    it('fails a published site whose domain was never attached with unreachable', async () => {
      await seedWebsite(WebsiteStatus.published)

      const result = await service.app
        .get(WebsitesService)
        .verifyLive(campaign.id)

      expect(result).toMatchObject({ verified: false, reason: 'unreachable' })
    })
  })
})
