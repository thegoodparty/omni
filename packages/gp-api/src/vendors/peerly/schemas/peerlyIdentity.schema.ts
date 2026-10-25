import { z } from 'zod'

// Response shapes for Peerly's identity endpoints, checked against
// api-docs.peerly.com and the prod mismatch log. Only fields gp-api reads are
// required; the rest are nullish so a field Peerly omits or nulls (common
// before a brand exists) does not alert. The real client parses with these in
// observe mode, the M4 vendor mock builds its bodies from them, and
// peerly.types.ts re-exports the inferred types.

// Peerly does not return account_id on identities (only on get_usecases).
export const peerlyIdentitySchema = z.object({
  identity_id: z.string(),
  identity_name: z.string(),
  start_date: z.string().nullish(),
  tcr_identity_status: z.string().nullish(),
  vetting_expire_date: z.string().nullish(),
  usecases: z.array(z.string()).nullish(),
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
  autoRenewal: z.number().nullish(),
  description: z.string().nullish(),
  embeddedLink: z.number().nullish(),
  embeddedPhone: z.number().nullish(),
  sample1: z.string().nullish(),
  subscriberOptin: z.number().nullish(),
  subscriberOptout: z.number().nullish(),
  usecase: z.string().nullish(),
  vertical: z.string().nullish(),
})

// `status` drives the registration state machine and `vertical` (set once a
// brand exists) gates the brand step; everything else is display data.
export const peerlyIdentityProfileSchema = z.object({
  status: z.string(),
  vertical: z.string().nullish(),
  account_id: z.string().nullish(),
  base_account_id: z.string().nullish(),
  campaignVerifyToken: z.string().nullish(),
  // A uuid-keyed map once a brand exists. Before that it fails the map shape;
  // bodies are not logged, so empty list, null and absent are all accepted.
  campaigns: z
    .union([
      z.record(z.string(), peerlyCampaignConfigSchema),
      z.array(peerlyCampaignConfigSchema),
    ])
    .nullish(),
  city: z.string().nullish(),
  companyName: z.string().nullish(),
  country: z.string().nullish(),
  displayName: z.string().nullish(),
  ein: z.string().nullish(),
  email: z.string().nullish(),
  entityType: z.string().nullish(),
  is_political: z.boolean().nullish(),
  legal_entity_type: z.string().nullish(),
  phone: z.string().nullish(),
  postalCode: z.string().nullish(),
  state: z.string().nullish(),
  street: z.string().nullish(),
  usecase: z.string().nullish(),
  usecases: z.array(z.string()).nullish(),
  website: z.string().nullish(),
  will_send_over_2k: z.boolean().nullish(),
})

// POST /identities/:id/submitProfile and GET /identities/:id/getProfile
export const peerlyIdentityProfileResponseBodySchema = z.object({
  link: z.string(),
  profile: peerlyIdentityProfileSchema.optional(),
})

export const peerlyIdentityUseCaseSchema = z.object({
  usecase: z.string(),
  activated: z.number(),
  identity_id: z.string().nullish(),
  account_id: z.string().nullish(),
  tcr_campaign_id: z.string().nullish(),
  submitted: z.number().nullish(),
})

// GET /v2/tdlc/:id/get_usecases
export const peerlyIdentityUseCaseResponseBodySchema = z.array(
  peerlyIdentityUseCaseSchema,
)
