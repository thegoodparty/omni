import { z } from 'zod'
import { zCoerceDate, zDate } from '../shared/Date.schema'
import {
  DoorKnockingModeSchema,
  type DoorKnockingMode,
  DoorKnockingPurposeSchema,
  type DoorKnockingPurpose,
} from '../generated/enums'
import { DOOR_KNOCKING_TALKING_POINTS_MAX_LENGTH } from '../outreach/DoorKnockingTalkingPoints.schema'
import {
  COMMUNITY_INPUT_PURPOSE,
  COMMUNITY_INPUT_QUESTION_MAX_LENGTH,
} from '../outreach/OutreachPurpose.schema'

export {
  DoorKnockingModeSchema,
  type DoorKnockingMode,
  DoorKnockingPurposeSchema,
  type DoorKnockingPurpose,
}

// GeoJSON coordinate order: [lng, lat].
const PositionSchema = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
])

const closedRing = (ring: [number, number][]) => {
  const first = ring[0]
  const last = ring[ring.length - 1]
  return (
    first !== undefined &&
    last !== undefined &&
    first[0] === last[0] &&
    first[1] === last[1]
  )
}

// Matches gp-api's PrismaJson.GeoJsonPolygon (doorKnockingTurf geoPoly
// column). First ring is the outer boundary; additional rings are holes.
export const GeoJsonPolygonSchema = z
  .object({
    type: z.literal('Polygon'),
    coordinates: z
      .array(
        z.array(PositionSchema).min(4).refine(closedRing, 'ring must close'),
      )
      .min(1),
  })
  .strict()

export type GeoJsonPolygon = z.infer<typeof GeoJsonPolygonSchema>

// Creating a turf no longer buys its route, so the walk settings are
// OPTIONAL here. `mode` and `loop` are what a route is optimized for and they
// freeze onto it, and the honest moment to ask them is when somebody is about
// to walk — the person at the top of the street knows whether they are
// walking it, and a manager planning turfs weeks earlier is guessing into a
// route nobody re-buys.
//
// Sent: the route is bought with the turf, exactly as before. Omitted: the
// turf is saved with all of its doors but no walk order, and
// `POST turfs/:id/route` buys that later. Both are supported on purpose — a
// client that has not shipped the new flow keeps working, and this is what
// lets creation stop buying without a flag day.
//
// What is NOT optional either way is the audience: a create always resolves
// and freezes the doors, whether or not it buys a route for them.
//
// The two are optional TOGETHER, enforced below. Independently optional, a
// body carrying `mode` and no `loop` validated, saved the turf unrouted and
// dropped the travel mode on the floor — a client asking to be routed got a
// 201 and no route, with nothing anywhere saying why.
export const CreateDoorKnockingTurfSchema = z
  .object({
    voterFileFilterId: z.number().int().positive(),
    name: z.string().min(1).max(120),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    geoPoly: GeoJsonPolygonSchema,
    mode: DoorKnockingModeSchema.optional(),
    loop: z.boolean().optional(),
    // The goal the candidate picked on the wizard's first step. It has always
    // been asked and never persisted — until now it decided a suggested list
    // name and was dropped on submit.
    //
    // Optional on the wire, and the column is nullable to match: the flow can
    // reach submit without it (the "Something else" card carries no slug the
    // server would store), and a client that has not shipped this field yet
    // must keep creating lists.
    //
    // The union of both rails' vocabularies, because door knocking has ONE
    // route for both surfaces — the server does not re-derive which rail is
    // asking, so a Serve-only slug and a Win-only slug both have to be
    // acceptable here. The wizard only ever offers the six for the rail it is
    // drawing.
    purpose: DoorKnockingPurposeSchema.optional(),
    // What this effort is asking, when the purpose is `community_input`. The
    // wizard requires it on that branch and omits it on every other, and the
    // server refuses the mismatch both ways below — a question recorded
    // against a purpose that never asks one would be read as context by the
    // extraction that runs at every door.
    communityInputQuestion: z
      .string()
      .min(1)
      .max(COMMUNITY_INPUT_QUESTION_MAX_LENGTH)
      .optional(),
    // The generated talking points, frozen with the list.
    //
    // Plain text, one line per section, landing on the `Outreach.script`
    // column that every other channel already uses for exactly this. Sent by
    // the client rather than generated here because generation is a separate,
    // stateless draft endpoint — the create transaction already carries a paid
    // Geoapify round trip inside a 120-second window, and an LLM call has no
    // business inside it.
    talkingPoints: z
      .string()
      .max(DOOR_KNOCKING_TALKING_POINTS_MAX_LENGTH)
      .optional(),
    // The Outreach id of an existing turf whose campaign this new turf
    // should join — the "Add another turf" flow reads it back from the
    // sibling-list drawer and threads it through save. Omitted (or
    // absent from a legacy client) means the new turf is its own
    // campaign anchor, matching how a solo campaign already looks.
    campaignOutreachId: z.number().int().positive().optional(),
    // What the CAMPAIGN is called, as opposed to `name` above, which is what
    // this one turf is called. A campaign has no row of its own — it is the
    // anchor Outreach plus every sibling pointing at it — so its title has to
    // live on an envelope, and history surfaces read the anchor's.
    //
    // Written onto EVERY turf's envelope in the campaign, not just the
    // anchor's, even though only the anchor's is ever displayed. Deleting the
    // anchor makes `collapseDoorKnockingCampaigns` fall back to the earliest
    // surviving sibling, and a campaign that silently renames itself to
    // whatever that sibling's turf was called is the failure this avoids.
    //
    // Optional, and absent falls back to the turf's own name: a client that
    // predates the multi-turf flow sends one turf and means it to title the
    // campaign, which is exactly what the fallback does.
    campaignName: z.string().min(1).max(120).optional(),
  })
  .strict()
  // Both walk settings or neither. They are one decision — how this turf
  // gets travelled — and the server reads them as a pair, so half of one is
  // a request nothing can honour.
  .refine(
    (input) => (input.mode === undefined) === (input.loop === undefined),
    {
      message: 'mode and loop must be sent together, or neither',
      path: ['loop'],
    },
  )
  // The question and the purpose that asks it travel together. Refused in
  // both directions: a `community_input` effort with no question leaves every
  // extraction reading its notes blind, and a question on any other purpose
  // is context the canvasser was never given and the model would still be
  // handed.
  .refine(
    (input) =>
      (input.purpose === COMMUNITY_INPUT_PURPOSE) ===
      (input.communityInputQuestion !== undefined),
    {
      message:
        'communityInputQuestion is required for community_input and refused otherwise',
      path: ['communityInputQuestion'],
    },
  )

