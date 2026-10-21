import { HttpStatus } from '@nestjs/common'
import axios from 'axios'
import { getUnixTime, subMinutes } from 'date-fns'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AreaCodeFromZipService } from '@/ai/util/areaCodeFromZip.util'
import {
  Campaign,
  CommitteeType,
  OfficeLevel,
  VendorMockVendor,
} from '@/generated/prisma'
import { useTestService } from '@/test-service'
import { PeerlyBaseConfig } from '@/vendors/peerly/config/peerlyBaseConfig'
import {
  peerlyGetIdentitiesResponseBodySchema,
  peerlyIdentityCreateResponseBodySchema,
  peerlyIdentityProfileResponseBodySchema,
  peerlyIdentityUseCaseResponseBodySchema,
} from '@/vendors/peerly/schemas/peerlyIdentity.schema'
import {
  approve10DLCBrandResponseBodySchema,
  peerly10DLCBrandSubmitResponseBodySchema,
  peerlyCreateCVTokenResponseSchema,
  peerlyResendPinResponseBodySchema,
  peerlyRetrieveCvResponseBodySchema,
  peerlySubmitCVResponseBodySchema,
  peerlyVerifyCVPinResponseSchema,
} from '@/vendors/peerly/schemas/peerlyTdlc.schema'
import { PeerlyIdentityService } from '@/vendors/peerly/services/peerlyIdentity.service'
import { isPeerlyCvPinRejection } from '@/vendors/peerly/utils/peerlyCvPinRejection.util'
import { signHs256Jwt } from './peerlyMockAuth.util'

const { mockMode } = vi.hoisted(() => ({ mockMode: { value: 'mock' } }))
vi.mock('@/shared/util/appEnvironment.util', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/shared/util/appEnvironment.util')>()
  return {
    ...actual,
    get IS_NON_PROD_DEPLOY() {
      return true
    },
    get VENDOR_MODE() {
      return mockMode.value as 'mock' | 'live'
    },
  }
})

const service = useTestService()

const BASE = '/v1/vendor-mocks/peerly'
const ACTIONS = '/v1/test-fixtures/vendor-mocks/actions'
const RECORDS = '/v1/test-fixtures/vendor-mocks/records'
const MOCK_PIN = '123456'

let einCounter = 0

type Seeded = { campaign: Campaign; ein: string; identityName: string }

