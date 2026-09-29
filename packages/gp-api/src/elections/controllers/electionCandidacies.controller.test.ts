import { beforeEach, describe, expect, it, vi } from 'vitest'
import { M2MOnly } from '@/authentication/guards/M2MOnly.guard'
import { CandidacyFilterDto } from '@/electionDb/candidacies/candidacies.schema'
import { CandidaciesService } from '@/electionDb/candidacies/candidacies.service'
import {
  candidaciesResponseSchema,
  ElectionCandidaciesController,
} from './electionCandidacies.controller'

const getGuards = (methodName: keyof ElectionCandidaciesController) =>
  Reflect.getMetadata(
    '__guards__',
    ElectionCandidaciesController.prototype[methodName],
  ) ?? []

const getPath = (methodName: keyof ElectionCandidaciesController) =>
  Reflect.getMetadata(
    'path',
    ElectionCandidaciesController.prototype[methodName],
  )

const baseFilter = {
  includeStances: false,
  includeRace: false,
} as CandidacyFilterDto

describe('ElectionCandidaciesController', () => {
  let controller: ElectionCandidaciesController
  const getCandidacies = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    controller = new ElectionCandidaciesController({
      getCandidacies,
    } as unknown as CandidaciesService)
  })

  describe('guards', () => {
    it('protects getCandidates with M2MOnly', () => {
      expect(getGuards('getCandidates')).toContain(M2MOnly)
    })
  })

  describe('routing', () => {
    it('exposes the list at the controller root', () => {
      expect(getPath('getCandidates')).toBe('/')
    })
  })

  describe('getCandidates', () => {
    it('delegates the filter straight to the service', async () => {
      const filter = { ...baseFilter, state: 'TX' } as CandidacyFilterDto
      getCandidacies.mockResolvedValue([])

      await controller.getCandidates(filter)

      expect(getCandidacies).toHaveBeenCalledWith(filter)
      expect(getCandidacies).toHaveBeenCalledTimes(1)
    })

    it('returns what the service returns', async () => {
      const candidacies = [{ id: 'candidacy-1' }]
      getCandidacies.mockResolvedValue(candidacies)

      await expect(controller.getCandidates(baseFilter)).resolves.toBe(
        candidacies,
      )
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
