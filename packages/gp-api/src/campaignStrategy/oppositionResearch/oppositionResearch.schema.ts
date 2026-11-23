import { z } from 'zod'

// The opposition_research manifest's input_schema in gp-api's names, plus the
// run's organization. The judge's suite writes the manifest's snake_case input
// and the run route converts the keys, so the two engines take the same fields
// (src/agents/AGENTS.md § The judge's run routes).
const CandidateSchema = z.object({
  gpCandidateId: z.string().nullable().optional(),
  firstName: z.string(),
  lastName: z.string(),
  fullName: z.string(),
  email: z.string().nullable().optional(),
  websiteUrl: z.string().nullable().optional(),
  party: z.string().nullable().optional(),
  isIncumbent: z.boolean().nullable().optional(),
})

const StrategyContextSchema = z.object({
  candidateCount: z.number().int(),
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

// The primary stage's roster only, or null when the race has no primary. The
// dispatcher's byte budget drops campaign_story before a roster, so it arrives
// absent rather than null in that case.
const PrimaryContextSchema = z.object({
  candidateCount: z.number().int(),
  candidates: z.array(CandidateSchema),
})

export const OppositionResearchInputSchema = z.object({
  organizationSlug: z.string().min(1),
  raceId: z.string().min(1),
  userEmail: z.string(),
  userFirstName: z.string().nullable().optional(),
  userLastName: z.string().nullable().optional(),
  userFullName: z.string().min(1),
  userPartyAffiliation: z.string().nullable().optional(),
  otherParty: z.string().nullable().optional(),
  campaignStrategyContext: StrategyContextSchema,
  campaignPrimaryStrategyContext: PrimaryContextSchema.nullable().optional(),
  campaignStory: z
    .object({
      why: z.string().nullable(),
      background: z.string().nullable(),
      issues: z.string().nullable(),
    })
    .optional(),
})
export type OppositionResearchInput = z.infer<
  typeof OppositionResearchInputSchema
>

// The manifest's output_schema, unchanged: the campaign-plan Opposition
// Research section is rendered from this shape and the persister reads it, so
// a gp-api run publishes the same artifact the PMF Engine does.
export const OppositionResearchOutputSchema = z.strictObject({
  opponents: z.array(
    z.strictObject({
      full_name: z.string().min(1),
      party_affiliation: z.string(),
      incumbent: z.boolean().nullable(),
    }),
  ),
})
export type OppositionResearchOutput = z.infer<
  typeof OppositionResearchOutputSchema
>
