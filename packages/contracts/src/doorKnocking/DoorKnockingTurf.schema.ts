import { z } from 'zod'
import { zDate } from '../shared/Date.schema'
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

export const CreateDoorKnockingTurfSchema = z
  .object({
    voterFileFilterId: z.number().int().positive(),
    name: z.string().min(1).max(120),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    geoPoly: GeoJsonPolygonSchema,
  })
  .strict()

export type CreateDoorKnockingTurf = z.infer<
  typeof CreateDoorKnockingTurfSchema
>

export const UpdateDoorKnockingTurfSchema = CreateDoorKnockingTurfSchema.omit({
  voterFileFilterId: true,
}).partial()

export type UpdateDoorKnockingTurf = z.infer<
  typeof UpdateDoorKnockingTurfSchema
>

// `locked` is derived, not stored: a turf is locked iff its route exists.
//
// The three counts are derived too, and from the frozen route — so they are
// null, not 0, on an unlocked turf: there is no route to count, and a zero
// would claim a walked list that turned out to be empty. Doors are addresses
// and people are knockable targets (do-not-knock and not-a-voter residents
// dropped), the same two populations the walk surfaces report; `loggedCount`
// is the subset of `peopleCount` whose derived knock status is not `unknown`,
// so the pair reads as "N of M logged" and never mixes populations.
export const DoorKnockingTurfSchema = z.object({
  id: z.number().int(),
  voterFileFilterId: z.number().int(),
  name: z.string(),
  color: z.string(),
  geoPoly: GeoJsonPolygonSchema,
  locked: z.boolean(),
  doorCount: z.number().int().nullable(),
  peopleCount: z.number().int().nullable(),
  loggedCount: z.number().int().nullable(),
  // Both are timestamps rather than booleans so a card can say *when*, and
  // both are only ever set on a knocked list. `deletedAt` is deliberately
  // absent: a soft-deleted turf never leaves the API at all, so exposing the
  // column would only invite a client to render a list the server considers
  // gone.
  completedAt: zDate().nullable(),
  archivedAt: zDate().nullable(),
  createdAt: zDate(),
  updatedAt: zDate(),
})

export type DoorKnockingTurf = z.infer<typeof DoorKnockingTurfSchema>

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

// Walk settings are request params picked in the knock dialog, not turf
// columns — they freeze onto the route.
export const DoorKnockingKnockRequestSchema = z
  .object({
    mode: DoorKnockingModeSchema,
    loop: z.boolean(),
  })
  .strict()

export type DoorKnockingKnockRequest = z.infer<
  typeof DoorKnockingKnockRequestSchema
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

// `created: false` = the turf already had a route (knock is idempotent —
// the existing route is returned as-is, nothing is re-billed).
export const DoorKnockingKnockResponseSchema = z.object({
  created: z.boolean(),
  route: DoorKnockingRouteHeaderSchema,
})

export type DoorKnockingKnockResponse = z.infer<
  typeof DoorKnockingKnockResponseSchema
>
