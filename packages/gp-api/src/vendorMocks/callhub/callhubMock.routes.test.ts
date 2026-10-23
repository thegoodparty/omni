import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { OutreachType } from '@/generated/prisma'
import { VendorMockRecordService } from '../vendorMockRecord.service'

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

const BASE = '/v1/vendor-mocks/callhub'
const AUTH = { headers: { Authorization: 'Token mock-key' } }

describe('POST /v1/vendor-mocks/callhub/v1/numbers/rent', () => {
  beforeEach(() => {
    mockMode.value = 'mock'
  })

  it('returns 201 with phone_number', async () => {
    const res = await service.client.post(`${BASE}/v1/numbers/rent`, {}, AUTH)
    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.phone_number).toBe('+15551234567')
  })

  it('serves the trailing-slash paths the CallHub client calls', async () => {
    const rent = await service.client.post(`${BASE}/v1/numbers/rent/`, {}, AUTH)
    expect(rent.status).toBe(HttpStatus.CREATED)
    expect(rent.data.phone_number).toBe('+15551234567')

    const dnc = await service.client.get(
      `${BASE}/v1/dnc_contacts/?page_size=100`,
      AUTH,
    )
    expect(dnc.status).toBe(HttpStatus.OK)
  })

  it('GET rented_calling_numbers returns rented number', async () => {
    await service.client.post(`${BASE}/v1/numbers/rent`, {}, AUTH)
    const res = await service.client.get(
      `${BASE}/v1/numbers/rented_calling_numbers`,
      AUTH,
    )
    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.results.length).toBeGreaterThanOrEqual(1)
    expect(res.data.results[0].phone_number).toBe('+15551234567')
  })

  it('returns 401 when Authorization is missing', async () => {
    const res = await service.client.post(`${BASE}/v1/numbers/rent`, {})
    expect(res.status).toBe(HttpStatus.UNAUTHORIZED)
  })

  it('returns 404 when VENDOR_MODE is live', async () => {
    mockMode.value = 'live'
    const res = await service.client.post(`${BASE}/v1/numbers/rent`, {}, AUTH)
    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })

  it('accepts the mock key the client sends when CALLHUB_API_KEY is set', async () => {
    vi.stubEnv('CALLHUB_API_KEY', 'real-dev-key')
    const mockKey = { headers: { Authorization: 'Token mock-key' } }
    const ok = await service.client.post(`${BASE}/v1/numbers/rent`, {}, mockKey)
    expect(ok.status).toBe(HttpStatus.CREATED)

    const wrong = await service.client.post(
      `${BASE}/v1/numbers/rent`,
      {},
      { headers: { Authorization: 'Token some-other-key' } },
    )
    expect(wrong.status).toBe(HttpStatus.UNAUTHORIZED)
    vi.unstubAllEnvs()
  })
})

describe('POST phonebooks + bulk_create + numbers_count', () => {
  beforeEach(() => {
    mockMode.value = 'mock'
  })

  it('creates phonebook, bulk_creates, counts correctly', async () => {
    const createRes = await service.client.post(
      `${BASE}/v1/phonebooks`,
      { name: 'test-book' },
      AUTH,
    )
    expect(createRes.status).toBe(HttpStatus.CREATED)
    expect(createRes.data.pk_str).toBeTruthy()
    expect(createRes.data.name).toBe('test-book')

    const pk = createRes.data.pk_str as string

    const bulkRes = await service.client.post(
      `${BASE}/v1/contacts/bulk_create`,
      {
        phonebook_id: pk,
        csv: 'phone_number\n+15551234567\n+15559876543',
      },
      AUTH,
    )
    expect(bulkRes.status).toBe(HttpStatus.CREATED)

    const countRes = await service.client.get(
      `${BASE}/v1/phonebooks/${pk}/numbers_count`,
      AUTH,
    )
    expect(countRes.status).toBe(HttpStatus.OK)
    expect(countRes.data.phonenumber_count).toBe(2)
  })

  it('counts the rows of the CSV the client sends as csv_url', async () => {
    const csvUrl = 'https://bucket.s3.amazonaws.com/robocall-phonebook/1.csv'
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('phone\n+15551111111\n+15552222222\n'))

    const createRes = await service.client.post(
      `${BASE}/v1/phonebooks/`,
      { name: 'csv-url-book' },
      AUTH,
    )
    const pk = createRes.data.pk_str as string

    const bulkRes = await service.client.post(
      `${BASE}/v1/contacts/bulk_create/`,
      { phonebook_id: pk, csv_url: csvUrl },
      AUTH,
    )
    expect(bulkRes.status).toBe(HttpStatus.CREATED)
    expect(fetchSpy).toHaveBeenCalledWith(csvUrl)

    const countRes = await service.client.get(
      `${BASE}/v1/phonebooks/${pk}/numbers_count`,
      AUTH,
    )
    expect(countRes.data.phonenumber_count).toBe(2)
    fetchSpy.mockRestore()
  })

  it('rejects csv_url not from amazonaws.com', async () => {
    const createRes = await service.client.post(
      `${BASE}/v1/phonebooks/`,
      { name: 'ssrf-book' },
      AUTH,
    )
    const pk = createRes.data.pk_str as string

    const bulkRes = await service.client.post(
      `${BASE}/v1/contacts/bulk_create/`,
      { phonebook_id: pk, csv_url: 'https://attacker.example.com/data.csv' },
      AUTH,
    )
    expect(bulkRes.status).toBe(HttpStatus.BAD_GATEWAY)
  })
})

