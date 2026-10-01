import { HttpStatus } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { PeerlyAccountService } from '@/vendors/peerly/services/peerlyAccount.service'
import { UserRole } from '../../generated/prisma'

const service = useTestService()

const getBalance = vi.fn()

// The balance cache lives on the service instance, which outlives a test;
// TTL 0 disables it so each case drives its own vendor read.
beforeEach(async () => {
  vi.stubEnv('BALANCE_CACHE_TTL_MS', '0')
  vi.stubEnv('DETAIL_FAILED_RETRY_COOLDOWN_MS', '0')
  getBalance.mockReset().mockResolvedValue({ balance: 808.6, creditLimit: 100 })
  vi.spyOn(
    service.app.get(PeerlyAccountService),
    'getBalance',
  ).mockImplementation(getBalance)

  // AdminOrM2MGuard reads the session user's CURRENT roles.
  await service.prisma.user.update({
    where: { id: service.user.id },
    data: { roles: [UserRole.admin] },
  })
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('GET /v1/outreach/admin/sms/balance', () => {
  it('returns the vendor account balance', async () => {
    const res = await service.client.get('/v1/outreach/admin/sms/balance')

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.account).toMatchObject({ balance: 808.6, creditLimit: 100 })
    expect(new Date(res.data.account.readAt).getTime()).not.toBeNaN()
  })

  it('reports a negative balance as-is (the vendor extends credit)', async () => {
    getBalance.mockResolvedValue({ balance: -88.396, creditLimit: 1400 })

    const res = await service.client.get('/v1/outreach/admin/sms/balance')

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.account).toMatchObject({
      balance: -88.396,
      creditLimit: 1400,
    })
  })

  it('degrades to null when the vendor read fails', async () => {
    getBalance.mockRejectedValue(new Error('peerly down'))

    const res = await service.client.get('/v1/outreach/admin/sms/balance')

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data).toEqual({ account: null })
  })

  it('serves a cached read within the TTL', async () => {
    vi.stubEnv('BALANCE_CACHE_TTL_MS', '60000')

    const first = await service.client.get('/v1/outreach/admin/sms/balance')
    const second = await service.client.get('/v1/outreach/admin/sms/balance')

    expect(first.status).toBe(HttpStatus.OK)
    expect(second.status).toBe(HttpStatus.OK)
    expect(getBalance).toHaveBeenCalledTimes(1)
  })

  it('refuses a non-admin', async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { roles: [] },
    })

    const res = await service.client.get('/v1/outreach/admin/sms/balance')

    expect(res.status).toBe(HttpStatus.FORBIDDEN)
  })
})
