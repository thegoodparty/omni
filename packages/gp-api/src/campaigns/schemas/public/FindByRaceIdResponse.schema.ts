import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'
import { zDate } from '@goodparty_org/contracts'

const DomainSchema = z.object({
  name: z.string(),
  status: z.string(),
})

const WebsiteSchema = z.object({
  id: z.number(),
  createdAt: zDate(),
  updatedAt: zDate(),
  campaignId: z.number(),
  status: z.string(),
  vanityPath: z.string(),
  content: z.record(z.string(), z.any()).nullable(),
  domain: DomainSchema.nullable(),
})

const PositionSchema = z.object({
  name: z.string(),
})

const TopIssueSchema = z.object({
  name: z.string(),
})

const CampaignPositionSchema = z.object({
  description: z.string().nullable(),
  position: PositionSchema,
  topIssue: TopIssueSchema.nullable(),
})

// Whitelist of public-safe `Campaign.details` fields. This endpoint is
// @PublicAccess(); the raw details blob also holds sensitive data (einNumber,
// einSupportingDocument, subscriptionId, campaignCommittee, statementName).
// The global ZodResponseInterceptor strips any field not listed here, so
// only the public candidate profile leaves the server.
const PublicCampaignDetailsSchema = z.object({
  raceId: z.string().nullable().optional(),
  state: z.string().optional(),
  ballotLevel: z.string().optional(),
  level: z.string().nullable().optional(),
  electionDate: z.string().optional(),
  primaryElectionDate: z.string().optional(),
  ballotStatus: z.string().optional(),
  pledged: z.boolean().optional(),
  party: z.string().optional(),
  otherParty: z.string().optional(),
  partisanType: z.string().nullable().optional(),
  normalizedOffice: z.string().nullable().optional(),
  // Historically stored as a bare number (4); the campaign-details editor has
  // written the "4 years" string form for a while, but ~18k active campaigns
  // still hold the number and every one of them 500s this endpoint. Normalize
  // to the declared string rather than widening to string | number, which
  // would push the legacy shape onto the generated DTO and every consumer.
  officeTermLength: z
    .union([z.string(), z.number()])
    .transform(String)
    .optional(),
  district: z.string().optional(),
  city: z.string().nullable().optional(),
  county: z.string().nullable().optional(),
  website: z.string().optional(),
  occupation: z.string().optional(),
  funFact: z.string().optional(),
  pastExperience: z
    .union([z.string(), z.record(z.string(), z.string())])
    .optional(),
  // Entries carry title/position strings plus a legacy numeric `order`. Unlike
  // officeTermLength the number is the correct type here, so widen instead of
  // coercing — stringifying `order` would invite lexical sorting ("10" < "9").
  customIssues: z
    .array(z.record(z.string(), z.union([z.string(), z.number()])))
    .optional(),
  runningAgainst: z.array(z.record(z.string(), z.string())).optional(),
})

export const FindByRaceIdResponseSchema = z.object({
  id: z.number(),
  slug: z.string(),
  details: PublicCampaignDetailsSchema.nullable(),
  updatedAt: zDate(),
  // The claimed candidate's uploaded photo (Clerk avatar), or null when they
  // haven't uploaded one — marketing falls back to the BallotReady image.
  avatar: z.string().nullable(),
  website: WebsiteSchema.nullable(),
  campaignPositions: z.array(CampaignPositionSchema),
})

export class FindByRaceIdResponseDto extends createZodDto(
  FindByRaceIdResponseSchema,
) {}

export type FindByRaceIdResponse = z.infer<
  typeof FindByRaceIdResponseSchema
> | null
