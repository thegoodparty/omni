import { z } from 'zod/v4'
import {
  UserRole,
  CampaignTier,
  BallotReadyPositionLevel,
  ElectionLevel,
  CampaignLaunchStatus,
} from '@goodparty_org/sdk'

export const USER_ROLES = Object.values(UserRole)

export const userSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  name: z.string().optional(),
  email: z.email('Invalid email').optional().or(z.literal('')),
  phone: z.string().optional(),
  zip: z.string().optional(),
  roles: z.array(z.nativeEnum(UserRole)).optional(),
  metaData: z
    .object({
      hubspotId: z.string().optional(),
      textNotifications: z.boolean().optional(),
    })
    .optional(),
})

export type UserFormData = z.infer<typeof userSchema>

export const campaignSchema = z.object({
  isActive: z.boolean(),
  isVerified: z.boolean().optional(),
  isPro: z.boolean().optional(),
  isDemo: z.boolean(),
  didWin: z.boolean().nullable().optional(),
  tier: z.nativeEnum(CampaignTier).optional().nullable(),
  canDownloadFederal: z.boolean(),
  data: z
    .object({
      launchStatus: z.nativeEnum(CampaignLaunchStatus).optional(),
      name: z.string().optional(),
      adminUserEmail: z.email().optional().or(z.literal('')),
    })
    .optional(),
})

export type CampaignFormData = z.infer<typeof campaignSchema>

export const campaignDetailsSchema = z.object({
  state: z.string().optional(),
  city: z.string().optional(),
  county: z.string().optional(),
  zip: z.string().optional(),

  ballotLevel: z.nativeEnum(BallotReadyPositionLevel).optional(),
  level: z.nativeEnum(ElectionLevel).optional().nullable(),
  officeTermLength: z.string().optional(),

  electionDate: z.string().optional(),
  primaryElectionDate: z.string().optional(),
  partisanType: z.string().optional(),

  filingPeriodsStart: z.string().optional().nullable(),
  filingPeriodsEnd: z.string().optional().nullable(),

  party: z.string().optional(),
  otherParty: z.string().optional(),

  occupation: z.string().optional(),
  funFact: z.string().optional(),
  pastExperience: z.string().optional(),
  website: z.url().optional().or(z.literal('')),

  pledged: z.boolean().optional(),
  knowRun: z.enum(['yes']).optional().nullable(),
  runForOffice: z.enum(['yes', 'no']).optional().nullable(),
})

export type CampaignDetailsFormData = z.infer<typeof campaignDetailsSchema>

// isActive and termLengthDays are derived server-side from the term dates (the
// stored columns were dropped), so the admin form no longer edits them.
export const electedOfficeSchema = z.object({
  electedDate: z.string().optional().nullable(),
  swornInDate: z.string().optional().nullable(),
  termStartDate: z.string().optional().nullable(),
  termEndDate: z.string().optional().nullable(),
  party: z.string().optional().nullable(),
})

export type ElectedOfficeFormData = z.infer<typeof electedOfficeSchema>

// Combined campaign + details schema for the edit form
export const combinedCampaignSchema = z.object({
  ...campaignSchema.shape,
  details: campaignDetailsSchema,
})

export type CombinedCampaignFormData = z.infer<typeof combinedCampaignSchema>
