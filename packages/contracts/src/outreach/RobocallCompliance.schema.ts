import { z } from 'zod'

// The compliance gate transcribes the recorded robocall and verifies the FCC
// calling-disclosure elements are actually spoken: the candidate identifies
// themselves, names the organization, and states a callback number. Fail-
// closed — the send is blocked until all three pass.
export const RobocallComplianceChecksSchema = z.object({
  // Candidate self-identifies ("this is <name>, running for <office>").
  hasSelfIdentification: z.boolean(),
  // The organization / committee is named.
  hasOrganization: z.boolean(),
  // The callback number is spoken.
  hasCallbackNumber: z.boolean(),
})
export type RobocallComplianceChecks = z.infer<
  typeof RobocallComplianceChecksSchema
>

export const RobocallComplianceVerdictSchema = z.object({
  // True only when every check passes.
  passed: z.boolean(),
  checks: RobocallComplianceChecksSchema,
  // What the transcription heard, so the candidate can see why a check failed.
  transcript: z.string(),
  // Human-readable reasons for any failed check (empty when passed).
  issues: z.array(z.string()),
})
export type RobocallComplianceVerdict = z.infer<
  typeof RobocallComplianceVerdictSchema
>
