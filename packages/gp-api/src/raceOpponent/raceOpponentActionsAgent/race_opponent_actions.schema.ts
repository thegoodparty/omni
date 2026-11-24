import { z } from 'zod'
import { RaceOpponentThreatTierSchema } from '@goodparty_org/contracts'
import { CandidatePlatformSchema } from '../raceOpponentSummaryAgent/race_opponent_summary.schema'
import { RaceContextSchema } from '../raceOpponentCollectionAgent/race_opponent_collection.schema'

// The manifest's input_schema, in gp-api's names, plus the run's owner. The
// district params are the same flat, all-or-nothing trio the dispatcher builds
// from DistrictResolverService: present together, or absent together.
export const RaceOpponentActionsInputSchema = z.strictObject({
  organizationSlug: z.string().min(1),
  opponents: z
    .array(
      z.strictObject({
        opponentName: z.string().min(1),
        threatTier: RaceOpponentThreatTierSchema,
        overviewText: z.string().nullable(),
        backgroundText: z.string().nullable(),
        issuesThatMatter: z.array(z.string().min(1)).nullable(),
      }),
    )
    .min(1),
  candidatePlatform: CandidatePlatformSchema.optional(),
  state: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  l2DistrictType: z.string().min(1).optional(),
  l2DistrictName: z.string().min(1).optional(),
  raceContext: RaceContextSchema,
})
export type RaceOpponentActionsInput = z.infer<
  typeof RaceOpponentActionsInputSchema
>

// The manifest's output_schema, unchanged: RaceOpponentPersistService's
// parseHaystaq and the contract's RaceOpponentStandoutActionHaystaqSchema read
// these keys, so a gp-api run writes the same card columns the PMF Engine does.
const HaystaqSchema = z
  .strictObject({
    hs_column: z.string().min(1),
    position_phrase: z.string().min(1),
    position_dir: z.enum(['high', 'low']),
    total_active: z.int().min(0),
    voter_count_ge50: z.int().min(0),
    voter_percentage_ge50: z.number().min(0).max(100),
    voter_count_ge70: z.int().min(0),
    voter_percentage_ge70: z.number().min(0).max(100),
  })
  .nullable()

const ActionCardSchema = z.strictObject({
  title: z.string().min(1).max(99),
  body: z.string().min(1).max(399),
  sms_message: z.string().min(1).max(320),
  opponent_name: z.string().min(1).nullable(),
  issue: z.string().min(1),
  haystaq: HaystaqSchema,
})

export const RaceOpponentActionsOutputSchema = z.strictObject({
  generated_at: z.string().min(1),
  haystaq_status: z.enum(['district_scoped', 'no_coverage', 'no_district']),
  actions: z.array(ActionCardSchema).max(5),
})
export type RaceOpponentActionsOutput = z.infer<
  typeof RaceOpponentActionsOutputSchema
>
