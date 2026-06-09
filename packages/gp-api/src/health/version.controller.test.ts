import { useTestService } from '@/test-service'
import { afterEach, describe, expect, it } from 'vitest'
import { HttpStatus } from '@nestjs/common'

const service = useTestService()

describe('GET /v1/version', () => {
  afterEach(() => {
    delete process.env.GIT_SHA
  })

  it('returns the deployed commit from GIT_SHA without auth', async () => {
    process.env.GIT_SHA = 'abc123'
    const res = await service.client.get('/v1/version')
    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data).toEqual({ commit: 'abc123' })
  })

  it("returns 'unknown' when GIT_SHA is unset", async () => {
    delete process.env.GIT_SHA
    const res = await service.client.get('/v1/version')
    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data).toEqual({ commit: 'unknown' })
  })
})
