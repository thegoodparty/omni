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

// What the next turf cut into this campaign is called. Numbered across the
// campaign's WHOLE membership — the siblings already bought plus the drafts
// committed this session — because the number is what tells them apart on a
// map where every one of them is drawn at once. Counting only the drafts
// would hand a second "Turf 1" to a candidate who arrived through "Add
// another turf".
//
// A plain count rather than a scan for the highest existing number: renaming
// is coming to this toolbar, and a campaign holding "Downtown" and "Turf 2"
// should offer "Turf 3" rather than re-offering a name the candidate has
// already used. Collisions are possible and harmless — the name is a label,
// the `clientId` is the identity.
export const nextTurfName = (existingCount: number): string =>
  `Turf ${existingCount + 1}`

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
