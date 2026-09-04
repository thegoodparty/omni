import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'
import { PeerlyJobStatus } from '../peerly.types'

const createJobResponseSchema = z.object({
  id: z.string(),
  agents: z
    .union([z.array(z.string()), z.record(z.string(), z.string())])
    .optional(),
  name: z.string(),
  status: z.string(),
  templates: z.array(
    z.object({
      id: z.string(),
      is_default: z.boolean().optional(),
      text: z.string().optional(),
      title: z.string().optional(),
    }),
  ),
})

export class CreateJobResponseDto extends createZodDto(
  createJobResponseSchema,
) {}

// The fields the outreach-completion sweep keys off of
// (OutreachCompletionService) — validated narrowly so a malformed vendor
// response 502s rather than silently driving a wrong status transition.
const getJobResponseSchema = z.object({
  id: z.string(),
  status: z.nativeEnum(PeerlyJobStatus),
  leads_remaining: z.number(),
  // The completion predicate (ENG-10739) is end_date-past; a missing or
  // malformed end_date must 502 the poll, not silently parse to Invalid
  // Date and pin the outreach in_progress forever.
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // The not-started guard is start_date-future for the same reason: a
  // missing start_date would parse to Invalid Date and silently skip the
  // pending hold, ratcheting a future-scheduled job to in_progress.
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

export class GetJobResponseDto extends createZodDto(getJobResponseSchema) {}

// detailedstats counters the admin monitor maps (narrow: only the keyed
// count objects and total cost — the endpoint returns much more). Records
// are label→count maps whose exact key set Peerly doesn't document, so the
// mapper sums by TX/RX prefix instead of naming keys.
const jobDetailedStatsResponseSchema = z
  .object({
    messages: z.record(z.string(), z.number()).optional(),
    mms_messages: z.record(z.string(), z.number()).optional(),
    delivery_receipts: z.record(z.string(), z.number()).optional(),
    mms_delivery_receipts: z.record(z.string(), z.number()).optional(),
    total_cost: z.number().optional(),
  })
  // All-optional fields would let an unrecognized v2 shape parse to
  // undefined everywhere and render as zeros; require at least one
  // expected counter so a key miss fails loudly instead.
  .refine(
    (data) =>
      data.messages !== undefined ||
      data.mms_messages !== undefined ||
      data.delivery_receipts !== undefined ||
      data.mms_delivery_receipts !== undefined ||
      data.total_cost !== undefined,
    {
      message:
        'detailedstats response contains none of the expected counter ' +
        'fields — possible API shape mismatch',
    },
  )

export class JobDetailedStatsResponseDto extends createZodDto(
  jobDetailedStatsResponseSchema,
) {}
