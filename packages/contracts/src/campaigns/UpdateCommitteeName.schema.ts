import { z } from 'zod'
import { CommitteeNameSchema } from './CommitteeName.schema'

// Same rule as the create path (tcrComplianceBase.schema.ts): the rename
// lands in the SMS "Paid for by" footer and checkSmsStandards too.
export const UpdateCommitteeNameSchema = z.object({
  committeeName: CommitteeNameSchema,
})

export type UpdateCommitteeNameInput = z.infer<typeof UpdateCommitteeNameSchema>

export const UpdateCommitteeNameOutputSchema = z.object({
  committeeName: z.string(),
})

export type UpdateCommitteeNameOutput = z.infer<
  typeof UpdateCommitteeNameOutputSchema
>
