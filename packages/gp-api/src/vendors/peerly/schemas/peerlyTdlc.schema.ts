import { PeerlyCvVerificationStatusSchema } from '@goodparty_org/contracts'
import { z } from 'zod'

// Response shapes for Peerly's 10DLC (`/v2/tdlc/:id/...`) endpoints. Same
// contract as peerlyIdentity.schema.ts: the client parses with these in observe
// mode, the vendor mock builds from them, and peerly.types.ts re-exports the
// inferred types. Status fields that are plain strings in the TS types stay
// z.string(): Peerly echoes vendor strings, and a new value is not drift.

// POST /v2/tdlc/:id/submit
export const peerly10DLCBrandSubmitResponseBodySchema = z.object({
  submission_key: z.string(),
})

// POST /v2/tdlc/:id/approve
export const approve10DLCBrandResponseBodySchema = z.object({
  street: z.string(),
  usecases: z.array(z.string()),
  phone: z.string(),
  legal_entity_type: z.string(),
  account_id: z.string(),
  companyName: z.string(),
  country: z.string(),
  postalCode: z.string(),
  entityType: z.string(),
  base_account_id: z.string(),
  email: z.string(),
  state: z.string(),
  vertical: z.string(),
  is_political: z.boolean(),
  website: z.string(),
  ein: z.string(),
  sample1: z.string(),
  displayName: z.string(),
  status: z.string(),
  entity_type: z.string(),
  city: z.string(),
  usecase: z.string(),
  sample2: z.string(),
  campaign_verify_token: z.string(),
})

// GET /v2/tdlc/:id/retrieve_cv, read as a bare status string
export const peerlyGetCvRequestResponseBodySchema = z.object({
  verification_status: z.string(),
})

// POST /v2/tdlc/:id/submit_cv
export const peerlySubmitCVResponseBodySchema = z.object({
  message: z.string(),
  verification_id: z.string(),
})

// POST /v2/tdlc/:id/resend_pin. The body is undocumented; nothing reads it.
export const peerlyResendPinResponseBodySchema = z.object({
  message: z.string().optional(),
})

// GET /v2/tdlc/:id/retrieve_cv, read as the typed status
export const peerlyRetrieveCampaignVerifyStatusResponseBodySchema = z.object({
  verification_status: PeerlyCvVerificationStatusSchema,
})

// The `verification_data` block retrieve_cv returns once the PIN has been sent.
// All optional: absent before the PIN is sent, and not a hardened contract.
export const peerlyCvVerificationDataSchema = z.object({
  verification_method: z.string().optional(),
  filing_email: z.string().optional(),
  filing_phone_number: z.string().optional(),
  filing_address_line1: z.string().optional(),
  filing_address_line2: z.string().optional(),
  filing_city: z.string().optional(),
  filing_state: z.string().optional(),
  filing_zip: z.string().optional(),
})

// GET /v2/tdlc/:id/retrieve_cv, full payload
export const peerlyRetrieveCvResponseBodySchema = z.object({
  verification_status: PeerlyCvVerificationStatusSchema,
  verification_data: peerlyCvVerificationDataSchema.optional(),
})

export enum CampaignVerificationStatus {
  PENDING = 'PENDING',
  VERIFIED = 'VERIFIED',
  FAILED = 'FAILED',
}

// POST /v2/tdlc/:id/verify_pin
export const peerlyVerifyCVPinResponseSchema = z.object({
  message: z.string(),
  verification_id: z.string(),
  cv_verification_status: z.nativeEnum(CampaignVerificationStatus),
})

// POST /v2/tdlc/:id/create_cv_token
export const peerlyCreateCVTokenResponseSchema = z.object({
  campaign_verify_token: z.string(),
})
