import { describe, expect, it } from 'vitest'
import {
  ElectionRacesController,
  racesResponseSchema,
} from './electionRaces.controller'

const getPath = (methodName: keyof ElectionRacesController) =>
  Reflect.getMetadata('path', ElectionRacesController.prototype[methodName])

describe('ElectionRacesController', () => {
  describe('routing', () => {
    it('exposes the list at the controller root', () => {
      expect(getPath('getRaces')).toBe('/')
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
