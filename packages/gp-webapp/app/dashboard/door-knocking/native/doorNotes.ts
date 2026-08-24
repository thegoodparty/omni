import { useState } from 'react'
import { ContactNote, RoutePayloadTargetNotes } from '@goodparty_org/contracts'

// ADR 0011's `{ entries, total }` as the door holds it after a write, with one
// difference the wire shape cannot express: `total` may be unknown.
//
// The route payload's `notes` block is optional, and the ADR is explicit that
// absent and empty are different claims — a walk the service worker
// snapshotted before ADR 0011 shipped carries no `notes` key at all, and that
// is a fact about the payload rather than about the resident. Collapsing it to
// `total: 0` would make the card say "nobody has written anything about this
// person" on a phone that simply has an older copy of the route, which is the
// exact false negative the optionality exists to prevent. `null` keeps the two
// apart all the way to the sentence the card prints.
export interface DoorNoteList {
  entries: ContactNote[]
  total: number | null
}

const UNKNOWN: DoorNoteList = { entries: [], total: null }

export const seedDoorNotes = (
  served: RoutePayloadTargetNotes | undefined,
): DoorNoteList =>
  served ? { entries: served.entries, total: served.total } : UNKNOWN

// A note the canvasser just wrote goes to the top, because the list is ordered
// newest-first by `createdAt` and theirs is the newest thing there is.
//
// It is deliberately NOT trimmed back to ROUTE_TARGET_NOTE_LIMIT. That cap is a
// payload-cost decision — ADR 0011 measures it in gzipped kilobytes over a
// 100-stop route — and a note already sitting in this browser costs none of
// them. Evicting one to imitate a wire limit would hide a note written seconds
// earlier behind a count, which is a worse thing to do at a doorstep than
// showing four rows where the next serve will show three. Truncation is read
// off `total` and never off `entries.length`, so a list that has grown past the
// cap still describes itself correctly.
export const withCreatedNote = (
  list: DoorNoteList,
  created: ContactNote,
): DoorNoteList => ({
  entries: [created, ...list.entries],
  total: list.total === null ? null : list.total + 1,
})

// Replaced in place rather than re-sorted. ADR 0011 orders this list by
// `created_at` and never by `updated_at` precisely so that fixing a typo in a
// two-year-old note does not resurface it above a note from this morning; a
// client that floated the edited row to the top would reintroduce at the door
// the behaviour the query was written to avoid.
export const withUpdatedNote = (
  list: DoorNoteList,
  updated: ContactNote,
): DoorNoteList => ({
  entries: list.entries.map((note) =>
    note.id === updated.id ? updated : note,
  ),
  total: list.total,
})

// `total` has to come down with the row, or a resident at the cap who deletes
// one of their three visible notes reads as "showing 2 of 9" forever — a count
// that is now wrong in the direction that sends a canvasser looking for notes
// that are not there. The floor is `entries.length` rather than zero because
// the two numbers are one claim: a total below the rows on screen is a
// contradiction the card cannot phrase.
//
// Deleting one of three shown out of nine leaves two shown out of eight, not
// three: the fourth note exists but is not in this browser, and backfilling it
// is the fetch the sheet does not do. Two of eight is honest about that; three
// of eight would be an invention.
export const withDeletedNote = (
  list: DoorNoteList,
  noteId: string,
): DoorNoteList => {
  const entries = list.entries.filter((note) => note.id !== noteId)
  if (entries.length === list.entries.length) return list
  return {
    entries,
    total:
      list.total === null ? null : Math.max(list.total - 1, entries.length),
  }
}

// The door sheet's per-resident note lists, held for as long as the sheet is
// open and keyed by `personId` — never rolled up to the household, for ADR
// 0011's reason: free text somebody typed about a named voter, read against the
// housemate who opened the door, is a mistake made out loud.
//
// It lives above the card rather than inside it because the sheet switches
// residents without closing: auto-advance walks between two people behind one
// door, and so does the header's switcher. A card that seeded itself on mount
// would re-read the frozen route payload every time the canvasser flicked back
// to the housemate they had just written about, and the note would be gone from
// a list it had been in a moment earlier.
//
// The served block is passed in at the point of use rather than captured, so
// the seed is always the payload the sheet is currently rendering, and edits
// apply through a transform rather than a snapshot — two deletes racing each
// other both land instead of the second overwriting the first with a list built
// before it.
export const useDoorNotes = () => {
  const [edited, setEdited] = useState<Record<string, DoorNoteList>>({})

  const notesFor = (
    personId: string,
    served: RoutePayloadTargetNotes | undefined,
  ): DoorNoteList => edited[personId] ?? seedDoorNotes(served)

  const applyToNotes = (
    personId: string,
    served: RoutePayloadTargetNotes | undefined,
    edit: (list: DoorNoteList) => DoorNoteList,
  ) =>
    setEdited((current) => ({
      ...current,
      [personId]: edit(current[personId] ?? seedDoorNotes(served)),
    }))

  return { notesFor, applyToNotes }
}
