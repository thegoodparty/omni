/**
 * INTEGRATION SEAM — local mirror of the `@goodparty_org/contracts` shapes.
 *
 * The backend slices (2, 3, 4) publish these shapes into
 * `@goodparty_org/contracts`, but those contract files are not on this branch
 * yet. To unblock the frontend, this file mirrors the planned contract shapes
 * EXACTLY as defined in:
 *   - slice 2 — DashboardCard DTO + list response, bucket union
 *   - slice 3 — chat message / conversation DTOs + the ChatStreamEvent SSE union
 *   - slice 4 — SupportEstimate
 *
 * At integration, delete the type bodies below and re-export the equivalents
 * from `@goodparty_org/contracts` (the names are chosen to match). The client
 * modules in this directory import only from here, so the swap is one file.
 */

// ---------------------------------------------------------------------------
// slice 4 — support estimate (GET /v1/elected-office/support-estimate)
// ---------------------------------------------------------------------------

export interface SupportEstimate {
  likelySupport: number
  districtSize: number
  /** 0–100, already a percentage. */
  percentOfDistrict: number
}

// ---------------------------------------------------------------------------
// slice 2 — dashboard cards (GET /v1/dashboard/cards, PUT .../dismiss)
// ---------------------------------------------------------------------------

export type DashboardCardType = 'briefing' | 'agenda_item'

export type DashboardCardBucket = 'active' | 'this_week' | 'skipped' | 'missed'

export interface DashboardCard {
  id: string
  type: DashboardCardType
  title: string
  summary: string
  ctaLabel: string
  ctaHref: string
  /** ISO timestamp — the meeting / due date. */
  dueDate: string
  sourceBriefingId: string
  sourceItemId: string | null
  dismissedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface DashboardCardListResponse {
  bucket: DashboardCardBucket
  cards: DashboardCard[]
}

// onboarding cards (GET /v1/dashboard/onboarding-cards, PUT .../:key/skip).
// The two fixed get-started cards; status is derived server-side.
export type OnboardingCardKey = 'meet' | 'priorities'

export type OnboardingCardStatus = 'active' | 'skipped' | 'completed'

export interface OnboardingCard {
  key: OnboardingCardKey
  status: OnboardingCardStatus
}

export interface OnboardingCardsResponse {
  cards: OnboardingCard[]
}

// ---------------------------------------------------------------------------
// slice 3 — general chat (/v1/chats). The scope-generic chat contracts now live
// in the shared manager-chat client; re-export them so this seam stays the
// single chat-types import site for Chief of Staff.
// ---------------------------------------------------------------------------

export type {
  ChatScope,
  ChatMessageRole,
  ChatMessageSegmentKind,
  ChatMessageSegment,
  ChatMessageDto,
  ChatConversationDto,
  ChatConversationListResponse,
  ChatConversationMessagesResponse,
  ChatErrorCode,
  ChatStreamEvent,
} from '../../shared/manager-chat/chatClient'
