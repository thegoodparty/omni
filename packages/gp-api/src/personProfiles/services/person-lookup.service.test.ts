import { HttpService } from '@nestjs/axios'
import { BadGatewayException } from '@nestjs/common'
import { AxiosError } from 'axios'
import { PinoLogger } from 'nestjs-pino'
import { of, throwError } from 'rxjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ElectionApiTokenService } from '@/vendors/clerk/services/electionApiToken.service'
import { PersonLookupService } from './person-lookup.service'

// The service destructures ELECTION_API_URL at import time, so the base URL is
// whatever .env.test supplies rather than something a test can inject.
const BY_SLUG = `${process.env.ELECTION_API_URL}/v1/persons/by-slug`

const PERSON_ID = 'a1b2c3d4-0000-4000-8000-000000000000'
const SLUG = 'jordan-reyes-a1b2c3d4'

const person = (overrides = {}) => ({
  id: PERSON_ID,
  fullName: 'Jordan Reyes',
  firstName: 'Jordan',
  lastName: 'Reyes',
  state: 'CA',
  OfficeHolders: [
    { officeTitle: 'City Council Member', positionName: null, isCurrent: true },
  ],
  ...overrides,
})

const axiosStatus = (status: number) => {
  const error = new AxiosError('boom')
  // isAxiosError keys off this flag; a plain object would fall through to the
  // 502 branch and mask what the test is pinning.
  error.response = {
    status,
    data: null,
    statusText: '',
    headers: {},
    config: { headers: new AxiosError('').config?.headers ?? {} },
  } as AxiosError['response']
  return error
}

describe('PersonLookupService', () => {
  let httpService: { get: ReturnType<typeof vi.fn> }
  let service: PersonLookupService

  beforeEach(() => {
    httpService = { get: vi.fn().mockReturnValue(of({ data: person() })) }
    const logger = {
      setContext: vi.fn(),
      error: vi.fn(),
    } as unknown as PinoLogger
    const tokenService = {
      authHeader: vi.fn().mockResolvedValue({ Authorization: 'Bearer t' }),
    } as unknown as ElectionApiTokenService
    service = new PersonLookupService(
      httpService as unknown as HttpService,
      logger,
      tokenService,
    )
  })

  const requestedUrl = (): string => String(httpService.get.mock.calls[0]?.[0])

  it('returns the identity an operator needs to confirm the subject', async () => {
    const result = await service.lookup(SLUG)

    expect(result).toEqual({
      personId: PERSON_ID,
      fullName: 'Jordan Reyes',
      state: 'CA',
      office: 'City Council Member',
    })
  })

  // A privacy request quotes a URL, not a slug, and ops paste it verbatim in
  // whatever form it arrived.
  it.each([
    ['https://goodparty.org/people/jordan-reyes-a1b2c3d4'],
    ['https://goodparty.org/people/jordan-reyes-a1b2c3d4/'],
    ['https://goodparty.org/people/jordan-reyes-a1b2c3d4?utm_source=x'],
    ['/people/jordan-reyes-a1b2c3d4'],
    ['  jordan-reyes-a1b2c3d4  '],
  ])('extracts the slug from %s', async (query) => {
    await service.lookup(query)

    expect(requestedUrl()).toBe(`${BY_SLUG}/${SLUG}`)
  })

  it('attaches the election-api M2M bearer', async () => {
    await service.lookup(SLUG)

    expect(httpService.get.mock.calls[0]?.[1]).toEqual({
      headers: { Authorization: 'Bearer t' },
    })
  })

  it('prefers a current term when the person held several', async () => {
    httpService.get.mockReturnValue(
      of({
        data: person({
          OfficeHolders: [
            { officeTitle: 'Trustee', positionName: null, isCurrent: false },
            { officeTitle: 'Mayor', positionName: null, isCurrent: true },
          ],
        }),
      }),
    )

    expect((await service.lookup(SLUG))?.office).toBe('Mayor')
  })

  it('falls back to first + last when fullName is unset', async () => {
    httpService.get.mockReturnValue(of({ data: person({ fullName: null }) }))

    expect((await service.lookup(SLUG))?.fullName).toBe('Jordan Reyes')
  })

  it('tolerates a person with no office terms', async () => {
    httpService.get.mockReturnValue(of({ data: person({ OfficeHolders: [] }) }))

    expect((await service.lookup(SLUG))?.office).toBeNull()
  })

  it.each([[404], [400]])(
    'reports no match rather than an outage on %i',
    async (status) => {
      httpService.get.mockReturnValue(throwError(() => axiosStatus(status)))

      expect(await service.lookup(SLUG)).toBeNull()
    },
  )

  it('surfaces an election-api outage as a 502', async () => {
    httpService.get.mockReturnValue(throwError(() => axiosStatus(500)))

    await expect(service.lookup(SLUG)).rejects.toBeInstanceOf(
      BadGatewayException,
    )
  })

  it('never calls election-api for an empty query', async () => {
    expect(await service.lookup('   ')).toBeNull()
    expect(httpService.get).not.toHaveBeenCalled()
  })
})
