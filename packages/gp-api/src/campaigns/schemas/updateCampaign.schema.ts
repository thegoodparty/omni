import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'
import {
  BallotReadyPositionLevelSchema,
  CampaignSchema,
  ElectionLevelSchema,
} from '@goodparty_org/contracts'
import { StateSchema } from '@/shared/schemas/State.schema'
import { BallotStatusSchema } from './ballotStatus.schema'

const CampaignDetailsSchema = z
  .object({
    state: StateSchema(),
    ballotLevel: BallotReadyPositionLevelSchema,
    electionDate: z.string(),
    primaryElectionDate: z.string(),
    zip: z.string(),
    knowRun: z.enum(['yes']),
    runForOffice: z.enum(['yes', 'no']),
    // Deprecated: the answer now lives on the campaign.ballotStatus column.
    // Still accepted so a frontend from before the cutover isn't silently
    // dropped mid-deploy; updateJsonFields forwards it to the column and
    // removes it from details. Delete once no client sends it.
    ballotStatus: BallotStatusSchema,
    pledged: z.boolean(),
    customIssues: z.array(
      z.object({
        title: z.string(),
        position: z.string(),
      }),
    ),
    runningAgainst: z.array(
      z.object({
        name: z.string(),
        party: z.string(),
        description: z.string(),
      }),
    ),
    geoLocation: z.object({
      geoHash: z.string(),
      lng: z.number(),
      lat: z.number(),
    }),
    geoLocationFailed: z.boolean(),
    city: z.string(),
    county: z.string(),
    normalizedOffice: z.string(),
    party: z.string(),
    otherParty: z.string(),
    district: z.string(),
    raceId: z.string().nullish(),
    level: ElectionLevelSchema,
    noNormalizedOffice: z.boolean(),
    website: z.string(),
    pastExperience: z.union([z.string(), z.record(z.string(), z.string())]),
    occupation: z.string(),
    funFact: z.string(),
    campaignCommittee: z.string(),
    statementName: z.string(),
    // Pro-upgrade wizard fields (ENG-10346). Shape-only EIN validation here;
    // the client owns the sanity layer (placeholder / IRS-prefix checks) and
    // Peerly is the downstream backstop for a truly bad EIN.
    einNumber: z.string().regex(/^\d{2}-\d{7}$/),
    validatedEin: z.boolean(),
    hasFiledForRace: z.boolean(),
    filingPeriodsStart: z.string().nullish(),
    filingPeriodsEnd: z.string().nullish(),
    officeTermLength: z.string(),
    partisanType: z.string().nullish().optional(),
    priorElectionDates: z.array(z.string()),
    electionId: z.string().nullish(),
    tier: z.string(),
    wonGeneral: z.boolean(),
  })
  .partial()

export const updateCampaignBodySchema = CampaignSchema.pick({
  slug: true,
  data: true,
  aiContent: true,
  formattedAddress: true,
  placeId: true,
  canDownloadFederal: true,
})
  .partial()
  .extend({
    details: CampaignDetailsSchema.optional(),
    primaryResult: z.enum(['won', 'lost']).nullish(),
    ballotStatus: BallotStatusSchema.nullish(),
  })
  .strict()

export type UpdateCampaignBody = z.infer<typeof updateCampaignBodySchema>

export class UpdateCampaignSchema extends createZodDto(
  updateCampaignBodySchema,
) {}

export class CreateCampaignSchema extends createZodDto(
  z.object({
    details: CampaignDetailsSchema,
    data: z.record(z.string(), z.unknown()).optional(),
    ballotReadyPositionId: z.string().nullish(),
    customPositionName: z.string().nullish(),
  }),
) {}

export const createFollowOnCampaignBodySchema = z.object({
  intent: z.enum(['same-office', 'new-office']),
  fromOrganizationSlug: z.string().nullish(),
  details: CampaignDetailsSchema.optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  ballotReadyPositionId: z.string().nullish(),
  customPositionName: z.string().nullish(),
})

export type CreateFollowOnCampaignBody = z.infer<
  typeof createFollowOnCampaignBodySchema
>

export class CreateFollowOnCampaignSchema extends createZodDto(
  createFollowOnCampaignBodySchema,
) {}

export class SetDistrictDTO extends createZodDto(
  z.object({
    slug: z.string().optional(),
    L2DistrictType: z.string(),
    L2DistrictName: z.string(),
  }),
) {}

export class SetDistrictM2MDTO extends createZodDto(
  z.object({
    L2DistrictType: z.string(),
    L2DistrictName: z.string(),
  }),
) {}
