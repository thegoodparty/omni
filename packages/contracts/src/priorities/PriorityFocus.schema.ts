import { z } from 'zod'
import {
  FirstWinHorizonSchema,
  PriorityFocusOptionKindSchema,
  ResidentInterestSchema,
} from '../generated/enums'

// `key` is a Priority id for `ran_on` and a CommunityIssue id for
// `community`, as on the onboarding options.
export const FocusOptionSchema = z.object({
  key: z.string(),
  kind: PriorityFocusOptionKindSchema,
  title: z.string(),
  description: z.string(),
  residentInterest: ResidentInterestSchema,
  firstWin: FirstWinHorizonSchema,
  // Completes "We'll help you make progress on ___."
  recapLine: z.string(),
})

export type FocusOption = z.infer<typeof FocusOptionSchema>

export const ONBOARDING_FOCUS_KINDS = ['ran_on', 'community', 'mixed'] as const

export const OnboardingFocusKindSchema = z.enum(ONBOARDING_FOCUS_KINDS)

export type OnboardingFocusKind = z.infer<typeof OnboardingFocusKindSchema>

// One card as it was shown when the official picked, facts included.
export const SavedFocusOptionSchema = z.object({
  key: z.string(),
  kind: PriorityFocusOptionKindSchema,
  title: z.string(),
  residentInterest: ResidentInterestSchema,
  firstWin: FirstWinHorizonSchema,
  picked: z.boolean(),
})

export type SavedFocusOption = z.infer<typeof SavedFocusOptionSchema>

// `title` and `recapLine` are the picked priority's as it reads now; `shown`
// is every card on screen at the pick, in the order shown.
export const SavedFocusSchema = z.object({
  focusKey: z.string(),
  priorityId: z.string(),
  title: z.string(),
  recapLine: z.string(),
  pickedAt: z.string(),
  shown: z.array(SavedFocusOptionSchema),
})

export type SavedFocus = z.infer<typeof SavedFocusSchema>

export const OnboardingFocusSchema = z.object({
  kind: OnboardingFocusKindSchema,
  options: z.array(FocusOptionSchema),
  // Same meaning as on the onboarding options: the queued onboarding search
  // is still waiting or running, so cards and their facts may still change.
  searchPending: z.boolean(),
  saved: SavedFocusSchema.nullable(),
})

export type OnboardingFocus = z.infer<typeof OnboardingFocusSchema>

// `shownKeys` is every card key on screen when the official picked, in the
// order shown; `focusKey` is the one they picked and must be among them.
export const SetOnboardingFocusInputSchema = z.object({
  shownKeys: z.array(z.string().min(1)).min(1).max(20),
  focusKey: z.string().min(1),
})

export type SetOnboardingFocusInput = z.infer<
  typeof SetOnboardingFocusInputSchema
>

export const SetOnboardingFocusResultSchema = z.object({
  priorityId: z.string(),
  title: z.string(),
  recapLine: z.string(),
})

export type SetOnboardingFocusResult = z.infer<
  typeof SetOnboardingFocusResultSchema
>