describe('POST /v1/vendor-mocks/callhub/v1/media/upload', () => {
  beforeEach(() => {
    mockMode.value = 'mock'
  })

  it('accepts the multipart upload the CallHub client sends', async () => {
    const form = new FormData()
    form.append('file', new Blob(['RIFF']), 'audio.wav')
    form.append('name', 'audio.wav')

    const res = await service.client.post(
      `${BASE}/v1/media/upload/`,
      form,
      AUTH,
    )
    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.data.media_file_id).toBeTruthy()
  })
})

describe('vb_campaign lifecycle', () => {
  beforeEach(() => {
    mockMode.value = 'mock'
  })

  it('creates, reads, updates, and re-reads a vb_campaign', async () => {
    const createRes = await service.client.post(
      `${BASE}/v1/vb_campaign`,
      { name: 'my-campaign' },
      AUTH,
    )
    expect(createRes.status).toBe(HttpStatus.CREATED)
    const pk = createRes.data.pk_str as string
    expect(pk).toBeTruthy()

    const getRes = await service.client.get(
      `${BASE}/v1/voice_broadcasts/${pk}`,
      AUTH,
    )
    expect(getRes.status).toBe(HttpStatus.OK)
    expect(getRes.data.status).toBe(2)

    const putRes = await service.client.put(
      `${BASE}/v1/voice_broadcasts/${pk}`,
      { status: '1' },
      AUTH,
    )
    expect(putRes.status).toBe(HttpStatus.OK)
    expect(putRes.data.status).toBe(1)

    const getRes2 = await service.client.get(
      `${BASE}/v1/voice_broadcasts/${pk}`,
      AUTH,
    )
    expect(getRes2.status).toBe(HttpStatus.OK)
    expect(getRes2.data.status).toBe(1)
  })

  it('keeps the phonebook ids the campaign was created with', async () => {
    const createRes = await service.client.post(
      `${BASE}/v1/vb_campaign`,
      { name: 'with-phonebook', phonebooks: ['pb-abc'] },
      AUTH,
    )
    const pk = createRes.data.pk_str as string

    const record = await service.prisma.vendorMockRecord.findFirstOrThrow({
      where: { kind: 'vb_campaign', externalId: pk },
    })
    expect(record.state).toMatchObject({ phonebooks: ['pb-abc'] })
  })
})

