import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

// Preview/dev-only deterministic seeding for e2e tests. The caller supplies
// only the text an assertion needs to address (titles, passage bodies); the
// service expands it into a complete `MeetingBriefingFull` artifact so the
// request body stays small enough to read inside a Playwright spec. Disabled
// on qa/prod by the service.
const BriefingSeedTalkingPointSchema = z.object({
  text: z.string().min(1),
  why: z.string().min(1),
})

const BriefingSeedItemSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  budgetImpactSummary: z.string().min(1).optional(),
  sentimentSummary: z.string().min(1).optional(),
  // A tuple, not `.array().length(3)`: the agent contract types talking_points
  // as a fixed-length tuple union, and only a tuple schema infers that shape.
  talkingPoints: z
    .tuple([
      BriefingSeedTalkingPointSchema,
      BriefingSeedTalkingPointSchema,
      BriefingSeedTalkingPointSchema,
    ])
    .optional(),
})

// The executive summary is a fixed-length tuple union in the agent contract
// (0-5 entries) and one entry is emitted per item, so the item cap is 5.
export const BriefingSeedRequestSchema = z.object({
  meetingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  meetingName: z.string().min(1).default('City Council'),
  meetingTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .default('18:00'),
  meetingTimezone: z.string().min(1).default('America/New_York'),
  location: z.string().min(1).default('City Hall Council Chambers'),
  officialName: z.string().min(1).default('Test Official'),
  items: z.array(BriefingSeedItemSchema).min(1).max(5),
})

export class BriefingSeedRequestDto extends createZodDto(
  BriefingSeedRequestSchema,
) {}

export const BriefingSeedResponseSchema = z.object({
  briefingId: z.string(),
  meetingDate: z.string(),
  itemIds: z.array(z.string()),
})
