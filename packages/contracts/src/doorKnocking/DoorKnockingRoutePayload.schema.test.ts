import { describe, expect, it } from 'vitest'
import { RoutePayloadTargetSchema } from './DoorKnockingRoutePayload.schema'

// The keys the target has carried since before either enrichment field
// shipped. A service worker's snapshot of a walk holds exactly this and no
// more, which is what the optionality below has to survive.
const snapshotTarget = {
  stopTargetId: 918400,
  personId: '11111111-1111-1111-1111-111111111111',
  name: 'Marisol Vega',
  age: 47,
  politicalParty: 'Independent',
  cellPhone: '(615) 555-0142',
  landline: null,
  knockStatus: 'unknown',
  mayHaveMoved: false,
  doNotKnock: false,
}

const note = {
  id: '019826f4-0000-7000-8000-000000000001',
  personId: snapshotTarget.personId,
  body: 'Dog in the front yard, use the side gate',
  createdAt: '2026-07-01T10:00:00.000Z',
  updatedAt: '2026-07-20T09:30:00.000Z',
  actorName: null,
}

describe('RoutePayloadTargetSchema notes (ADR 0011)', () => {
  // The whole reason the field is `.optional()` rather than required or
  // `.default([])`. A route snapshotted for an offline walk before this
  // shipped carries no `notes` key, and the phone holding it cannot refetch.
  it('parses a target snapshotted before notes existed', () => {
    const parsed = RoutePayloadTargetSchema.parse(snapshotTarget)
    expect(parsed.notes).toBeUndefined()
  })

  // `.default([])` would make this assertion fail, which is the point: a
  // default fills in nothing on a path where nothing parses at runtime, and
  // only tells the compiler the key is always there. Absent has to stay
  // distinguishable from "this resident has no notes".
  it('leaves an absent block absent rather than defaulting it', () => {
    expect(
      Object.keys(RoutePayloadTargetSchema.parse(snapshotTarget)),
    ).not.toContain('notes')
  })

  it('accepts a populated block with its full count', () => {
    const parsed = RoutePayloadTargetSchema.parse({
      ...snapshotTarget,
      notes: { entries: [note], total: 9 },
    })
    expect(parsed.notes).toEqual({ entries: [note], total: 9 })
  })

  // Empty-but-present is what the server sends for a resident nobody has
  // written anything about, and it has to be a legal parse rather than
  // collapsing into the absent case above.
  it('accepts an empty block', () => {
    const parsed = RoutePayloadTargetSchema.parse({
      ...snapshotTarget,
      notes: { entries: [], total: 0 },
    })
    expect(parsed.notes).toEqual({ entries: [], total: 0 })
  })

  // The count is not derivable from the rows, so it is not optional within the
  // block — a block without it would be a truncated list that cannot say so.
  it('rejects entries without a total', () => {
    expect(() =>
      RoutePayloadTargetSchema.parse({
        ...snapshotTarget,
        notes: { entries: [note] },
      }),
    ).toThrow()
  })
})
