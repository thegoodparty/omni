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
} from '@/vendors/peerly/schemas/peerlyIdentity.schema'
import {
  approve10DLCBrandResponseBodySchema,
  peerly10DLCBrandSubmitResponseBodySchema,
} from '@/vendors/peerly/schemas/peerlyTdlc.schema'
import { PeerlyIdentityService } from '@/vendors/peerly/services/peerlyIdentity.service'
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
const RECORDS = '/v1/test-fixtures/vendor-mocks/records'

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
