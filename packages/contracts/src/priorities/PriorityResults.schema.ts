import { z } from 'zod'

// What a priority's outreach brought back, pooled across every send linked to
// it (GET /v1/priorities/:id/results): the reach, the themes across every
// channel, where respondents live, and how those places compare with the
// district.

export const PRIORITY_RESULTS_CHANNELS = [
  'text',
  'phoneBanking',
  'doorKnocking',
  'social',
] as const
export const PriorityResultsChannelSchema = z.enum(PRIORITY_RESULTS_CHANNELS)
export type PriorityResultsChannel = z.infer<
  typeof PriorityResultsChannelSchema
>

export const PriorityResultsSendSchema = z.object({
  outreachId: z.number().int(),
  name: z.string().nullable(),
  channel: PriorityResultsChannelSchema,
  date: z.string().nullable(),
  // People the send reached (texted, called, knocked). Null for a post,
  // which has no audience to count.
  reached: z.number().int().nullable(),
  responded: z.number().int().nullable(),
})
export type PriorityResultsSend = z.infer<typeof PriorityResultsSendSchema>

// One respondent's home, rounded to about 100m so the map shows where people
// are without pinning anyone's house. No ids ride with it.
export const PriorityResultsPointSchema = z.object({
  lat: z.number(),
  lng: z.number(),
})

export const REPRESENTATION_DIMENSIONS = [
  'age',
  'race',
  'education',
  'income',
  'housing',
  'poverty',
] as const
export const RepresentationDimensionSchema = z.enum(REPRESENTATION_DIMENSIONS)
export type RepresentationDimension = z.infer<
  typeof RepresentationDimensionSchema
>

export const RepresentationGroupSchema = z.object({
  dimension: RepresentationDimensionSchema,
  key: z.string(),
  label: z.string(),
  // Shares are fractions, 0.25 is 25%. The respondent side is each
  // respondent's census block group composition, averaged, so both sides
  // read the same census source.
  respondentShare: z.number(),
  districtShare: z.number(),
})
export type RepresentationGroup = z.infer<typeof RepresentationGroupSchema>

export const PriorityRepresentationSchema = z.object({
  respondentCount: z.number().int(),
  // Empty when the district's census figures are unavailable.
  groups: z.array(RepresentationGroupSchema),
})
export type PriorityRepresentation = z.infer<
  typeof PriorityRepresentationSchema
>

// One theme from the priority's latest pooled synthesis run. `people` is
// distinct people counted now: confirmed notes and replies, so someone who
// texted twice counts once.
export const PriorityThemeSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  people: z.number().int(),
})
export type PriorityTheme = z.infer<typeof PriorityThemeSchema>

// Whether a priority has heard from enough people to read the district:
// pooled answers across texts, calls and doors against answersNeeded for
// the district's population. gp-api's priorityReadStatus decides `good`.
export const PriorityReadStatusSchema = z.object({
  answers: z.number().int().nonnegative(),
  needed: z.number().int().positive(),
  good: z.boolean(),
})
export type PriorityReadStatus = z.infer<typeof PriorityReadStatusSchema>

export const PriorityResultsSchema = z.object({
  priorityId: z.string(),
  readStatus: PriorityReadStatusSchema,
  sends: z.array(PriorityResultsSendSchema),
  respondents: z.object({
    total: z.number().int(),
    // Distinct people per channel. Someone heard by text and at the door
    // counts once in each, so the channels can add up to more than total.
    byChannel: z.object({
      text: z.number().int(),
      phoneBanking: z.number().int(),
      doorKnocking: z.number().int(),
    }),
    joinedCivicPanel: z.number().int(),
  }),
  themes: z.array(PriorityThemeSchema),
  // A pooled run is in flight: the themes shown are the previous run's.
  summarizing: z.boolean(),
  points: z.array(PriorityResultsPointSchema),
  // Null below the minimum number of respondents, where a comparison would
  // say more about chance than about who was heard.
  representation: PriorityRepresentationSchema.nullable(),
})
export type PriorityResults = z.infer<typeof PriorityResultsSchema>

export const MIN_RESPONDENTS_FOR_REPRESENTATION = 10
