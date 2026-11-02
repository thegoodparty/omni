import { describe, expect, it } from 'vitest'
import {
  candidaciesResponseSchema,
  ElectionCandidaciesController,
} from './electionCandidacies.controller'

const getPath = (methodName: keyof ElectionCandidaciesController) =>
  Reflect.getMetadata(
    'path',
    ElectionCandidaciesController.prototype[methodName],
  )

describe('ElectionCandidaciesController', () => {
  describe('routing', () => {
    it('exposes the list at the controller root', () => {
      expect(getPath('getCandidates')).toBe('/')
    })
  })

  describe('response narrowing', () => {
    it('drops email and any other undeclared candidacy column', () => {
      const parsed = candidaciesResponseSchema.parse([
        {
          id: 'candidacy-1',
          firstName: 'Ada',
          lastName: 'Lovelace',
          email: 'ada@example.com',
          secretInternalColumn: 'leak',
        },
      ])

      expect(parsed[0]).not.toHaveProperty('email')
      expect(parsed[0]).toEqual({
        id: 'candidacy-1',
        firstName: 'Ada',
        lastName: 'Lovelace',
      })
    })

    it('drops undeclared columns on nested stances and races', () => {
      const parsed = candidaciesResponseSchema.parse([
        {
          id: 'candidacy-1',
          Stances: [
            {
              id: 'stance-1',
              stanceStatement: 'For libraries',
              Issue: { id: 'issue-1', name: 'Libraries', undeclared: 'leak' },
              undeclaredStanceColumn: 'leak',
            },
          ],
          Race: { id: 'race-1', slug: 'a', undeclaredRaceColumn: 'leak' },
        },
      ])

      expect(parsed[0]?.Stances?.[0]).toEqual({
        id: 'stance-1',
        stanceStatement: 'For libraries',
        Issue: { id: 'issue-1', name: 'Libraries' },
      })
      expect(parsed[0]?.Race).toEqual({ id: 'race-1', slug: 'a' })
    })
  })
})
