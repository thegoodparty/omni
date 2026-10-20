import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VendorMockVendor } from '@/generated/prisma'
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

const BASE = '/v1/vendor-mocks/peerly'

describe('POST /v1/vendor-mocks/peerly/token-auth', () => {
  beforeEach(() => {
    mockMode.value = 'mock'
  })

  it('returns 404 when VENDOR_MODE is live', async () => {
    mockMode.value = 'live'
    const res = await service.client.post(`${BASE}/token-auth`, {})
    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })

  it('returns a JWT with exp claim ~3600s out', async () => {
    const res = await service.client.post(`${BASE}/token-auth`, {})
    expect(res.status).toBe(HttpStatus.CREATED)
    const { token } = res.data as { token: string }
    expect(typeof token).toBe('string')
    const parts = token.split('.')
    expect(parts).toHaveLength(3)
    const payload = JSON.parse(
      Buffer.from(parts[1]!, 'base64url').toString('utf8'),
    ) as { exp: number; accountNumber: string }
    const nowSec = Math.floor(Date.now() / 1000)
    expect(payload.exp).toBeGreaterThan(nowSec + 3500)
    expect(payload.exp).toBeLessThan(nowSec + 3700)
    expect(payload.accountNumber).toBe('mock-peerly')
  })
})

describe('P2P job CRUD', () => {
  beforeEach(() => {
    mockMode.value = 'mock'
  })

  it('creates a job with 201 + Location header', async () => {
    const res = await service.client.post(`${BASE}/1to1/jobs`, {
      name: 'test-job',
    })
    expect(res.status).toBe(HttpStatus.CREATED)
    const location = res.headers['location'] as string
    expect(location).toMatch(/^\/1to1\/jobs\//)
    expect(res.data.id).toBeTruthy()
    expect(res.data.status).toBe('pending')
  })

  it('reads the job by id', async () => {
    const create = await service.client.post(`${BASE}/1to1/jobs`, {
      name: 'read-test',
    })
    const id = create.data.id as string
    const res = await service.client.get(`${BASE}/1to1/jobs/${id}`)
    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.id).toBe(id)
    expect(res.data.status).toBe('pending')
    expect(typeof res.data.leads_remaining).toBe('number')
  })

  it('lists all jobs', async () => {
    await service.client.post(`${BASE}/1to1/jobs`, { name: 'list-test' })
    const res = await service.client.get(`${BASE}/1to1/jobs`)
    expect(res.status).toBe(HttpStatus.OK)
    expect(Array.isArray(res.data.results)).toBe(true)
    expect(res.data.results.length).toBeGreaterThan(0)
  })

  it('updates the job state', async () => {
    const create = await service.client.post(`${BASE}/1to1/jobs`, {})
    const id = create.data.id as string
    const res = await service.client.put(`${BASE}/1to1/jobs/${id}`, {
      status: 'active',
    })
    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.status).toBe('active')
    expect(res.data.id).toBe(id)
  })

  it('soft-deletes a job with 204', async () => {
    const create = await service.client.post(`${BASE}/1to1/jobs`, {})
    const id = create.data.id as string
    const del = await service.client.delete(`${BASE}/1to1/jobs/${id}`)
    expect(del.status).toBe(HttpStatus.NO_CONTENT)
    const get = await service.client.get(`${BASE}/1to1/jobs/${id}`)
    expect(get.data.deleted).toBe(true)
  })

  it('assigns a phone list to the job', async () => {
    const create = await service.client.post(`${BASE}/1to1/jobs`, {})
    const id = create.data.id as string
    const res = await service.client.post(
      `${BASE}/1to1/jobs/${id}/assignlist`,
      { list_id: 'list-123' },
    )
    expect(res.status).toBe(HttpStatus.CREATED)
    const job = await service.client.get(`${BASE}/1to1/jobs/${id}`)
    expect(job.data.phoneListId).toBe('list-123')
  })

  it('returns empty questionresponses', async () => {
    const create = await service.client.post(`${BASE}/1to1/jobs`, {})
    const id = create.data.id as string
    const res = await service.client.get(
      `${BASE}/1to1/jobs/${id}/questionresponses`,
    )
    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.results).toEqual([])
  })
})