export type CreateDoorKnockingTurf = z.infer<
  typeof CreateDoorKnockingTurfSchema
>

// Name and colour only, and deliberately NOT derived from the create schema by
// omission any more. The polygon is what the frozen route was computed from,
// so accepting one would desync the two — and since every turf is routed from
// birth, a shared `.partial()` would have made every field permanently
// unacceptable rather than just that one. Splitting the fields is what keeps a
// list renameable after its route exists.
export const UpdateDoorKnockingTurfSchema = z
  .object({
    name: z.string().min(1).max(120),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  })
  .partial()
  .strict()

export type UpdateDoorKnockingTurf = z.infer<
  typeof UpdateDoorKnockingTurfSchema
>

// There is no `locked` field, and an unrouted turf does not bring it back.
// Whether a route exists is `routeSeconds === null`, which is one fact in one
// place; a boolean beside it could only disagree with it.
//
// The counts stay non-nullable, and they are REAL from the moment the turf
// is drawn rather than zero until it is walked: the doors are the turf's
// audience, frozen at creation, and only the walk order waits on the route.
// A details page can therefore report what a campaign covers before anybody
// has started it. Doors are
// addresses and people are knockable targets (do-not-knock and not-a-voter
// residents dropped), the same two populations the walk surfaces report;
// `loggedCount` is the subset of `peopleCount` whose derived knock status is
// not `unknown`, so the pair reads as "N of M logged" and never mixes
// populations.
//
// `knockedDoorCount` is the DOOR-side twin of `loggedCount`, and it exists
// because the rail's overline is a ratio of doors: a door is knocked once
// anybody behind it has been written down, so it counts a door with at least
// one knockable resident whose status is not `unknown` — and also a door with
// no knockable residents at all, which was correctly skipped and has nothing
// left to do. Without that second clause a list containing one do-not-knock
// house could never reach 100%, which is the same asymmetry `peopleCount`
// drops flagged residents to avoid. It is a subset of `doorCount`, never of
// `peopleCount`, so the overline's two halves count the same noun.
export const DoorKnockingTurfSchema = z.object({
  id: z.number().int(),
  // This turf's own Outreach envelope. Every turf has exactly one (the
  // 1:1:1 chain the schema comment above describes), and it is the id the
  // campaign grouping is expressed in: `campaignOutreachId` on a create
  // names one of these, never a turf id.
  //
  // Exposed because the multi-turf create needs it and can get it nowhere
  // else. It cuts several turfs into one campaign, which means the first
  // turf it creates has to become the anchor the rest point at — and until
  // this field existed the client had just bought that anchor and had no
  // way to learn what to call it.
  outreachId: z.number().int(),
  voterFileFilterId: z.number().int(),
  name: z.string(),
  color: z.string(),
  geoPoly: GeoJsonPolygonSchema,
  doorCount: z.number().int(),
  knockedDoorCount: z.number().int(),
  peopleCount: z.number().int(),
  loggedCount: z.number().int(),
  // The route's own `totalSeconds` — travel between doors, with no time spent
  // at them (see `doorKnockingServe.service.ts`). The create flow's estimate
  // and the details drawer's are a different quantity, and printing one here
  // under the same clock icon would put two of them in one column of the rail.
  //
  // NULL means the turf has no route yet, which is a real state now that the
  // route is bought at first knock rather than at create. It is the one field
  // that says so, deliberately, rather than a second `routed` boolean that
  // could disagree with it — a surface asking "is this routed" asks whether
  // this is null. The COUNTS do not answer that question: they are non-zero
  // from creation, because the doors are frozen with the turf and only their
  // order is bought. A routed turf whose travel happens to be 0 seconds is
  // not a case the router can produce, since a route spans at least two
  // stops.
  routeSeconds: z.number().int().nullable(),
  // Both read off the turf's Outreach envelope, which since 3.0 is the one
  // place the lifecycle lives. They are shaped differently because the
  // envelope stores them differently: completion is a `status` value, so it
  // arrives as a boolean, while archiving has a real `archivedAt` column and
  // keeps its timestamp. The turf used to carry a `completedAt` instant, but
  // nothing ever rendered the date — `turfStage` only asks whether it is set —
  // so there is no reader to strand, and inventing an instant out of the
  // envelope's `updatedAt` would have been a plausible-looking lie.
  //
  // `deletedAt` is deliberately absent: a soft-deleted turf never leaves the
  // API at all, so exposing the column would only invite a client to render a
  // list the server considers gone.
  completed: z.boolean(),
  archivedAt: zDate().nullable(),
  createdAt: zDate(),
  updatedAt: zDate(),
})

