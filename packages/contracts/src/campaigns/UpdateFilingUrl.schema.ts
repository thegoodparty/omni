import { z } from 'zod'

// Shape only — gp-api's service re-applies the full filing-URL guards
// (host allowlist, path requirement, office-level FEC rules) against the
// persisted record, since those rules depend on gp-api utilities and the
// record's officeLevel.
export const UpdateFilingUrlSchema = z.object({
  filingUrl: z.string().trim().min(1, 'A filing URL is required'),
})

export type UpdateFilingUrlInput = z.infer<typeof UpdateFilingUrlSchema>

export const UpdateFilingUrlOutputSchema = z.object({
  filingUrl: z.string(),
})

export type UpdateFilingUrlOutput = z.infer<typeof UpdateFilingUrlOutputSchema>
