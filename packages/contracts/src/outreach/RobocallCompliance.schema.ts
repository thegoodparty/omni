import { z } from 'zod'
import { ROBOCALL_AUDIO_ALLOWED_MIME_TYPES } from './RobocallAudio.schema'

// Request for POST /v1/outreach/robocall/compliance: the uploaded recording's
// object key + content type, and the rented callback number the candidate was
// meant to read aloud (checked against the transcript). Candidate + org are
// derived server-side.
export const RobocallComplianceRequestSchema = z.object({
  audioKey: z.string().min(1),
  contentType: z.enum(ROBOCALL_AUDIO_ALLOWED_MIME_TYPES),
  callbackNumber: z.string().min(1).max(32),
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
