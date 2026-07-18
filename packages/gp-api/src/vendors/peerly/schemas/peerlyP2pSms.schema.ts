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
})

export class GetJobResponseDto extends createZodDto(getJobResponseSchema) {}
