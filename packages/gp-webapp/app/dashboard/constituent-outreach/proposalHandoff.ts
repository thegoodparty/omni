import { z } from 'zod'
import { ProposalLinkSchema } from '@goodparty_org/contracts'

/**
 * What a chat card's outreach proposal hands this hub's flows. It goes
 * browser to browser through sessionStorage, so the message never sits in a
 * shareable URL. The proposal link (the card's derived key and its priority)
 * rides through to the flow's own create, which is where it crosses into the
 * API and where its contract lives.
 */
export const ProposalHandoffSchema = z
  .object({
    channel: z.enum(['text', 'phoneBanking', 'social']),
    message: z.string().min(1),
    savedFilterId: z.number().int().positive().nullish(),
  })
  .extend(ProposalLinkSchema.shape)

export type ProposalHandoff = z.infer<typeof ProposalHandoffSchema>

export const proposalLinkOf = ({
  proposalKey,
  priorityId,
}: ProposalHandoff) => ({
  ...(proposalKey !== undefined && { proposalKey }),
  ...(priorityId !== undefined && { priorityId }),
})
