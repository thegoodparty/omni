import { NotFoundException } from '@nestjs/common'
import axios from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CandidaciesService } from '@/electionDb/candidacies/candidacies.service'
import { OfficeHoldersService } from '@/electionDb/officeHolders/officeHolders.service'
import { PersonsService } from '@/electionDb/persons/persons.service'
import { PlacesService } from '@/electionDb/places/places.service'
import { PositionsService } from '@/electionDb/positions/positions.service'
import { RacesService } from '@/electionDb/races/races.service'
import { signTestM2MJwt, useTestService } from '@/test-service'

const service = useTestService()

const PERSON_ID = '11111111-1111-4111-8111-111111111111'
const POSITION_ID = '22222222-2222-4222-8222-222222222222'

// The nine routes gp-marketing reads. It authenticates with one long-lived
// JWT-format machine token, which SessionGuard only ever turns into
// `serviceReader`, so these must accept a service reader, not just an
// opaque mt_ token.
const ROUTES = [
  { path: '/v1/elections/candidacies', params: { state: 'WY' }, found: true },
  { path: '/v1/elections/officeholders', params: { state: 'WY' }, found: true },
  { path: '/v1/elections/persons', params: { state: 'WY' }, found: true },
  {
    path: '/v1/elections/persons/by-slug/jane-doe-11111111',
    params: {},
    found: false,
  },
  { path: `/v1/elections/persons/${PERSON_ID}`, params: {}, found: false },
  { path: '/v1/elections/places', params: { state: 'WY' }, found: true },
  {
    path: '/v1/elections/places/most-elections',
    params: { count: 5 },
    found: true,
  },
  { path: `/v1/elections/positions/${POSITION_ID}`, params: {}, found: false },
  { path: '/v1/elections/races', params: { state: 'WY' }, found: true },
]

const withBearer = (token: string) => ({
  headers: { Authorization: `Bearer ${token}` },
})

describe('election data routes read by gp-marketing', () => {
  beforeEach(() => {
    const notFound = () => Promise.reject(new NotFoundException())
    vi.spyOn(
      service.app.get(CandidaciesService),
      'getCandidacies',
    ).mockResolvedValue([])
    vi.spyOn(
      service.app.get(OfficeHoldersService),
      'getOfficeHolders',
    ).mockResolvedValue([])
    const persons = service.app.get(PersonsService)
    vi.spyOn(persons, 'getPersons').mockResolvedValue([])
    vi.spyOn(persons, 'getPersonBySlug').mockImplementation(notFound)
    vi.spyOn(persons, 'getPersonById').mockImplementation(notFound)
    const places = service.app.get(PlacesService)
    vi.spyOn(places, 'getPlaces').mockResolvedValue([])
    vi.spyOn(places, 'getPlacesWithMostElections').mockResolvedValue([])
    vi.spyOn(
      service.app.get(PositionsService),
      'getPositionById',
    ).mockImplementation(notFound)
    vi.spyOn(service.app.get(RacesService), 'findRaces').mockResolvedValue([])
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
    async ({ path, params, found }) => {
      const res = await service.client.get(path, {
        params,
        ...withBearer(signTestM2MJwt()),
      })
      expect(res.status).toBe(found ? 200 : 404)
    },
  )
})
