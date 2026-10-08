import { beforeEach, describe, expect, it, vi } from 'vitest'
import { M2MOnly } from '@/authentication/guards/M2MOnly.guard'
import {
  MostElectionsDto,
  PlaceFilterDto,
} from '@/electionDb/places/places.schema'
import { PlacesService } from '@/electionDb/places/places.service'
import {
  ElectionPlacesController,
  mostElectionsResponseSchema,
  placesResponseSchema,
} from './electionPlaces.controller'

const getGuards = (methodName: keyof ElectionPlacesController) =>
  Reflect.getMetadata(
    '__guards__',
    ElectionPlacesController.prototype[methodName],
  ) ?? []

const getPath = (methodName: keyof ElectionPlacesController) =>
  Reflect.getMetadata('path', ElectionPlacesController.prototype[methodName])

const baseFilter = {
  includeChildren: false,
  includeChildRaces: false,
  includeParent: false,
  includeRaces: false,
  categorizeChildren: false,
} as PlaceFilterDto

describe('ElectionPlacesController', () => {
  let controller: ElectionPlacesController
  const getPlaces = vi.fn()
  const getPlacesWithMostElections = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    controller = new ElectionPlacesController({
      getPlaces,
      getPlacesWithMostElections,
    } as unknown as PlacesService)
  })

  describe('guards', () => {
    it('protects getPlaces with M2MOnly', () => {
      expect(getGuards('getPlaces')).toContain(M2MOnly)
    })

    it('protects getPlacesWithMostElections with M2MOnly', () => {
      expect(getGuards('getPlacesWithMostElections')).toContain(M2MOnly)
    })
  })

  describe('routing', () => {
    it('exposes both marketing paths under the controller', () => {
      expect(getPath('getPlaces')).toBe('/')
      expect(getPath('getPlacesWithMostElections')).toBe('most-elections')
    })

    it('keeps most-elections a static segment, never a :param route', () => {
      expect(getPath('getPlacesWithMostElections')).not.toContain(':')
    })
  })

  describe('getPlaces', () => {
    it('delegates the filter straight to the service', async () => {
      const filter = { ...baseFilter, state: 'TX' } as PlaceFilterDto
      getPlaces.mockResolvedValue([])

      await controller.getPlaces(filter)

      expect(getPlaces).toHaveBeenCalledWith(filter)
      expect(getPlaces).toHaveBeenCalledTimes(1)
    })

    it('returns what the service returns', async () => {
      const places = [{ id: 'place-1', name: 'Mission' }]
      getPlaces.mockResolvedValue(places)

      await expect(controller.getPlaces(baseFilter)).resolves.toBe(places)
    })
  })

  describe('getPlacesWithMostElections', () => {
    it('delegates with the MIN_RACES floor and the requested count', async () => {
      getPlacesWithMostElections.mockResolvedValue([])

      await controller.getPlacesWithMostElections({
        count: 5,
      } as MostElectionsDto)

      expect(getPlacesWithMostElections).toHaveBeenCalledWith(100, 5)
    })
  })

  describe('response narrowing', () => {
    it('drops undeclared place columns', () => {
      const parsed = placesResponseSchema.parse([
        {
          id: 'place-1',
          name: 'Mission',
          slug: 'tx/hidalgo/mission',
          state: 'TX',
          secretInternalColumn: 'leak',
        },
      ])

      expect(parsed[0]).not.toHaveProperty('secretInternalColumn')
      expect(parsed[0]).toEqual({
        id: 'place-1',
        name: 'Mission',
        slug: 'tx/hidalgo/mission',
        state: 'TX',
      })
    })

    it('drops undeclared columns on nested races and children', () => {
      const parsed = placesResponseSchema.parse([
        {
          id: 'place-1',
          Races: [{ id: 'race-1', slug: 'a', undeclaredRaceColumn: 'leak' }],
          children: [{ id: 'child-1', undeclaredPlaceColumn: 'leak' }],
        },
      ])

      expect(parsed[0]?.Races?.[0]).toEqual({ id: 'race-1', slug: 'a' })
      expect(parsed[0]?.children?.[0]).toEqual({ id: 'child-1' })
    })

    it('narrows the most-elections rows to slug, name and race_count', () => {
      const parsed = mostElectionsResponseSchema.parse([
        {
          slug: 'tx/hidalgo/mission',
          name: 'Mission',
          race_count: 120,
          internalPlaceId: 'leak',
        },
      ])

      expect(parsed[0]).toEqual({
        slug: 'tx/hidalgo/mission',
        name: 'Mission',
        race_count: 120,
      })
    })
  })
})
