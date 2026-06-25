import { z } from 'zod'
import {
  ONBOARDING_CARD_KEY_VALUES,
  OnboardingCardKeySchema,
  type OnboardingCardKey,
} from '../generated/enums'

export {
  ONBOARDING_CARD_KEY_VALUES,
  OnboardingCardKeySchema,
  type OnboardingCardKey,
}

// Derived per-office state of an onboarding card. `completed` (the user has met
// the agent / stated priorities) beats `skipped` beats `active`. Not stored —
// computed from the dismissal row + the existing priority / conversation
// signals.
export const ONBOARDING_CARD_STATUS_VALUES = [
  'active',
  'skipped',
  'completed',
] as const
export const OnboardingCardStatusSchema = z.enum(ONBOARDING_CARD_STATUS_VALUES)
export type OnboardingCardStatus = z.infer<typeof OnboardingCardStatusSchema>

export const OnboardingCardSchema = z.object({
  key: OnboardingCardKeySchema,
  status: OnboardingCardStatusSchema,
})
export type OnboardingCard = z.infer<typeof OnboardingCardSchema>

export const OnboardingCardsResponseSchema = z.object({
  cards: z.array(OnboardingCardSchema),
})
export type OnboardingCardsResponse = z.infer<
  typeof OnboardingCardsResponseSchema
>

export const OnboardingCardKeyParamSchema = z.object({
  key: OnboardingCardKeySchema,
})
export type OnboardingCardKeyParam = z.infer<
  typeof OnboardingCardKeyParamSchema
>
