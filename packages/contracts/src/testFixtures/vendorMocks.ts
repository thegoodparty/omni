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
  action: z.enum([
    'geoapify.route.fail',
    'callhub.campaign.complete',
    'callhub.campaign.fail',
    'peerly.balance.empty',
    'peerly.cv.approve',
    'peerly.cv.reject',
    'peerly.cv.setPin',
    'peerly.usecase.activate',
    'vercel.order.fail',
  ]),
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
  vendorMode: z.enum(['live', 'mock']),
  records: z.array(VendorMockRecordSummarySchema),
})
export type MockRecordsResponse = z.infer<typeof MockRecordsResponseSchema>

export const RunJobResponseSchema = z.object({
  ranAt: z.string().datetime(),
  durationMs: z.number(),
})
export type RunJobResponse = z.infer<typeof RunJobResponseSchema>

export const TimeTravelSchema = z.object({
  outreachId: z.number().int().positive(),
  action: z.enum([
    'robocall.send_due_now',
    'robocall.dialed_48h_ago',
    'sms.start_date_today',
    'sms.start_date_passed',
  ]),
})
export type TimeTravel = z.infer<typeof TimeTravelSchema>

export const TimeTravelResponseSchema = z.object({
  outreachId: z.number().int().positive(),
  date: z.string().datetime().nullable(),
  dialedAt: z.string().datetime().nullable(),
  poolFreedAt: z.string().datetime().nullable(),
})
export type TimeTravelResponse = z.infer<typeof TimeTravelResponseSchema>

export const DeliverStripeEventRequestSchema = z.object({
  type: z.enum(['checkout.session.completed']),
  sessionId: z.string(),
})
export type DeliverStripeEventRequest = z.infer<
  typeof DeliverStripeEventRequestSchema
>

export const DeliverStripeEventResponseSchema = z.object({
  eventId: z.string(),
  status: z.literal('delivered'),
})
export type DeliverStripeEventResponse = z.infer<
  typeof DeliverStripeEventResponseSchema
>

export const AdminOutreachActionRequestSchema = z.object({
  action: z.enum(['cas.approve', 'results.upload']),
  payload: z.unknown().optional(),
})
export type AdminOutreachActionRequest = z.infer<
  typeof AdminOutreachActionRequestSchema
>

export const AdminOutreachActionResponseSchema = z.object({
  outreachId: z.number().int().positive(),
  action: z.string(),
  status: z.literal('applied'),
})
export type AdminOutreachActionResponse = z.infer<
  typeof AdminOutreachActionResponseSchema
>
