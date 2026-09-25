import type { DoorKnockingTurf } from '@goodparty_org/contracts'
import type { PolygonRing } from './VoterMapCanvas'

// A turf a candidate has committed on the drawing surface but not yet
// bought. Lives in `NativeDoorKnockingPage` state, alongside the ring the
// canvas is currently accepting vertices for. The route step's save press
// is what turns each draft into a `POST /v1/door-knocking/turfs` call
// (batched, siblings sharing one anchor id).
//
// Not `DoorKnockingTurf`-shaped on purpose: a draft has no server id, no
// route, no counts to report — attempting to render one through code paths
// built for the saved shape would print zeros as answers about a walk that
// hasn't happened. Callers that need the shape for map rendering adapt via
// `draftAsTurfLike` below.
export interface TurfDraft {
  // Local uuid — the canvas + draft-card list read this to key their
  // renders; the server assigns real ids on save.
  clientId: string
  polygon: PolygonRing
  color: string
  // Numeric default at creation ("Turf N"). Renameable in the toolbar or
  // in a future kebab menu on the draft card.
  name: string
  // Team-member id from `GET /v1/organizations/team`, or null for
  // unassigned. Posted as a `POST /v1/outreach/:id/assignments` write per
  // draft after the batch turf create returns envelope ids.
  assigneeId: number | null
}

// Whether this turf currently has a boundary.
//
// A draft can exist without one: undoing corners on a turf already committed
// takes it back below three, and the canvas stops emitting a ring. The draft
// is KEPT through that rather than deleted, because deleting it would throw
// away the colour and the canvasser the candidate had already set — silent
// data loss from pressing Undo. So the turf survives with an empty polygon
// and reads as still being drawn, which is what it is.
//
// Everything that treats a draft as a real turf goes through here: its card
// prints "Drawing" instead of a stop count, the map draws no ring for it,
// and the paid press does not try to buy it a route.
export const isDrawnTurf = (draft: TurfDraft): boolean =>
  draft.polygon.length >= 3

// Whether two rings trace the same boundary. Point-wise, because the canvas
// hands back a fresh array on every report and the contents are what a
// boundary IS.
const sameRing = (a: PolygonRing, b: PolygonRing): boolean =>
  a.length === b.length &&
  a.every((point, index) => {
    const other = b[index]
    return other !== undefined && point[0] === other[0] && point[1] === other[1]
  })

// Whether applying this patch would leave the draft exactly as it is.
//
// `updateDraft` uses it to return the list UNCHANGED rather than mapping a
// new array over identical contents, and both things that depend on that are
// load-bearing. The session's dirty flag is one: re-entering the drawing
// surface re-reports the boundary already under the cursor, and a write of
// the same shape replaced the array, so Cancel asked what to discard about a
// session that had touched nothing. The per-draft stats cache is the other —
// it keys on polygon IDENTITY, so a fresh array of identical points costs a
// full ray-cast over the pack for an answer that cannot have changed.
//
// Spelled out per field rather than looped, so a field added to `TurfDraft`
// fails the typecheck here instead of being silently compared by reference.
export const patchChangesDraft = (
  draft: TurfDraft,
  patch: Partial<Omit<TurfDraft, 'clientId'>>,
): boolean => {
  if (patch.color !== undefined && patch.color !== draft.color) return true
  if (patch.name !== undefined && patch.name !== draft.name) return true
  // `undefined` is "not in the patch" and `null` is "unassign", so the
  // explicit check is the difference between taking a canvasser off a turf
  // and leaving them on it.
  if (patch.assigneeId !== undefined && patch.assigneeId !== draft.assigneeId)
    return true
  if (patch.polygon !== undefined && !sameRing(patch.polygon, draft.polygon))
    return true
  return false
}

// Whether two lists describe the same turfs — the session snapshot's test.
// It used to be reference equality on the array, on the argument that every
// writer replaces it; that held until a writer started replacing it with
// identical contents. Value equality is the question actually being asked:
// would Cancel put anything back?
export const sameDrafts = (a: TurfDraft[], b: TurfDraft[]): boolean =>
  a.length === b.length &&
  a.every((draft, index) => {
    const other = b[index]
    return (
      other !== undefined &&
      draft.clientId === other.clientId &&
      !patchChangesDraft(draft, other)
    )
  })

// What the next turf cut into this campaign is called. Numbered across the
// campaign's WHOLE membership — the siblings already bought plus the drafts
// committed this session — because the number is what tells them apart on a
// map where every one of them is drawn at once. Counting only the drafts
// would hand a second "Turf 1" to a candidate who arrived through "Add
// another turf".
//
// The fallback a turf is SAVED under when nobody named it, not a default
// filled into the field. A pre-filled "Turf 1" is a name the candidate has
// to select and delete before typing their own, which is why the input
// starts empty and offers "Name this turf" instead.
//
// A name is still required server-side, and everything downstream needs one
// — outreach history, the walk header, the printed sheet. So an unnamed
// turf gets this on the way out rather than blocking the press.
//
// A plain count rather than a scan for the highest existing number: a
// campaign holding "Downtown" and "Turf 2" should offer "Turf 3" rather
// than re-offering a name the candidate has already used. Collisions are
// possible and harmless — the name is a label, the `clientId` is the
// identity.
export const nextTurfName = (existingCount: number): string =>
  `Turf ${existingCount + 1}`

// What an unnamed turf shows: in the input as its placeholder, and on a
// closed row where there is no input to place anything in. The ellipsis is
// what keeps it reading as an invitation to type rather than as the name
// somebody already gave the turf.
export const UNNAMED_TURF_LABEL = 'Name this turf...'

// Renders a draft on the canvas by shape-adapting it to `DoorKnockingTurf`.
// Only the fields the `saved-turfs` PolygonLayer actually reads are honest
// (`id`, `color`, `geoPoly`); the count and lifecycle fields are placeholder
// zeros / nulls, since a draft has no route to count over. Nothing in the
// campaign drawer, the details sheet or the counts service reads through
// this adapter — the surface that renders draft cards uses `TurfDraft`
// directly and prints "—" for the counts a draft hasn't earned yet.
//
// The id is a negative number derived from the clientId's hash, so the
// canvas's interactive-turf select/hover machinery keyed on id can never
// collide with a real server-issued turf id (which are positive integers).
export const draftAsTurfLike = (draft: TurfDraft): DoorKnockingTurf => {
  const now = new Date()
  return {
    id: draftTurfId(draft.clientId),
    // A draft has no envelope — nothing is bought until the route step's
    // press — so this is a placeholder of the same kind as the zero counts
    // below. Negative for the same reason the id is: a real envelope id is
    // always positive, so nothing can mistake this for one.
    outreachId: -1,
    voterFileFilterId: -1,
    name: draft.name,
    color: draft.color,
    geoPoly: { type: 'Polygon', coordinates: [draft.polygon] },
    doorCount: 0,
    knockedDoorCount: 0,
    peopleCount: 0,
    loggedCount: 0,
    routeSeconds: 0,
    completed: false,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

// A stable-per-clientId negative integer, so the canvas layer's identity
// on this turf does not change render-to-render. A real turf id is always
// positive, so any handler receiving a negative id knows it is a draft
// (though today no handler on this surface cares).
export const draftTurfId = (clientId: string): number => {
  let hash = 0
  for (let i = 0; i < clientId.length; i++) {
    hash = (hash * 31 + clientId.charCodeAt(i)) | 0
  }
  return -Math.abs(hash === 0 ? 1 : hash)
}
