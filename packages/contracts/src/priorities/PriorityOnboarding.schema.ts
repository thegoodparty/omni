import { z } from 'zod'

export const ONBOARDING_PRIORITY_OPTION_KINDS = [
  'ran_on',
  'community',
  'other',
] as const

export const OnboardingPriorityOptionKindSchema = z.enum(
  ONBOARDING_PRIORITY_OPTION_KINDS,
)

export type OnboardingPriorityOptionKind = z.infer<
  typeof OnboardingPriorityOptionKindSchema
>

// `key` is a Priority id for `ran_on` and `other`, and a CommunityIssue id for
// `community`, so the selection can be reconciled without a lookup table.
export const OnboardingPriorityOptionSchema = z.object({
  key: z.string(),
  kind: OnboardingPriorityOptionKindSchema,
  title: z.string(),
  description: z.string(),
  selected: z.boolean(),
})

export type OnboardingPriorityOption = z.infer<
  typeof OnboardingPriorityOptionSchema
>

export const OnboardingPriorityOptionsSchema = z.object({
  options: z.array(OnboardingPriorityOptionSchema),
  // Whether the queued starter-issue search is still waiting or running. The
  // onboarding step reads this instead of deciding from a timer that the
  // search is over: a job stuck behind others and a job that found nothing
  // look the same to a clock.
  searchPending: z.boolean(),
})

export type OnboardingPriorityOptions = z.infer<
  typeof OnboardingPriorityOptionsSchema
>

// Same questions and limits as the Priorities page's add form, so a priority
// typed in onboarding is complete without a second pass.
export const OnboardingOtherPrioritySchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(600),
})

export type OnboardingOtherPriority = z.infer<
  typeof OnboardingOtherPrioritySchema
>

// `shownKeys` is every option key the official saw. Only those can be
// archived by leaving them unchecked, so a save made from a list that never
// loaded cannot remove priorities the official was never asked about.
export const SetOnboardingPrioritiesInputSchema = z.object({
  shownKeys: z.array(z.string()),
  selectedKeys: z.array(z.string()),
  other: z.array(OnboardingOtherPrioritySchema).max(10),
})

export type SetOnboardingPrioritiesInput = z.infer<
  typeof SetOnboardingPrioritiesInputSchema
>
