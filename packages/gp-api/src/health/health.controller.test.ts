import { useTestService } from '@/test-service'
import { describe, expect, it, vi } from 'vitest'
import { HttpStatus } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

const service = useTestService()

describe('GET /v1/health', () => {
  it('checks the database by default', async () => {
    const res = await service.client.get('/v1/health')
    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data).toBe('OK')
  })

  it('fails by default when the database cannot answer', async () => {
    const prisma = service.app.get(PrismaService)
    const spy = vi
      .spyOn(prisma, '$queryRaw')
      .mockRejectedValueOnce(new Error('pool exhausted'))
    const res = await service.client.get('/v1/health')
    expect(res.status).toBe(HttpStatus.SERVICE_UNAVAILABLE)
    spy.mockRestore()
  })

  it('answers mode=live without querying the database', async () => {
    const prisma = service.app.get(PrismaService)
    const spy = vi
      .spyOn(prisma, '$queryRaw')
      .mockRejectedValue(new Error('pool exhausted'))
    const res = await service.client.get('/v1/health', {
      params: { mode: 'live' },
    })
    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data).toBe('OK')
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
