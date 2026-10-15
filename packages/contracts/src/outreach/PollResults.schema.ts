import { z } from 'zod'
import { zCoerceDate } from '../shared/Date.schema'

export const POLL_THEMES_MAX = 5

// Below this many responses a poll reports no themes and no confidence: a
// handful of replies is an anecdote, not a result. Product call, one place.
export const POLL_MIN_RESPONSES = 20

export const POLL_SAMPLE_QUOTES_MAX = 3

export const PollThemeSentimentSchema = z.enum([
  'positive',
  'negative',
  'mixed',
  'neutral',
])
export type PollThemeSentiment = z.infer<typeof PollThemeSentimentSchema>

export const PollSampleQuoteSchema = z.object({
  text: z.string(),
  firstName: z.string().nullable(),
})
export type PollSampleQuote = z.infer<typeof PollSampleQuoteSchema>

export const ThemeSchema = z.object({
  id: z.string(),
  label: z.string(),
  summary: z.string(),
  mentionCount: z.number().int().nonnegative(),
  sentiment: PollThemeSentimentSchema.optional(),
  // Members whose reply landed after the previous completed analysis. Zero on
  // a poll's first analysis, where nothing is new relative to anything.
  newMentions: z.number().int().nonnegative(),
  sampleQuotes: z.array(PollSampleQuoteSchema).max(POLL_SAMPLE_QUOTES_MAX),
})
export type Theme = z.infer<typeof ThemeSchema>

export const PollAnalysisStatusSchema = z.enum([
  'none',
  'running',
  'completed',
  'failed',
])
export type PollAnalysisStatus = z.infer<typeof PollAnalysisStatusSchema>

export const PollExpansionSummarySchema = z.object({
  sendSeq: z.number().int().positive(),
  textCount: z.number().int().nonnegative(),
  status: z.string(),
})
export type PollExpansionSummary = z.infer<typeof PollExpansionSummarySchema>

export const PollResultsSchema = z.object({
  outreachId: z.number().int().positive(),
  sent: z.number().int().nonnegative(),
  responses: z.number().int().nonnegative(),
  responseRate: z.number().nonnegative(),
  optOutRate: z.number().nonnegative(),
  // The share of the send that answered, once there are enough responses to
  // call a result; null below POLL_MIN_RESPONSES.
  confidence: z.number().nullable(),
  isHighConfidence: z.boolean(),
  notEnoughResponses: z.boolean(),
  newSinceLastAnalysis: z.number().int().nonnegative(),
  lastAnalysisAt: zCoerceDate().nullable(),
  themes: z.array(ThemeSchema).max(POLL_THEMES_MAX),
  // Replies the latest analysis did not place in any theme.
  nonClustered: z.object({ count: z.number().int().nonnegative() }),
  analysis: z.object({ status: PollAnalysisStatusSchema }),
  expansions: z.array(PollExpansionSummarySchema),
})
export type PollResults = z.infer<typeof PollResultsSchema>

export const ReplyFlagSchema = z.object({
  favorited: z.boolean(),
  read: z.boolean(),
})
export type ReplyFlag = z.infer<typeof ReplyFlagSchema>
