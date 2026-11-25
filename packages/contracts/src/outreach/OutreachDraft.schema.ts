import { z } from 'zod'

// Only the two paid channels can be drafted: a candidate who cannot send yet
// keeps the work instead of losing it at the pay step.
export const OUTREACH_DRAFT_TYPES = ['p2p', 'robocall'] as const

// Multipart carries every field as a string (a p2p draft sends its image on
// the same request), so the numeric id is coerced.
export const CreateOutreachDraftRequestSchema = z
  .object({
    outreachType: z.enum(OUTREACH_DRAFT_TYPES),
    name: z.string().trim().min(1).max(120),
    voterFileFilterId: z.coerce.number().int().positive(),
    script: z.string().trim().min(1).optional(),
    audioKey: z.string().min(1).optional(),
    callbackNumber: z.string().min(1).optional(),
    // The campaign-plan task the flow was opened from. Kept on the draft so
    // the task still closes once a later resume schedules it.
    trackerTaskId: z.string().min(1).optional(),
    // The chat card a texting draft was written from (the card's key, never
    // the model's). A keyed draft has its own slot, so it neither collides
    // with the draft the candidate saved from the hub nor replaces it, and
    // saving again under the same key updates that one row.
    proposalKey: z.string().uuid().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.outreachType === 'robocall' && data.proposalKey) {
      ctx.addIssue({
        path: ['proposalKey'],
        code: z.ZodIssueCode.custom,
        message: 'proposalKey is only accepted on a texting draft',
      })
    }
    if (data.outreachType === 'p2p' && !data.script) {
      ctx.addIssue({
        path: ['script'],
        code: z.ZodIssueCode.custom,
        message: 'script is required for a texting draft',
      })
    }
    if (
      data.outreachType === 'robocall' &&
      (!data.audioKey || !data.callbackNumber)
    ) {
      ctx.addIssue({
        path: ['audioKey'],
        code: z.ZodIssueCode.custom,
        message:
          'audioKey and callbackNumber are required for a robocall draft',
      })
    }
  })

export type CreateOutreachDraftRequest = z.infer<
  typeof CreateOutreachDraftRequestSchema
>

// The 409 body when a draft of that type already exists (one unkeyed draft per
// type per campaign), so the client can offer "resume" instead of "start".
export const OutreachDraftConflictSchema = z.object({
  existingId: z.number().int(),
})
export type OutreachDraftConflict = z.infer<typeof OutreachDraftConflictSchema>
