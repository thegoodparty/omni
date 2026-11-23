import { HttpStatus } from '@nestjs/common'
import axios from 'axios'
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

// No interceptor mints a Bearer, which is what the webapp sends once Clerk has
// ended the session: the `/api` rewrite forwards the request headerless.
const withNoSession = (params: Record<string, string> = {}) =>
  axios.get('/v1/onboarding/contacts/stats', {
    baseURL: service.client.defaults.baseURL,
    params,
    validateStatus: () => true,
  })

describe('GET /v1/onboarding/contacts/stats session states', () => {
  let fetchStatsByDistrictId: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchStatsByDistrictId = vi
      .spyOn(service.app.get(ContactsService), 'fetchStatsByDistrictId')
      .mockResolvedValue(stats)
  })

  it('answers a param-less request with no session as a bare 401', async () => {
    // A session ended under an open tab is an auth answer, not a bad request:
    // the webapp reads this exact body as "sign in again" and stops reporting
    // it as a defect (ENG-11674).
    const response = await withNoSession()

    expect(response.status).toBe(HttpStatus.UNAUTHORIZED)
    expect(response.data).toEqual({
      message: 'Unauthorized',
      statusCode: HttpStatus.UNAUTHORIZED,
    })
    expect(fetchStatsByDistrictId).not.toHaveBeenCalled()
  })

  it('still serves an anonymous request that names a district', async () => {
    const response = await withNoSession({ districtId: 'd-1' })

    expect(response.status).toBe(HttpStatus.OK)
    expect(fetchStatsByDistrictId).toHaveBeenCalledWith('d-1', {
      base: 'voters',
    })
  })

  it('keeps the 400 for a live session that resolves no district', async () => {
    // User 123 is signed in but sends no organization, so nothing can name a
    // district. That caller is identified, so it stays a bad request.
    const response = await service.client.get('/v1/onboarding/contacts/stats')

    expect(response.status).toBe(HttpStatus.BAD_REQUEST)
    expect(response.data.message).toContain('Could not resolve a district')
    expect(fetchStatsByDistrictId).not.toHaveBeenCalled()
  })
})
