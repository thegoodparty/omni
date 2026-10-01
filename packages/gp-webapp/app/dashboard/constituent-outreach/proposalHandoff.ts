import { z } from 'zod'

/**
 * What a chat card's outreach proposal hands this hub's text and phone
 * banking flows. It goes browser to browser through sessionStorage, so the
 * message never sits in a shareable URL, and it never crosses a service
 * boundary, which is why it is not a contract. Social keeps the Chief of
 * Staff's `ComposeHandoffPayload`, which that flow already reads.
 */
export const ProposalHandoffSchema = z.object({
  channel: z.enum(['text', 'phoneBanking']),
  message: z.string().min(1),
  savedFilterId: z.number().int().positive().nullish(),
})

export type ProposalHandoff = z.infer<typeof ProposalHandoffSchema>
