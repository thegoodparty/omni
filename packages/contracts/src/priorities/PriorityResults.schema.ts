import { z } from 'zod'

// What a priority's outreach brought back, pooled across every send linked to
// it (GET /v1/priorities/:id/results): the reach, the themes across every
// channel, where respondents live, and how the groups who answered compare
// with the district.

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

// How far a priority's answers have got toward a read of every major group
// in the district: no voices from some, too few from some, or the model
// still unsure of some. `enoughAnswers` is a good read the census could not
// be checked against, so it makes no claim about who answered.
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
  'age18to24',
  'age25to34',
  'age35to44',
  'age45to54',
  'age55to64',
  'age65plus',
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
// "Need a few more answers from people 65 and over". Each name reads whole
// in a list joined with "and", so none ends on a clause of its own.
export const UNDERREPRESENTED_GROUP_NAMES: Record<
  UnderrepresentedGroup,
  string
> = {
  age18to24: 'people 18 to 24',
  age25to34: 'people 25 to 34',
  age35to44: 'people 35 to 44',
  age45to54: 'people 45 to 54',
  age55to64: 'people 55 to 64',
  age65plus: 'people 65 and over',
  unreachedAreas: 'people in some parts of your district',
  men: 'men',
  women: 'women',
  white: 'white residents',
  black: 'Black residents',
  hispanic: 'Hispanic or Latino residents',
  asian: 'Asian residents',
}

// Once every neighborhood has been heard from, the ones still named are the
// ones the model is unsure of, not ones nobody answered in.
export const UNSURE_AREAS_NAME = 'people in a few neighborhoods'

export const underrepresentedGroupName = (
  group: UnderrepresentedGroup,
  status: ReadRepresentativeness,
): string =>
  group === 'unreachedAreas' && status === 'gettingClose'
    ? UNSURE_AREAS_NAME
    : UNDERREPRESENTED_GROUP_NAMES[group]

// Groups named together in one sentence: "men", "men and women", or
// "people 65 and over, men and women".
export const joinGroupNames = (names: readonly string[]): string =>
  names.length <= 2
    ? names.join(' and ')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

// The status's name wherever it shows, in the app and from the agents.
export const READ_REPRESENTATIVENESS_LABELS: Record<
  ReadRepresentativeness,
  string
> = {
  tooEarly: 'Waiting to hear back',
  notYetRepresentative: 'A few groups need more answers',
  gettingClose: 'Still unsure what some groups think',
  representative: 'Every group heard',
  enoughAnswers: 'Enough people have answered',
}

// Grid squares about 400m on a side at US latitudes: a few blocks, so one
// square never stands for one household. The results page bins answers on
// it, and the area of a district not reached yet is drawn from it.
export const DISTRICT_GRID_CELL_DEGREES = 0.004

// Whether a priority has heard from every major group in the district:
// answers pooled across texts, calls and doors, at least three from each
// major group (3% or more of the district by age, neighborhood, race when it
// can be named, and gender), and a model of the coded answers sure enough of
// each. gp-api's mrpReadStatus decides `good`: representative, or
// answersNeeded() met when the district could not be read.
// `needed` is the answers so far plus those still missing for every major
// group to have three: a floor, not a promise. `groupsHeard` of
// `groupsTotal` major groups have their three; both are 0 when the district
// could not be read.
export const PriorityReadStatusSchema = z.object({
  answers: z.number().int().nonnegative(),
  needed: z.number().int().positive(),
  groupsHeard: z.number().int().nonnegative().default(0),
  groupsTotal: z.number().int().nonnegative().default(0),
  good: z.boolean(),
  status: ReadRepresentativenessSchema,
  // The one or two groups holding the read back, the one to hear from
  // first leading. Empty once representative.
  underrepresented: z.array(UnderrepresentedGroupSchema).max(2),
  // The groups in `underrepresented` nobody in has answered yet, so the
  // line says "Still need to hear from" them rather than asking for more
  // answers. Absent from reads served before it existed.
  unheard: z.array(UnderrepresentedGroupSchema).max(2).optional(),
  // A follow-up text paid for and not sent yet: when it goes out and how
  // many it texts. Absent when there is none.
  followUp: z
    .object({
      scheduledLocalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      texts: z.number().int().positive(),
    })
    .optional(),
  // A check is out: something sent to residents on any channel, counted
  // from checkout. Absent means nobody has been asked yet, so there is
  // nothing to get answers on.
  checkOut: z.boolean().optional(),
  // The follow-up text has gone out. With it, a short read is closed with
  // doors and calls, never a third text.
  followUpSent: z.boolean().optional(),
})
export type PriorityReadStatus = z.infer<typeof PriorityReadStatusSchema>

// Shares are fractions, 0.25 is 25%. The page draws from them and never
// prints a share.
export const PriorityResultsGroupSchema = z.object({
  group: UnderrepresentedGroupSchema,
  districtShare: z.number(),
  answerShare: z.number(),
})
export type PriorityResultsGroup = z.infer<typeof PriorityResultsGroupSchema>

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
  // Each major group the read counts (age band, gender, and race when it may
  // be named): its share of the district and of the coded answers. Empty
  // when the district could not be read.
  groups: z.array(PriorityResultsGroupSchema),
})
export type PriorityResults = z.infer<typeof PriorityResultsSchema>
