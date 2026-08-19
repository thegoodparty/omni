import { z } from 'zod'
import {
  DoorKnockConstituentActivitySchema,
  RobocallConstituentActivitySchema,
  StatusChangeConstituentActivitySchema,
  TextConstituentActivitySchema,
} from '../people/ContactActivity.schema'
import { NotAVoterReasonSchema } from '../people/ContactStatus.schema'
import { DoorKnockingRouteHeaderSchema } from './DoorKnockingTurf.schema'

// ADR 0009. Previous outreach to one resident, riding the route payload so
// the walk keeps working on the bad signal it was designed around.
//
// The variants are the CRM's own ConstituentActivity members, not a
// door-knocking copy of them: the same event has to read the same way in
// Contacts and at the door, and reusing the schemas means the webapp's
// existing feed rows render this without a fork.
//
// Two of the CRM's six variants are deliberately absent. POLL_INTERACTIONS
// is elected-office only and door knocking is Win-only. OUTREACH (the
// deprecated VoterOutreachActivity rows) is keyed on lalVoterId, and
// door_knocking_stop_target stores a people-db personId precisely so no raw
// LALVOTERID is frozen into a route — so the door cannot join to them.
export const RouteTargetActivitySchema = z.discriminatedUnion('type', [
  DoorKnockConstituentActivitySchema,
  TextConstituentActivitySchema,
  RobocallConstituentActivitySchema,
  StatusChangeConstituentActivitySchema,
])

export type RouteTargetActivity = z.infer<typeof RouteTargetActivitySchema>

// Most-recent-first, capped server-side. The cap is what makes the payload's
// cost independent of how long a person's CRM history runs: a person with two
// hundred rows costs the same bytes as one with five. Full history lives in
// the CRM person view, which pages.
export const ROUTE_TARGET_ACTIVITY_LIMIT = 5

// Knock statuses derived from the CRM door-knock vocabulary (outcome +
// supportAnswer). 'unknown' covers never-knocked, answered-but-unsure, and
// unsure support.
export const DOOR_KNOCK_STATUSES = [
  'unknown',
  'not_home',
  'supporter',
  'non_supporter',
  'inaccessible',
  'refused',
  'not_a_voter',
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
  // For the door that doesn't answer. Live-only, like age and party: a
  // mayHaveMoved target has no live row, so it carries no number rather than a
  // number belonging to whoever lives there now. Screen only — the printed
  // walk sheet deliberately omits these, since paper leaves the building.
  cellPhone: z.string().nullable(),
  landline: z.string().nullable(),
  knockStatus: DoorKnockStatusSchema,
  mayHaveMoved: z.boolean(),
  // ADR 0007. A flag rather than a DoorKnockStatus member: a knock status is
  // derived from an interaction, and this comes from the contact-status
  // projection instead. Read live at serve time, so a person flagged this
  // morning is marked on a route frozen yesterday — turf evaluation keeps them
  // out of new routes, but it cannot reach back into one already built.
  doNotKnock: z.boolean(),
  // ADR 0008. Why this person is not a voter to reach here, when someone at
  // the door said so. Read live at serve time for the same reason doNotKnock
  // is: evaluation keeps them out of new routes, but the frozen one in
  // someone's hand already passed it.
  //
  // An absent key rather than a nullable one — `cleared` is the absence of a
  // reason, and the marker is present or it isn't. Keeping it optional also
  // means a payload snapshotted offline before this shipped still parses.
  notAVoterReason: NotAVoterReasonSchema.optional(),
  // ADR 0009. This resident's own recent outreach, newest first — never the
  // household's. Two people behind one door disagree, and attributing a
  // neighbor's refusal to the person answering is worse than showing nothing.
  //
  // The server always sends the array, empty included: "we have never been
  // here" is a thing the card says out loud. Optional for the same reason
  // notAVoterReason above is — a payload snapshotted offline before this
  // shipped has to keep parsing on a phone that cannot refetch.
  //
  // Deliberately not `.default([])`, which reads like the safer form and is
  // not: nothing parses this schema at runtime in either direction
  // (ZodResponseInterceptor isn't registered globally and DoorKnockingController
  // doesn't apply it, so serveRoute's @ResponseSchema is inert; the webapp's
  // clientRequest casts ofetch's JSON without parsing). A default would fill in
  // nothing and only promise the compiler a non-optional array, so a service
  // worker's pre-ship snapshot would hand a `.map()` undefined with no type
  // error. Optional keeps that decision at the call site. See ADR 0009.
  history: z.array(RouteTargetActivitySchema).optional(),
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
  // No stop-level rollup: the webapp's `rollupStopStatus` derives one from
  // `addresses[].targets[].knockStatus`, and shipping a second copy meant two
  // implementations of one rule that had to agree about suppressing
  // do-not-knock and not-a-voter residents. One implementation cannot drift.
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
