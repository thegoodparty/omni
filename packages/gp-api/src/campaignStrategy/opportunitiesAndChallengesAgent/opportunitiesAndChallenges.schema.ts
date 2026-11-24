import { z } from 'zod'

const CandidateSchema = z.object({
  gpCandidateId: z.string().nullish(),
  firstName: z.string(),
  lastName: z.string(),
  fullName: z.string(),
  email: z.string().nullish(),
  websiteUrl: z.string().nullish(),
  party: z.string().nullish(),
  isIncumbent: z.boolean().nullish(),
})

// The campaign-strategy-context slice: the reliable race numbers the bullets
// are derived from. The roster rides along and is provisional (see the
// prompt's opponent-data rule) — the agent reads it only to find the
// candidate's own row.
const StrategyContextSchema = z.object({
  candidateCount: z.number(),
  candidateOffice: z.string().nullable(),
  candidates: z.array(CandidateSchema),
  contactsNeededEstimate: z.number().nullable().optional(),
  filingDateEnd: z.string().nullable().optional(),
  generalElectionDate: z.string().nullable().optional(),
  numberOfSeats: z.number().nullable().optional(),
  officeLevel: z.string().nullable().optional(),
  officeType: z.string().nullable().optional(),
  officialOfficeName: z.string().nullable().optional(),
  partisanType: z.string().nullable().optional(),
  primaryElectionDate: z.string().nullable().optional(),
  projectedTurnout: z.number().nullable().optional(),
  registeredVoters: z.number().nullable().optional(),
  relevantElectionDate: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  uniqueCellphones: z.number().nullable().optional(),
  uniqueLandlines: z.number().nullable().optional(),
  winNumberEffective: z.number().nullable().optional(),
})

// The opportunities_and_challenges manifest's input_schema, in gp-api's names,
// plus the run's date. The date is not a param the product dispatches: the
// runner used to state it, and the runway to the election is read off it.
export const OpportunitiesAndChallengesInputSchema = z.object({
  organizationSlug: z.string().min(1),
  raceId: z.string().min(1),
  userEmail: z.string(),
  userFirstName: z.string().nullish(),
  userLastName: z.string().nullish(),
  userFullName: z.string().min(1),
  userPartyAffiliation: z.string().nullish(),
  otherParty: z.string().nullish(),
  campaignStrategyContext: StrategyContextSchema,
  campaignPrimaryStrategyContext: z
    .object({
      candidateCount: z.number(),
      candidates: z.array(CandidateSchema),
    })
    .nullable()
    .optional(),
  // Optional enrichment: a campaign with no story is dispatched without it.
  campaignStory: z
    .object({
      why: z.string().nullable(),
      background: z.string().nullable(),
      issues: z.string().nullable(),
    })
    .optional(),
  today: z.iso.date(),
})
export type OpportunitiesAndChallengesInput = z.infer<
  typeof OpportunitiesAndChallengesInputSchema
>

// The manifest's output_schema, unchanged: the two sections ARE the artifact,
// so the persister reads the same shape from either engine's run.
export const OpportunitiesAndChallengesOutputSchema = z.strictObject({
  opportunities: z.array(z.string().min(1)).min(1).max(3),
  challenges: z.array(z.string().min(1)).min(1).max(3),
})
export type OpportunitiesAndChallengesOutput = z.infer<
  typeof OpportunitiesAndChallengesOutputSchema
>
