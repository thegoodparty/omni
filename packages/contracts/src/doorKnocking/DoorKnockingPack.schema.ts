import { z } from 'zod'
import { DoorKnockStatusSchema } from './DoorKnockingRoutePayload.schema'

// The district-scoped dim whose buckets are derived rather than chosen — see
// PackAgeBuckets.ts, which owns that vocabulary. The key lives here with the
// other dim keys so nothing has to import a whole module to name it.
export const AGE_DIM_KEY = 'age'

// The `contactsMade` dim's buckets, in byte order. These ARE the labels the
// saved-list filter offers ('0'…'5+', gp-webapp's filters.config), so the
// pack's vocabulary and the pill a candidate pressed are the same string and
// the preview mapping needs no translation table. `5+` is ">= 5 logged
// interactions", matching CONTACTS_MADE_BUCKET_FIELDS in gp-api's
// voterFileFilter.utils.ts and the HAVING arms in
// ContactsMadeResolutionService.
export const CONTACTS_MADE_DIM_KEY = 'contactsMade'
export const CONTACTS_MADE_BUCKETS = ['0', '1', '2', '3', '4', '5+'] as const

// The most contacted people gp-api will describe on the wire. It is
// deliberately MAX_RESOLVED_ID_SET_SIZE (activityConditionResolution.service),
// the same number at which resolving a contacts-made filter for a real query
// gives up: above it the filter cannot be applied at knock time either, so a
// pack that shaded by it would be previewing an audience no list can serve.
// Past the cap the plane is omitted rather than truncated — a truncated plane
// would silently read those people as "0 prior contacts", which is exactly
// the wrong answer for the one bucket candidates select most.
export const PACK_CONTACTS_MADE_MAX = 100_000

// The exploration-map "pack": one binary buffer, built per request and
// streamed people-api → gp-api → browser, never stored. Wire framing:
//
//   [u32 LE: manifest byte length][manifest JSON, utf8, padded to a 4-byte
//   boundary][typed arrays]
//
// where each typed array sits at its manifest-declared byteOffset from the
// START of the pack (f32/u32 arrays are 4-byte aligned). Consumers must
// trust the manifest, not a fixed layout. The `canvassStatus` and
// `contactsMade` dims are joined inside the encoder from the per-organization
// arrays gp-api sends with the request — the binary is never patched after
// the fact.
//
// That pack rides inside the streaming envelope below, so its byteOffsets are
// relative to the pack frame's payload rather than to byte 0 of the response.
export const DoorKnockingPackRequestSchema = z
  .object({
    districtId: z.guid(),
    // gp-api's org-wide latest-per-person knock statuses; bounded by doors
    // actually knocked, so far smaller than the district. The cap fits
    // people-api's 32 MiB body limit with headroom.
    knockStatuses: z
      .array(
        z
          .object({
            personId: z.guid(),
            status: DoorKnockStatusSchema,
          })
          .strict(),
      )
      .max(200_000)
      .optional(),
    // The second per-organization plane: how many interactions this campaign
    // has logged against each person, bucketed as the saved-list filter
    // buckets it. Only people with at least one are sent — everyone else IS
    // bucket 0, so the plane's default byte is already the right answer for
    // them, and the array is bounded by who the campaign has contacted rather
    // than by the district.
    //
    // ABSENT AND EMPTY MEAN DIFFERENT THINGS, and the encoder treats them so.
    // An empty array is an organization that has contacted nobody, which is a
    // fact the map can shade ("0 prior contacts" is everyone). Absent means
    // gp-api could not answer — see PACK_CONTACTS_MADE_MAX — and the plane is
    // then left out of the pack entirely, which the client reads through the
    // same unpreviewable-filter disclosure that names any other dim it lacks.
    contactsMade: z
      .array(
        z
          .object({
            personId: z.guid(),
            // Index into CONTACTS_MADE_BUCKETS; never 0, since bucket 0 is
            // the plane's default and sending it would be a wasted row.
            bucket: z
              .int()
              .min(1)
              .max(CONTACTS_MADE_BUCKETS.length - 1),
          })
          .strict(),
      )
      .max(PACK_CONTACTS_MADE_MAX)
      .optional(),
  })
  .strict()

export type DoorKnockingPackRequest = z.infer<
  typeof DoorKnockingPackRequestSchema
>

// The pack takes tens of seconds to build and produces no bytes until the
// last one, which left the socket idle long enough for the gateway to kill
// the connection without writing a status (prod 2026-08-25). The envelope
// exists so the response can be committed and kept alive from the first
// millisecond: gp-api writes the magic before it issues a query, heartbeat
// frames while the build runs, and the pack itself in a final frame.
//
//   [8 bytes: PACK_STREAM_MAGIC]
//   repeated: [u32 LE kind][u32 LE payload byte length][payload, zero-padded
//             to PACK_STREAM_ALIGNMENT]
//
// Payload padding keeps every frame — and therefore the pack frame's payload —
// 8-byte aligned, so the manifest's 4-byte-aligned offsets stay aligned once
// the pack's start offset is added and consumers can still mount typed-array
// views without copying.
//
// A response that ends without a pack frame is a failed build, not an empty
// map: the decoder must throw rather than render nothing.
export const PACK_STREAM_MAGIC = 'GPPACKS1'
export const PACK_STREAM_MAGIC_BYTES = 8
export const PACK_STREAM_FRAME_HEADER_BYTES = 8
export const PACK_STREAM_ALIGNMENT = 8

