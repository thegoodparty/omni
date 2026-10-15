import { z } from 'zod'
import {
  DASHBOARD_CARD_TYPE_VALUES,
  DashboardCardTypeSchema,
  type DashboardCardType,
} from '../generated/enums'

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

// Where the build card's Build my panel goes: the Chief of Staff home, which
// opens its chat on the conversation that builds the panel and drops the
// param, so the official never leaves the home to start.
export const CIVIC_PANEL_BUILD_CHAT_PARAM = 'chat'
export const CIVIC_PANEL_BUILD_CHAT_VALUE = 'build_citizens_panel'
export const CIVIC_PANEL_BUILD_CARD_HREF = `/dashboard/chief-of-staff?${CIVIC_PANEL_BUILD_CHAT_PARAM}=${CIVIC_PANEL_BUILD_CHAT_VALUE}`

export const DashboardCardsResponseSchema = z.object({
  bucket: DashboardCardBucketSchema,
  cards: z.array(DashboardCardSchema),
})
export type DashboardCardsResponse = z.infer<
  typeof DashboardCardsResponseSchema
>
