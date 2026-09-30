import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { ContactsService } from '@/contacts/services/contacts.service'

const service = useTestService()

const stats = {
  districtId: 'd-1',
  totalConstituents: 1000,
  totalConstituentsWithCellPhone: 400,
  districtPopulation: null,
  buckets: {
    age: [],
    homeowner: [],
    education: [],
    presenceOfChildren: [],
    estimatedIncomeRange: [],
  },
}

// `trustProxy` is on, so an X-Forwarded-For header is what the rate-limit
// guard keys on. Each test uses its own address so one test's spend cannot
// exhaust another's budget.
const get = (ip: string) =>
  service.client.get('/v1/onboarding/contacts/stats', {
    params: { districtId: 'd-1' },
    headers: { 'X-Forwarded-For': ip },
  })

describe('GET /v1/onboarding/contacts/stats', () => {
  let fetchStatsByDistrictId: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchStatsByDistrictId = vi
      .spyOn(service.app.get(ContactsService), 'fetchStatsByDistrictId')
      .mockResolvedValue(stats)
  })

  it('answers a read within the limit', async () => {
    const result = await get('10.5.0.1')

    expect(result.status).toBe(HttpStatus.OK)
    expect(fetchStatsByDistrictId).toHaveBeenCalledOnce()
  })

  it('refuses the 31st read from one address and reads nothing further', async () => {
    for (let i = 0; i < 30; i++) {
      const allowed = await get('10.5.0.2')
      expect(allowed.status).toBe(HttpStatus.OK)
    }
    expect(fetchStatsByDistrictId).toHaveBeenCalledTimes(30)

    const refused = await get('10.5.0.2')

    expect(refused.status).toBe(HttpStatus.TOO_MANY_REQUESTS)
    expect(fetchStatsByDistrictId).toHaveBeenCalledTimes(30)
  })
})
