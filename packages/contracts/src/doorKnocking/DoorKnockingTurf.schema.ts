import { z } from 'zod'
import { zCoerceDate, zDate } from '../shared/Date.schema'
import {
  DoorKnockingModeSchema,
  type DoorKnockingMode,
} from '../generated/enums'

export { DoorKnockingModeSchema, type DoorKnockingMode }

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

// Creating a turf buys its route, so the walk settings ride the create body:
// `mode` and `loop` are what the route is optimized for and they freeze onto
// it. They used to be a separate knock request sent later, from a dialog on an
// already-saved list; 3.0 has no such moment, because a turf without a route
// is a state the model no longer has.
export const CreateDoorKnockingTurfSchema = z
  .object({
    voterFileFilterId: z.number().int().positive(),
    name: z.string().min(1).max(120),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    geoPoly: GeoJsonPolygonSchema,
    mode: DoorKnockingModeSchema,
    loop: z.boolean(),
  })
  .strict()

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

// There is no `locked` field. It was derived from the route's existence, and
// since 3.0 buys the route in the same transaction that inserts the turf there
// is no unlocked state left for it to describe.
//
// That is also why the counts are non-nullable here. They used to be null
// rather than 0 on an unlocked list — nothing frozen, nothing to count, and a
// zero would have claimed a walked list that turned out empty. Every turf now
// has a route from birth, so there is always something to count. Doors are
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
  routeSeconds: z.number().int(),
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
// `turfId` is what the drawer could not reach before: the envelope stores
// `doorKnockingRouteId`, and the turf is one `@unique` hop the other side of
// it. It is here so the drawer's Archive action can name the turf, and so the
// footer can link into the walk.
export const DoorKnockingOutreachDetailSchema = z.object({
  turfId: z.number().int(),
  routeId: z.number().int(),
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
