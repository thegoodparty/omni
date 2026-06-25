import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { PositionLevel } from 'src/generated/graphql.types'

// The module throws at import time if BALLOT_READY_KEY is unset, and creates a
// GraphQLClient as a field initializer — stub the env and mock the client before
// import. The gql mock reconstructs the interpolated string so we can assert no
// attacker value is embedded in the query text.
const { mockRequest } = vi.hoisted(() => ({ mockRequest: vi.fn() }))
vi.hoisted(() => {
  process.env.BALLOT_READY_KEY = 'test-key'
})
vi.mock('graphql-request', () => ({
  gql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce(
      (acc, str, i) => acc + str + (i < values.length ? String(values[i]) : ''),
      '',
    ),
  GraphQLClient: class {
    request = mockRequest
  },
}))
vi.mock('zipcodes', () => ({
  default: { lookup: vi.fn(() => ({ state: 'OR' })) },
}))

import zipcodes from 'zipcodes'
import { BallotReadyService } from './ballotReady.service'

// A payload that breaks out of node(id: "...") under string interpolation.
const INJECTION_ID = 'x") { __typename } node(id: "y'

describe('BallotReadyService GraphQL injection hardening', () => {
  let service: BallotReadyService

  beforeEach(() => {
    vi.clearAllMocks()
    mockRequest.mockResolvedValue({ node: null })
    service = new BallotReadyService(createMockLogger())
  })

  describe('race-id methods pass the id as a typed variable', () => {
    it('fetchRaceById sends node(id: $id) with the id as a variable, not interpolated', async () => {
      await service.fetchRaceById('Z2lkOi8vYmFsbG90')

      const [query, variables] = mockRequest.mock.calls[0]
      expect(query).toContain('node(id: $id)')
      expect(query).not.toContain('Z2lkOi8vYmFsbG90')
      expect(variables).toEqual({ id: 'Z2lkOi8vYmFsbG90' })
    })

    it('fetchRaceById rejects a malformed id without calling BallotReady', async () => {
      const result = await service.fetchRaceById(INJECTION_ID)

      expect(result).toBeNull()
      expect(mockRequest).not.toHaveBeenCalled()
    })

    it('fetchRaceNormalizedPosition rejects a malformed id without calling BallotReady', async () => {
      const result = await service.fetchRaceNormalizedPosition(INJECTION_ID)

      expect(result).toBeNull()
      expect(mockRequest).not.toHaveBeenCalled()
    })

    it('fetchRaceNormalizedPosition passes a valid id as a variable, not interpolated', async () => {
      await service.fetchRaceNormalizedPosition('Z2lkOi8vcG9zaXRpb24=')

      const [query, variables] = mockRequest.mock.calls[0]
      expect(query).toContain('node(id: $id)')
      expect(query).not.toContain('Z2lkOi8vcG9zaXRpb24=')
      expect(variables).toEqual({ id: 'Z2lkOi8vcG9zaXRpb24=' })
    })

    it('fetchRacesWithOfficeHolders rejects a malformed id without calling BallotReady', async () => {
      const result = await service.fetchRacesWithOfficeHolders(INJECTION_ID)

      expect(result).toBeNull()
      expect(mockRequest).not.toHaveBeenCalled()
    })

    it('fetchRacesWithOfficeHolders passes a valid id as a variable', async () => {
      await service.fetchRacesWithOfficeHolders('Z2lkOi8vcmFjZQ==')

      const [query, variables] = mockRequest.mock.calls[0]
      expect(query).toContain('node(id: $id)')
      expect(variables).toEqual({ id: 'Z2lkOi8vcmFjZQ==' })
    })

    it('fetchPersonOfficeHolders rejects a malformed id without calling BallotReady', async () => {
      const result = await service.fetchPersonOfficeHolders(INJECTION_ID)

      expect(result).toBeNull()
      expect(mockRequest).not.toHaveBeenCalled()
    })

    it('fetchPersonOfficeHolders passes a valid id as a variable, not interpolated', async () => {
      mockRequest.mockResolvedValue({ node: null })
      await service.fetchPersonOfficeHolders('Z2lkOi8vcGVyc29u')

      const [query, variables] = mockRequest.mock.calls[0]
      expect(query).toContain('node(id: $personId)')
      expect(query).not.toContain('Z2lkOi8vcGVyc29u')
      expect(variables).toEqual({ personId: 'Z2lkOi8vcGVyc29u' })
    })

    it('fetchMilestones rejects a malformed id without calling BallotReady', async () => {
      const result = await service.fetchMilestones(INJECTION_ID)

      expect(result).toBeNull()
      expect(mockRequest).not.toHaveBeenCalled()
    })
  })

  describe('fetchRacesWithElectionDates', () => {
    it('passes zip and the upper date bound as variables and only a known enum level', async () => {
      mockRequest.mockResolvedValue({ races: { edges: [] } })

      await service.fetchRacesWithElectionDates('97201', PositionLevel.CITY)

      const [query, variables] = mockRequest.mock.calls[0]
      expect(query).toContain('location: { zip: $zip }')
      expect(query).toContain('level: CITY')
      expect(variables).toEqual({ zip: '97201', lt: expect.any(String) })
    })

    it('truncates a ZIP+4 to the first 5 digits before sending', async () => {
      mockRequest.mockResolvedValue({ races: { edges: [] } })

      await service.fetchRacesWithElectionDates(
        '97201-3456',
        PositionLevel.CITY,
      )

      const [, variables] = mockRequest.mock.calls[0]
      expect(variables.zip).toBe('97201')
    })

    it('rejects an unrecognised position level without calling BallotReady', async () => {
      const result = await service.fetchRacesWithElectionDates(
        '97201',
        'CITY) { __typename } x(' as PositionLevel,
      )

      expect(result).toBeNull()
      expect(mockRequest).not.toHaveBeenCalled()
    })
  })

  describe('fetchRacesByZipcode', () => {
    it('parameterizes zip/date/cursor and expands a known level to validated enum tokens', async () => {
      mockRequest.mockResolvedValue({ races: { edges: [], pageInfo: {} } })

      await service.fetchRacesByZipcode('97201', 'LOCAL', null, 'cursor-1')

      const [query, variables] = mockRequest.mock.calls[0]
      expect(query).toContain('location: { zip: $zip }')
      expect(query).toContain('electionDay: { gte: $gte, lte: $lte }')
      expect(query).toContain('level: [LOCAL,TOWNSHIP,CITY]')
      expect(variables).toMatchObject({
        zip: '97201',
        gte: expect.any(String),
        lte: expect.any(String),
        after: 'cursor-1',
      })
    })

    it('passes after: null as a variable when no cursor is supplied', async () => {
      mockRequest.mockResolvedValue({ races: { edges: [], pageInfo: {} } })

      await service.fetchRacesByZipcode('97201', 'STATE', null, null)

      const [, variables] = mockRequest.mock.calls[0]
      expect(variables.after).toBeNull()
    })

    it('drops the level filter entirely for an unrecognised level (no injection)', async () => {
      mockRequest.mockResolvedValue({ races: { edges: [], pageInfo: {} } })

      await service.fetchRacesByZipcode('97201', 'EVIL] injected [', null, null)

      const [query] = mockRequest.mock.calls[0]
      expect(query).not.toContain('injected')
      expect(query).not.toContain('level:')
    })

    it('omits the state filter when the zipcode lookup returns no state (no injection)', async () => {
      // The [A-Z]{2} guard drops a non-2-letter / missing state so nothing
      // unvalidated reaches the interpolated `state: "..."` filter.
      vi.mocked(zipcodes.lookup).mockReturnValueOnce(undefined as never)
      mockRequest.mockResolvedValue({ races: { edges: [], pageInfo: {} } })

      await service.fetchRacesByZipcode('00000', null, null, null)

      const [query] = mockRequest.mock.calls[0]
      expect(query).not.toContain('state:')
    })
  })
})
