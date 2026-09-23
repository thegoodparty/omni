import { z } from 'zod'

// The committee name feeds the SMS "Paid for by" footer and the
// checkSmsStandards paid_for_by check, so a whitespace-only value is
// invalid — same rule as the create path (tcrComplianceBase.schema.ts).
export const UpdateCommitteeNameSchema = z.object({
  committeeName: z.string().trim().min(1, 'A committee name is required'),
})

export type UpdateCommitteeNameInput = z.infer<typeof UpdateCommitteeNameSchema>

export const UpdateCommitteeNameOutputSchema = z.object({
  committeeName: z.string(),
})

export type UpdateCommitteeNameOutput = z.infer<
  typeof UpdateCommitteeNameOutputSchema
>
