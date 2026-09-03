import { z } from 'zod'

// A CallFire Region: the geography attached to a local number. We keep the
// fields useful for picking/labelling a caller-ID number; the rest are
// stripped.
export const CallfireRegionSchema = z.object({
  prefix: z.string().nullish(),
  city: z.string().nullish(),
  state: z.string().nullish(),
  zipcode: z.string().nullish(),
  country: z.string().nullish(),
})
export type CallfireRegion = z.infer<typeof CallfireRegionSchema>

// A single number from GET /numbers/local. `number` is the caller ID we would
// rent and reuse; `region` carries the state we surface to callers.
export const CallfireNumberSchema = z.object({
  number: z.string(),
  nationalFormat: z.string().nullish(),
  tollFree: z.boolean().nullish(),
  region: CallfireRegionSchema.nullish(),
})
export type CallfireNumber = z.infer<typeof CallfireNumberSchema>

// GET /numbers/local returns a NumberList (an ItemList page). Only `items` is
// consumed; the paging fields (limit/offset/totalCount) are stripped, and an
// empty result may omit `items` entirely.
export const CallfireNumberListSchema = z.object({
  items: z
    .array(CallfireNumberSchema)
    .nullish()
    .transform((v) => v ?? []),
})
export type CallfireNumberList = z.infer<typeof CallfireNumberListSchema>

// POST /orders/numbers returns a ResourceId { id }. CallFire types the id as an
// int64, which exceeds JS's safe-integer range, so it is kept as a STRING
// (mirrors CallHub's id handling). Only the order id is returned here.
export const CallfireOrderResourceIdSchema = z.object({
  id: z.coerce.string(),
})
export type CallfireOrderResourceId = z.infer<
  typeof CallfireOrderResourceIdSchema
>
