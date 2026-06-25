import { z } from 'zod'
import { TcrComplianceStatusSchema } from '@goodparty_org/contracts'

export const DevApproveTcrComplianceOutputSchema = z.object({
  id: z.string(),
  campaignId: z.number(),
  status: TcrComplianceStatusSchema,
  peerlyIdentityId: z.string().nullable(),
})
