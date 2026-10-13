import { describe, expect, it } from 'vitest'
import { ListSampleSchema } from './ListSample.schema'

describe('ListSampleSchema', () => {
  it('takes a panel part inside the sample', () => {
    expect(ListSampleSchema.parse({ size: 240, panelSize: 120 })).toEqual({
      size: 240,
      panelSize: 120,
    })
    expect(ListSampleSchema.parse({ size: 120, panelSize: 120 })).toEqual({
      size: 120,
      panelSize: 120,
    })
  })

  it('refuses a panel part bigger than the sample', () => {
    expect(
      ListSampleSchema.safeParse({ size: 100, panelSize: 101 }).success,
    ).toBe(false)
  })
})
