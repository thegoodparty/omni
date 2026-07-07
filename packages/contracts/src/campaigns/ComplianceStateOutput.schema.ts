import { z } from 'zod'
import {
  ComplianceStageSchema,
  PeerlyCvVerificationStatusSchema,
} from './enums'
import { DomainStatusSchema } from '../generated/enums'

export const ComplianceStateDomainSchema = z.object({
  name: z.string(),
  status: DomainStatusSchema,
  registrantVerifiedAt: z.string().datetime({ offset: true }).nullable(),
})

export type ComplianceStateDomain = z.infer<typeof ComplianceStateDomainSchema>

export const ComplianceStateOutputSchema = z.object({
  stage: ComplianceStageSchema,
  domain: ComplianceStateDomainSchema.nullable(),
  websiteId: z.number().int().nullable(),
  peerlyVerificationId: z.string().nullable(),
  // Live Peerly CampaignVerify status. Only resolved (via a Peerly read) at the
  // `awaiting_pin` stage, where it gates the PIN-entry screen; null otherwise
  // (including when no CV request exists yet at Peerly).
  peerlyCvStatus: PeerlyCvVerificationStatusSchema.nullable(),
})

export type ComplianceStateOutput = z.infer<typeof ComplianceStateOutputSchema>
