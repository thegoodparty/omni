import { NotFoundException } from '@nestjs/common'
import axios from 'axios'
import { beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import { CandidaciesService } from '@/electionDb/candidacies/candidacies.service'
import { OfficeHoldersService } from '@/electionDb/officeHolders/officeHolders.service'
import { PersonMergesService } from '@/electionDb/personMerges/person-merges.service'
import { PersonsService } from '@/electionDb/persons/persons.service'
import { PlacesService } from '@/electionDb/places/places.service'
import { PositionsService } from '@/electionDb/positions/positions.service'
import { RacesService } from '@/electionDb/races/races.service'
import { signTestM2MJwt, useTestService } from '@/test-service'

const service = useTestService()

const PERSON_ID = '11111111-1111-4111-8111-111111111111'
const POSITION_ID = '22222222-2222-4222-8222-222222222222'
const RETIRED_ID = '33333333-3333-4333-8333-333333333333'

// The ten routes gp-marketing reads. It authenticates with one long-lived
// JWT-format machine token, which SessionGuard only ever turns into
// `serviceReader`, so these must accept a service reader, not just an
// opaque mt_ token.
const ROUTES = [
  {
    path: '/v1/elections/candidacies',
    params: { state: 'WY' },
    found: true,
    forwarded: [expect.objectContaining({ state: 'WY' })],
    body: [],
  },
  {
    path: '/v1/elections/officeholders',
    params: { state: 'WY' },
    found: true,
    forwarded: [expect.objectContaining({ state: 'WY' })],
    body: [],
  },
  {
    path: '/v1/elections/persons',
    params: { state: 'WY' },
    found: true,
    forwarded: [expect.objectContaining({ state: 'WY' })],
    body: [],
  },
  {
    path: '/v1/elections/persons/by-slug/jane-doe-11111111',
    params: {},
    found: false,
    forwarded: ['jane-doe-11111111'],
    body: expect.objectContaining({ statusCode: 404 }),
  },
  {
    path: `/v1/elections/persons/${PERSON_ID}`,
    params: {},
    found: false,
    forwarded: [PERSON_ID],
    body: expect.objectContaining({ statusCode: 404 }),
  },
  {
    path: `/v1/elections/person-merges/${RETIRED_ID}`,
    params: {},
    found: true,
    forwarded: [RETIRED_ID],
    body: expect.objectContaining({ retiredId: RETIRED_ID }),
  },
  {
    path: '/v1/elections/places',
    params: { state: 'WY' },
    found: true,
    forwarded: [expect.objectContaining({ state: 'WY' })],
    body: [],
  },
  {
    path: '/v1/elections/places/most-elections',
    params: { count: 5 },
    found: true,
    forwarded: [100, 5],
    body: [],
  },
  {
    path: `/v1/elections/positions/${POSITION_ID}`,
    params: {
      includeDistrict: true,
      includeFilingFee: true,
      electionDate: '2026-11-03',
    },
    found: false,
    forwarded: [
      {
        id: POSITION_ID,
        includeDistrict: true,
        electionDate: '2026-11-03',
        includeFilingFee: true,
      },
    ],
    body: expect.objectContaining({ statusCode: 404 }),
  },
  {
    path: '/v1/elections/races',
    params: { state: 'WY' },
    found: true,
    forwarded: [expect.objectContaining({ state: 'WY' })],
    body: [],
  },
]

const withBearer = (token: string) => ({
  headers: { Authorization: `Bearer ${token}` },
})

describe('election data routes read by gp-marketing', () => {
  const serviceCalls = new Map<string, MockInstance>()

  beforeEach(() => {
    const notFound = () => Promise.reject(new NotFoundException())
    serviceCalls.clear()
    serviceCalls.set(
      '/v1/elections/candidacies',
      vi
        .spyOn(service.app.get(CandidaciesService), 'getCandidacies')
        .mockResolvedValue([]),
    )
    serviceCalls.set(
      '/v1/elections/officeholders',
      vi
        .spyOn(service.app.get(OfficeHoldersService), 'getOfficeHolders')
        .mockResolvedValue([]),
    )
    const persons = service.app.get(PersonsService)
    serviceCalls.set(
      '/v1/elections/persons',
      vi.spyOn(persons, 'getPersons').mockResolvedValue([]),
    )
    serviceCalls.set(
      '/v1/elections/persons/by-slug/jane-doe-11111111',
      vi.spyOn(persons, 'getPersonBySlug').mockImplementation(notFound),
    )
    serviceCalls.set(
      `/v1/elections/persons/${PERSON_ID}`,
      vi.spyOn(persons, 'getPersonById').mockImplementation(notFound),
    )
    serviceCalls.set(
      `/v1/elections/person-merges/${RETIRED_ID}`,
      vi
        .spyOn(service.app.get(PersonMergesService), 'getPersonMerge')
        .mockResolvedValue({
          retiredId: RETIRED_ID,
          survivingId: PERSON_ID,
          retiredSlug: 'jane-doe',
          retiredAt: new Date('2026-09-01T00:00:00Z'),
          createdAt: new Date('2026-09-01T00:00:00Z'),
        }),
    )
    const places = service.app.get(PlacesService)
    serviceCalls.set(
      '/v1/elections/places',
      vi.spyOn(places, 'getPlaces').mockResolvedValue([]),
    )
    serviceCalls.set(
      '/v1/elections/places/most-elections',
      vi.spyOn(places, 'getPlacesWithMostElections').mockResolvedValue([]),
    )
    serviceCalls.set(
      `/v1/elections/positions/${POSITION_ID}`,
      vi
        .spyOn(service.app.get(PositionsService), 'getPositionById')
        .mockImplementation(notFound),
    )
    serviceCalls.set(
      '/v1/elections/races',
      vi
        .spyOn(service.app.get(RacesService), 'findRaces')
        .mockResolvedValue([]),
    )
  })

  it.each(ROUTES)('403s $path with no token', async ({ path, params }) => {
    const res = await axios.get(path, {
      baseURL: service.client.defaults.baseURL,
      params,
      validateStatus: () => true,
    })
    expect(res.status).toBe(403)
  })

  it.each(ROUTES)(
    '403s $path for a logged-in user who is not an admin',
    async ({ path, params }) => {
      const res = await service.client.get(path, { params })
      expect(res.status).toBe(403)
    },
  )

  it.each(ROUTES)(
    'serves $path to a JWT-format machine token',
    async ({ path, params, found, forwarded, body }) => {
      const res = await service.client.get(path, {
        params,
        ...withBearer(signTestM2MJwt()),
      })
      expect(res.status).toBe(found ? 200 : 404)
      expect(res.data).toEqual(body)
      expect(serviceCalls.get(path)).toHaveBeenCalledExactlyOnceWith(
        ...forwarded,
      )
    },
  )

  it('narrows a person merge to the forwarding fields', async () => {
    const res = await service.client.get(
      `/v1/elections/person-merges/${RETIRED_ID}`,
      withBearer(signTestM2MJwt()),
    )
    expect(res.data).toEqual({
      retiredId: RETIRED_ID,
      survivingId: PERSON_ID,
      retiredSlug: 'jane-doe',
      retiredAt: '2026-09-01T00:00:00.000Z',
    })
  })
})
