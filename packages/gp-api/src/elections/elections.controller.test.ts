import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { ElectionsService } from './services/elections.service'

const service = useTestService()

// `trustProxy` is on, so an X-Forwarded-For header is what the rate-limit
// guard keys on. Each test uses its own address so one test's spend cannot
// exhaust another's budget.
const get = (ip: string) =>
  service.client.get('/v1/elections/districts/types', {
    params: { state: 'IL', electionYear: 2026 },
    headers: { 'X-Forwarded-For': ip },
  })

describe('GET /v1/elections/districts/types', () => {
  let getValidDistrictTypes: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // The bucket refills a token a second, so a slow run of 61 requests
    // would earn the 61st. A still clock keeps the count exact.
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 0, 1))
    getValidDistrictTypes = vi
      .spyOn(service.app.get(ElectionsService), 'getValidDistrictTypes')
      .mockResolvedValue([{ id: 'dt-1', L2DistrictType: 'City Council' }])
  })

  it('answers a read within the limit', async () => {
    const result = await get('10.4.0.1')

    expect(result.status).toBe(HttpStatus.OK)
    expect(getValidDistrictTypes).toHaveBeenCalledOnce()
  })

  it('refuses the 61st read from one address and queries nothing further', async () => {
    for (let i = 0; i < 60; i++) {
      const allowed = await get('10.4.0.2')
      expect(allowed.status).toBe(HttpStatus.OK)
    }
    expect(getValidDistrictTypes).toHaveBeenCalledTimes(60)

    const refused = await get('10.4.0.2')

    expect(refused.status).toBe(HttpStatus.TOO_MANY_REQUESTS)
    expect(getValidDistrictTypes).toHaveBeenCalledTimes(60)
  })

  it('meters the whole controller from one bucket', async () => {
    const districtNames = () =>
      service.client.get('/v1/elections/districts/names', {
        params: {
          state: 'IL',
          electionYear: 2026,
          L2DistrictType: 'City Council',
        },
        headers: { 'X-Forwarded-For': '10.4.0.3' },
      })

    vi.spyOn(
      service.app.get(ElectionsService),
      'getValidDistrictNames',
    ).mockResolvedValue([{ id: 'dn-1', L2DistrictName: 'District 1' }])

    for (let i = 0; i < 60; i++) {
      expect((await districtNames()).status).toBe(HttpStatus.OK)
    }

    expect((await get('10.4.0.3')).status).toBe(HttpStatus.TOO_MANY_REQUESTS)
  })
})

// Serve onboarding lists seats, so it asks for every race on file for the zip
// rather than only the ones inside the future window (ENG-11637).
describe('GET /v1/elections/races-by-year', () => {
  let searchPositions: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    searchPositions = vi
      .spyOn(service.app.get(ElectionsService), 'searchPositions')
      .mockResolvedValue([])
  })

  const getRaces = (timeframe: string, ip: string) =>
    service.client.get('/v1/elections/races-by-year', {
      params: { zipcode: '54981', timeframe },
      headers: { 'X-Forwarded-For': ip },
    })

  it('accepts timeframe=all and forwards it', async () => {
    const result = await getRaces('all', '10.5.0.1')

    expect(result.status).toBe(HttpStatus.OK)
    expect(searchPositions).toHaveBeenCalledWith({
      zip: '54981',
      timeframe: 'all',
      displayOfficeLevels: undefined,
      name: undefined,
      officeType: undefined,
    })
  })

  it('refuses a timeframe outside the enum', async () => {
    const result = await getRaces('sideways', '10.5.0.2')

    expect(result.status).toBe(HttpStatus.BAD_REQUEST)
    expect(searchPositions).not.toHaveBeenCalled()
  })
})
