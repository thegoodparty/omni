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
  // Peerly's end_date is the reply window (moved to start + 15 days the
  // morning after a send), not the send window; nothing keys a status off
  // it any more. Still parsed narrowly so a malformed vendor payload 502s.
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // Both the not-started guard and the completion predicate read start_date
  // (ENG-11157): a missing value must 502 the poll, never parse to Invalid
  // Date and either skip the pending hold (ratcheting a future job to
  // in_progress) or pin a sent job in_progress forever.
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

// Test-job reads parse only the fields the admin test-send path needs —
// Peerly's test-job shapes drift and everything else is noise here.
const createTestJobResponseSchema = z.object({
  id: z.string(),
})

export class CreateTestJobResponseDto extends createZodDto(
  createTestJobResponseSchema,
) {}

const listTestJobsResponseSchema = z.array(
  z.object({
    p2p_id: z.string(),
  }),
)

export class ListTestJobsResponseDto extends createZodDto(
  listTestJobsResponseSchema,
) {}
