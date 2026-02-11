import { z } from 'zod'
import { UserRole } from '@goodparty_org/sdk'
import {
  BALLOT_LEVELS,
  CAMPAIGN_LAUNCH_STATUS,
  CAMPAIGN_TIERS,
  ELECTION_LEVELS,
} from '@/types/campaign'
import { P2V_STATUS } from '../constants'

export const USER_ROLES = Object.values(UserRole)

export const userSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  name: z.string().optional(),
  email: z.email('Invalid email').optional().or(z.literal('')),
  phone: z.string().optional(),
  zip: z.string().optional(),
  avatar: z.url().optional().or(z.literal('')),
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
  didWin: z.boolean().optional(),
  tier: z.enum(CAMPAIGN_TIERS).optional().nullable(),
  canDownloadFederal: z.boolean(),
  data: z
    .object({
      launchStatus: z.enum(CAMPAIGN_LAUNCH_STATUS).optional(),
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
  district: z.string().optional(),

  office: z.string().optional(),
  otherOffice: z.string().optional(),
  ballotLevel: z.enum(BALLOT_LEVELS).optional(),
  level: z.enum(ELECTION_LEVELS).optional().nullable(),
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

const numberOrUndefined = z.any().transform((val): number | undefined => {
  if (val === undefined || val === null || val === '') return undefined
  const num = Number(val)
  return isNaN(num) ? undefined : num
})

export const pathToVictorySchema = z.object({
  p2vStatus: z.enum(P2V_STATUS).optional(),
  electionType: z.string().optional(),
  electionLocation: z.string().optional(),

  winNumber: numberOrUndefined,
  voterContactGoal: numberOrUndefined,
  totalRegisteredVoters: numberOrUndefined,
  projectedTurnout: numberOrUndefined,
  averageTurnout: numberOrUndefined,

  republicans: numberOrUndefined,
  democrats: numberOrUndefined,
  indies: numberOrUndefined,

  men: numberOrUndefined,
  women: numberOrUndefined,

  white: numberOrUndefined,
  asian: numberOrUndefined,
  africanAmerican: numberOrUndefined,
  hispanic: numberOrUndefined,

  viability: z
    .object({
      level: z.string().optional(),
      isPartisan: z.boolean().optional(),
      isIncumbent: z.boolean().optional(),
      isUncontested: z.boolean().optional(),
      candidates: numberOrUndefined,
      seats: numberOrUndefined,
      candidatesPerSeat: numberOrUndefined,
      score: numberOrUndefined,
      probOfWin: numberOrUndefined,
    })
    .optional(),
})

export type PathToVictoryFormData = z.infer<typeof pathToVictorySchema>

const numberOrNull = z.any().transform((val): number | null => {
  if (val === null || val === undefined || val === '') return null
  const num = Number(val)
  return isNaN(num) ? null : num
})

export const electedOfficeSchema = z.object({
  electedDate: z.string().optional().nullable(),
  swornInDate: z.string().optional().nullable(),
  termStartDate: z.string().optional().nullable(),
  termLengthDays: numberOrNull,
  termEndDate: z.string().optional().nullable(),
  isActive: z.boolean(),
})

export type ElectedOfficeFormData = z.infer<typeof electedOfficeSchema>
