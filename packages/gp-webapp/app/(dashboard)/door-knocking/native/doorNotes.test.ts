import { describe, expect, it } from 'vitest'
import { ContactNote } from '@goodparty_org/contracts'
import {
  editServedNotes,
  seedDoorNotes,
  withCreatedNote,
  withDeletedNote,
  withUpdatedNote,
} from './doorNotes'

const note = (overrides: Partial<ContactNote> = {}): ContactNote => ({
  id: 'note-1',
  personId: 'person-1',
  body: 'Dog in the front yard, use the side gate',
  createdAt: '2026-07-01T10:00:00.000Z',
  updatedAt: '2026-07-01T10:00:00.000Z',
  actorName: null,
  ...overrides,
})

describe('seedDoorNotes', () => {
  it('takes the served block as it stands', () => {
    expect(seedDoorNotes({ entries: [note()], total: 9 })).toEqual({
      entries: [note()],
      total: 9,
    })
  })

  // ADR 0011 keeps `notes` optional so that absent and empty stay different
  // claims: an empty block says nobody has written about this resident, while
  // an absent one says the phone is holding a route snapshotted before the
  // field existed. Collapsing the second into `total: 0` would put the first
  // sentence on screen about a resident who may have a dozen notes.
  it('keeps an absent block distinguishable from an empty one', () => {
    expect(seedDoorNotes(undefined).total).toBeNull()
    expect(seedDoorNotes({ entries: [], total: 0 }).total).toBe(0)
  })
})

describe('withCreatedNote', () => {
  it('puts the new note first and counts it', () => {
    const created = note({ id: 'note-2', createdAt: '2026-08-24T18:00:00Z' })

    const next = withCreatedNote({ entries: [note()], total: 4 }, created)

    expect(next.entries.map((entry) => entry.id)).toEqual(['note-2', 'note-1'])
    expect(next.total).toBe(5)
  })

  // ROUTE_TARGET_NOTE_LIMIT is a payload-cost cap, measured in gzipped
  // kilobytes over a whole route. A note already in this browser costs none of
  // them, and dropping one to imitate the wire limit would hide something the
  // canvasser wrote seconds ago behind a count.
  it('does not evict a served note to hold the payload cap', () => {
    const served = {
      entries: [note({ id: 'a' }), note({ id: 'b' }), note({ id: 'c' })],
      total: 3,
    }

    const next = withCreatedNote(served, note({ id: 'd' }))

    expect(next.entries.map((entry) => entry.id)).toEqual(['d', 'a', 'b', 'c'])
    // Still not truncated: four of four. Truncation is read off `total`, never
    // off the row count, so growing past three does not make the card lie.
    expect(next.total).toBe(4)
  })

  // Nothing is known about how many notes this resident really has, so a count
  // must not be invented from the one note just written.
  it('leaves an unknown total unknown', () => {
    expect(withCreatedNote(seedDoorNotes(undefined), note()).total).toBeNull()
  })
})

describe('withUpdatedNote', () => {
  it('replaces the note in place rather than resurfacing it', () => {
    const list = {
      entries: [note({ id: 'new' }), note({ id: 'old' })],
      total: 2,
    }

    const next = withUpdatedNote(
      list,
      note({
        id: 'old',
        body: 'Fixed a typo',
        updatedAt: '2026-08-24T18:00:00Z',
      }),
    )

    // ADR 0011 orders this list by createdAt and never by updatedAt, precisely
    // so that editing a two-year-old note does not float it above one written
    // this morning. A client that re-sorted would undo that at the door.
    expect(next.entries.map((entry) => entry.id)).toEqual(['new', 'old'])
    expect(next.entries[1]?.body).toBe('Fixed a typo')
    expect(next.total).toBe(2)
  })

  it('leaves the count alone', () => {
    const next = withUpdatedNote(
      { entries: [note()], total: 9 },
      note({ body: 'Edited' }),
    )

    expect(next.total).toBe(9)
  })
})

