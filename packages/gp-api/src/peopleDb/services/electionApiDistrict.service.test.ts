import { BadGatewayException, NotFoundException } from '@nestjs/common'
import { AxiosError } from 'axios'
import { of, throwError } from 'rxjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ElectionApiDistrictService } from './electionApiDistrict.service'

const DISTRICT_ID = '0e5bafca-93a9-86a5-2522-f373979720df'

const axiosStatus = (status: number) => {
  const err = new AxiosError('boom')
  err.response = { status } as never
  return err
}

describe('ElectionApiDistrictService', () => {
  let get: ReturnType<typeof vi.fn>
  let service: ElectionApiDistrictService

  beforeEach(() => {
    get = vi.fn()
    service = new ElectionApiDistrictService(
      { get } as never,
      { setContext: vi.fn(), error: vi.fn(), warn: vi.fn() } as never,
      {
        authHeader: vi.fn().mockResolvedValue({ Authorization: 'Bearer t' }),
      } as never,
    )
  })

  // election-api names these columns for their L2 origin; the voter path wants
  // the people-db spelling, and the two tables agree on the values.
  it('maps the L2 column names onto the district shape', async () => {
    get.mockReturnValue(
      of({
        data: {
          id: DISTRICT_ID,
          state: 'WY',
          L2DistrictType: 'City_Ward',
          L2DistrictName: 'CHEYENNE CITY WARD 1',
          registeredVoters: 8604,
        },
      }),
    )

    const district = await service.findDistrictById(DISTRICT_ID)

    expect(district).toEqual({
      id: DISTRICT_ID,
      type: 'City_Ward',
      name: 'CHEYENNE CITY WARD 1',
      state: 'WY',
    })
  })

  it('sends the M2M bearer, which election-api requires', async () => {
    get.mockReturnValue(
      of({
        data: {
          id: DISTRICT_ID,
          state: 'WY',
          L2DistrictType: 'City_Ward',
          L2DistrictName: 'CHEYENNE CITY WARD 1',
        },
      }),
    )

    await service.findDistrictById(DISTRICT_ID)

    const [url, config] = get.mock.calls[0] as [string, { headers: unknown }]
    // ELECTION_API_URL is read at module load (as everywhere else in gp-api),
    // so the base comes from the environment; the path is what this owns.
    expect(url).toMatch(new RegExp(`/v1/districts/${DISTRICT_ID}$`))
    expect(config.headers).toEqual({ Authorization: 'Bearer t' })
  })

  // A missing district is the caller's domain error, and the message matches
  // what the people-db lookup produced so nothing downstream has to change.
  it('turns a 404 into NotFound', async () => {
    get.mockReturnValue(throwError(() => axiosStatus(404)))

    await expect(service.findDistrictById(DISTRICT_ID)).rejects.toThrow(
      NotFoundException,
    )
  })

  // Everything else is an upstream failure, and must not be mistaken for
  // "no such district" -- that would silently empty a real audience.
  it('does not mistake an upstream failure for a missing district', async () => {
    get.mockReturnValue(throwError(() => axiosStatus(503)))

    await expect(service.findDistrictById(DISTRICT_ID)).rejects.toThrow(
      BadGatewayException,
    )
  })

  it('refuses a response missing the columns it reads', async () => {
    get.mockReturnValue(of({ data: { id: DISTRICT_ID, state: 'WY' } }))

    await expect(service.findDistrictById(DISTRICT_ID)).rejects.toThrow(
      BadGatewayException,
    )
  })
})
