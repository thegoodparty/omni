import { z } from 'zod'
import {
  DoorKnockConstituentActivitySchema,
  PhoneBankingConstituentActivitySchema,
  RobocallConstituentActivitySchema,
  StatusChangeConstituentActivitySchema,
  TextConstituentActivitySchema,
} from '../people/ContactActivity.schema'
import { ContactNoteSchema } from '../people/ContactNote.schema'
import { NotAVoterReasonSchema } from '../people/ContactStatus.schema'
import { DoorKnockingDemographicsShape } from './DoorKnockingResidents.schema'
import { DoorKnockingRouteHeaderSchema } from './DoorKnockingTurf.schema'

// ADR 0009. Previous outreach to one resident, riding the route payload so
// the walk keeps working on the bad signal it was designed around.
//
// The variants are the CRM's own ConstituentActivity members, not a
// door-knocking copy of them: the same event has to read the same way in
// Contacts and at the door, and reusing the schemas means the webapp's
// existing feed rows render this without a fork.
//
// Two of the CRM's seven variants are deliberately absent. POLL_INTERACTIONS
// is elected-office only and door knocking is Win-only. OUTREACH (the
// deprecated VoterOutreachActivity rows) is keyed on lalVoterId, and
// door_knocking_stop_target stores a people-db personId precisely so no raw
// LALVOTERID is frozen into a route — so the door cannot join to them.
export const RouteTargetActivitySchema = z.discriminatedUnion('type', [
  DoorKnockConstituentActivitySchema,
  TextConstituentActivitySchema,
  RobocallConstituentActivitySchema,
  PhoneBankingConstituentActivitySchema,
  StatusChangeConstituentActivitySchema,
])

export type RouteTargetActivity = z.infer<typeof RouteTargetActivitySchema>

// `DoorKnockingDemographicsShape` with every member made optional, built by
// mapping rather than re-declared, so the eleven attributes are still written
// down exactly once (in DoorKnockingResidents.schema.ts, next to the column
// each one reads and the mapper that produced it). A hand-copied optional twin
// is a second list to keep in step, and the first thing to fall out of step is
// the one nobody re-reads.
const optionalDemographics = (): {
  [K in keyof typeof DoorKnockingDemographicsShape]: z.ZodOptional<
    (typeof DoorKnockingDemographicsShape)[K]
  >
} =>
  Object.fromEntries(
    Object.entries(DoorKnockingDemographicsShape).map(([key, schema]) => [
      key,
      schema.optional(),
    ]),
  ) as {
    [K in keyof typeof DoorKnockingDemographicsShape]: z.ZodOptional<
      (typeof DoorKnockingDemographicsShape)[K]
    >
  }

// Most-recent-first, capped server-side. The cap is what makes the payload's
// cost independent of how long a person's CRM history runs: a person with two
// hundred rows costs the same bytes as one with five. Full history lives in
// the CRM person view, which pages.
export const ROUTE_TARGET_ACTIVITY_LIMIT = 5

// ADR 0011. The same server-side cap as the activity feed above and for the
// same reason, at a lower number: notes are several times more expensive per
// row. An activity row is a fixed handful of short fields, while a note is
// free text a human typed and `ContactNoteInputSchema` lets it run to 10,000
// characters. On ADR 0009's own 100-stop rig, one 140-character note per
// target costs roughly what all five activity rows cost together.
//
// Three is also close to product's "show them all": a resident with three or
// fewer notes — nearly all of them — loses nothing.
export const ROUTE_TARGET_NOTE_LIMIT = 3

// Notes plus the resident's full note count, so a truncated list says so.
//
// The count is on the wire rather than inferred from
// `entries.length === ROUTE_TARGET_NOTE_LIMIT`, which is wrong in exactly the
// case that matters least dramatically and most often: a resident with
// precisely three notes would render as truncated forever. With `total` the
// sheet can say "3 of 7" and point at the CRM for the rest, instead of showing
// a subset as though it were the whole record.
//
// One object rather than sibling `notes` / `notesTotal` keys on the target,
// because the two halves are only meaningful together. Siblings make "rows
// with no count" a representable state, and a renderer that reads the rows and
// forgets the count drops the truncation silently. Nothing parses this schema
// at runtime (see `notes` below), so nothing but the shape can enforce that
// they arrive as a pair.
export const RoutePayloadTargetNotesSchema = z.object({
  entries: z.array(ContactNoteSchema),
  total: z.number().int(),
})