describe('withDeletedNote', () => {
  // The bug this exists to prevent: a resident at the cap deletes one of three
  // visible notes and is left reading "2 of 9" — a count that now sends the
  // canvasser looking for notes that are not there.
  it('brings the count down with the row', () => {
    const list = {
      entries: [note({ id: 'a' }), note({ id: 'b' }), note({ id: 'c' })],
      total: 9,
    }

    const next = withDeletedNote(list, 'b')

    expect(next.entries.map((entry) => entry.id)).toEqual(['a', 'c'])
    // Two of eight, not three of eight. The fourth note exists and is not in
    // this browser; backfilling it is the fetch the sheet deliberately does
    // not do, and claiming three rows would be an invention.
    expect(next.total).toBe(8)
  })

  // A total below the rows on screen is a contradiction the card cannot
  // phrase, so the two numbers stay one claim even if the served count was
  // already behind.
  it('never drops the count below what is on screen', () => {
    const next = withDeletedNote(
      { entries: [note({ id: 'a' }), note({ id: 'b' })], total: 1 },
      'a',
    )

    expect(next.total).toBe(1)
  })

  it('leaves an unknown total unknown', () => {
    const list = withCreatedNote(seedDoorNotes(undefined), note())

    expect(withDeletedNote(list, 'note-1').total).toBeNull()
  })

  // Two deletes of the same row — a double tap, or a retry after a response
  // that arrived late — must not decrement twice.
  it('does nothing for a note that has already gone', () => {
    const list = { entries: [note({ id: 'a' })], total: 4 }

    expect(withDeletedNote(list, 'b')).toBe(list)
  })
})

// The step that lets the cached route payload be the door's only copy of a
// resident's notes: an edit goes in as one of the four above and comes back out
// in the shape `RoutePayloadTarget.notes` holds, ready for `patchPerson`.
describe('editServedNotes', () => {
  it('applies the edit to the block the payload arrived with', () => {
    const next = editServedNotes({ entries: [note()], total: 9 }, (list) =>
      withCreatedNote(list, note({ id: 'note-2', body: 'New' })),
    )

    expect(next.entries.map((entry) => entry.id)).toEqual(['note-2', 'note-1'])
    expect(next.total).toBe(10)
  })

  // Two writes racing each other both land, because each is applied to whatever
  // the cache holds when it runs rather than to a list captured earlier.
  it('composes with a second edit against its own result', () => {
    const first = editServedNotes({ entries: [note()], total: 9 }, (list) =>
      withCreatedNote(list, note({ id: 'note-2' })),
    )

    const second = editServedNotes(first, (list) =>
      withDeletedNote(list, 'note-1'),
    )

    expect(second.entries.map((entry) => entry.id)).toEqual(['note-2'])
    expect(second.total).toBe(9)
  })

  // The one thing the wire shape cannot carry. `total` is an int, so a payload
  // that predates ADR 0011 has no count to write back once a note is added to
  // it — and the two alternatives are both worse than materialising what the
  // browser actually has: leaving the block absent would drop the note the
  // moment it was written, which is the defect this path exists to close, and
  // deriving a count from the served rows is the inference ADR 0011 rejected.
  // What is given up is the card's "saved before notes rode the route" line for
  // that resident, and that line does its work on an *empty* card, where a
  // blank section otherwise reads as "nobody has ever written about this
  // person". A card showing a note written thirty seconds ago is not that.
  it('materialises a count for a payload that predates the field', () => {
    const next = editServedNotes(undefined, (list) =>
      withCreatedNote(list, note()),
    )

    expect(next).toEqual({ entries: [note()], total: 1 })
  })

  // The far corner of that trade, written down rather than left to be
  // discovered: once a count is materialised it is a real count, so deleting
  // the note that caused it decrements to nought and the card goes from "saved
  // before notes rode the route" to "no notes about this resident yet" — a
  // claim about the person, made off a payload that knows nothing about them.
  // It is the price of not dropping the note in the first place, and it is
  // reachable only on a snapshot old enough to predate the field, where the
  // canvasser both wrote a note and took it back again. Pinned so that a change
  // in this behaviour has to be a decision.
  it('cannot get an unknown count back once one has been materialised', () => {
    const afterCreate = editServedNotes(undefined, (list) =>
      withCreatedNote(list, note()),
    )

    const afterDelete = editServedNotes(afterCreate, (list) =>
      withDeletedNote(list, 'note-1'),
    )

    expect(afterDelete).toEqual({ entries: [], total: 0 })
  })
})
