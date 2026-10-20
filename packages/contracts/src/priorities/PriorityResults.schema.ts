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

// How closely the people who answered look like the district. An official
// sees only this label and the groups to hear more from, never a weight.
// `enoughAnswers` is a good read the census could not be checked against,
// so it makes no claim about who answered.
export const ReadRepresentativenessSchema = z.enum([
  'tooEarly',
  'notYetRepresentative',
  'gettingClose',
  'representative',
  'enoughAnswers',
])
export type ReadRepresentativeness = z.infer<
  typeof ReadRepresentativenessSchema
>

export const UnderrepresentedGroupSchema = z.enum([
  'age18to64',
  'age65plus',
  'owners',
  'renters',
  'unreachedAreas',
  'men',
  'women',
  'white',
  'black',
  'hispanic',
  'asian',
])
export type UnderrepresentedGroup = z.infer<typeof UnderrepresentedGroupSchema>

// How a group is named in a sentence, in the app and by the agents alike:
// "Hear from more renters".
export const UNDERREPRESENTED_GROUP_NAMES: Record<
  UnderrepresentedGroup,
  string
> = {
  age18to64: 'people 18 to 64',
  age65plus: 'people 65 and over',
  owners: 'homeowners',
  renters: 'renters',
  unreachedAreas: "people in parts of your district we haven't reached",
  men: 'men',
  women: 'women',
  white: 'white residents',
  black: 'Black residents',
  hispanic: 'Hispanic or Latino residents',
  asian: 'Asian residents',
}

// The status's name wherever it shows, in the app and from the agents.
export const READ_REPRESENTATIVENESS_LABELS: Record<
  ReadRepresentativeness,
  string
> = {
  tooEarly: 'Too early',
  notYetRepresentative: 'Not yet representative',
  gettingClose: 'Getting close',
  representative: 'Representative',
  enoughAnswers: 'Enough answers',
}

// Grid squares about 400m on a side at US latitudes: a few blocks, so one
// square never stands for one household. The results page bins answers on
// it, and the area of a district not reached yet is drawn from it.
export const DISTRICT_GRID_CELL_DEGREES = 0.004

// Whether a priority has heard from enough people, and the right mix of
// people, to read the district: answers pooled across texts, calls and
// doors, every large group in the district heard from, and a model of the
// coded answers sure enough of each. gp-api's mrpReadStatus decides `good`:
// representative, or answersNeeded() (100) met when the district could not
// be read.
// `needed` is the answers so far plus those still missing for every large
// group to have three.
export const PriorityReadStatusSchema = z.object({
  answers: z.number().int().nonnegative(),
  needed: z.number().int().positive(),
  good: z.boolean(),
  status: ReadRepresentativenessSchema,
  // The one or two groups holding the read back, the one to hear from
  // first leading. Empty once representative.
  underrepresented: z.array(UnderrepresentedGroupSchema).max(2),
  // A follow-up text paid for and not sent yet: when it goes out and how
  // many it texts. Absent when there is none.
  followUp: z
    .object({
      scheduledLocalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      texts: z.number().int().positive(),
    })
    .optional(),
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
