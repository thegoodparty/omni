import { z } from 'zod'

export const BriefingInputSchema = z.object({
  organizationSlug: z.string().min(1),
  electedOfficeId: z.string().min(1),
  requestedAt: z.iso.datetime({ offset: true }),
  officialName: z.string().min(1),
  state: z.string().regex(/^[A-Z]{2}$/),
  meetingDate: z.iso.date(),
  meetingTime: z
    .string()
    .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/)
    .optional(),
  meetingTimezone: z.string().min(1).max(64).optional(),
  positionName: z.string().min(1).optional(),
  l2DistrictType: z
    .string()
    .regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/)
    .optional(),
  l2DistrictName: z.string().min(1).optional(),
  knownAgendaLocation: z.string().min(1).max(2000).optional(),
  agendaPacketUrl: z
    .string()
    .max(2048)
    .regex(/^https?:\/\//)
    .optional(),
})
export type BriefingInput = z.infer<typeof BriefingInputSchema>
