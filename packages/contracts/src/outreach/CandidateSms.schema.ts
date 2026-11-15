import { z } from 'zod'
import { P2P_SCRIPT_MAX_LENGTH } from './OutreachScript.const'

export const CandidateSmsTestRequestSchema = z.object({
  phones: z
    .array(z.string().regex(/^\+?\d{10,15}$/))
    .min(1)
    .max(5),
})
export type CandidateSmsTestRequest = z.infer<
  typeof CandidateSmsTestRequestSchema
>

export const CandidateSmsTestResponseSchema = z.object({
  results: z.array(
    z.object({
      phone: z.string(),
      result: z.enum(['sent', 'not_cell', 'failed']),
      message: z.string().nullable(),
    }),
  ),
})
export type CandidateSmsTestResponse = z.infer<
  typeof CandidateSmsTestResponseSchema
>

export const CandidateEditSmsScriptRequestSchema = z.object({
  script: z.string().min(1).max(P2P_SCRIPT_MAX_LENGTH),
})
export type CandidateEditSmsScriptRequest = z.infer<
  typeof CandidateEditSmsScriptRequestSchema
>
