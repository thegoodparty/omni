import { z } from 'zod'
import {
  ComplianceStageSchema,
  PeerlyCvVerificationStatusSchema,
  PinDeliveryMethodSchema,
} from './enums'
import { DomainStatusSchema } from '../generated/enums'

// Where Peerly sent the candidate's CampaignVerify PIN, once it has been sent.
// Only populated at `awaiting_pin` (from the live retrieve_cv read); null before
// Peerly issues the PIN or when the method is unrecognized. `displayString` is a
// server-masked rendering of the destination (e.g. `(312) •••-1162`,
// `l•••@gmail.com`) — the candidate's raw filing email/phone/address never
// crosses the wire; the FE composes the "we sent your PIN…" copy from it.
export const PinDeliverySchema = z.object({
  method: PinDeliveryMethodSchema,
  displayString: z.string(),
})

export type PinDelivery = z.infer<typeof PinDeliverySchema>

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
  // Live PIN-delivery channel + destination, resolved alongside peerlyCvStatus
  // at `awaiting_pin`; null before Peerly has sent the PIN (or on an
  // unrecognized method). The FE uses it to tell the candidate where to look.
  pinDelivery: PinDeliverySchema.nullable(),
  // Set when the record was created by the admin "treat as 10DLC approved
  // (internal testing)" checkbox: status is approved with no Peerly identity,
  // so UI gates pass but real P2P sends stay blocked.
  internalTestingApprovedAt: z.string().datetime({ offset: true }).nullable(),
  // Whether a TcrCompliance row exists at all — gp-admin uses it (with
  // internalTestingApprovedAt null) to detect real compliance in progress and
  // disable the internal-testing checkbox.
  hasComplianceRecord: z.boolean(),
})

export type ComplianceStateOutput = z.infer<typeof ComplianceStateOutputSchema>
