import { z } from 'zod'
import { zCoerceDate } from '../shared/Date.schema'

export const POLL_THEMES_MAX = 5

export const PollThemeSentimentSchema = z.enum([
  'positive',
  'negative',
  'mixed',
  'neutral',
])
export type PollThemeSentiment = z.infer<typeof PollThemeSentimentSchema>

export const ThemeSchema = z.object({
  id: z.string(),
  label: z.string(),
  summary: z.string(),
  mentionCount: z.number().int().nonnegative(),
  sentiment: PollThemeSentimentSchema.optional(),
})
export type Theme = z.infer<typeof ThemeSchema>

export const PollResultsSchema = z.object({
  outreachId: z.number().int().positive(),
  sent: z.number().int().nonnegative(),
  responses: z.number().int().nonnegative(),
  responseRate: z.number().nonnegative(),
  confidence: z.number().nullable(),
  isHighConfidence: z.boolean(),
  notEnoughResponses: z.boolean(),
  newSinceLastAnalysis: z.number().int().nonnegative(),
  lastAnalysisAt: zCoerceDate().nullable(),
  themes: z.array(ThemeSchema).max(POLL_THEMES_MAX),
})
export type PollResults = z.infer<typeof PollResultsSchema>
