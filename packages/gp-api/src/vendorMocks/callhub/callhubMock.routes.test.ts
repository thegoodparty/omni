import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'

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
const AUTH = { headers: { Authorization: 'Token test' } }

describe('POST /v1/vendor-mocks/callhub/v1/numbers/rent', () => {
  beforeEach(() => {
    mockMode.value = 'mock'
  })

  it('returns 201 with phone_number', async () => {
    const res = await service.client.post(`${BASE}/v1/numbers/rent`, {}, AUTH)
    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.phone_number).toBe('+15551234567')
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
