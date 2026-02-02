import { z } from 'zod'

// ============================================
// ENUMS (matching Prisma schema)
// ============================================

export const USER_ROLES = [
  'admin',
  'sales',
  'candidate',
  'campaignManager',
  'demo',
] as const
export const CAMPAIGN_TIERS = ['WIN', 'LOSE', 'TOSSUP'] as const
export const CAMPAIGN_LAUNCH_STATUS = [
  'draft',
  'launched',
  'archived',
  'suspended',
] as const
export const BALLOT_LEVELS = [
  'CITY',
  'COUNTY',
  'FEDERAL',
  'LOCAL',
  'REGIONAL',
  'STATE',
  'TOWNSHIP',
] as const
export const ELECTION_LEVELS = [
  'city',
  'county',
  'state',
  'federal',
  'local',
] as const
export const P2V_STATUS = [
  'Waiting',
  'Processing',
  'Complete',
  'Failed',
  'Not Needed',
] as const

// ============================================
// USER SCHEMA (PATCH /users/:id)
// ============================================

export const userSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  name: z.string().optional(),
  email: z.email('Invalid email').optional().or(z.literal('')),
  phone: z.string().optional(),
  zip: z.string().optional(),
  avatar: z.url().optional().or(z.literal('')),
  roles: z.array(z.enum(USER_ROLES)).optional(),
  // metaData fields
  metaData: z
    .object({
      hubspotId: z.string().optional(),
      textNotifications: z.boolean().optional(),
    })
    .optional(),
})

export type UserFormData = z.infer<typeof userSchema>

// ============================================
// CAMPAIGN SCHEMA (PATCH /campaigns/:id)
// ============================================

export const campaignSchema = z.object({
  // Core flags
  isActive: z.boolean(),
  isVerified: z.boolean().optional(),
  isPro: z.boolean().optional(),
  isDemo: z.boolean(),
  didWin: z.boolean().optional(),
  tier: z.enum(CAMPAIGN_TIERS).optional().nullable(),
  canDownloadFederal: z.boolean(),
  // Campaign.data fields
  data: z
    .object({
      launchStatus: z.enum(CAMPAIGN_LAUNCH_STATUS).optional(),
      name: z.string().optional(),
      adminUserEmail: z.email().optional().or(z.literal('')),
    })
    .optional(),
})

export type CampaignFormData = z.infer<typeof campaignSchema>

// ============================================
// CAMPAIGN DETAILS SCHEMA (PATCH /campaigns/:id - details JSON)
// ============================================

export const campaignDetailsSchema = z.object({
  // Location
  state: z.string().optional(),
  city: z.string().optional(),
  county: z.string().optional(),
  zip: z.string().optional(),
  district: z.string().optional(),

  // Office
  office: z.string().optional(),
  otherOffice: z.string().optional(),
  ballotLevel: z.enum(BALLOT_LEVELS).optional(),
  level: z.enum(ELECTION_LEVELS).optional().nullable(),
  officeTermLength: z.string().optional(),

  // Election
  electionDate: z.string().optional(),
  primaryElectionDate: z.string().optional(),
  partisanType: z.string().optional(),

  // Filing
  filingPeriodsStart: z.string().optional().nullable(),
  filingPeriodsEnd: z.string().optional().nullable(),

  // Party
  party: z.string().optional(),
  otherParty: z.string().optional(),

  // Background
  occupation: z.string().optional(),
  funFact: z.string().optional(),
  pastExperience: z.string().optional(),
  website: z.url().optional().or(z.literal('')),

  // Flags
  pledged: z.boolean().optional(),
  knowRun: z.enum(['yes']).optional().nullable(),
  runForOffice: z.enum(['yes', 'no']).optional().nullable(),
})

export type CampaignDetailsFormData = z.infer<typeof campaignDetailsSchema>

// ============================================
// PATH TO VICTORY SCHEMA (PATCH /path-to-victory/:id)
// ============================================

const numberOrEmpty = z.coerce.number().optional()

export const pathToVictorySchema = z.object({
  // Status
  p2vStatus: z.enum(P2V_STATUS).optional(),
  electionType: z.string().optional(),
  electionLocation: z.string().optional(),

  // Target Numbers
  winNumber: numberOrEmpty,
  voterContactGoal: numberOrEmpty,
  totalRegisteredVoters: numberOrEmpty,
  projectedTurnout: numberOrEmpty,
  averageTurnout: numberOrEmpty,

  // Demographics - Party
  republicans: numberOrEmpty,
  democrats: numberOrEmpty,
  indies: numberOrEmpty,

  // Demographics - Gender
  men: numberOrEmpty,
  women: numberOrEmpty,

  // Demographics - Race/Ethnicity
  white: numberOrEmpty,
  asian: numberOrEmpty,
  africanAmerican: numberOrEmpty,
  hispanic: numberOrEmpty,

  // Viability (nested object)
  viability: z
    .object({
      level: z.string().optional(),
      isPartisan: z.boolean().optional(),
      isIncumbent: z.boolean().optional(),
      isUncontested: z.boolean().optional(),
      candidates: numberOrEmpty,
      seats: numberOrEmpty,
      candidatesPerSeat: numberOrEmpty,
      score: numberOrEmpty,
      probOfWin: numberOrEmpty,
    })
    .optional(),
})

export type PathToVictoryFormData = z.infer<typeof pathToVictorySchema>

// ============================================
// ELECTED OFFICE SCHEMA (PATCH /elected-offices/:id)
// ============================================

export const electedOfficeSchema = z.object({
  electedDate: z.string().optional().nullable(),
  swornInDate: z.string().optional().nullable(),
  termStartDate: z.string().optional().nullable(),
  termLengthDays: z.coerce.number().optional().nullable(),
  termEndDate: z.string().optional().nullable(),
  isActive: z.boolean(),
})

export type ElectedOfficeFormData = z.infer<typeof electedOfficeSchema>
