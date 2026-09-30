import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'
import { OutreachProposalSchema } from '@goodparty_org/contracts'

// The card's own shape minus its key, which travels in the path. Built from
// the contract rather than restated so the browser and the server cannot
// drift on what a proposal is. priorityId is absent for a card the Chief of
// Staff left, since that chat has no priority behind it.
export class SendOutreachProposalSchema extends createZodDto(
  OutreachProposalSchema.omit({ proposalKey: true })
    .extend({ priorityId: z.string().min(1).nullish() })
    .strict(),
) {}
