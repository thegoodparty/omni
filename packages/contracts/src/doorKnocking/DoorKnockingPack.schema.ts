import { z } from 'zod'
import { DoorKnockStatusSchema } from './DoorKnockingRoutePayload.schema'

// The exploration-map "pack": one binary buffer, built per request and
// streamed people-api → gp-api → browser, never stored. Wire framing:
//
//   [u32 LE: manifest byte length][manifest JSON, utf8, padded to a 4-byte
//   boundary][typed arrays]
//
// where each typed array sits at its manifest-declared byteOffset from the
// START of the pack (f32/u32 arrays are 4-byte aligned). Consumers must
// trust the manifest, not a fixed layout. The `canvassStatus` dim is joined
// inside the encoder from the statuses gp-api sends with the request — the
// binary is never patched after the fact.
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
  .strict()
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
