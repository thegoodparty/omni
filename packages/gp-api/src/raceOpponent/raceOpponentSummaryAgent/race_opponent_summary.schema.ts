import { z } from 'zod'
import { RaceOpponentThreatTierSchema } from '@goodparty_org/contracts'
import { RaceContextSchema } from '../raceOpponentCollectionAgent/race_opponent_collection.schema'

// The candidate's own platform, hydrated by gp-api from Website.content.about
// (NOT CampaignStory, which is the self-research duplicate the product avoids).
// Absent when the campaign has no website bio yet, and then the run emits no
// field_analysis.
export const CandidatePlatformSchema = z.strictObject({
  bio: z.string().optional(),
  issues: z
    .array(
      z.strictObject({
        title: z.string().min(1),
        description: z.string().min(1),
      }),
    )
    .optional(),
})
export type CandidatePlatform = z.infer<typeof CandidatePlatformSchema>

export const RaceOpponentSummaryInputSchema = z.strictObject({
  organizationSlug: z.string().min(1),
  opponents: z
    .array(
      z.strictObject({
        opponentName: z.string().min(1),
        sources: z.array(
          z.strictObject({
            sourceType: z.enum(['ballotpedia', 'opponent_website']),
            sourceUrl: z.string().regex(/^https?:\/\//),
            text: z.string().min(1),
          }),
        ),
      }),
    )
    .min(1),
  candidatePlatform: CandidatePlatformSchema.optional(),
  raceContext: RaceContextSchema,
})
export type RaceOpponentSummaryInput = z.infer<
  typeof RaceOpponentSummaryInputSchema
>

// The manifest's output_schema, unchanged. `raceOpponentPersist.mapSummary`
// reads exactly these keys, so the persisted `RaceOpponentSummary.sections` is
// the same document whichever engine produced it.
const RichSourceSchema = z.strictObject({
  url: z.string().regex(/^https?:\/\//),
  title: z.string().min(1),
  publisher: z.string().min(1),
  description: z.string().min(1).optional(),
})

const DescriptiveSectionSchema = z
  .strictObject({
    text: z.string().min(1),
    sources: z.array(RichSourceSchema).min(1),
  })
  .nullable()

const IssuesThatMatterSchema = z
  .strictObject({
    items: z.array(z.string().min(1)).min(1),
    sources: z.array(RichSourceSchema).min(1),
  })
  .nullable()

// Interpretive, so there is no `sources` key at all.
const WhyTheyreRunningSchema = z
  .strictObject({ text: z.string().min(1) })
  .nullable()

const FieldAnalysisSchema = z
  .strictObject({
    strengths: z.array(z.string().min(1)),
    weaknesses: z.array(z.string().min(1)),
    opportunities: z.array(z.string().min(1)),
    threats: z.array(z.string().min(1)),
    sources: z.array(RichSourceSchema),
  })
  .nullable()

const SummaryOpponentSchema = z.strictObject({
  opponent_name: z.string().min(1),
  threat_tier: RaceOpponentThreatTierSchema,
  overview: DescriptiveSectionSchema.optional(),
  why_theyre_running: WhyTheyreRunningSchema.optional(),
  background: DescriptiveSectionSchema.optional(),
  issues_that_matter: IssuesThatMatterSchema.optional(),
})

export const RaceOpponentSummaryOutputSchema = z.strictObject({
  generated_at: z.string().min(1),
  opponents: z.array(SummaryOpponentSchema).min(1),
  field_analysis: FieldAnalysisSchema.optional(),
})
export type RaceOpponentSummaryOutput = z.infer<
  typeof RaceOpponentSummaryOutputSchema
>
