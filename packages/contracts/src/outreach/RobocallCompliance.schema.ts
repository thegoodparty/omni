import { z } from 'zod'
import { ROBOCALL_AUDIO_ALLOWED_MIME_TYPES } from './RobocallAudio.schema'

// Request for POST /v1/outreach/robocall/compliance: the uploaded recording's
// object key + content type. Everything the transcript is checked against is
// derived server-side — the candidate name and organization from the campaign,
// and the callback-number check just confirms a number is spoken (no
// client-supplied expected value to spoof). The caller-ID number that voters
// actually reach is enforced at dial time, not here.
export const RobocallComplianceRequestSchema = z.object({
  audioKey: z.string().min(1),
  contentType: z.enum(ROBOCALL_AUDIO_ALLOWED_MIME_TYPES),
})
export type RobocallComplianceRequest = z.infer<
  typeof RobocallComplianceRequestSchema
>

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
