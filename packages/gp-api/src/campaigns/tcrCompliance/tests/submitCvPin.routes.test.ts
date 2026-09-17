import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { OfficeLevel, TcrCompliance } from '../../../generated/prisma'
import { PeerlyCvVerificationStatus } from '../../../vendors/peerly/peerly.types'
import { PeerlyIdentityService } from '../../../vendors/peerly/services/peerlyIdentity.service'

const service = useTestService()

const PIN = '123456'
const PEERLY_IDENTITY_ID = 'peerly-identity-cvpin'

const submitPinUrl = (id: string) =>
  `/v1/campaigns/tcr-compliance/${id}/submit-cv-pin`

describe('POST /v1/campaigns/tcr-compliance/:id/submit-cv-pin', () => {
  let record: TcrCompliance
  let headers: { 'x-organization-slug': string }
  let peerly: PeerlyIdentityService

  beforeEach(async () => {
    // The route short-circuits every Peerly call outside prod, so the guard
    // under test only runs with the prod environment stubbed.
    vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'prod')

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`
    const slug = `cvpin-${suffix}`
    headers = { 'x-organization-slug': slug }
    await service.prisma.organization.create({
      data: { slug, ownerId: service.user.id },
    })
    const campaign = await service.prisma.campaign.create({
      data: { slug, organizationSlug: slug, userId: service.user.id },
    })
    record = await service.prisma.tcrCompliance.create({
      data: {
        campaignId: campaign.id,
        ein: '12-3456789',
        postalAddress: '123 Main St',
        committeeName: 'Friends of Tyshea',
        websiteDomain: 'example.org',
        filingUrl: 'https://sos.example.gov/filing',
        phone: '555-000-1234',
        email: `candidate-${suffix}@example.com`,
        officeLevel: OfficeLevel.local,
        peerlyIdentityId: `${PEERLY_IDENTITY_ID}-${suffix}`,
      },
    })

    peerly = service.app.get(PeerlyIdentityService)
    vi.spyOn(peerly, 'verifyCampaignVerifyPin').mockResolvedValue(true)
    vi.spyOn(peerly, 'createCampaignVerifyToken').mockResolvedValue('cv-token')
    vi.spyOn(peerly, 'submitCampaignVerifyTokenToBrand').mockResolvedValue(
      undefined,
    )
  })

  afterEach(async () => {
    // Deliberately not vi.restoreAllMocks() — the test harness's auth-provider
    // spy is installed once in beforeAll, and restoring it 401s every
    // subsequent request.
    vi.unstubAllEnvs()
    await service.prisma.tcrCompliance.deleteMany({ where: { id: record.id } })
  })

  // retrieveCampaignVerifyToken reads the enriched retrieve_cv (one call
  // yields both the status and the PIN delivery channel), so the gate is
  // driven off `details.status`, not the status-only variant.
  const stubCvStatus = (status: PeerlyCvVerificationStatus | null) =>
    vi
      .spyOn(peerly, 'retrieveCampaignVerifyDetails')
      .mockResolvedValue({ status, pinDelivery: null })

  it('verifies the PIN with Peerly when the CV status is APPROVED', async () => {
    stubCvStatus(PeerlyCvVerificationStatus.APPROVED)

    const res = await service.client.post(
      submitPinUrl(record.id),
      { pin: PIN },
      { headers },
    )

    expect(res.status).toBe(200)
    expect(peerly.verifyCampaignVerifyPin).toHaveBeenCalledWith(
      record.peerlyIdentityId,
      PIN,
      expect.objectContaining({ id: record.campaignId }),
    )
    expect(peerly.createCampaignVerifyToken).toHaveBeenCalled()
  })

  it('returns 422 when Peerly rejects the PIN against an APPROVED CV', async () => {
    stubCvStatus(PeerlyCvVerificationStatus.APPROVED)
    vi.spyOn(peerly, 'verifyCampaignVerifyPin').mockResolvedValue(false)

    const res = await service.client.post(
      submitPinUrl(record.id),
      { pin: PIN },
      { headers },
    )

    expect(res.status).toBe(422)
    expect(res.data.message).toMatch(/invalid pin/i)
  })

  it('skips verification and mints the token when the CV is already VERIFIED', async () => {
    stubCvStatus(PeerlyCvVerificationStatus.VERIFIED)

    const res = await service.client.post(
      submitPinUrl(record.id),
      { pin: PIN },
      { headers },
    )

    expect(res.status).toBe(200)
    expect(peerly.verifyCampaignVerifyPin).not.toHaveBeenCalled()
    expect(peerly.createCampaignVerifyToken).toHaveBeenCalled()
  })

  // ENG-10866: everything that is not VERIFIED used to fall through to
  // verify_pin, so a candidate whose CV was still IN_REVIEW got "That PIN
  // didn't match" for a PIN that had never been issued.
  it.each([
    [PeerlyCvVerificationStatus.REQUESTED],
    [PeerlyCvVerificationStatus.IN_REVIEW],
    [PeerlyCvVerificationStatus.REJECTED],
    [PeerlyCvVerificationStatus.WITHDRAWN],
    [null],
  ])(
    'returns 409 without contacting Peerly when the CV status is %s',
    async (cvStatus) => {
      stubCvStatus(cvStatus)

      const res = await service.client.post(
        submitPinUrl(record.id),
        { pin: PIN },
        { headers },
      )

      expect(res.status).toBe(409)
      expect(res.data.message).toMatch(/hasn't issued your PIN yet/i)
      expect(peerly.verifyCampaignVerifyPin).not.toHaveBeenCalled()
      expect(peerly.createCampaignVerifyToken).not.toHaveBeenCalled()
      expect(peerly.submitCampaignVerifyTokenToBrand).not.toHaveBeenCalled()
    },
  )

  it('leaves the record at `submitted` when no PIN has been issued', async () => {
    stubCvStatus(PeerlyCvVerificationStatus.IN_REVIEW)

    await service.client.post(
      submitPinUrl(record.id),
      { pin: PIN },
      { headers },
    )

    const after = await service.prisma.tcrCompliance.findUniqueOrThrow({
      where: { id: record.id },
    })
    expect(after.status).toBe('submitted')
  })
})
