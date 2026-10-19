import { z } from 'zod'

// state is a Json column — its shape varies per vendor/action so we pass it
// through without asserting structure; the caller reads only what it knows.
export const VendorMockRecordSummarySchema = z.object({
  id: z.string(),
  vendor: z.string(),
  kind: z.string(),
  externalId: z.string(),
  state: z.unknown(),
})
export type VendorMockRecordSummary = z.infer<
  typeof VendorMockRecordSummarySchema
>

export const MockActionSchema = z.object({
  campaignId: z.number().int().positive(),
  action: z.enum(['geoapify.route.fail']),
  params: z.record(z.string(), z.unknown()).optional(),
})
export type MockAction = z.infer<typeof MockActionSchema>

export const MockActionResponseSchema = z.object({
  records: z.array(VendorMockRecordSummarySchema),
})
export type MockActionResponse = z.infer<typeof MockActionResponseSchema>

export const MockRecordsQuerySchema = z.object({
  campaignId: z.coerce.number().int().positive(),
})
export type MockRecordsQuery = z.infer<typeof MockRecordsQuerySchema>

export const MockRecordsResponseSchema = z.object({
  records: z.array(VendorMockRecordSummarySchema),
})
export type MockRecordsResponse = z.infer<typeof MockRecordsResponseSchema>

export const RunJobResponseSchema = z.object({
  ranAt: z.string().datetime(),
  durationMs: z.number(),
})
export type RunJobResponse = z.infer<typeof RunJobResponseSchema>
