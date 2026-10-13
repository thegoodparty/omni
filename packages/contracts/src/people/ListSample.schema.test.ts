import { describe, expect, it } from 'vitest'
import { ListSampleSchema } from './ListSample.schema'

describe('ListSampleSchema', () => {
  it('takes a panel part inside the sample', () => {
    expect(ListSampleSchema.parse({ size: 240, panelSize: 120 })).toEqual({
      size: 240,
      panelSize: 120,
    })
  })

  // A panel part the whole size would invite nobody new to join.
  it('refuses a panel part that leaves no room for new residents', () => {
    expect(
      ListSampleSchema.safeParse({ size: 100, panelSize: 101 }).success,
    ).toBe(false)
    expect(
      ListSampleSchema.safeParse({ size: 120, panelSize: 120 }).success,
    ).toBe(false)
  })
})
