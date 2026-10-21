import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VendorMockVendor } from '@/generated/prisma'
import { useTestService } from '@/test-service'
import {
  peerlyIdentityCreateResponseBodySchema,
  peerlyGetIdentitiesResponseBodySchema,
  peerlyIdentityProfileResponseBodySchema,
} from '@/vendors/peerly/schemas/peerlyIdentity.schema'
import {
  peerly10DLCBrandSubmitResponseBodySchema,
  approve10DLCBrandResponseBodySchema,
} from '@/vendors/peerly/schemas/peerlyTdlc.schema'

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

// Build a valid mock JWT via the P2P token-auth endpoint.
const getToken = async (): Promise<string> => {
  const res = await service.client.post(`${BASE}/token-auth`, {})
  return (res.data as { token: string }).token
}

// Axios helper that sets Authorization: JWT <token>.
const authed = (token: string) => ({
  headers: { authorization: `JWT ${token}` },
  validateStatus: () => true,
})

const seedCampaign = async () => {
  const slug = `tcr-${Math.random().toString(36).slice(2)}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
  return service.prisma.campaign.create({
    data: { userId: service.user.id, slug, organizationSlug: slug },
  })
}

const seedTcrCompliance = async (campaignId: number, ein: string) =>
  service.prisma.tcrCompliance.create({
    data: {
      campaignId,
      ein,
      postalAddress: '1 Main St',
      committeeName: 'Mock Committee',
      websiteDomain: 'example.com',
      filingUrl: 'https://example.com/filing',
      phone: '5555555555',
      email: 'mock@example.com',
      officeLevel: 'local',
    },
  })

// Minimal brand data matching Peerly10DlcBrandData
const BRAND_BODY = {
  entityType: 'NON_PROFIT',
  vertical: 'POLITICAL',
  is_political: true,
  displayName: 'Mock Committee',
  companyName: 'Mock Committee',
  ein: '12-3456789',
  phone: '+15555555555',
  street: '1 Main St',
  city: 'Springfield',
  state: 'IL',
  postalCode: '62701',
  website: 'https://example.com',
  email: 'info@example.com',
}

describe('JWT authentication', () => {
  beforeEach(() => {
    mockMode.value = 'mock'
  })

  it('returns 401 when Authorization header is missing', async () => {
    const res = await service.client.get(`${BASE}/identities/listByAccount`, {
      validateStatus: () => true,
    })
    expect(res.status).toBe(HttpStatus.UNAUTHORIZED)
  })

  it('returns 401 when the JWT signature is wrong', async () => {
    const res = await service.client.get(`${BASE}/identities/listByAccount`, {
      ...authed('bad.token.here'),
      validateStatus: () => true,
    })
    expect(res.status).toBe(HttpStatus.UNAUTHORIZED)
  })

  it('returns 404 when VENDOR_MODE is live (mock gate wins)', async () => {
    mockMode.value = 'live'
    const token = await getToken()
    mockMode.value = 'live'
    const res = await service.client.get(
      `${BASE}/identities/listByAccount`,
      authed(token),
    )
    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })
})

describe('POST /identities', () => {
  beforeEach(() => {
    mockMode.value = 'mock'
  })

  it('creates an identity and returns a body passing the M4-2 schema', async () => {
    const token = await getToken()
    const res = await service.client.post(
      `${BASE}/identities`,
      {
        account_id: 'mock-peerly',
        identity_name: 'Jane Smith - 12-3456789',
        usecases: ['POLITICAL'],
      },
      authed(token),
    )
    expect(res.status).toBe(HttpStatus.CREATED)
    const parsed = peerlyIdentityCreateResponseBodySchema.safeParse(res.data)
    expect(parsed.success).toBe(true)
    const data = res.data as { Data: { identity_id: string } }
    expect(typeof data.Data.identity_id).toBe('string')
    expect(data.Data.identity_id).toMatch(/^\d+$/)
  })

  it('stores the identity in vendor_mock_record', async () => {
    const token = await getToken()
    const res = await service.client.post(
      `${BASE}/identities`,
      {
        account_id: 'mock-peerly',
        identity_name: 'Jane Smith - 12-3456789',
        usecases: ['POLITICAL'],
      },
      authed(token),
    )
    const data = res.data as { Data: { identity_id: string } }
    const record = await service.prisma.vendorMockRecord.findUnique({
      where: {
        vendor_kind_externalId: {
          vendor: VendorMockVendor.peerly,
          kind: 'identity',
          externalId: data.Data.identity_id,
        },
      },
    })
    expect(record).toBeTruthy()
  })

  it('links the identity to the campaign via TcrCompliance EIN', async () => {
    const ein = `99-${Math.floor(Math.random() * 9_000_000) + 1_000_000}`
    const campaign = await seedCampaign()
    await seedTcrCompliance(campaign.id, ein)
    const token = await getToken()
    const res = await service.client.post(
      `${BASE}/identities`,
      {
        account_id: 'mock-peerly',
        identity_name: `John Doe - ${ein}`,
        usecases: ['POLITICAL'],
      },
      authed(token),
    )
    const data = res.data as { Data: { identity_id: string } }
    const record = await service.prisma.vendorMockRecord.findUnique({
      where: {
        vendor_kind_externalId: {
          vendor: VendorMockVendor.peerly,
          kind: 'identity',
          externalId: data.Data.identity_id,
        },
      },
    })
    expect(record?.campaignId).toBe(campaign.id)
  })
})

describe('GET /identities/listByAccount', () => {
  beforeEach(() => {
    mockMode.value = 'mock'
  })

  it('lists identities and passes the M4-2 schema', async () => {
    const token = await getToken()
    await service.client.post(
      `${BASE}/identities`,
      {
        account_id: 'mock-peerly',
        identity_name: 'List Test - 12-9876543',
        usecases: ['POLITICAL'],
      },
      authed(token),
    )
    const res = await service.client.get(
      `${BASE}/identities/listByAccount`,
      authed(token),
    )
    expect(res.status).toBe(HttpStatus.OK)
    const parsed = peerlyGetIdentitiesResponseBodySchema.safeParse(res.data)
    expect(parsed.success).toBe(true)
    const listData = res.data as { identities: { identity_name: string }[] }
    expect(
      listData.identities.some(
        (i) => i.identity_name === 'List Test - 12-9876543',
      ),
    ).toBe(true)
  })
})

describe('Identity → Profile → Brand submit → Approve → Finalize flow', () => {
  beforeEach(() => {
    mockMode.value = 'mock'
  })

  it('runs the full happy path: records exist and schemas pass', async () => {
    const ein = `88-${Math.floor(Math.random() * 9_000_000) + 1_000_000}`
    const campaign = await seedCampaign()
    await seedTcrCompliance(campaign.id, ein)
    const token = await getToken()

    // 1. Create identity
    const createRes = await service.client.post(
      `${BASE}/identities`,
      {
        account_id: 'mock-peerly',
        identity_name: `Happy Path - ${ein}`,
        usecases: ['POLITICAL'],
      },
      authed(token),
    )
    expect(createRes.status).toBe(HttpStatus.CREATED)
    const identityId = (createRes.data as { Data: { identity_id: string } })
      .Data.identity_id

    // 2. Submit profile
    const profileRes = await service.client.post(
      `${BASE}/identities/${identityId}/submitProfile`,
      { entityType: 'NON_PROFIT', is_political: true },
      authed(token),
    )
    expect(profileRes.status).toBe(HttpStatus.CREATED)
    expect(
      peerlyIdentityProfileResponseBodySchema.safeParse(profileRes.data)
        .success,
    ).toBe(true)
    const profileData = profileRes.data as { profile: { status: string } }
    expect(profileData.profile.status).toBe('pending')

    // 3. Get profile — no brand yet, so no vertical
    const getProfileRes = await service.client.get(
      `${BASE}/identities/${identityId}/getProfile`,
      authed(token),
    )
    expect(getProfileRes.status).toBe(HttpStatus.OK)
    expect(
      (getProfileRes.data as { profile: { vertical?: string } }).profile
        .vertical,
    ).toBeUndefined()

    // 4. Submit brand
    const brandRes = await service.client.post(
      `${BASE}/v2/tdlc/${identityId}/submit`,
      { ...BRAND_BODY, ein },
      authed(token),
    )
    expect(brandRes.status).toBe(HttpStatus.CREATED)
    expect(
      peerly10DLCBrandSubmitResponseBodySchema.safeParse(brandRes.data).success,
    ).toBe(true)

    // 5. Get profile — brand submitted, so vertical is present and EIN is visible
    const afterBrandRes = await service.client.get(
      `${BASE}/identities/${identityId}/getProfile`,
      authed(token),
    )
    expect(afterBrandRes.status).toBe(HttpStatus.OK)
    const afterBrand = afterBrandRes.data as {
      profile: { vertical: string; ein: string }
    }
    expect(afterBrand.profile.vertical).toBe('POLITICAL')
    expect(afterBrand.profile.ein).toBe(ein)

    // 6. Approve
    const approveRes = await service.client.post(
      `${BASE}/v2/tdlc/${identityId}/approve`,
      {
        campaign_verify_token: 'mock-cv-token-abc',
        entity_type: 'NON_PROFIT',
        usecase: 'POLITICAL',
        sample1: 'Hello {first_name}',
        sample2: 'Hello {first_name} again',
      },
      authed(token),
    )
    expect(approveRes.status).toBe(HttpStatus.CREATED)
    expect(
      approve10DLCBrandResponseBodySchema.safeParse(approveRes.data).success,
    ).toBe(true)

    // Profile advances to waiting_to_finalize after approve
    const afterApproveRes = await service.client.get(
      `${BASE}/identities/${identityId}/getProfile`,
      authed(token),
    )
    expect(
      (afterApproveRes.data as { profile: { status: string } }).profile.status,
    ).toBe('waiting_to_finalize')

    // 7. Finalize
    const finalizeRes = await service.client.get(
      `${BASE}/v2/tdlc/${identityId}/finalize`,
      authed(token),
    )
    expect(finalizeRes.status).toBe(HttpStatus.OK)

    // Profile advances to finalized
    const afterFinalizeRes = await service.client.get(
      `${BASE}/identities/${identityId}/getProfile`,
      authed(token),
    )
    expect(
      (afterFinalizeRes.data as { profile: { status: string } }).profile.status,
    ).toBe('finalized')
  })

  it('records are linked to the campaign and visible via test-fixtures', async () => {
    const ein = `77-${Math.floor(Math.random() * 9_000_000) + 1_000_000}`
    const campaign = await seedCampaign()
    await seedTcrCompliance(campaign.id, ein)
    const token = await getToken()

    // Create identity + brand to produce linked records
    const createRes = await service.client.post(
      `${BASE}/identities`,
      {
        account_id: 'mock-peerly',
        identity_name: `Fixture Test - ${ein}`,
        usecases: ['POLITICAL'],
      },
      authed(token),
    )
    const identityId = (createRes.data as { Data: { identity_id: string } })
      .Data.identity_id
    await service.client.post(
      `${BASE}/identities/${identityId}/submitProfile`,
      { entityType: 'NON_PROFIT', is_political: true },
      authed(token),
    )
    await service.client.post(
      `${BASE}/v2/tdlc/${identityId}/submit`,
      { ...BRAND_BODY, ein },
      authed(token),
    )

    const records = await service.prisma.vendorMockRecord.findMany({
      where: { campaignId: campaign.id },
    })
    const kinds = records.map((r) => r.kind)
    expect(kinds).toContain('identity')
    expect(kinds).toContain('profile')
    expect(kinds).toContain('brand')

    const brandRecord = records.find((r) => r.kind === 'brand')
    const brandState = brandRecord?.state as {
      ein?: string
    } | null
    expect(brandState?.ein).toBe(ein)
  })
})

describe('POST /v2/tdlc/:id/approve — empty campaign_verify_token', () => {
  beforeEach(() => {
    mockMode.value = 'mock'
  })

  it('returns 400 with Peerly error shape when token is empty', async () => {
    const token = await getToken()

    // Create an identity and brand first
    const createRes = await service.client.post(
      `${BASE}/identities`,
      {
        account_id: 'mock-peerly',
        identity_name: 'Reject Test - 12-1234567',
        usecases: ['POLITICAL'],
      },
      authed(token),
    )
    const identityId = (createRes.data as { Data: { identity_id: string } })
      .Data.identity_id
    await service.client.post(
      `${BASE}/v2/tdlc/${identityId}/submit`,
      BRAND_BODY,
      authed(token),
    )

    const res = await service.client.post(
      `${BASE}/v2/tdlc/${identityId}/approve`,
      {
        campaign_verify_token: '',
        entity_type: 'NON_PROFIT',
        usecase: 'POLITICAL',
        sample1: 'Hello',
        sample2: 'Hello again',
      },
      authed(token),
    )
    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect((res.data as { Error: string }).Error).toBeTruthy()
  })
})

describe('Unknown identity id', () => {
  beforeEach(() => {
    mockMode.value = 'mock'
  })

  it('returns 404 for submitProfile on unknown identity', async () => {
    const token = await getToken()
    const res = await service.client.post(
      `${BASE}/identities/99999999/submitProfile`,
      { entityType: 'NON_PROFIT', is_political: true },
      authed(token),
    )
    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })

  it('returns 404 for brand submit on unknown identity', async () => {
    const token = await getToken()
    const res = await service.client.post(
      `${BASE}/v2/tdlc/99999999/submit`,
      BRAND_BODY,
      authed(token),
    )
    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })

  it('returns 404 for getProfile on unknown identity', async () => {
    const token = await getToken()
    const res = await service.client.get(
      `${BASE}/identities/99999999/getProfile`,
      authed(token),
    )
    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })
})
