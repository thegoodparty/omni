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

  it("takes the people a send reached as the sample's pool", () => {
    expect(
      ListSampleSchema.parse({ size: 300, recipientsOfOutreachId: 12 }),
    ).toEqual({ size: 300, recipientsOfOutreachId: 12 })
  })

  // A report back goes to exactly who was asked, so it is never mixed with
  // a panel draw or a widen.
  it('refuses a send-recipients sample mixed with another draw', () => {
    expect(
      ListSampleSchema.safeParse({
        size: 300,
        panelSize: 100,
        recipientsOfOutreachId: 12,
      }).success,
    ).toBe(false)
    expect(
      ListSampleSchema.safeParse({
        size: 300,
        excludeOutreachIds: [3],
        recipientsOfOutreachId: 12,
      }).success,
    ).toBe(false)
  })
})
