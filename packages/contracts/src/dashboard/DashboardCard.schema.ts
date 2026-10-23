import { z } from 'zod'
import {
  DASHBOARD_CARD_TYPE_VALUES,
  DashboardCardTypeSchema,
  type DashboardCardType,
} from '../generated/enums'
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

// gp-api keys a report back card on the read status it was made for
// (`sourceItemId`), so the deck can tell whether its priority has a good read.
export const isGoodReadReportBackCard = (
  card: Pick<DashboardCard, 'type' | 'sourceItemId'>,
): boolean =>
  card.type === 'report_back' &&
  GOOD_READ_STATUSES.some((status) => status === card.sourceItemId)

const MANAGED_CIVIC_PANEL_CARD_PREFIX = 'managed-panel:'

// The office's one card that offers to have GoodParty build its civic panel
// (the managed panel), shown until the official approves it. Its source is
// the office rather than a priority.
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

// The exhausted card's button: the home opens the Chief of Staff, which says
// where the panel stands, rather than following the card's link.
export const MANAGED_CIVIC_PANEL_EXHAUSTED_CARD_CTA = 'See where it stands'
export const MANAGED_CIVIC_PANEL_PROGRESS_CARD_CTA = 'See your panel'

export const DashboardCardsResponseSchema = z.object({
  bucket: DashboardCardBucketSchema,
  cards: z.array(DashboardCardSchema),
})
export type DashboardCardsResponse = z.infer<
  typeof DashboardCardsResponseSchema
>