export const PACK_STREAM_FRAME_KINDS = {
  heartbeat: 1,
  pack: 2,
  error: 3,
} as const

export const PACK_ARRAY_TYPES = ['f32', 'u32', 'u16', 'u8'] as const

// Core arrays every pack carries. `positions` is interleaved [lng, lat]
// f32 pairs, one per dot (deck.gl coordinate order); the two index arrays
// chain person → household → dot.
export const PACK_CORE_ARRAYS = {
  positions: 'positions',
  personToHousehold: 'personToHousehold',
  householdToDot: 'householdToDot',
} as const

export const DoorKnockingPackDimSchema = z.object({
  key: z.string().min(1),
  // The dim's byte plane (array named `dim:<key>`, u8, one byte per person)
  // holds indexes into this list.
  values: z.array(z.string().min(1)).min(1).max(256),
})

export type DoorKnockingPackDim = z.infer<typeof DoorKnockingPackDimSchema>

export const DoorKnockingPackArraySchema = z.object({
  name: z.string().min(1),
  type: z.enum(PACK_ARRAY_TYPES),
  byteOffset: z.number().int().nonnegative(),
  elementCount: z.number().int().nonnegative(),
})

export type DoorKnockingPackArray = z.infer<typeof DoorKnockingPackArraySchema>

// What the district scan MEANS, as opposed to how the bytes are framed.
// `version` below is the framing: bump it only when a decoder written for the
// old one would read the new bytes wrongly, because doing so is designed to
// make every old client reject the pack. This number is the other axis — the
// vocabulary of the district-scoped dims, whose buckets a client reads out of
// the manifest and therefore survives a change to. Nothing on the wire carries
// it and nothing needs to; it exists so the planned per-district pack cache
// (docs/perf/voter-pack-headroom.md, option 1) can key on
// `(districtId, mirrorVersion, PACK_FORMAT_REVISION)` and stop serving a
// cached buffer whose age buckets predate the code that would read it.
//
// Increment when a district-scoped dim's key or bucket list changes. Do NOT
// increment for the per-organization planes: those are rebuilt per request
// under any caching design, so a cached artifact never contains a stale one.
//
//   1 — the legacy age bands (18_25 / 25_35 / 35_50 / 50_plus).
//   2 — age re-cut at every boundary both generations of age key use, so
//       `age65Plus` and `age50_64` have somewhere exact to map
//       (PackAgeBuckets.ts).
export const PACK_FORMAT_REVISION = 2

export const DoorKnockingPackManifestSchema = z
  .object({
    version: z.literal(1),
    generatedAt: z.string().datetime(),
    counts: z
      .object({
        people: z.number().int().nonnegative(),
        households: z.number().int().nonnegative(),
        dots: z.number().int().nonnegative(),
      })
      .strict(),
    dims: z.array(DoorKnockingPackDimSchema),
    arrays: z.array(DoorKnockingPackArraySchema),
  })
  // Deliberately NOT `.strict()`, unlike every nested object above. The
  // browser parses this manifest with whatever schema shipped in ITS bundle,
  // so a strict top level makes adding any manifest field a change that breaks
  // every tab open across the deploy — the pack throws in `decodePack` and the
  // map fails to load, rather than degrading. Tolerating unknown keys costs
  // nothing (`superRefine` below, not the key list, is what actually keeps
  // producer and consumer honest) and makes the manifest additively
  // extensible, which a versioned wire format has to be.
  .superRefine((manifest, ctx) => {
    const byName = new Map(manifest.arrays.map((a) => [a.name, a]))
    for (const core of Object.values(PACK_CORE_ARRAYS)) {
      if (!byName.has(core)) {
        ctx.addIssue({
          path: ['arrays'],
          code: z.ZodIssueCode.custom,
          message: `missing core array "${core}"`,
        })
      }
    }
    for (const dim of manifest.dims) {
      const plane = byName.get(`dim:${dim.key}`)
      if (!plane || plane.type !== 'u8') {
        ctx.addIssue({
          path: ['dims'],
          code: z.ZodIssueCode.custom,
          message: `dim "${dim.key}" needs a u8 array named "dim:${dim.key}"`,
        })
      } else if (plane.elementCount !== manifest.counts.people) {
        ctx.addIssue({
          path: ['dims'],
          code: z.ZodIssueCode.custom,
          message:
            `dim "${dim.key}" elementCount (${plane.elementCount}) must ` +
            `equal counts.people (${manifest.counts.people})`,
        })
      }
    }
    // The manifest is the only enforcement layer between producer and
    // consumer, so counts and array lengths must agree — a mismatch means
    // out-of-bounds typed-array reads on the client. elementCount is in
    // scalar elements (TypedArray.length): positions carries 2 per dot.
    const expectedCounts: [string, number][] = [
      [PACK_CORE_ARRAYS.positions, manifest.counts.dots * 2],
      [PACK_CORE_ARRAYS.personToHousehold, manifest.counts.people],
      [PACK_CORE_ARRAYS.householdToDot, manifest.counts.households],
    ]
    for (const [name, expected] of expectedCounts) {
      const array = byName.get(name)
      if (array && array.elementCount !== expected) {
        ctx.addIssue({
          path: ['arrays'],
          code: z.ZodIssueCode.custom,
          message:
            `${name} elementCount (${array.elementCount}) must equal ` +
            `${expected}`,
        })
      }
    }
  })

export type DoorKnockingPackManifest = z.infer<
  typeof DoorKnockingPackManifestSchema
>
