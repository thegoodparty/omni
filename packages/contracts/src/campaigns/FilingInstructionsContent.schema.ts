import { z } from 'zod'

/**
 * The filing-instructions content shown on the pro-upgrade wizard's
 * "filing-instructions" screen AND emailed by "Email this to me". Both
 * surfaces read this one shape (computed once on the server from the live
 * race-target metrics) so the page and the email can never drift.
 *
 * `filingWindow` is a presentation-ready string ("June 1, 2026 – June 30,
 * 2026", a single date, or "Not yet available") — formatted server-side so
 * the window isn't formatted independently on each surface. The remaining
 * fields are raw: each surface lays them out per its own design.
 */
export const FilingInstructionsContentSchema = z.object({
  filingWindow: z.string(),
  filingFee: z.number().nullable(),
  filingRequirementsText: z.string().nullable(),
  filingOfficeAddress: z.string().nullable(),
  filingPhoneNumber: z.string().nullable(),
  paperworkInstructions: z.string().nullable(),
})

export type FilingInstructionsContent = z.infer<
  typeof FilingInstructionsContentSchema
>
