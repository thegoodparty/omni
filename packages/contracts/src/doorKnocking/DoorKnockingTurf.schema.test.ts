import { describe, expect, it } from 'vitest'
import { DoorKnockingOutreachDetailSchema } from './DoorKnockingTurf.schema'
import { OutreachDetailSchema } from '../outreach/OutreachSocial.schema'

const block = {
  turfId: 12,
  routeId: 7,
  turfName: 'Elm St & 5th',
  doorCount: 4,
  peopleCount: 9,
  loggedCount: 6,
  completedAt: null,
  archivedAt: null,
}

const envelope = {
  id: 30,
  createdAt: '2026-08-10T00:00:00.000Z',
  updatedAt: '2026-08-10T00:00:00.000Z',
  campaignId: 1,
  outreachType: 'nativeDoorKnocking',
  projectId: null,
  name: 'Elm St & 5th',
  status: 'in_progress',
  error: null,
  audienceRequest: null,
  script: null,
  message: null,
  date: null,
  imageUrl: null,
  voterFileFilterId: 3,
  doorKnockingRouteId: 7,
  phoneListId: null,
  identityId: null,
  didState: null,
  didNpaSubset: [],
  title: null,
  textCount: null,
  billableTextCount: null,
  campaignPlanDueDate: null,
  organizationSlug: 'org',
  archivedAt: null,
}

describe('DoorKnockingOutreachDetailSchema', () => {
  it('parses a walk with its counts and turf lifecycle', () => {
    expect(() => DoorKnockingOutreachDetailSchema.parse(block)).not.toThrow()
  })

  // Nullable where the rail's are nullable, but never absent: an envelope
  // exists only for a route that was frozen, so a block that reached the wire
  // always has doors to count. Null here would let a walked list read as an
  // unknocked one.
  it('rejects a null count', () => {
    expect(() =>
      DoorKnockingOutreachDetailSchema.parse({ ...block, doorCount: null }),
    ).toThrow()
  })

  it('accepts the turf lifecycle timestamps as ISO strings', () => {
    const parsed = DoorKnockingOutreachDetailSchema.parse({
      ...block,
      completedAt: '2026-08-01T12:00:00.000Z',
      archivedAt: '2026-08-02T12:00:00.000Z',
    })
    expect(parsed.completedAt).toBeInstanceOf(Date)
    expect(parsed.archivedAt).toBeInstanceOf(Date)
  })
})

describe('OutreachDetailSchema — doorKnocking block', () => {
  it('carries the block through the envelope', () => {
    const parsed = OutreachDetailSchema.parse({
      ...envelope,
      doorKnocking: block,
    })
    expect(parsed.doorKnocking).toMatchObject({ turfId: 12, doorCount: 4 })
  })

  // Optional, not nullable: a tombstoned list and every non-door-knocking
  // channel omit the key entirely rather than sending null.
  it('parses an envelope with no block at all', () => {
    const parsed = OutreachDetailSchema.parse(envelope)
    expect(parsed.doorKnocking).toBeUndefined()
  })
})
