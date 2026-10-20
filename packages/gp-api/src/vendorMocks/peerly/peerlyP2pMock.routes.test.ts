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

const BASE = '/v1/vendor-mocks/peerly'

describe('GET /v1/vendor-mocks/peerly/accounts/:acct/balance', () => {
  beforeEach(() => {
    mockMode.value = 'mock'
  })

  it('returns 404 when VENDOR_MODE is live', async () => {
    mockMode.value = 'live'
    const res = await service.client.get(`${BASE}/accounts/test/balance`)
    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })

  it('returns 501 when VENDOR_MODE is mock', async () => {
    const res = await service.client.get(`${BASE}/accounts/test/balance`)
    expect(res.status).toBe(HttpStatus.NOT_IMPLEMENTED)
  })
})