export type RoutePayloadTargetNotes = z.infer<
  typeof RoutePayloadTargetNotesSchema
>

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
  // The eleven-attribute demographic profile, derived from the residents
  // contract's shape so the two cannot drift — `serve()` copies these across
  // one for one, and a field added on one side without the other would be a
  // silent hole rather than a type error.
  //
  // Live-only like age, party and the phones: a `mayHaveMoved` target has no
  // live row, so every one of these is null for them rather than describing
  // whoever lives there now. Screen only — both paper surfaces omit them, for
  // the reason they omit the phone numbers, and with more force: a demographic
  // profile of a named voter on a page that leaves the building is a larger
  // disclosure than a phone number is.
  //
  // Targets only. `otherResidents` below stays name-only.
  //
  // **Optional here and required on the residents response**, which is the same
  // split `history` and `notAVoterReason` above make and for the same reason:
  // this payload is what a service worker snapshots for a walk with no signal,
  // so one taken before this shipped carries none of these keys and has to keep
  // parsing on a phone that cannot refetch. The residents response is an
  // in-process S2S read with no snapshot, so required there is what actually
  // enforces that the SELECT widened.
  //
  // Consequence for renderers, and it is the whole reason this is written down:
  // absent means the same thing as null and must render the same way. A
  // `boolean | null | undefined` fed to a bare ternary makes `undefined` false,
  // which would print "No" against `registeredVoter` on every pre-ship
  // snapshot — see `demographicFacts.ts`, which normalizes both.
  ...optionalDemographics(),
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
  // ADR 0011. This resident's saved contact notes, newest first, capped at
  // ROUTE_TARGET_NOTE_LIMIT with their true count beside them. Riding the
  // payload rather than fetched per resident for the reason ADR 0009 gave
  // about `history`: the sheet is deliberately fetch-free, because the moment
  // a canvasser needs it is the moment they are standing on a porch in the
  // dead zone the whole feature is shaped around.
  //
  // Keyed by personId like `history`, never rolled up to the address. Two
  // people behind one door are two records, and free text written about one of
  // them read against the housemate who answered is the ADR 0009 failure with
  // worse material than an outcome enum.
  //
  // The CRM's own `ContactNoteSchema`, not a door-knocking narrowing of it, so
  // one note cannot be worded two ways — and so the webapp can drop the
  // response of its own create/edit straight into `entries` without a
  // translation step that would be a second idea of what a note is.
  //
  // The server always sends the block, `{ entries: [], total: 0 }` included:
  // "nothing written down about this person yet" is a thing the sheet says out
  // loud, and it has to stay distinguishable from a payload that predates this
  // field, where the key is absent and absence is not a claim about anything.
  //
  // Optional and deliberately not `.default([])`, for the reason set out on
  // `history` above: nothing parses this schema at runtime in either
  // direction, so a default fills in nothing anywhere and only promises the
  // compiler a value that a service worker's pre-ship snapshot does not carry.
  //
  // Screen only. Both paper surfaces omit it, for the reason they omit the
  // phones and the demographic profile and with more force again — free text
  // about a named voter, on a page that stops being access-controlled the
  // moment it leaves the building.
  notes: RoutePayloadTargetNotesSchema.optional(),
})

export type RoutePayloadTarget = z.infer<typeof RoutePayloadTargetSchema>

export const RoutePayloadAddressSchema = z.object({
  addressKey: z.string(),
  // Frozen at the lock (the addressKey's address line) — never re-derived
  // from live data, so the walk view matches what was routed.
  address: z.string(),
  targets: z.array(RoutePayloadTargetSchema),
  // Live household context, deliberately name-only — the demographic profile
  // above is for targets alone.
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
