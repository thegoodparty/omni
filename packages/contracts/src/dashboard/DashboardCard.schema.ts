import { z } from 'zod'
import {
  DASHBOARD_CARD_TYPE_VALUES,
  DashboardCardTypeSchema,
  type DashboardCardType,
} from '../generated/enums'
import { CIVIC_PANEL_PAGE_HREF } from '../people/CivicPanelBuildPlan.schema'
import { GOOD_READ_STATUSES } from '../priorities/PriorityResults.schema'

export {
  DASHBOARD_CARD_TYPE_VALUES,
  DashboardCardTypeSchema,
  type DashboardCardType,
}

export const DASHBOARD_CARD_BUCKET_VALUES = [
  'active',
  'this_week',
  'skipped',
  'missed',
  'done',
] as const
export const DashboardCardBucketSchema = z.enum(DASHBOARD_CARD_BUCKET_VALUES)
export type DashboardCardBucket = z.infer<typeof DashboardCardBucketSchema>

export const DashboardCardsQuerySchema = z.object({
  bucket: DashboardCardBucketSchema.default('active'),
})
export type DashboardCardsQuery = z.infer<typeof DashboardCardsQuerySchema>

export const DashboardCardSchema = z.object({
  id: z.string(),
  type: DashboardCardTypeSchema,
  title: z.string(),
  summary: z.string(),
  ctaLabel: z.string(),
  ctaHref: z.string(),
  dueDate: z.string(),
  sourceExternalId: z.string(),
  sourceItemId: z.string().nullable(),
  dismissedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type DashboardCard = z.infer<typeof DashboardCardSchema>

// How far "Show in 3 days" puts a card off.
export const DASHBOARD_CARD_SNOOZE_DAYS = 3

const CIVIC_PANEL_BUILD_CARD_PREFIX = 'build:'

// The office's one card that builds its civic panel. Its source is the office
// rather than a priority, which is what tells it apart from the per-priority
// panel cards that share its type.
export const civicPanelBuildCardSourceId = (electedOfficeId: string): string =>
  `${CIVIC_PANEL_BUILD_CARD_PREFIX}${electedOfficeId}`

export const isCivicPanelBuildCard = (
  card: Pick<DashboardCard, 'type' | 'sourceExternalId'>,
): boolean =>
  card.type === 'civic_panel' &&
  card.sourceExternalId.startsWith(CIVIC_PANEL_BUILD_CARD_PREFIX)

export const CIVIC_PANEL_STEP_CARD_PREFIX = 'panel-step:'

// A card for one ready step of the panel's plan, once the build card is done.
// Keyed by the step, so a skipped card stays skipped while that step is next
// and the step after it gets a card of its own.
export const civicPanelStepCardSourceId = (stepId: string): string =>
  `${CIVIC_PANEL_STEP_CARD_PREFIX}${stepId}`

export const isCivicPanelStepCard = (
  card: Pick<DashboardCard, 'type' | 'sourceExternalId'>,
): boolean =>
  card.type === 'civic_panel' &&
  card.sourceExternalId.startsWith(CIVIC_PANEL_STEP_CARD_PREFIX)

// gp-api keys a report back card on the read status it was made for
// (`sourceItemId`), so the deck can tell whether its priority has a good read.
export const isGoodReadReportBackCard = (
  card: Pick<DashboardCard, 'type' | 'sourceItemId'>,
): boolean =>
  card.type === 'report_back' &&
  GOOD_READ_STATUSES.some((status) => status === card.sourceItemId)

// The build card's button before there is a plan: the home opens the chat
// build flow from it. Once a plan is active, gp-api gives the card the plan
// button instead, and the home opens the panel page, where the plan lives,
// rather than starting a second build. Without the chat the link is the
// panel page either way.
export const CIVIC_PANEL_BUILD_CARD_CTA = 'Build your panel'
export const CIVIC_PANEL_BUILD_CARD_PLAN_CTA = 'See your plan'
export const CIVIC_PANEL_BUILD_CARD_HREF = CIVIC_PANEL_PAGE_HREF

export const civicPanelBuildCardOpensPlan = (
  card: Pick<DashboardCard, 'type' | 'sourceExternalId' | 'ctaLabel'>,
): boolean =>
  isCivicPanelBuildCard(card) &&
  card.ctaLabel === CIVIC_PANEL_BUILD_CARD_PLAN_CTA

const MANAGED_CIVIC_PANEL_CARD_PREFIX = 'managed-panel:'

// The office's one card that offers to have GoodParty build its civic panel
// (the managed panel), shown until the official approves it. Its source is
// the office, like the build card's.
export const managedCivicPanelCardSourceId = (
  electedOfficeId: string,
): string => `${MANAGED_CIVIC_PANEL_CARD_PREFIX}${electedOfficeId}`

export const isManagedCivicPanelCard = (
  card: Pick<DashboardCard, 'type' | 'sourceExternalId'>,
): boolean =>
  card.type === 'civic_panel' &&
  card.sourceExternalId.startsWith(MANAGED_CIVIC_PANEL_CARD_PREFIX)

// The home opens the Chief of Staff on the managed setup from this button
// rather than following the card's link.
export const MANAGED_CIVIC_PANEL_CARD_CTA = 'Build my civic panel'

// The card's words, naming the place the office serves where the app knows
// it. gp-api stores the placeless words; the home draws them with the place.
export const managedCivicPanelCardContent = (place: string | null) => {
  const where = place?.trim() || 'your district'
  return {
    title: `Know what ${where} thinks before you vote`,
    summary: `Residents from every part of ${where}, matched by age, gender and race. Free in early access.`,
  }
}

const MANAGED_CIVIC_PANEL_PROGRESS_CARD_PREFIX = 'managed-panel-progress:'

// The office's card for the managed panel once it is approved: where it
// stands while it builds, that it is ready, or that every resident a text
// can reach has been invited. `sourceItemId` is the phase, so a card set
// aside in one phase does not hide the next.
export const managedCivicPanelProgressCardSourceId = (
  electedOfficeId: string,
): string => `${MANAGED_CIVIC_PANEL_PROGRESS_CARD_PREFIX}${electedOfficeId}`

export const MANAGED_PANEL_PROGRESS_PHASES = [
  'building',
  'ready',
  'exhausted',
] as const
export type ManagedPanelProgressPhase =
  (typeof MANAGED_PANEL_PROGRESS_PHASES)[number]

export const managedPanelProgressPhase = (
  card: Pick<DashboardCard, 'type' | 'sourceExternalId' | 'sourceItemId'>,
): ManagedPanelProgressPhase | null =>
  card.type === 'civic_panel' &&
  card.sourceExternalId.startsWith(MANAGED_CIVIC_PANEL_PROGRESS_CARD_PREFIX)
    ? (MANAGED_PANEL_PROGRESS_PHASES.find(
        (phase) => phase === card.sourceItemId,
      ) ?? null)
    : null

// The exhausted card's button: the home opens the Chief of Staff on the
// join link rather than following the card's link.
export const MANAGED_CIVIC_PANEL_EXHAUSTED_CARD_CTA = 'Get your join link'
export const MANAGED_CIVIC_PANEL_PROGRESS_CARD_CTA = 'See your panel'

export const DashboardCardsResponseSchema = z.object({
  bucket: DashboardCardBucketSchema,
  cards: z.array(DashboardCardSchema),
})
export type DashboardCardsResponse = z.infer<
  typeof DashboardCardsResponseSchema
>
