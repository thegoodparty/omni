import { z } from 'zod'

// Structured LLM verdict for the pre-submission filing-URL check (ENG-10965).
// A false check with an empty reasons array is a malformed verdict, not a
// completed one — refined out so the caller retries (jsonCompletion) rather
// than persisting a hold with no explanation.
export const CvPreSubmissionVerdictSchema = z
  .object({
    urlAcceptable: z.boolean(),
    nameFound: z.boolean(),
    filingEvidenced: z.boolean(),
    reasons: z.array(z.string()),
  })
  .refine(
    (verdict) =>
      (verdict.urlAcceptable && verdict.nameFound && verdict.filingEvidenced) ||
      verdict.reasons.length > 0,
    { message: 'reasons must explain every check marked false' },
  )

export type CvPreSubmissionVerdict = z.infer<
  typeof CvPreSubmissionVerdictSchema
>