// The campaign link is the EIN at the end of the identity name, so every test
// seeds its own campaign and TcrCompliance row under a distinct EIN.
const seedCampaignWithTcr = async (): Promise<Seeded> => {
  einCounter += 1
  const ein = `12-${String(3_000_000 + einCounter)}`
  const slug = `peerly-mock-${einCounter}-${Math.random().toString(36).slice(2)}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
  const campaign = await service.prisma.campaign.create({
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
  await service.prisma.tcrCompliance.create({
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
  return { campaign, ein, identityName: `TEST-Johnny Goodparty - ${ein}` }
}

const manualAddress = {
  addressLine1: '1 Main St',
  city: 'Austin',
  state: 'TX',
  zip: '78701',
}

const getRecords = async (campaignId: number) => {
  const res = await service.client.get<{
    records: { kind: string; externalId: string; state: unknown }[]
  }>(RECORDS, { params: { campaignId } })
  return res.data.records
}

const applyAction = (
  campaignId: number,
  action: string,
  params?: Record<string, unknown>,
) =>
  service.client.post(
    ACTIONS,
    { campaignId, action, params },
    { validateStatus: () => true },
  )

const mintJwt = async () => {
  const res = await service.client.post<{ token: string }>(
    `${BASE}/token-auth`,
    {},
  )
  return { Authorization: `JWT ${res.data.token}` }
}

// Points the real client at the in-process mock, so the mock is exercised by
// the exact request shapes and response handling production uses.
const useMockAsPeerly = () => {
  const baseUrl = `${service.client.defaults.baseURL}${BASE}`
  vi.spyOn(PeerlyBaseConfig.prototype, 'baseUrl', 'get').mockReturnValue(
    baseUrl,
  )
  vi.spyOn(PeerlyBaseConfig.prototype, 'accountNumber', 'get').mockReturnValue(
    '12345678',
  )
  vi.spyOn(PeerlyBaseConfig.prototype, 'email', 'get').mockReturnValue('mock')
  vi.spyOn(PeerlyBaseConfig.prototype, 'password', 'get').mockReturnValue(
    'mock',
  )
  return service.app.get(PeerlyIdentityService)
}

const createIdentity = async (
  peerly: PeerlyIdentityService,
  { campaign, identityName }: Seeded,
) => {
  const identity = await peerly.createIdentity(identityName, campaign)
  if (!identity) throw new Error('mock returned no identity')
  return identity
}

const submitBrand = (
  peerly: PeerlyIdentityService,
  identityId: string,
  { campaign, ein }: Seeded,
) =>
  peerly.submit10DlcBrand(
    identityId,
    {
      phone: '(512) 555-0123',
      websiteDomain: 'friendsoftest.example',
      ein,
      manualAddress,
    } as Parameters<PeerlyIdentityService['submit10DlcBrand']>[1],
    campaign,
    'friendsoftest.example',
  )

beforeEach(() => {
  mockMode.value = 'mock'
  vi.spyOn(
    service.app.get(AreaCodeFromZipService),
    'getAreaCodeFromZip',
  ).mockResolvedValue(['512'])
})

describe('Peerly 10DLC mock: gating and auth', () => {
  it('returns 404 when VENDOR_MODE is live', async () => {
    mockMode.value = 'live'
    const res = await service.client.get(`${BASE}/identities/listByAccount`, {
      headers: await mintJwt(),
      validateStatus: () => true,
    })
    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })

  it.each([
    ['a malformed token', { Authorization: 'JWT not-a-jwt' }],
    ['a token with a forged signature', { Authorization: 'JWT a.b.c' }],
    ['the wrong auth scheme', { Authorization: 'Bearer abc' }],
  ])('rejects a request with %s', async (_label, headers) => {
    const res = await service.client.get(`${BASE}/identities/listByAccount`, {
      headers,
      validateStatus: () => true,
    })
    expect(res.status).toBe(HttpStatus.UNAUTHORIZED)
  })

  it('rejects a request with no Authorization header', async () => {
    const res = await axios.get(
      `${service.client.defaults.baseURL}${BASE}/identities/listByAccount`,
      { validateStatus: () => true },
    )
    expect(res.status).toBe(HttpStatus.UNAUTHORIZED)
  })

  it('rejects a correctly signed but expired token', async () => {
    const expired = signHs256Jwt({
      exp: getUnixTime(subMinutes(new Date(), 1)),
    })
    const res = await service.client.get(`${BASE}/identities/listByAccount`, {
      headers: { Authorization: `JWT ${expired}` },
      validateStatus: () => true,
    })
    expect(res.status).toBe(HttpStatus.UNAUTHORIZED)
  })

  it('accepts a token minted by token-auth', async () => {
    const res = await service.client.get(`${BASE}/identities/listByAccount`, {
      headers: await mintJwt(),
    })
    expect(res.status).toBe(HttpStatus.OK)
  })
})

describe('Peerly 10DLC mock: identity, profile and brand (M4-3)', () => {
  it('creates an identity that the campaign records endpoint shows', async () => {
    const peerly = useMockAsPeerly()
    const seeded = await seedCampaignWithTcr()

    const identity = await createIdentity(peerly, seeded)

    expect(identity.identity_id).toMatch(/^\d+$/)
    expect(identity.identity_name).toBe(seeded.identityName)
    const records = await getRecords(seeded.campaign.id)
    expect(records).toEqual([
      expect.objectContaining({
        kind: 'identity',
        externalId: identity.identity_id,
      }),
    ])
  })

  it('returns bodies that parse against the identity schemas', async () => {
    const seeded = await seedCampaignWithTcr()
    const headers = await mintJwt()

    const created = await service.client.post(
      `${BASE}/identities`,
      {
        account_id: '12345678',
        identity_name: seeded.identityName,
        usecases: ['POLITICAL'],
      },
      { headers },
    )
    const { Data } = peerlyIdentityCreateResponseBodySchema.parse(created.data)
    const listed = await service.client.get(
      `${BASE}/identities/listByAccount`,
      { headers, params: { account_id: '12345678' } },
    )
    const { identities } = peerlyGetIdentitiesResponseBodySchema.parse(
      listed.data,
    )
    expect(identities.map((i) => i.identity_id)).toContain(Data.identity_id)

    const submitted = await service.client.post(
      `${BASE}/identities/${Data.identity_id}/submitProfile`,
      { entityType: 'NON_PROFIT', is_political: true },
      { headers },
    )
    expect(
      peerlyIdentityProfileResponseBodySchema.parse(submitted.data).profile
        ?.status,
    ).toBe('pending')
    const fetched = await service.client.get(
      `${BASE}/identities/${Data.identity_id}/getProfile`,
      { headers },
    )
    expect(
      peerlyIdentityProfileResponseBodySchema.parse(fetched.data).profile
        ?.campaignVerifyToken,
    ).toBeNull()
  })

  it('lists identities created by earlier attempts so the client can reuse them', async () => {
    const peerly = useMockAsPeerly()
    const seeded = await seedCampaignWithTcr()
    const identity = await createIdentity(peerly, seeded)

    const identities = await peerly.getIdentities(seeded.campaign)

    expect(
      identities.find((i) => i.identity_name === seeded.identityName)
        ?.identity_id,
    ).toBe(identity.identity_id)
  })

  it('stores profile and brand records, with the EIN on the brand request', async () => {
    const peerly = useMockAsPeerly()
    const seeded = await seedCampaignWithTcr()
    const identity = await createIdentity(peerly, seeded)

    const profile = await peerly.submitIdentityProfile(
      identity.identity_id,
      seeded.campaign,
    )
    const submissionKey = await submitBrand(
      peerly,
      identity.identity_id,
      seeded,
    )

    expect(profile?.profile?.status).toBe('pending')
    expect(submissionKey).toBeTruthy()
    const records = await getRecords(seeded.campaign.id)
    expect(records.map((r) => r.kind).sort()).toEqual([
      'brand',
      'identity',
      'profile',
    ])
    const brand = records.find((r) => r.kind === 'brand')
    expect(brand?.state).toMatchObject({
      status: 'pending',
      request: { ein: seeded.ein, entityType: 'NON_PROFIT' },
    })
    const stored = await service.prisma.vendorMockRecord.findFirstOrThrow({
      where: { kind: 'brand', externalId: identity.identity_id },
    })
    expect(stored.requests).toEqual([
      expect.objectContaining({ ein: seeded.ein }),
    ])
  })

  it('rejects approve without a campaign verify token, in Peerly error shape', async () => {
    const peerly = useMockAsPeerly()
    const seeded = await seedCampaignWithTcr()
    const identity = await createIdentity(peerly, seeded)
    await peerly.submitIdentityProfile(identity.identity_id, seeded.campaign)
    await submitBrand(peerly, identity.identity_id, seeded)

    const res = await service.client.post(
      `${BASE}/v2/tdlc/${identity.identity_id}/approve`,
      { campaign_verify_token: '' },
      { headers: await mintJwt(), validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(res.data).toEqual({
      Error: expect.stringContaining('campaign_verify_token'),
      status_code: HttpStatus.BAD_REQUEST,
    })
    const profile = await peerly.getIdentityProfile(
      identity.identity_id,
      seeded.campaign,
    )
    expect(profile?.profile?.status).toBe('pending')
  })

  it('walks approve to waiting_to_finalize and finalize to finalized', async () => {
    const peerly = useMockAsPeerly()
    const seeded = await seedCampaignWithTcr()
    const identity = await createIdentity(peerly, seeded)
    await peerly.submitIdentityProfile(identity.identity_id, seeded.campaign)
    await submitBrand(peerly, identity.identity_id, seeded)
    const headers = await mintJwt()

    const approved = await service.client.post(
      `${BASE}/v2/tdlc/${identity.identity_id}/approve`,
      { campaign_verify_token: 'cv-token', usecase: 'POLITICAL' },
      { headers },
    )
    const body = approve10DLCBrandResponseBodySchema.parse(approved.data)
    expect(body.campaign_verify_token).toBe('cv-token')
    expect(body.ein).toBe(seeded.ein)
    expect(
      (await peerly.getIdentityProfile(identity.identity_id, seeded.campaign))
        ?.profile?.status,
    ).toBe('waiting_to_finalize')
    const brand = (await getRecords(seeded.campaign.id)).find(
      (r) => r.kind === 'brand',
    )
    expect(brand?.state).toMatchObject({ status: 'approved' })

    const finalized = await service.client.get(
      `${BASE}/v2/tdlc/${identity.identity_id}/finalize`,
      { headers },
    )
    expect(finalized.status).toBe(HttpStatus.OK)
    expect(typeof finalized.data).toBe('string')
    expect(
      (await peerly.getIdentityProfile(identity.identity_id, seeded.campaign))
        ?.profile?.status,
    ).toBe('finalized')
  })

  it('re-opens a finalized brand to pending on a token-only submit', async () => {
    const peerly = useMockAsPeerly()
    const seeded = await seedCampaignWithTcr()
    const identity = await createIdentity(peerly, seeded)
    await peerly.submitIdentityProfile(identity.identity_id, seeded.campaign)
    await submitBrand(peerly, identity.identity_id, seeded)
    const headers = await mintJwt()
    await service.client.post(
      `${BASE}/v2/tdlc/${identity.identity_id}/approve`,
      { campaign_verify_token: 'cv-token' },
      { headers },
    )
    await service.client.get(
      `${BASE}/v2/tdlc/${identity.identity_id}/finalize`,
      { headers },
    )

    const submit = await service.client.post(
      `${BASE}/v2/tdlc/${identity.identity_id}/submit`,
      { campaign_verify_token: 'cv-token' },
      { headers },
    )

    peerly10DLCBrandSubmitResponseBodySchema.parse(submit.data)
    expect(
      (await peerly.getIdentityProfile(identity.identity_id, seeded.campaign))
        ?.profile?.status,
    ).toBe('pending')
    const brand = (await getRecords(seeded.campaign.id)).find(
      (r) => r.kind === 'brand',
    )
    expect(brand?.state).toMatchObject({ request: { ein: seeded.ein } })
  })

  it('returns a 404 the client handles for an unknown identity id', async () => {
    const peerly = useMockAsPeerly()
    const { campaign } = await seedCampaignWithTcr()

    await expect(
      peerly.getIdentityProfile('99999999', campaign),
    ).rejects.toThrow(
      'Identity profile for given identity ID could not be found',
    )
    await expect(
      peerly.getIdentityUseCases('99999999', campaign),
    ).rejects.toThrow('Use cases for given identity ID could not be found')

    const res = await service.client.post(
      `${BASE}/identities/99999999/submitProfile`,
      {},
      { headers: await mintJwt(), validateStatus: () => true },
    )
    expect(res.status).toBe(HttpStatus.NOT_FOUND)
    expect(res.data).toEqual({
      Error: 'Identity not found',
      status_code: HttpStatus.NOT_FOUND,
    })
  })

  it('links records to the campaign through the saved peerlyIdentityId once the EIN is not enough', async () => {
    const peerly = useMockAsPeerly()
    const seeded = await seedCampaignWithTcr()
    // An identity created before any TcrCompliance row matched has no campaign.
    const orphan = await service.prisma.vendorMockRecord.create({
      data: {
        vendor: VendorMockVendor.peerly,
        kind: 'identity',
        externalId: '70000001',
        state: {
          identity_id: '70000001',
          identity_name: 'No ein here',
          start_date: '2030-01-01',
          account_id: '12345678',
          tcr_identity_status: null,
        },
      },
    })
    await service.prisma.tcrCompliance.update({
      where: { campaignId: seeded.campaign.id },
      data: { peerlyIdentityId: orphan.externalId },
    })

    await peerly.submitIdentityProfile(orphan.externalId, seeded.campaign)

    const records = await getRecords(seeded.campaign.id)
    expect(records.map((r) => r.kind)).toEqual(['profile'])
  })
})

// M4-4 TESTS BEGIN

const submitCv = (
  peerly: PeerlyIdentityService,
  identityId: string,
  { campaign, ein }: Seeded,
) =>
  peerly.submitCampaignVerifyRequest(
    {
      email: 'candidate@example.com',
      ein,
      phone: '+15125550123',
      peerlyIdentityId: identityId,
      filingUrl: 'https://filing.example/test',
      officeLevel: OfficeLevel.state,
      fecCommitteeId: null,
      committeeType: CommitteeType.CANDIDATE,
      filingAddressLine1: manualAddress.addressLine1,
      filingAddressLine2: null,
      filingCity: manualAddress.city,
      filingState: manualAddress.state,
      filingZip: manualAddress.zip,
    },
    service.user,
    campaign,
    'friendsoftest.example',
  )

// Brings a campaign to a submitted CV request (IN_REVIEW) on a fresh identity.
const withSubmittedCv = async () => {
  const peerly = useMockAsPeerly()
  const seeded = await seedCampaignWithTcr()
  const identity = await createIdentity(peerly, seeded)
  const identityId = identity.identity_id
  await peerly.submitIdentityProfile(identityId, seeded.campaign)
  const cv = await submitCv(peerly, identityId, seeded)
  return { peerly, seeded, identityId, cv }
}

const cvStatus = (
  peerly: PeerlyIdentityService,
  identityId: string,
  campaign: Campaign,
) => peerly.retrieveCampaignVerifyStatus(identityId, campaign)

describe('Peerly 10DLC mock: CV request, PIN and use cases (M4-4)', () => {
  it('reports no CV request before submit_cv, as a first-time registration', async () => {
    const peerly = useMockAsPeerly()
    const seeded = await seedCampaignWithTcr()
    const identity = await createIdentity(peerly, seeded)

    expect(
      await peerly.getCampaignVerifyRequest(
        identity.identity_id,
        seeded.campaign,
      ),
    ).toBeNull()
    expect(
      await cvStatus(peerly, identity.identity_id, seeded.campaign),
    ).toBeNull()
  })

  it('walks submit_cv, approve, verify_pin and create_cv_token to a token on getProfile', async () => {
    const { peerly, seeded, identityId, cv } = await withSubmittedCv()
    const { campaign } = seeded
    expect(cv?.verification_id).toBeTruthy()
    expect(await cvStatus(peerly, identityId, campaign)).toBe('IN_REVIEW')
    expect(
      (await getRecords(campaign.id)).find((r) => r.kind === 'cv_request')
        ?.state,
    ).toMatchObject({ status: 'IN_REVIEW', pin: MOCK_PIN })

    const approve = await applyAction(campaign.id, 'peerly.cv.approve')
    expect(approve.status).toBe(HttpStatus.CREATED)
    expect(await cvStatus(peerly, identityId, campaign)).toBe('APPROVED')

    expect(
      await peerly.verifyCampaignVerifyPin(identityId, MOCK_PIN, campaign),
    ).toBe(true)
    expect(await cvStatus(peerly, identityId, campaign)).toBe('VERIFIED')

    const token = await peerly.createCampaignVerifyToken(identityId, campaign)
    expect(token).toBeTruthy()
    const profile = await peerly.getIdentityProfile(identityId, campaign)
    expect(profile?.profile?.campaignVerifyToken).toBe(token)
  })

  it('returns bodies that parse against the 10DLC schemas', async () => {
    const { seeded, identityId } = await withSubmittedCv()
    const headers = await mintJwt()
    const url = (path: string) => `${BASE}/v2/tdlc/${identityId}/${path}`

    const inReview = await service.client.get(url('retrieve_cv'), { headers })
    expect(
      peerlyRetrieveCvResponseBodySchema.parse(inReview.data),
    ).toMatchObject({ verification_status: 'IN_REVIEW' })
    expect(inReview.data.verification_data).toBeUndefined()

    await applyAction(seeded.campaign.id, 'peerly.cv.approve')
    const approved = await service.client.get(url('retrieve_cv'), { headers })
    expect(
      peerlyRetrieveCvResponseBodySchema.parse(approved.data),
    ).toMatchObject({
      verification_status: 'APPROVED',
      verification_data: {
        verification_method: 'email',
        filing_email: 'candidate@example.com',
      },
    })

    const resend = await service.client.post(url('resend_pin'), {}, { headers })
    peerlyResendPinResponseBodySchema.parse(resend.data)
    const verify = await service.client.post(
      url('verify_pin'),
      { code: MOCK_PIN },
      { headers },
    )
    expect(
      peerlyVerifyCVPinResponseSchema.parse(verify.data).cv_verification_status,
    ).toBe('VERIFIED')
    const token = await service.client.post(
      url('create_cv_token'),
      {},
      { headers },
    )
    peerlyCreateCVTokenResponseSchema.parse(token.data)
    peerlySubmitCVResponseBodySchema.parse({
      message: 'x',
      verification_id: 'y',
    })
  })

  it('auto-approves a CV request 2 minutes after it was created', async () => {
    const { peerly, seeded, identityId } = await withSubmittedCv()
    const { campaign } = seeded
    const cv = await service.prisma.vendorMockRecord.findFirstOrThrow({
      where: { kind: 'cv_request', externalId: identityId },
    })

    await service.prisma.vendorMockRecord.update({
      where: { id: cv.id },
      data: { createdAt: subMinutes(new Date(), 1) },
    })
    expect(await cvStatus(peerly, identityId, campaign)).toBe('IN_REVIEW')

    await service.prisma.vendorMockRecord.update({
      where: { id: cv.id },
      data: { createdAt: subMinutes(new Date(), 3) },
    })
    expect(await cvStatus(peerly, identityId, campaign)).toBe('APPROVED')
    expect(
      await peerly.verifyCampaignVerifyPin(identityId, MOCK_PIN, campaign),
    ).toBe(true)
  })

  it('rejects a wrong PIN with the nested 4xx envelope and no Slack alert', async () => {
    const { peerly, seeded, identityId } = await withSubmittedCv()
    const { campaign } = seeded
    await applyAction(campaign.id, 'peerly.cv.approve')
    const slack = vi.spyOn(
      (peerly as unknown as { slackService: { message: () => unknown } })
        .slackService,
      'message',
    )

    const err = await peerly
      .verifyCampaignVerifyPin(identityId, '000000', campaign)
      .catch((e: unknown) => e)
    expect(err).toMatchObject({ status: HttpStatus.UNPROCESSABLE_ENTITY })
    expect(slack).not.toHaveBeenCalled()

    const res = await service.client.post(
      `${BASE}/v2/tdlc/${identityId}/verify_pin`,
      { code: '000000' },
      { headers: await mintJwt(), validateStatus: () => true },
    )
    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(res.data).toEqual({
      Error: expect.stringContaining('Campaign Verify'),
      status_code: HttpStatus.BAD_REQUEST,
    })
    expect(await cvStatus(peerly, identityId, campaign)).toBe('APPROVED')
  })

  it('flags a wrong PIN as a CV PIN rejection through the real HTTP client', async () => {
    const { seeded, identityId } = await withSubmittedCv()
    await applyAction(seeded.campaign.id, 'peerly.cv.approve')

    const err = await service.client
      .post(
        `${BASE}/v2/tdlc/${identityId}/verify_pin`,
        { code: '000000' },
        {
          headers: await mintJwt(),
          validateStatus: (status) => status < HttpStatus.BAD_REQUEST,
        },
      )
      .catch((e: unknown) => e)

    expect(isPeerlyCvPinRejection(err)).toBe(true)
  })

  it('refuses verify_pin until the request is APPROVED', async () => {
    const { seeded, identityId } = await withSubmittedCv()
    const headers = await mintJwt()

    const res = await service.client.post(
      `${BASE}/v2/tdlc/${identityId}/verify_pin`,
      { code: MOCK_PIN },
      { headers, validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(res.data.Error).toContain('IN_REVIEW')
    const cv = (await getRecords(seeded.campaign.id)).find(
      (r) => r.kind === 'cv_request',
    )
    expect(cv?.state).toMatchObject({ status: 'IN_REVIEW' })
  })

  it('is one-shot: a VERIFIED request rejects a re-entered PIN', async () => {
    const { peerly, seeded, identityId } = await withSubmittedCv()
    const { campaign } = seeded
    await applyAction(campaign.id, 'peerly.cv.approve')
    await peerly.verifyCampaignVerifyPin(identityId, MOCK_PIN, campaign)

    const res = await service.client.post(
      `${BASE}/v2/tdlc/${identityId}/verify_pin`,
      { code: MOCK_PIN },
      { headers: await mintJwt(), validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(await cvStatus(peerly, identityId, campaign)).toBe('VERIFIED')
  })

  it('peerly.cv.setPin makes the default PIN fail and the new one pass', async () => {
    const { peerly, seeded, identityId } = await withSubmittedCv()
    const { campaign } = seeded
    await applyAction(campaign.id, 'peerly.cv.approve')

    const setPin = await applyAction(campaign.id, 'peerly.cv.setPin', {
      pin: '999999',
    })
    expect(setPin.status).toBe(HttpStatus.CREATED)

    await expect(
      peerly.verifyCampaignVerifyPin(identityId, MOCK_PIN, campaign),
    ).rejects.toMatchObject({ status: HttpStatus.UNPROCESSABLE_ENTITY })
    expect(
      await peerly.verifyCampaignVerifyPin(identityId, '999999', campaign),
    ).toBe(true)
  })

  it.each([undefined, '12345', '1234567', 'abcdef', 123456])(
    'rejects peerly.cv.setPin with pin %s',
    async (pin) => {
      const { seeded } = await withSubmittedCv()

      const res = await applyAction(seeded.campaign.id, 'peerly.cv.setPin', {
        pin,
      })

      expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    },
  )

  it('peerly.cv.reject sets REJECTED with a reason and the clock does not override it', async () => {
    const { peerly, seeded, identityId } = await withSubmittedCv()
    const { campaign } = seeded

    const res = await applyAction(campaign.id, 'peerly.cv.reject', {
      reason: 'Filing not found',
    })
    expect(res.status).toBe(HttpStatus.CREATED)
    await service.prisma.vendorMockRecord.updateMany({
      where: { kind: 'cv_request', externalId: identityId },
      data: { createdAt: subMinutes(new Date(), 30) },
    })

    expect(await cvStatus(peerly, identityId, campaign)).toBe('REJECTED')
    expect(
      (await getRecords(campaign.id)).find((r) => r.kind === 'cv_request')
        ?.state,
    ).toMatchObject({ status: 'REJECTED', rejectionReason: 'Filing not found' })
  })

  it('restarts the auto-approve clock when a CV request is resubmitted', async () => {
    const { peerly, seeded, identityId } = await withSubmittedCv()
    const { campaign } = seeded
    await service.prisma.vendorMockRecord.updateMany({
      where: { kind: 'cv_request', externalId: identityId },
      data: { createdAt: subMinutes(new Date(), 30) },
    })

    await submitCv(peerly, identityId, seeded)

    expect(await cvStatus(peerly, identityId, campaign)).toBe('IN_REVIEW')
  })

  it('refuses create_cv_token before the request is VERIFIED', async () => {
    const { peerly, seeded, identityId } = await withSubmittedCv()
    const { campaign } = seeded
    await applyAction(campaign.id, 'peerly.cv.approve')

    await expect(
      peerly.createCampaignVerifyToken(identityId, campaign),
    ).rejects.toThrow()

    const profile = await peerly.getIdentityProfile(identityId, campaign)
    expect(profile?.profile?.campaignVerifyToken).toBeNull()
  })

  it('reports the use case PENDING after approve, then ACTIVE after the control action', async () => {
    const { peerly, seeded, identityId } = await withSubmittedCv()
    const { campaign } = seeded
    const headers = await mintJwt()
    expect(await peerly.getIdentityUseCases(identityId, campaign)).toEqual([])
    await submitBrand(peerly, identityId, seeded)
    await service.client.post(
      `${BASE}/v2/tdlc/${identityId}/approve`,
      { campaign_verify_token: 'cv-token' },
      { headers },
    )

    const pending = await service.client.get(
      `${BASE}/v2/tdlc/${identityId}/get_usecases`,
      { headers },
    )
    expect(peerlyIdentityUseCaseResponseBodySchema.parse(pending.data)).toEqual(
      [expect.objectContaining({ usecase: 'POLITICAL', activated: 0 })],
    )

    const activate = await applyAction(campaign.id, 'peerly.usecase.activate')
    expect(activate.status).toBe(HttpStatus.CREATED)

    const useCases = await peerly.getIdentityUseCases(identityId, campaign)
    expect(useCases).toEqual([
      expect.objectContaining({ usecase: 'POLITICAL', activated: 1 }),
    ])
    expect(
      (await getRecords(campaign.id)).find((r) => r.kind === 'usecase')?.state,
    ).toEqual({ status: 'ACTIVE' })
  })

  it('auto-activates the use case 5 minutes after the brand approve', async () => {
    const { peerly, seeded, identityId } = await withSubmittedCv()
    const { campaign } = seeded
    await submitBrand(peerly, identityId, seeded)
    await service.client.post(
      `${BASE}/v2/tdlc/${identityId}/approve`,
      { campaign_verify_token: 'cv-token' },
      { headers: await mintJwt() },
    )
    const usecase = await service.prisma.vendorMockRecord.findFirstOrThrow({
      where: { kind: 'usecase', externalId: identityId },
    })

    await service.prisma.vendorMockRecord.update({
      where: { id: usecase.id },
      data: { createdAt: subMinutes(new Date(), 4) },
    })
    expect(
      (await peerly.getIdentityUseCases(identityId, campaign))[0]?.activated,
    ).toBe(0)

    await service.prisma.vendorMockRecord.update({
      where: { id: usecase.id },
      data: { createdAt: subMinutes(new Date(), 6) },
    })
    expect(
      (await peerly.getIdentityUseCases(identityId, campaign))[0]?.activated,
    ).toBe(1)
  })

  it.each(['peerly.cv.approve', 'peerly.cv.reject', 'peerly.usecase.activate'])(
    '%s returns 404 when the campaign has nothing to act on',
    async (action) => {
      const { campaign } = await seedCampaignWithTcr()

      const res = await applyAction(campaign.id, action)

      expect(res.status).toBe(HttpStatus.NOT_FOUND)
    },
  )

  it('scopes control actions to the caller campaign', async () => {
    const mine = await withSubmittedCv()
    const other = await withSubmittedCv()

    await applyAction(mine.seeded.campaign.id, 'peerly.cv.approve')

    expect(
      await cvStatus(mine.peerly, mine.identityId, mine.seeded.campaign),
    ).toBe('APPROVED')
    expect(
      await cvStatus(other.peerly, other.identityId, other.seeded.campaign),
    ).toBe('IN_REVIEW')
  })
})
