import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PlacesService } from '@/electionDb/places/places.service'
import { RacesService } from '@/electionDb/races/races.service'
import { useTestService } from '@/test-service'
import { signTestVercelOidcToken, useTestVercelOidc } from '@/test-vercel-oidc'

const service = useTestService()
useTestVercelOidc()

const asServiceReader = () => ({
  headers: { Authorization: `Bearer ${signTestVercelOidcToken()}` },
})

// One crawl wave in production asked for the same small set of documents about
// ten times a minute, and each ask was a fresh set of SQL statements against a
// 50-connection pool until it ran dry (ENG-11791). The routes must answer the
// repeats without touching the services behind them.
const BURST = 200

describe('machine election reads', () => {
  let getPlaces: ReturnType<typeof vi.spyOn>
  let findRaces: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    getPlaces = vi
      .spyOn(service.app.get(PlacesService), 'getPlaces')
      .mockResolvedValue([])
    findRaces = vi
      .spyOn(service.app.get(RacesService), 'findRaces')
      .mockResolvedValue([])
  })

  it('answers a 200-request place wave with at most two reads', async () => {
    const responses = await Promise.all(
      Array.from({ length: BURST }, () =>
        service.client.get('/v1/elections/places', {
          params: { state: 'WY' },
          ...asServiceReader(),
        }),
      ),
    )

    expect(responses.every((res) => res.status === 200)).toBe(true)
    expect(getPlaces.mock.calls.length).toBeLessThanOrEqual(2)
  })

  it('answers a 200-request race wave with at most two reads', async () => {
    const responses = await Promise.all(
      Array.from({ length: BURST }, () =>
        service.client.get('/v1/elections/races', {
          params: { state: 'WY' },
          ...asServiceReader(),
        }),
      ),
    )

    expect(responses.every((res) => res.status === 200)).toBe(true)
    expect(findRaces.mock.calls.length).toBeLessThanOrEqual(2)
  })

  it('keeps two different filters on separate reads', async () => {
    const read = (state: string) =>
      service.client.get('/v1/elections/races', {
        params: { state },
        ...asServiceReader(),
      })

    await read('WY')
    await read('MI')

    expect(findRaces).toHaveBeenCalledTimes(2)
  })

  it('does not answer a later read with a failed one', async () => {
    findRaces.mockRejectedValue(new Error('pool acquire timed out'))

    const failed = await service.client.get('/v1/elections/races', {
      params: { state: 'WY' },
      ...asServiceReader(),
    })
    findRaces.mockResolvedValue([])
    const recovered = await service.client.get('/v1/elections/races', {
      params: { state: 'WY' },
      ...asServiceReader(),
    })

    expect(failed.status).toBe(500)
    expect(recovered.status).toBe(200)
    expect(findRaces).toHaveBeenCalledTimes(2)
  })
})