export type DoorKnockingTurf = z.infer<typeof DoorKnockingTurfSchema>

// The nativeDoorKnocking extension of the outreach detail schema
// (OutreachDetailSchema in outreach/OutreachSocial.schema.ts), the sibling of
// PhoneBankingOutreachDetailSchema — an envelope-level rollup, not a per-stop
// read.
//
// The three counts are the SAME three as `DoorKnockingTurfSchema` above, from
// the same `DoorKnockingTurfCountsService` aggregate the rail reads, and they
// mean exactly what they mean there. That reuse is the point: doors and logged
// progress are already reported on the door-knocking surface, and a second
// derivation here would be the two-denominator failure ADR 0010 wrote the rule
// against — one quantity, one number, wherever it is printed.
//
// `turfId` is what the drawer could not reach before, and it is what the
// envelope names directly now. It is here so the drawer's Archive action can
// name the turf, and so the footer can link into the walk.
export const DoorKnockingOutreachDetailSchema = z.object({
  turfId: z.number().int(),
  // NULL until the route is bought at first knock. The three counts below do
  // NOT wait on it — the doors are frozen when the turf is drawn — so an
  // unwalked campaign opens a drawer reporting what it covers, with this
  // field as the one thing saying nobody has started.
  routeId: z.number().int().nullable(),
  // The turf's live name, not the envelope's `name` snapshot taken at knock
  // time: a list renamed since is one list, and two names for it across two
  // drawers is the same class of defect as two counts.
  turfName: z.string(),
  doorCount: z.number().int(),
  peopleCount: z.number().int(),
  loggedCount: z.number().int(),
  // The walk's lifecycle. It used to be carried here because it lived on the
  // turf and the envelope held only a mirror that could fall behind it; now
  // both come off the envelope this block already describes, so they agree by
  // construction. Kept on the block anyway so a caller holding it does not
  // have to reach back out to the row for two fields, and shaped to match
  // `DoorKnockingTurfSchema` above.
  completed: z.boolean(),
  archivedAt: zCoerceDate().nullable(),
})

export type DoorKnockingOutreachDetail = z.infer<
  typeof DoorKnockingOutreachDetailSchema
>

// `POST /v1/door-knocking/turfs/:id/route` — buy the route for a turf that
// does not have one. The same two settings the create body may carry, asked
// at the moment somebody is actually about to walk.
//
// Idempotent by design rather than by hope: a turf that already has a route
// gets that route back untouched. `DoorKnockingRoute.doorKnockingTurfId` is
// `@unique`, so one route per turf is a database fact and a race cannot
// produce two — what the server-side short-circuit adds is not paying the
// vendor twice for the answer.
//
// It buys an ORDER, not an audience. The doors were frozen when the turf was
// drawn, so this resolves no roster and cannot fail on one that has grown
// past the 150-stop cap since.
export const BuildDoorKnockingRouteSchema = z
  .object({
    mode: DoorKnockingModeSchema,
    loop: z.boolean(),
  })
  .strict()

export type BuildDoorKnockingRoute = z.infer<
  typeof BuildDoorKnockingRouteSchema
>

// A boolean rather than two endpoints, so restore-from-archive can't drift
// away from archive in gating or shape.
export const DoorKnockingArchiveRequestSchema = z
  .object({
    archived: z.boolean(),
  })
  .strict()

export type DoorKnockingArchiveRequest = z.infer<
  typeof DoorKnockingArchiveRequestSchema
>

export const DoorKnockingRouteHeaderSchema = z.object({
  id: z.number().int(),
  doorKnockingTurfId: z.number().int(),
  mode: DoorKnockingModeSchema,
  loop: z.boolean(),
  totalSeconds: z.number().int(),
  totalMeters: z.number().int(),
  stopCount: z.number().int(),
  createdAt: zDate(),
})

export type DoorKnockingRouteHeader = z.infer<
  typeof DoorKnockingRouteHeaderSchema
>
