import { z } from 'zod'
import { DoorKnockingRouteHeaderSchema } from './DoorKnockingTurf.schema'

// Knock statuses derivable from the CRM's shipped door-knock vocabulary
// (outcome answered/not_home/refused_to_engage + supportAnswer). 'unknown'
// covers never-knocked, answered-but-unsure, and unsure support. Additive
// values ('inaccessible') join when the interaction vocabulary grows.
export const DOOR_KNOCK_STATUSES = [
  'unknown',
  'not_home',
  'supporter',
  'non_supporter',
  'refused',
] as const

export const DoorKnockStatusSchema = z.enum(DOOR_KNOCK_STATUSES)

export type DoorKnockStatus = z.infer<typeof DoorKnockStatusSchema>

// A frozen target enriched live at serve time. age/party are always live —
// null when the person no longer appears at the frozen addressKey
// (mayHaveMoved), in which case the frozen snapshot name still renders.
export const RoutePayloadTargetSchema = z.object({
  stopTargetId: z.number().int(),
  personId: z.string(),
  name: z.string().nullable(),
  age: z.number().nullable(),
  politicalParty: z
    .enum(['Independent', 'Democratic', 'Republican', 'Other'])
    .nullable(),
  knockStatus: DoorKnockStatusSchema,
  mayHaveMoved: z.boolean(),
})

export type RoutePayloadTarget = z.infer<typeof RoutePayloadTargetSchema>

export const RoutePayloadAddressSchema = z.object({
  addressKey: z.string(),
  // Frozen at the lock (the addressKey's address line) — never re-derived
  // from live data, so the walk view matches what was routed.
  address: z.string(),
  targets: z.array(RoutePayloadTargetSchema),
  // Live household context, deliberately name-only.
  otherResidents: z.array(z.object({ name: z.string().nullable() })),
})

export type RoutePayloadAddress = z.infer<typeof RoutePayloadAddressSchema>

export const RoutePayloadStopSchema = z.object({
  id: z.number().int(),
  seq: z.number().int(),
  lat: z.number(),
  lng: z.number(),
  displayAddress: z.string(),
  legSeconds: z.number().int(),
  legMeters: z.number().int(),
  // Most-actionable rollup across the stop's people: an 'unknown' person
  // keeps the whole stop knockable.
  knockStatus: DoorKnockStatusSchema,
  addresses: z.array(RoutePayloadAddressSchema),
})

export type RoutePayloadStop = z.infer<typeof RoutePayloadStopSchema>

// Road-following tour path frozen at knock (Geoapify Routing API; their
// terms permit storing results). Null on legacy routes or when the routing
// call failed — consumers fall back to straight seq-order legs.
export const RoutePathGeometrySchema = z.union([
  z.object({
    type: z.literal('LineString'),
    coordinates: z.array(z.tuple([z.number(), z.number()])),
  }),
  z.object({
    type: z.literal('MultiLineString'),
    coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))),
  }),
])

export type RoutePathGeometry = z.infer<typeof RoutePathGeometrySchema>

// The full serve response: the frozen route plus live enrichment. Phones
// snapshot this offline; there is no navigate block — the phone builds deep
// links from lat/lng.
export const DoorKnockingRoutePayloadSchema = z.object({
  route: DoorKnockingRouteHeaderSchema,
  pathGeometry: RoutePathGeometrySchema.nullable(),
  stops: z.array(RoutePayloadStopSchema),
})

export type DoorKnockingRoutePayload = z.infer<
  typeof DoorKnockingRoutePayloadSchema
>
