import { z } from 'zod'

// The exploration-map "pack": one binary buffer, built per request and
// streamed people-api → gp-api → browser, never stored. Wire framing:
//
//   [u32 LE: manifest byte length][manifest JSON, utf8][typed arrays]
//
// where each typed array sits at its manifest-declared byteOffset from the
// START of the buffer. people-api emits the demographic dims; gp-api appends
// a `canvassStatus` dim (bytes joined from its interactions table) before
// forwarding, so consumers must trust the manifest, not a fixed layout.
export const DoorKnockingPackRequestSchema = z
  .object({
    districtId: z.guid(),
  })
  .strict()

export type DoorKnockingPackRequest = z.infer<
  typeof DoorKnockingPackRequestSchema
>

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
      }
    }
  })

export type DoorKnockingPackManifest = z.infer<
  typeof DoorKnockingPackManifestSchema
>
