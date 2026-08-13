import { z } from 'zod'
import { createZodDto } from 'nestjs-zod'

// Sales-facing 400 shown when the HubSpot contact is missing a usable name.
// The provisioned Clerk identity and onboarding greeting rely on a real
// first/last name, so we reject blank or whitespace-only values up front.
export const CAMPAIGN_MAGIC_LINK_NAME_REQUIRED_ERROR =
  'First and last name are required — add them to the HubSpot contact before sending the magic link.'

// SMS fields shared by the create-and-text and text-only endpoints. `phone` is
// only shape-checked here — SmsService normalizes to E.164 and reports an
// unusable number back as `smsError`, so a bad number never fails link creation.
// `consentSource` records who claimed consent (the card passes the rep's email).
const smsFields = {
  phone: z.string().min(1).optional(),
  smsConsent: z.boolean().optional(),
  consentSource: z.string().optional(),
}

export const CreateCampaignMagicLinkSchema = z.object({
  email: z.string().email(),
  // Accept any string here; the controller trims and rejects blank/whitespace
  // names with CAMPAIGN_MAGIC_LINK_NAME_REQUIRED_ERROR so the message is
  // predictable.
  firstName: z.string(),
  lastName: z.string(),
  // When a phone is supplied the freshly minted link is also texted, as part of
  // the same call — the rep clicked one button.
  ...smsFields,
})

export class CreateCampaignMagicLinkDto extends createZodDto(
  CreateCampaignMagicLinkSchema,
) {}

export type CreateCampaignMagicLinkInput = z.infer<
  typeof CreateCampaignMagicLinkSchema
>

// Query schema for the on-demand URL lookup the Win sales card uses to fetch
// (and copy) the redemption link without it ever being stored in HubSpot.
export const GetCampaignMagicLinkSchema = z.object({
  email: z.string().email(),
})

export class GetCampaignMagicLinkDto extends createZodDto(
  GetCampaignMagicLinkSchema,
) {}

// Texts the lead's *current* active link without minting a new one, for the case
// where the rep emailed it and the lead says it never arrived. Minting a fresh
// link here would rotate the slug and invalidate the one already in their inbox.
export const SendCampaignMagicLinkSmsSchema = z.object({
  email: z.string().email(),
  // Required here, unlike the create endpoint where it opts into texting.
  phone: z.string().min(1),
  smsConsent: smsFields.smsConsent,
  consentSource: smsFields.consentSource,
})

export class SendCampaignMagicLinkSmsDto extends createZodDto(
  SendCampaignMagicLinkSmsSchema,
) {}
