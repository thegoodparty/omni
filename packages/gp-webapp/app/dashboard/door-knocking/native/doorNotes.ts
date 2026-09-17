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

// One of the four edits above, applied to a resident's served block and handed
// back in the shape the route payload holds — which is what lets the door's
// only copy of a note list be the cached payload itself rather than a second
// list beside it. `WalkView` writes the result through `patchPerson`, the same
// path a logged knock takes.
//
// The edit is a transform of the block passed in rather than of a snapshot
// taken earlier, so two writes racing each other both land: each reads whatever
// the cache holds at the moment it is applied.
//
// **`total ?? entries.length` is the one place the wire shape cannot carry what
// the door knows**, and it is worth being explicit about what that costs.
// `RoutePayloadTargetNotes.total` is an `int`, so a payload that predates ADR
// 0011 — no `notes` key, `total: null` here — has no honest count to write back
// once a canvasser adds a note to it. The alternatives were both worse. Leaving
// the block absent would drop the note the moment it was written, which is the
// defect this whole path exists to close. Inventing a count from the served
// rows would be the inference ADR 0011 rejected outright. So the block
// materialises describing exactly what the browser has and nothing more, and
// what is given up is the card's "this walk was saved before notes rode the
// route" line for that resident, from their first note onward. That line's work
// is done on an *empty* card, where a blank section otherwise reads as "nobody
// has ever written about this person"; a card showing a note the canvasser
// wrote thirty seconds ago is not that false negative. It is also unreachable
// on any payload a live serve produced, since the server always sends the block.
export const editServedNotes = (
  served: RoutePayloadTargetNotes | undefined,
  edit: (list: DoorNoteList) => DoorNoteList,
): RoutePayloadTargetNotes => {
  const next = edit(seedDoorNotes(served))
  return { entries: next.entries, total: next.total ?? next.entries.length }
}
