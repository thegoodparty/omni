import { z } from 'zod'

// Response shapes for Peerly's identity endpoints. Field names and optionality
// mirror what the client has always assumed (peerly.types.ts re-exports the
// inferred types). The real client parses with these in observe mode and the
// M4 vendor mock builds its bodies from them, so the two cannot drift.

export const peerlyIdentitySchema = z.object({
  identity_id: z.string(),
  identity_name: z.string(),
  start_date: z.string(),
  account_id: z.string(),
  tcr_identity_status: z.string().nullable(),
  vetting_expire_date: z.string().optional(),
  usecases: z.array(z.string()).optional(),
})

// POST /identities
export const peerlyIdentityCreateResponseBodySchema = z.object({
  Data: peerlyIdentitySchema,
})

// GET /identities/listByAccount
export const peerlyGetIdentitiesResponseBodySchema = z.object({
  identities: z.array(peerlyIdentitySchema),
})

export const peerlyCampaignConfigSchema = z.object({
  autoRenewal: z.number(),
  description: z.string(),
  embeddedLink: z.number(),
  embeddedPhone: z.number(),
  sample1: z.string(),
  subscriberOptin: z.number(),
  subscriberOptout: z.number(),
  usecase: z.string(),
  vertical: z.string().optional(),
})

export const peerlyIdentityProfileSchema = z.object({
  account_id: z.string(),
  base_account_id: z.string(),
  campaignVerifyToken: z.string().nullish(),
  campaigns: z.record(z.string(), peerlyCampaignConfigSchema),
  city: z.string(),
  companyName: z.string(),
  country: z.string().nullable(),
  displayName: z.string(),
  ein: z.string(),
  email: z.string(),
  entityType: z.string(),
  is_political: z.boolean(),
  legal_entity_type: z.string(),
  phone: z.string(),
  postalCode: z.string(),
  state: z.string(),
  status: z.string(),
  street: z.string(),
  usecase: z.string(),
  vertical: z.string().optional(),
  usecases: z.array(z.string()).optional(),
  website: z.string(),
  will_send_over_2k: z.boolean().optional(),
})

// POST /identities/:id/submitProfile and GET /identities/:id/getProfile
export const peerlyIdentityProfileResponseBodySchema = z.object({
  link: z.string(),
  profile: peerlyIdentityProfileSchema.optional(),
})

export const peerlyIdentityUseCaseSchema = z.object({
  identity_id: z.string(),
  account_id: z.string(),
  usecase: z.string(),
  tcr_campaign_id: z.string(),
  submitted: z.number(),
  activated: z.number(),
})

// GET /v2/tdlc/:id/get_usecases
export const peerlyIdentityUseCaseResponseBodySchema = z.array(
  peerlyIdentityUseCaseSchema,
)
