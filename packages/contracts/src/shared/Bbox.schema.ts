import { z } from 'zod'

// Geographic bounding box, WGS84 degrees. No antimeridian handling — this
// crosses the gp-api ↔ people-api boundary for US voter addresses only.
export const BboxSchema = z
  .object({
    minLat: z.number().min(-90).max(90),
    maxLat: z.number().min(-90).max(90),
    minLng: z.number().min(-180).max(180),
    maxLng: z.number().min(-180).max(180),
  })
  .strict()
  .refine(
    (b) => b.minLat <= b.maxLat && b.minLng <= b.maxLng,
    'bbox min must not exceed max',
  )

export type Bbox = z.infer<typeof BboxSchema>