describe('Phone list upload and status', () => {
  beforeEach(() => {
    mockMode.value = 'mock'
  })

  it('uploads a CSV and returns a token', async () => {
    const csv = 'first_name,last_name,lead_phone\nAlice,Smith,5551234567\n'
    const form = new FormData()
    form.append('file', new Blob([csv], { type: 'text/csv' }), 'voters.csv')
    form.append('list_name', 'my-list')
    const res = await service.client.post(`${BASE}/phonelists`, form)
    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.Data.token).toBeTruthy()
  })

  it('returns PENDING immediately after upload', async () => {
    const csv = 'first_name\nAlice\n'
    const form = new FormData()
    form.append('file', new Blob([csv], { type: 'text/csv' }), 'v.csv')
    const upload = await service.client.post(`${BASE}/phonelists`, form)
    const token = upload.data.Data.token as string
    const status = await service.client.get(
      `${BASE}/phonelists/${token}/checkstatus`,
    )
    expect(status.status).toBe(HttpStatus.OK)
    expect(status.data.Data.list_state).toBe('PENDING')
  })

  it('returns ACTIVE after p2p.phoneListFinish runJob', async () => {
    const csv = 'first_name\nBob\n'
    const form = new FormData()
    form.append('file', new Blob([csv], { type: 'text/csv' }), 'v.csv')
    const upload = await service.client.post(`${BASE}/phonelists`, form)
    const token = upload.data.Data.token as string

    // testUserRunJob requires isTestUser; backdate directly instead
    await service.prisma.vendorMockRecord.updateMany({
      where: { vendor: VendorMockVendor.peerly, kind: 'phone_list' },
      data: { createdAt: new Date(Date.now() - 15_000) },
    })

    const status = await service.client.get(
      `${BASE}/phonelists/${token}/checkstatus`,
    )
    expect(status.status).toBe(HttpStatus.OK)
    expect(status.data.Data.list_state).toBe('ACTIVE')
    expect(typeof status.data.Data.list_id).toBe('number')
  })
})

describe('GET /v1/vendor-mocks/peerly/accounts/:acct/balance', () => {
  beforeEach(() => {
    mockMode.value = 'mock'
  })

  it('returns 404 when VENDOR_MODE is live', async () => {
    mockMode.value = 'live'
    const res = await service.client.get(`${BASE}/accounts/test/balance`)
    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })

  it('returns 1000000 by default', async () => {
    const res = await service.client.get(`${BASE}/accounts/test/balance`)
    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.balance).toBe(1_000_000)
  })
})

describe('peerly.balance.empty mock action', () => {
  beforeEach(() => {
    mockMode.value = 'mock'
  })

  it('sets balance to 0 after the action', async () => {
    const slug = `balance-test-${Date.now()}`
    await service.prisma.organization.create({
      data: { slug, ownerId: service.user.id },
    })
    const campaign = await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug,
        organizationSlug: slug,
        data: {},
        details: {},
        aiContent: {},
      },
    })

    await service.client.post('/v1/test-fixtures/vendor-mocks/actions', {
      campaignId: campaign.id,
      action: 'peerly.balance.empty',
    })

    const balance = await service.client.get(`${BASE}/accounts/test/balance`)
    expect(balance.data.balance).toBe(0)
  })
})

describe('Media and schedule endpoints', () => {
  beforeEach(() => {
    mockMode.value = 'mock'
  })

  it('POST /v2/media returns a media_id', async () => {
    const res = await service.client.post(`${BASE}/v2/media`, {})
    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.media_id).toBeTruthy()
    expect(res.data.status).toBe('ready')
  })

  it('POST /schedule returns a numeric schedule_id', async () => {
    const res = await service.client.post(`${BASE}/schedule`, {
      schedule_name: 'test-schedule',
    })
    expect(res.status).toBe(HttpStatus.CREATED)
    expect(typeof res.data.Data.schedule_id).toBe('number')
    expect(res.data.Data.schedule_name).toBe('test-schedule')
  })
})
