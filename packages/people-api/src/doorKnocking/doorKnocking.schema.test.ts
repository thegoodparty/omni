import { describe, expect, it } from 'vitest'
import { DoorKnockingEvaluateDTO } from './doorKnocking.schema'

const base = {
  districtId: '457a1cd7-4184-f823-49d3-f207af693521',
  bbox: { minLat: 41.8, maxLat: 41.9, minLng: -87.7, maxLng: -87.6 },
  maxPeople: 5000,
}

describe('DoorKnockingEvaluateDTO', () => {
  it('transforms wire filters into the SQL pipeline FilterData shape', () => {
    const parsed = DoorKnockingEvaluateDTO.schema.parse({
      ...base,
      filters: { voterStatus: { in: ['Super'] } },
    })

    expect(parsed.filters).toEqual({
      filters: ['voterStatus'],
      filterValues: { voterStatus: ['Super'] },
      filterOperators: {
        voterStatus: { operator: 'in', values: ['Super'], includeNull: false },
      },
    })
  })

  it('defaults absent filters to empty FilterData', () => {
    const parsed = DoorKnockingEvaluateDTO.schema.parse(base)
    expect(parsed.filters.filters).toEqual([])
  })

  it('stays strict about unknown keys', () => {
    expect(() =>
      DoorKnockingEvaluateDTO.schema.parse({ ...base, limit: 5 }),
    ).toThrow()
  })
})
