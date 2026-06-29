import { describe, expect, it, vi } from 'vitest'
import { RaceFrequencyByBrHashSchema } from '@goodparty_org/contracts'
import { RacesController } from './races.controller'
import { RacesService } from './races.service'

// Guards the wire contract between election-api and its consumers (gp-api):
// the /races/by-br-hash-id/:brHashId/frequency response must keep satisfying
// the contracts RaceFrequencyByBrHash schema.
describe('RacesController contract alignment', () => {
  it('getFrequencyByBrHashId returns a RaceFrequencyByBrHash response', async () => {
    const findFrequencyByBrHashId = vi
      .fn()
      .mockResolvedValue({ frequency: [2, 2], electionDate: '2026-11-03' })
    const controller = new RacesController({
      findFrequencyByBrHashId,
    } as unknown as RacesService)

    const result = await controller.getFrequencyByBrHashId({
      brHashId: 'hash-1',
    })

    expect(findFrequencyByBrHashId).toHaveBeenCalledWith('hash-1')
    expect(RaceFrequencyByBrHashSchema.parse(result)).toEqual({
      frequency: [2, 2],
      electionDate: '2026-11-03',
    })
  })

  it('accepts empty frequency with null electionDate (no match)', async () => {
    const findFrequencyByBrHashId = vi
      .fn()
      .mockResolvedValue({ frequency: [], electionDate: null })
    const controller = new RacesController({
      findFrequencyByBrHashId,
    } as unknown as RacesService)

    const result = await controller.getFrequencyByBrHashId({
      brHashId: 'hash-1',
    })

    expect(() => RaceFrequencyByBrHashSchema.parse(result)).not.toThrow()
  })
})
