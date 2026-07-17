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
})

export class GetJobResponseDto extends createZodDto(getJobResponseSchema) {}
