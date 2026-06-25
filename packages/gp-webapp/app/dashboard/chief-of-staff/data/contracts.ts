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
// slice 3 — general chat (/v1/chats, scope=chief_of_staff)
// ---------------------------------------------------------------------------

export type ChatScope =
  | 'briefing_annotation'
  | 'chief_of_staff'
  | 'campaign_assistant'

export type ChatMessageRole = 'user' | 'assistant' | 'system' | 'tool'

export type ChatMessageSegmentKind = 'text' | 'tool'

// One ordered display block of an assistant turn (mirrors the persisted
// ChatMessageSegment). Consecutive `tool` segments are grouped into one pill
// row by the renderer. Present only on assistant turns that used tools.
export interface ChatMessageSegment {
  kind: ChatMessageSegmentKind
  text?: string | null
  toolName?: string | null
}

export interface ChatMessageDto {
  id: string
  conversationId: string
  role: ChatMessageRole
  content: string
  createdAt: string
  segments?: ChatMessageSegment[]
}

export interface ChatConversationDto {
  conversationId: string
  scope: ChatScope
  title: string | null
  organizationSlug: string | null
  ownerUserId: number
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ChatConversationListResponse {
  conversations: ChatConversationDto[]
}

export interface ChatConversationMessagesResponse {
  conversationId: string
  messages: ChatMessageDto[]
}

export type ChatErrorCode =
  | 'conversation_not_found'
  | 'upstream_unavailable'
  | 'rate_limited'
  | 'aborted'
  | 'internal'

/**
 * SSE union streamed by `POST /v1/chats/:id/messages`. Treat `done` and
 * `error` as terminal.
 */
export type ChatStreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; toolName: string; args?: unknown }
  | { type: 'tool_result'; toolName: string; result?: unknown }
  | { type: 'done'; assistantMessageId?: string }
  | {
      type: 'error'
      code: ChatErrorCode
      message: string
      retryable: boolean
    }
