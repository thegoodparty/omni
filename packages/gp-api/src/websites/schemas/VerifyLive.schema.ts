import { z } from 'zod'

// Why the site failed verification, so the agent acts on the real cause
// instead of inferring "DNS not propagated" from http_200=false:
//   unreachable     — the fetch threw (DNS/connection/timeout); not reachable yet
//   not_live        — a response came back, but the status was not 200
//   redirect_loop   — too many redirects; server reachable but misconfigured,
//                     so waiting will never fix it (unrecoverable)
//   content_missing — 200, but a required TCR section/identity marker is absent
// null when verified.
export const VerifyLiveReason = {
  unreachable: 'unreachable',
  notLive: 'not_live',
  redirectLoop: 'redirect_loop',
  contentMissing: 'content_missing',
} as const

export const VerifyLiveResponseSchema = z.object({
  verified: z.boolean(),
  url: z.string().url(),
  reason: z.nativeEnum(VerifyLiveReason).nullable(),
  checks: z.object({
    http_200: z.boolean(),
    has_privacy_policy: z.boolean(),
    has_terms: z.boolean(),
    has_candidate_identity: z.boolean(),
  }),
})

export type VerifyLiveResponse = z.infer<typeof VerifyLiveResponseSchema>
