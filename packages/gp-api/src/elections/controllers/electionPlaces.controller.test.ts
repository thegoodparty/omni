import { describe, expect, it } from 'vitest'
import {
  ElectionPlacesController,
  mostElectionsResponseSchema,
  placesResponseSchema,
} from './electionPlaces.controller'

const getPath = (methodName: keyof ElectionPlacesController) =>
  Reflect.getMetadata('path', ElectionPlacesController.prototype[methodName])

describe('ElectionPlacesController', () => {
  describe('routing', () => {
    it('exposes both marketing paths under the controller', () => {
      expect(getPath('getPlaces')).toBe('/')
      expect(getPath('getPlacesWithMostElections')).toBe('most-elections')
    })

    it('keeps most-elections a static segment, never a :param route', () => {
      expect(getPath('getPlacesWithMostElections')).not.toContain(':')
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
