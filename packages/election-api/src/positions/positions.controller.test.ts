import { describe, expect, it, vi } from 'vitest'
import { NextElectionForPositionSchema } from '@goodparty_org/contracts'
import { PositionsController } from './positions.controller'
import { PositionsService } from './positions.service'

// Guards the wire contract between election-api and its consumers (gp-api):
// the /positions/:id/next-election response must keep satisfying the contracts
// NextElectionForPosition schema.
describe('PositionsController contract alignment', () => {
  it('getNextElectionForPosition returns a NextElectionForPosition response', async () => {
    const getNextElectionForPosition = vi
      .fn()
      .mockResolvedValue({ electionDate: '2026-11-03' })
    const controller = new PositionsController({
      getNextElectionForPosition,
    } as unknown as PositionsService)

    const result = await controller.getNextElectionForPosition({ id: 'pos-1' })

    expect(getNextElectionForPosition).toHaveBeenCalledWith('pos-1')
    expect(NextElectionForPositionSchema.parse(result)).toEqual({
      electionDate: '2026-11-03',
    })
  })

  it('accepts a null electionDate (no upcoming race)', async () => {
    const getNextElectionForPosition = vi
      .fn()
      .mockResolvedValue({ electionDate: null })
    const controller = new PositionsController({
      getNextElectionForPosition,
    } as unknown as PositionsService)

    const result = await controller.getNextElectionForPosition({ id: 'pos-1' })

    expect(() => NextElectionForPositionSchema.parse(result)).not.toThrow()
  })
})