describe('callhub.campaign.fail', () => {
  beforeEach(() => {
    mockMode.value = 'mock'
  })

  const seedRobocall = async () => {
    const slug = `mock-org-${Math.random().toString(36).slice(2)}`
    await service.prisma.organization.create({
      data: { slug, ownerId: service.user.id },
    })
    const campaign = await service.prisma.campaign.create({
      data: { userId: service.user.id, slug, organizationSlug: slug },
    })
    const outreach = await service.prisma.outreach.create({
      data: {
        outreachType: OutreachType.robocall,
        campaignId: campaign.id,
        date: new Date(),
      },
    })
    return { campaign, name: `Robocall ${slug} #${outreach.id}` }
  }

  it("fails the armed campaign's next create once with CallHub's error shape, then succeeds", async () => {
    const { campaign, name } = await seedRobocall()
    await service.app
      .get(VendorMockRecordService)
      .armCallhubCreateFail(campaign.id)

    const failRes = await service.client.post(
      `${BASE}/v1/vb_campaign`,
      { name },
      AUTH,
    )
    expect(failRes.status).toBe(HttpStatus.SERVICE_UNAVAILABLE)
    expect(failRes.data.detail).toEqual(expect.any(String))
    expect(
      await service.prisma.vendorMockRecord.count({
        where: { kind: 'vb_campaign' },
      }),
    ).toBe(0)

    const okRes = await service.client.post(
      `${BASE}/v1/vb_campaign`,
      { name },
      AUTH,
    )
    expect(okRes.status).toBe(HttpStatus.CREATED)
    expect(okRes.data.pk_str).toBeTruthy()
  })

  it("never fails a create that isn't the armed campaign's", async () => {
    const armed = await seedRobocall()
    const other = await seedRobocall()
    await service.app
      .get(VendorMockRecordService)
      .armCallhubCreateFail(armed.campaign.id)

    const otherRes = await service.client.post(
      `${BASE}/v1/vb_campaign`,
      { name: other.name },
      AUTH,
    )
    const unrelatedRes = await service.client.post(
      `${BASE}/v1/vb_campaign`,
      { name: 'my-campaign' },
      AUTH,
    )
    const armedRes = await service.client.post(
      `${BASE}/v1/vb_campaign`,
      { name: armed.name },
      AUTH,
    )

    expect(otherRes.status).toBe(HttpStatus.CREATED)
    expect(unrelatedRes.status).toBe(HttpStatus.CREATED)
    expect(armedRes.status).toBe(HttpStatus.SERVICE_UNAVAILABLE)
  })
})

describe('export_data', () => {
  beforeEach(() => {
    mockMode.value = 'mock'
  })

  it('returns total_calls >= rows imported', async () => {
    const bookRes = await service.client.post(
      `${BASE}/v1/phonebooks`,
      { name: 'export-book' },
      AUTH,
    )
    const pk = bookRes.data.pk_str as string

    await service.client.post(
      `${BASE}/v1/contacts/bulk_create`,
      {
        phonebook_id: pk,
        csv: 'phone_number\n+15551111111\n+15552222222\n+15553333333',
      },
      AUTH,
    )

    const campRes = await service.client.post(
      `${BASE}/v1/vb_campaign`,
      { name: 'export-campaign' },
      AUTH,
    )
    const campPk = campRes.data.pk_str as string

    const exportRes = await service.client.get(
      `${BASE}/v1/export_data/export_${campPk}`,
      AUTH,
    )
    expect(exportRes.status).toBe(HttpStatus.OK)
    expect(exportRes.data.state).toBe('SUCCESS')
    expect(exportRes.data.total_calls).toBeGreaterThanOrEqual(3)
    expect(exportRes.data.data.url).toContain(campPk)
  })
})

describe('auth and mode guards', () => {
  beforeEach(() => {
    mockMode.value = 'mock'
  })

  it('returns 401 on missing auth for phonebooks', async () => {
    const res = await service.client.post(`${BASE}/v1/phonebooks`, {
      name: 'x',
    })
    expect(res.status).toBe(HttpStatus.UNAUTHORIZED)
  })

  it('returns 401 on missing auth for vb_campaign', async () => {
    const res = await service.client.post(`${BASE}/v1/vb_campaign`, {
      name: 'x',
    })
    expect(res.status).toBe(HttpStatus.UNAUTHORIZED)
  })

  it('returns 401 on missing auth for dnc_contacts', async () => {
    const res = await service.client.get(`${BASE}/v1/dnc_contacts`)
    expect(res.status).toBe(HttpStatus.UNAUTHORIZED)
  })

  it('returns 404 on live mode for phonebooks', async () => {
    mockMode.value = 'live'
    const res = await service.client.post(
      `${BASE}/v1/phonebooks`,
      { name: 'x' },
      AUTH,
    )
    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })

  it('returns 404 on live mode for dnc_contacts', async () => {
    mockMode.value = 'live'
    const res = await service.client.get(`${BASE}/v1/dnc_contacts`, AUTH)
    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })
})
