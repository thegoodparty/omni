import { beforeEach, describe, expect, it, vi } from 'vitest'
import { M2MOnly } from '@/authentication/guards/M2MOnly.guard'
import { RaceFilterDto } from '@/electionDb/races/races.schema'
import { RacesService } from '@/electionDb/races/races.service'
import {
  ElectionRacesController,
  racesResponseSchema,
} from './electionRaces.controller'

const getGuards = (methodName: keyof ElectionRacesController) =>
  Reflect.getMetadata(
    '__guards__',
    ElectionRacesController.prototype[methodName],
  ) ?? []

const getPath = (methodName: keyof ElectionRacesController) =>
  Reflect.getMetadata('path', ElectionRacesController.prototype[methodName])

const baseFilter = {
  includePlace: false,
  includeCandidacies: false,
  page: 1,
  pageSize: 1000,
} as RaceFilterDto

describe('ElectionRacesController', () => {
  let controller: ElectionRacesController
  const findRaces = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    controller = new ElectionRacesController({
      findRaces,
    } as unknown as RacesService)
  })

  describe('guards', () => {
    it('protects getRaces with M2MOnly', () => {
      expect(getGuards('getRaces')).toContain(M2MOnly)
    })
  })

  describe('routing', () => {
    it('exposes the list at the controller root', () => {
      expect(getPath('getRaces')).toBe('/')
    })
  })

  describe('getRaces', () => {
    it('delegates the filter straight to the service', async () => {
      const filter = { ...baseFilter, state: 'TX' } as RaceFilterDto
      findRaces.mockResolvedValue([])

      await controller.getRaces(filter)

      expect(findRaces).toHaveBeenCalledWith(filter)
      expect(findRaces).toHaveBeenCalledTimes(1)
    })

    it('returns what the service returns', async () => {
      const races = [{ id: 'race-1' }]
      findRaces.mockResolvedValue(races)

      await expect(controller.getRaces(baseFilter)).resolves.toBe(races)
    })
  })

  describe('response narrowing', () => {
    it('drops undeclared race columns', () => {
      const parsed = racesResponseSchema.parse([
        {
          id: 'race-1',
          slug: 'tx/hidalgo/mission/county-sheriff',
          state: 'TX',
          secretInternalColumn: 'leak',
        },
      ])

      expect(parsed[0]).not.toHaveProperty('secretInternalColumn')
      expect(parsed[0]).toEqual({
        id: 'race-1',
        slug: 'tx/hidalgo/mission/county-sheriff',
        state: 'TX',
      })
    })

    it('never lets a nested candidacy email through', () => {
      const parsed = racesResponseSchema.parse([
        {
          id: 'race-1',
          Place: { id: 'place-1', name: 'Mission', undeclared: 'leak' },
          Candidacies: [
            {
              id: 'candidacy-1',
              firstName: 'Ada',
              email: 'ada@example.com',
            },
          ],
        },
      ])

      expect(parsed[0]?.Candidacies?.[0]).toEqual({
        id: 'candidacy-1',
        firstName: 'Ada',
      })
      expect(parsed[0]?.Place).toEqual({ id: 'place-1', name: 'Mission' })
    })
  })
})
