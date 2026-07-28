import type {
  CreateOrdinanceRequest,
  ExperimentVariantsResponse,
  Ordinance,
  OrdinanceListResponse,
  OrdinanceQualityIterationsResponse,
  OrdinanceQualityRun,
  SaveOrdinanceClarifyAnswerRequest,
  UpdateOrdinanceRequest,
  Priority,
  ChatAnchor,
  RaceOpponentSourceType,
  RaceOpponentCollectionStatus,
  RaceOpponentResearchStatus,
  RaceOpponentFindingKind,
  SummarySource,
} from '@goodparty_org/contracts'
import type { Race } from 'app/onboarding/[slug]/[step]/components/ballotOffices/types'
import type {
  SynthesizeSpeechRequest,
  SynthesizeSpeechResponse,
  TranscribeSessionRequest,
  TranscribeSessionResponse,
} from 'app/dashboard/briefings/shared/speech-types'
import type { Poll } from 'app/dashboard/polls/shared/poll-types'
import {
  Campaign,
  CampaignDetails,
  CampaignVersions,
  User,
} from 'helpers/types'
import type {
  CampaignStory,
  CampaignStoryRewrite,
  RaceOpponentThreatTier,
} from '@goodparty_org/contracts'
import type { ContactsStats } from 'app/dashboard/polls/shared/queries'
import type { GetPollIssuesResponse } from 'app/dashboard/polls/shared/serverApiCalls'
import type {
  SegmentResponse,
  Person,
  ListContactsResponse,
  ListDetailContactsResponse,
  GetConstituentIssuesResponse,
  GetIndividualActivitiesResponse,
  ContactNote,
  ContactNoteInput,
  ContactNoteListResponse,
  LogContactInteractionInput,
  LogContactInteractionResponse,
  SupportStatusRollup,
} from 'app/dashboard/contacts/crm/shared/contacts-types'
import type { ActivityConditionInput } from 'app/dashboard/contacts/crm/shared/activityConditionOptions'
import type { AnnotationAnchor, ChatMessage } from 'app/shared/briefings/types'
import type { Outreach } from 'app/dashboard/outreach/hooks/OutreachContext'
import type {
  ChatConversationListResponse,
  ChatConversationMessagesResponse,
  ChatScope,
  DashboardCardBucket,
  DashboardCardListResponse,
  OnboardingCardsResponse,
  SupportEstimate,
} from 'app/dashboard/chief-of-staff/data/contracts'
import { MeetingBriefingOutput } from './generated/agent-job-contracts'

export interface MeetingsListItemDto {
  meetingDate: string
  meetingTime: string
  meetingTimezone: string
  durationMinutes: number
  meetingName: string
  location: string
  hasBriefing: boolean
  /**
   * Status of an in-progress "user-uploaded agenda" briefing run for this
   * meeting. `null` when the user has never submitted an agenda. Mirrors
   * gp-api's MeetingsListItemDto.userAgendaStatus.
   */
  userAgendaStatus?: UserAgendaStatus | null
}

export type UserAgendaStatus = 'processing' | 'failed' | 'completed' | 'unknown'

/**
 * A Campaign Tracker task row (campaign_tracker_tasks). Mirrors the gp-api
 * CampaignTrackerTask model returned by the /campaigns/tracker-tasks endpoints.
 */
export type CampaignTrackerTask = {
  id: string
  title: string
  description: string
  cta: string | null
  link: string | null
  flowType: string | null
  week: number
  date: string
  completed: boolean
  phase: string | null
  proRequired: boolean | null
  // true for the static launch/pre-launch rows materialized at bootstrap;
  // false for the dynamic tasks + events the CAP run produces. Lets the client
  // tell "still generating" (only static present) from "done".
  isDefaultTask: boolean
}

/** Request/response shapes for the user-agenda-upload flow. */
export type UserAgendaSubmitRequest =
  | { source: 'URL'; sourceUrl: string }
  | { source: 'UPLOAD'; uploadId: string }

export interface UserAgendaSubmitResponse {
  experimentRunId: string
  status: 'processing'
}

export interface UserAgendaPresignRequest {
  contentType: 'application/pdf'
  byteSize: number
}

export interface UserAgendaPresignResponse {
  uploadId: string
  uploadKey: string
  uploadUrl: string
  expiresAt: string
}

export interface MeetingsListResponseDto {
  scheduleKnown: boolean
  meetings: MeetingsListItemDto[]
}

/**
 * gp-api emits this shape (not part of the agent artifact) when no
 * MeetingBriefing row exists for the requested date. Distinguished from a
 * `MeetingBriefingPlaceholder` artifact by the top-level `status` field.
 */
export interface MeetingBriefingAwaitingDto {
  status: 'awaiting_agenda'
  meetingDate: string
  meetingName: string
  meetingTime: string
  meetingTimezone: string
  location: string
  durationMinutes: number
}

// Mirrors `OpponentSchema` in gp-api
// (`src/campaignStrategy/schemas/strategicLandscape.schema.ts`). Who is
// running: name, party, incumbency. No narrative profiling.
export interface StrategicLandscapeOpponent {
  fullName: string
  partyAffiliation: string
  incumbent: boolean | null
}

export interface StrategicLandscapeData {
  opportunities: string[]
  challenges: string[]
  opponents: StrategicLandscapeOpponent[]
}

// Discriminated union matching the polling response on gp-api.
export type StrategicLandscapeResponse =
  | { status: 'ready'; data: StrategicLandscapeData }
  | { status: 'generating' }

// Mirrors `CommunityEventSchema` in
// `gp-api/src/campaignStrategy/schemas/communityEvents.schema.ts`.
// `address` is the venue's physical street address and `url` is the
// direct event-page URL. Either can be null when the search data
// didn't surface it.
export interface CommunityEvent {
  title: string
  description: string
  date: string
  address: string | null
  url: string | null
}

export interface CommunityEventsData {
  events: CommunityEvent[]
}

export type CommunityEventsResponse =
  | { status: 'ready'; data: CommunityEventsData }
  | { status: 'generating' }

export type APIEndpoints = {
  'GET /v1/users/me': {
    Request: {}
    Response: User
  }

  // Submits the HubSpot registration form with the visitor's hubspotutk so
  // the contact gets web/paid original-source attribution instead of the
  // "offline sources" Segment's server-side destination would assign.
  'POST /v1/users/me/crm-registration': {
    Request: { hutk?: string }
    Response: {}
  }

  // Used to refresh the outreach list after payment finalizes a draft
  // (draft-first purchase flow). Server hides pending_payment rows.
  'GET /v1/outreach': {
    Request: {}
    Response: Outreach[]
  }

  // Server-side flag resolution: gp-api evaluates Amplitude Experiment for the
  // current user and returns the full variant map, so the browser never has to
  // reach Amplitude (which ad blockers / some networks block) to render gated
  // surfaces. Consumed in PageWrapper to seed FeatureFlagsProvider.
  'GET /v1/experiment/variants': {
    Request: {}
    Response: ExperimentVariantsResponse
  }

  'GET /v1/organizations': {
    Request: {}
    Response: {
      organizations: Organization[]
    }
  }
  'GET /v1/organizations/:slug': {
    Request: {}
    Response: Organization
  }

  'PATCH /v1/organizations/:slug': {
    Request: {
      ballotReadyPositionId?: string | null | undefined
      overrideDistrictId?: string | null | undefined
      customPositionName?: string | null | undefined
    }
    Response: Organization
  }

  // Mirrors gp-api's GET /v1/eligibility (EligibilitySchema in
  // @goodparty_org/contracts). Drives the org switcher's "run for" actions.
  'GET /v1/eligibility': {
    Request: {}
    Response: Eligibility
  }

  'GET /v1/campaigns/mine': {
    Request: {}
    Response: Campaign
  }

  // The write path behind the switcher's "run for" actions; gp-api re-checks
  // eligibility server-side. Mirrors createFollowOnCampaignBodySchema and the
  // persisted-campaign response in gp-api's campaigns.controller.
  'POST /v1/campaigns/follow-on': {
    Request: {
      intent: 'same-office' | 'new-office'
      fromOrganizationSlug?: string | null | undefined
      details?: CampaignDetails
      data?: Record<string, unknown>
      ballotReadyPositionId?: string | null | undefined
      customPositionName?: string | null | undefined
    }
    Response: Campaign
  }

  'GET /v1/campaigns/mine/status': {
    Request: {}
    Response: {
      status: string | false
      slug?: string
      step?: number
    }
  }

  'GET /v1/campaigns/mine/plan-version': {
    Request: {}
    Response: CampaignVersions
  }

  'GET /v1/campaigns/mine/story': {
    Request: {}
    Response: CampaignStory
  }

  // Partial upsert of the story. Only `background` lives on the story now (the
  // `why` and issues moved to the website, shared with Pro-upgrade); the
  // server's Zod schema rejects an empty body with 400, so `background` is
  // required here.
  'PUT /v1/campaigns/mine/story': {
    Request: { background: string }
    Response: CampaignStory
  }

  // AI-suggested rewrite of a Campaign Story prompt or a website issue's "Policy
  // focus". The server pairs the submitted text with the candidate's name and a
  // section-specific prompt; `text` must be non-empty (the Zod schema rejects
  // blank input with 400).
  'POST /v1/campaigns/mine/story/rewrite': {
    // `why` (now the website bio) and `background` are the story prompts;
    // `issue` rewrites a Policy focus (website issue description). `why` is no
    // longer a CampaignStory key, so the set is listed explicitly. The server's
    // Zod enum is the runtime mirror.
    Request: {
      field: 'why' | 'background' | 'issue'
      text: string
      // Optional context for an `issue` rewrite: the policy title.
      title?: string
    }
    Response: CampaignStoryRewrite
  }

  // The pro-upgrade filing-instructions screen reads this fresh so it renders
  // the same content the "email this to me" body composes (one server source —
  // page and email can't drift). `filingWindow` is preformatted server-side.
  'GET /v1/campaigns/mine/filing-instructions': {
    Request: {}
    Response: {
      filingWindow: string
      filingFee: number | null
      filingRequirementsText: string | null
      filingOfficeAddress: string | null
      filingPhoneNumber: string | null
      paperworkInstructions: string | null
    }
  }

  // Emails the caller their own race's filing instructions (window, fee,
  // requirements, office contact). No body: gp-api scopes the send to the
  // authenticated user's campaign + email via @UseCampaign()/@ReqUser().
  'POST /v1/campaigns/mine/filing-instructions/email': {
    Request: {}
    Response: {
      success: boolean
    }
  }

  // Accepts a multipart PDF upload and stores it as a public share link.
  // The file part is sent as FormData — pass `{}` as the typed payload and
  // supply `{ body: formData }` via the overrides argument of clientRequest.
  'POST /v1/campaigns/mine/plan-pdf-share': {
    Request: {}
    Response: { url: string }
  }

  'POST /v1/campaigns/tcr-compliance/:tcrComplianceId/submit-cv-pin': {
    Request: {
      pin: string
    }
    Response: void
  }

  // Polling endpoint. 200 → ready, 202 → still generating (poll again ~3s).
  // First-time generation runs three Gemini pipelines in parallel; on cache
  // hit subsequent calls return 200 immediately. Mirrors
  // `StrategicLandscapeResponseSchema` on gp-api.
  'POST /v1/campaignStrategy/mine/strategic-landscape': {
    Request: {}
    Response: StrategicLandscapeResponse
  }

  // Section 7 community events (legacy / story-off plan only). Polling
  // endpoint — same shape as strategic-landscape. 200 → ready (events array up
  // to length 3), 202 → generating (poll again ~3s). Mirrors
  // `CommunityEventsResponseSchema` in
  // `gp-api/src/campaignStrategy/schemas/communityEvents.schema.ts`. Story-on
  // campaigns get events from the campaign tracker (CAP) instead.
  'POST /v1/campaignStrategy/mine/community-events': {
    Request: {}
    Response: CommunityEventsResponse
  }

  // Cheap existence probe used to gate the dashboard's Campaign Plan tab.
  // Mirrors `StrategyExistsResponseSchema` in
  // `gp-api/src/campaignStrategy/schemas/strategyExists.schema.ts`.
  'GET /v1/campaignStrategy/mine/exists': {
    Request: {}
    Response: { exists: boolean }
  }

  // Campaign Tracker tasks (campaign_tracker_tasks). The new tracker reads and
  // completes these; mirrors /campaigns/tracker-tasks in gp-api.
  'GET /v1/campaigns/tracker-tasks': {
    Request: {}
    Response: CampaignTrackerTask[]
  }

  'PUT /v1/campaigns/tracker-tasks/complete/:id': {
    Request: { id: string; type?: string; quantity?: number }
    Response: CampaignTrackerTask
  }

  'DELETE /v1/campaigns/tracker-tasks/complete/:id': {
    Request: { id: string }
    Response: CampaignTrackerTask
  }

  'GET /v1/elected-office/current': {
    Request: {}
    Response: ElectedOffice
  }

  'GET /v1/elected-office/mine': {
    Request: {}
    Response: ElectedOffice[]
  }

  'POST /v1/elected-office': {
    Request: ElectedOfficeInput
    Response: ElectedOffice
  }

  'PUT /v1/elected-office/:id': {
    Request: ElectedOfficeInput
    Response: ElectedOffice
  }

  'POST /v1/meetings/briefings/dispatch': {
    Request: {
      electedOfficeId: string
      kind: 'schedule' | 'briefing'
    }
    Response: { dispatched: true; kind: 'schedule' | 'briefing' }
  }

  'GET /v1/elected-office/support-estimate': {
    Request: {}
    // Null until the data team's ETL populates the office's support row.
    Response: SupportEstimate | null
  }

  'GET /v1/dashboard/cards': {
    Request: { bucket: DashboardCardBucket }
    Response: DashboardCardListResponse
  }

  'PUT /v1/dashboard/cards/:id/dismiss': {
    Request: {}
    Response: void
  }

  'GET /v1/dashboard/onboarding-cards': {
    Request: {}
    Response: OnboardingCardsResponse
  }

  'PUT /v1/dashboard/onboarding-cards/:key/skip': {
    Request: {}
    Response: void
  }

  'POST /v1/chats': {
    Request: { scope: ChatScope; anchor?: ChatAnchor }
    Response: { conversationId: string; created: boolean }
  }

  'GET /v1/chats': {
    Request: { scope: ChatScope }
    Response: ChatConversationListResponse
  }

  'GET /v1/chats/:id': {
    Request: { scope: ChatScope }
    Response: ChatConversationMessagesResponse
  }

  'DELETE /v1/chats/:id': {
    Request: { scope: ChatScope }
    Response: void
  }

  'GET /v1/ordinances': {
    Request: {}
    Response: OrdinanceListResponse
  }

  'POST /v1/ordinances': {
    Request: CreateOrdinanceRequest
    Response: Ordinance
  }

  'GET /v1/priorities': {
    Request: {}
    Response: Priority[]
  }

  'GET /v1/ordinances/:slug': {
    Request: {}
    Response: Ordinance
  }

  'PATCH /v1/ordinances/:slug': {
    Request: UpdateOrdinanceRequest
    Response: Ordinance
  }

  'DELETE /v1/ordinances/:slug': {
    Request: {}
    Response: void
  }

  'POST /v1/ordinances/:slug/clarify-answers': {
    Request: SaveOrdinanceClarifyAnswerRequest
    Response: Ordinance
  }

  'POST /v1/ordinances/:slug/quality-report': {
    Request: {}
    Response: OrdinanceQualityRun
  }

  'GET /v1/ordinances/:slug/quality-report': {
    Request: {}
    Response: OrdinanceQualityRun
  }

  'POST /v1/ordinances/:slug/quality-loop': {
    Request: {}
    Response: Ordinance
  }

  'DELETE /v1/ordinances/:slug/quality-loop': {
    Request: {}
    Response: Ordinance
  }

  'GET /v1/ordinances/:slug/quality-iterations': {
    Request: {}
    Response: OrdinanceQualityIterationsResponse
  }

  'GET /v1/contacts/stats': {
    Request: {}
    Response: ContactsStats
  }

  'GET /v1/onboarding/contacts/stats': {
    Request: {
      ballotReadyPositionId?: string
      districtId?: string
    }
    Response: ContactsStats
  }

  'GET /v1/onboarding/local-news': {
    Request: {
      city?: string
      state: string
      office: string
    }
    Response:
      | { status: 'pending' }
      | {
          status: 'ready'
          outlets: Array<{
            name: string
            type: 'TV' | 'print' | 'radio'
            description: string
            email?: string | null
            phone?: string | null
            address?: string | null
          }>
        }
  }

  'GET /v1/onboarding/voter-issues': {
    Request: {}
    Response: {
      issues: Array<{
        label: string
        score: number
        priority: 'high' | 'medium' | 'low'
      }>
    }
  }

  'POST /v1/polls/initial-poll': {
    Request: {
      message: string
      swornInDate: string
      imageUrl: string | null | undefined
      scheduledDate: string | null | undefined
    }
    Response: Poll
  }

  'GET /v1/polls/:pollId': {
    Request: {}
    Response: Poll
  }

  'GET /v1/polls': {
    Request: {}
    Response: {
      results: Poll[]
      pagination: { nextCursor: string | undefined }
    }
  }

  'GET /v1/polls/:pollId/top-issues': {
    Request: {}
    Response: GetPollIssuesResponse
  }

  'GET /v1/organizations/admin/list': {
    Request: { slug?: string; email?: string }
    Response: { organizations: AdminOrganization[] }
  }

  'GET /v1/admin/users/search': {
    Request: { email: string }
    Response: { id: number; email: string; name: string | null }[]
  }

  'POST /v1/admin/users/impersonate/:userId': {
    Request: { actorEmail?: string }
    Response: { token: string }
  }

  'POST /v1/voters/voter-file/filter': {
    Request: {
      name?: string
      activityConditions?: ActivityConditionInput[]
      supportStatus?: SupportStatusRollup[]
    } & Record<string, unknown>
    Response: SegmentResponse
  }
  'PUT /v1/voters/voter-file/filter/:id': {
    Request: {
      name?: string
      activityConditions?: ActivityConditionInput[]
      supportStatus?: SupportStatusRollup[]
    } & Record<string, unknown>
    Response: SegmentResponse
  }
  'GET /v1/voters/voter-file/filters': {
    Request: {}
    Response: SegmentResponse[]
  }
  'DELETE /v1/voters/voter-file/filter/:id': {
    Request: {}
    Response: {}
  }

  'GET /v1/contacts': {
    Request: {
      page?: number
      resultsPerPage?: number
      segment?: string
      search?: string
    }
    Response: ListContactsResponse
  }
  'GET /v1/contacts/:id': {
    Request: {}
    Response: Person
  }
  'POST /v1/contacts/count': {
    Request: {
      activityConditions?: ActivityConditionInput[]
      supportStatus?: SupportStatusRollup[]
    } & Record<string, unknown>
    Response: { count: number; fenced?: boolean }
  }
  'GET /v1/contacts/download': {
    Request: { segment?: string }
    Response: Blob
  }
  'GET /v1/contacts/list-detail': {
    // Omitted segment = the universe row's detail (ENG-10778): the whole
    // unfiltered district.
    Request: { segment?: number }
    Response: ListDetailContactsResponse
  }

  'GET /v1/contacts/:personId/notes': {
    Request: {}
    Response: ContactNoteListResponse
  }
  'POST /v1/contacts/:personId/notes': {
    Request: ContactNoteInput
    Response: ContactNote
  }
  'PATCH /v1/contacts/notes/:noteId': {
    Request: ContactNoteInput
    Response: ContactNote
  }
  'DELETE /v1/contacts/notes/:noteId': {
    Request: {}
    Response: {}
  }

  'POST /v1/contacts/:personId/interactions': {
    Request: LogContactInteractionInput
    Response: LogContactInteractionResponse
  }

  'GET /v1/contact-engagement/:id/issues': {
    Request: { take?: number; after?: string }
    Response: GetConstituentIssuesResponse
  }
  'GET /v1/contact-engagement/:id/activities': {
    Request: { take?: number; after?: string; lalVoterId?: string }
    Response: GetIndividualActivitiesResponse
  }

  'GET /v1/meetings': {
    Request: {}
    Response: MeetingsListResponseDto
  }

  // Self-serve landing catch-up: called client-side after landing on the
  // dashboard. Resolves the office from the authenticated user and dispatches
  // a briefing if the cron's gates would allow it, skipping only the 90-day
  // activity gate (landing already proves activity). `inFlight` covers both
  // a fresh dispatch from this call and a run already in progress from an
  // earlier one — either way the caller should show the loading banner.
  'POST /v1/meetings/dispatch-if-needed': {
    Request: {}
    Response: {
      dispatched: boolean
      inFlight: boolean
      meetingDate: string | null
    }
  }

  'GET /v1/meetings/:date/briefing': {
    Request: { date: string }
    Response: MeetingBriefingOutput | MeetingBriefingAwaitingDto
  }

  // User-uploaded agenda flow. Either submit a URL directly, or first call
  // `/presign` to get a signed S3 PUT URL, upload bytes, then submit the
  // returned uploadId/uploadKey. gp-api enqueues an experiment run and
  // surfaces status via MeetingsListItemDto.userAgendaStatus.
  'POST /v1/meetings/:date/briefing/agenda/presign': {
    Request: { date: string } & UserAgendaPresignRequest
    Response: UserAgendaPresignResponse
  }
  'POST /v1/meetings/:date/briefing/agenda': {
    Request: { date: string } & UserAgendaSubmitRequest
    Response: UserAgendaSubmitResponse
  }

  'POST /v1/speech/synthesize': {
    Request: SynthesizeSpeechRequest
    Response: SynthesizeSpeechResponse
  }

  'POST /v1/speech/transcribe/session': {
    Request: TranscribeSessionRequest
    Response: TranscribeSessionResponse
  }

  // Briefing annotations. Backend ships responses in snake_case. The
  // frontend AnnotationsApi client translates these to the camelCase
  // Annotation shape consumed by components. Briefings are addressed
  // by meeting date (YYYY-MM-DD), matching `GET /v1/meetings/:date/briefing`.
  'GET /v1/meetings/:date/briefing/annotations': {
    Request: { date: string; kinds?: string }
    Response: { annotations: ApiAnnotation[] }
  }
  'POST /v1/meetings/:date/briefing/annotations': {
    Request: ApiCreateAnnotationInput & { date: string }
    Response: ApiAnnotation
  }
  'PUT /v1/annotations/:annotationId/note': {
    Request: { body: string }
    Response: ApiAnnotation
  }
  'PUT /v1/annotations/:annotationId/review': {
    Request: { body: string }
    Response: ApiAnnotation
  }
  'DELETE /v1/annotations/:annotationId': {
    Request: {}
    Response: void
  }
  'POST /v1/annotations/:annotationId/note/attachments/presign': {
    Request: { annotationId: string } & ApiAttachmentPresignRequest
    Response: ApiAttachmentPresignResponse
  }
  'POST /v1/annotations/:annotationId/note/attachments/:attachmentId/complete': {
    Request: { annotationId: string; attachmentId: string }
    Response: void
  }
  'DELETE /v1/annotations/:annotationId/note/attachments/:attachmentId': {
    Request: { annotationId: string; attachmentId: string }
    Response: void
  }
  'GET /v1/annotations/:annotationId/note/attachments/:attachmentId/download-url': {
    Request: { annotationId: string; attachmentId: string }
    Response: ApiAttachmentDownloadUrlResponse
  }

  'GET /v1/meetings/:date/briefing/review-verdict': {
    Request: { date: string }
    Response: { review: ApiBriefingReviewVerdict | null }
  }
  'PUT /v1/meetings/:date/briefing/review-verdict': {
    Request: { date: string; verdict: 'passed' | 'failed'; failReason?: string }
    Response: ApiBriefingReviewVerdict
  }

  'GET /v1/meetings/:date/briefing/feedback': {
    Request: { date: string }
    Response: { feedback: ApiArtifactFeedback[] }
  }
  'PUT /v1/meetings/:date/briefing/items/:itemId/feedback': {
    Request: {
      date: string
      itemId: string
      feedback: ApiArtifactFeedbackKind
      // Optional free-text. Omit to leave the existing comment untouched;
      // pass `null` to clear it; pass a string to set / replace it.
      comment?: string | null
    }
    Response: ApiArtifactFeedback
  }
  'DELETE /v1/meetings/:date/briefing/items/:itemId/feedback': {
    Request: { date: string; itemId: string }
    Response: void
  }

  'GET /v1/elections/race-by-position': {
    Request: {
      brPositionId: string
      zip: string
      electionDate: string
    }
    Response: Race
  }

  // Briefing chat routes — cross-repo contract with gp-api PR #1607.
  // Request/response shapes mirror gp-api's createBriefingChatSchema,
  // getConversationResponseSchema, and sendMessageSchema. SSE message
  // streaming is intentionally not modeled here because clientRequest
  // can't consume an SSE body — see chat-api.ts streamMessage for the
  // raw fetch path.
  'POST /v1/briefing-chats': {
    Request: {
      meetingDate: string
      anchor: AnnotationAnchor
    }
    Response: {
      annotationId: string
      conversationId: string
    }
  }
  'GET /v1/briefing-chats/:annotationId': {
    Request: {}
    Response: {
      conversationId: string
      messages: ChatMessage[]
    }
  }
  'DELETE /v1/briefing-chats/:annotationId': {
    Request: {}
    Response: void
  }

  // Pro $10/mo subscription checkout (gp-api createProCheckoutSession).
  // `embedded: true` returns a Stripe Custom Checkout `clientSecret` to mount
  // in-app; omitting it returns a hosted `redirectUrl` (legacy off-cohort
  // path). `returnUrl` is where Stripe sends the candidate when a confirm
  // requires a redirect (e.g. 3DS); gp-api defaults it when omitted.
  'POST /v1/payments/purchase/checkout-session': {
    Request: {
      embedded?: boolean
      returnUrl?: string
    }
    Response: {
      clientSecret?: string
      redirectUrl?: string
    }
  }

  'GET /v1/community-issues': {
    Request: { list: 'top_community' | 'trending' }
    Response: {
      issues: CommunityIssueCard[]
      refresh: {
        status: 'running' | 'completed' | 'failed'
        lastCompletedAt: string | null
      }
    }
  }

  'GET /v1/community-issues/:id': {
    Request: { id: string }
    Response: CommunityIssueDetail
  }

  'POST /v1/community-issues/:id/prioritize': {
    Request: { id: string }
    Response: Priority
  }

  'POST /v1/community-issues/self-dispatch': {
    Request: { type: 'top_community_issues' | 'trending_issues' }
    Response: { dispatched: number; skipped: number }
  }

  // Preview/dev-only deterministic test seeding (gp-api disables it on qa/prod).
  // Used by the Community Issues e2e suite; not called from product code.
  'POST /v1/community-issues/seed': {
    Request: {
      issues: Array<{
        list: 'top_community' | 'trending'
        category: string
        priority: 'low' | 'medium' | 'high'
        title: string
        summary: string
        rank: number
        detail: CommunityIssueContent
        relatedBriefing?: {
          meetingDate: string
          briefingItemId: string
          content: string
        }
      }>
    }
    Response: {
      issues: Array<{
        id: string
        list: string
        rank: number | null
        title: string
      }>
    }
  }

  // Self-serve landing catch-up: called client-side after landing on the
  // community issues dashboard. Dispatches both experiment types if eligible
  // and not already in flight, skipping only the 90-day activity gate.
  // Distinct from self-dispatch above (staff-only, single-type, manual
  // refresh button).
  'POST /v1/community-issues/dispatch-if-needed': {
    Request: {}
    Response: { dispatched: number; skipped: number }
  }

  'GET /v1/campaigns/mine/race-opponent': {
    Request: {}
    Response: RaceOpponentResponse
  }

  'POST /v1/campaigns/mine/race-opponent/collect': {
    Request: {}
    Response: { runId: string | null; status: RaceOpponentCollectionStatus }
  }

  // Manual opponent entry: when discovery finds nobody, the candidate names
  // opponents by hand and runs collection on them. Mirrors gp-api's
  // ManualOpponentsRequestSchema (name required; ballotpediaUrl/website are
  // optional https URLs; 1-10 opponents) and returns the same collect shape.
  'POST /v1/campaigns/mine/race-opponent/opponents/manual': {
    Request: {
      opponents: Array<{
        name: string
        ballotpediaUrl?: string
        website?: string
      }>
    }
    Response: { runId: string | null; status: RaceOpponentCollectionStatus }
  }

  // Self-research: the candidate's own footprint pass. start/status/report all
  // derive their inputs from the campaign server-side, so none take a body.
  'POST /v1/campaigns/mine/race-opponent/self-research': {
    Request: {}
    Response: StartSelfResearchResponse
  }

  'GET /v1/campaigns/mine/race-opponent/self-research/status': {
    Request: {}
    Response: SelfResearchStatusResponse
  }

  'GET /v1/campaigns/mine/race-opponent/self-research/report': {
    Request: {}
    Response: SelfResearchReportResponse
  }

  // Contrasts: the candidate review/edit/route surface (ENG-10575). generate
  // drafts contrasts from opponent findings; list returns only candidate-
  // visible (cleared/approved/used) contrasts; PATCH edits a contrast's text;
  // route writes a DRAFT into Campaign Story or a texting Outreach (no send).
  'POST /v1/campaigns/mine/race-opponent/contrasts/generate': {
    Request: {}
    Response: GenerateContrastsResponse
  }

  'GET /v1/campaigns/mine/race-opponent/contrasts': {
    Request: {}
    Response: ListContrastsResponse
  }

  // `id` is the path param (PathParamsOf types it as string and the runtime
  // substitutes it into the URL), so it is NOT redeclared in Request —
  // redeclaring it as a number would intersect with the string path param to
  // `never`.
  // Only candidate-authored fields are editable. opponentFact/sourceUrl/
  // issueTag/routing are sourced from the opponent finding and immutable, so
  // they are not part of the edit request (mirrors EditContrastRequestSchema).
  'PATCH /v1/campaigns/mine/race-opponent/contrasts/:id': {
    Request: {
      candidateFact?: string
      contrastSentence?: string
    }
    Response: ContrastResponse
  }

  'POST /v1/campaigns/mine/race-opponent/contrasts/:id/route': {
    Request: { target: ContrastRouteTarget }
    Response: RouteContrastResponse
  }

  // Opponent identify/research/profile/activity. All hard-gated server-side on a
  // completed self-research pass — they 403 until self-research is done. identify
  // defaults the opponent set from the election-api roster; research requires a
  // candidate-confirmed opponentName in the body (never auto-run on a namesake).
  'POST /v1/campaigns/mine/race-opponent/opponents/identify': {
    Request: {}
    Response: IdentifyOpponentsResponse
  }

  'POST /v1/campaigns/mine/race-opponent/opponents/research': {
    Request: StartOpponentResearchRequest
    Response: StartOpponentResearchResponse
  }

  'GET /v1/campaigns/mine/race-opponent/opponents/profile': {
    Request: { opponentName: string }
    Response: OpponentProfileResponse
  }

  // Viewing the activity stream advances lastViewedAt server-side, so a fresh GET
  // re-flags only findings that landed after this read.
  'GET /v1/campaigns/mine/race-opponent/opponents/activity': {
    Request: {}
    Response: RaceOpponentActivityResponse
  }
}

// Wire shapes for the self-research routes. Mirror the contract schemas in
// @goodparty_org/contracts (RaceOpponentResearchSchema / RaceOpponentFinding-
// Schema), but dates arrive over JSON as ISO strings (the contract coerces them
// to Date), so the date leaves are typed as string here.
export type SelfResearchRecord = {
  id: number
  kind: RaceOpponentFindingKind
  opponentName: string | null
  electionCandidacyId: string | null
  status: RaceOpponentResearchStatus
  runId: string | null
  attempts: number
  completedAt: string | null
  lastViewedAt: string | null
  createdAt: string
  updatedAt: string
}

// Every finding is sourced-or-silent at the type level: sourceUrl and
// sourceExtract are always non-empty. draftedResponse is self-research only.
export type SelfResearchFinding = {
  id: number
  researchId: number
  claim: string
  sourceUrl: string
  sourceExtract: string
  sourceTitle: string | null
  sourceReachableAt: string | null
  category: string
  occurredAt: string | null
  draftedResponse: string | null
  createdAt: string
}

export type StartSelfResearchResponse = {
  research: SelfResearchRecord
}

export type SelfResearchStatusResponse = {
  status: RaceOpponentResearchStatus
  research: SelfResearchRecord | null
}

export type SelfResearchReportResponse = {
  research: SelfResearchRecord & { findings: SelfResearchFinding[] }
}

// Opponent identify returns roster-defaulted candidate names; the candidate
// confirms a match before research is dispatched. Mirrors
// IdentifyOpponentsResponseSchema in @goodparty_org/contracts.
export type IdentifyOpponentsResponse = {
  opponentNames: string[]
}

// Mirrors StartOpponentResearchRequestSchema. opponentName is the confirmed
// match (required); electionCandidacyId is an optional roster reference.
export type StartOpponentResearchRequest = {
  opponentName: string
  electionCandidacyId?: string | null
}

export type StartOpponentResearchResponse = {
  research: SelfResearchRecord
}

// The opponent Handbook: the research row plus its sourced findings. Same wire
// shape as the self-research report (dates as ISO strings over JSON); reuses
// SelfResearchFinding for the finding leaves.
export type OpponentProfileResponse = {
  research: SelfResearchRecord & { findings: SelfResearchFinding[] }
}

// One "what's new" item: an opponent finding flagged with whether it landed
// after the candidate last viewed the stream.
export type RaceOpponentActivityItem = SelfResearchFinding & {
  newSinceLastVisit: boolean
}

// Mirrors RaceOpponentActivityResponseSchema. `researchStatus` is the
// authoritative opponent-research lifecycle from the persisted row (not_started
// when none exists); the UI drives its initial view off it. The `refresh`
// envelope matches the community-issues feed shape exactly so the activity feed
// renders from the same pattern.
export type RaceOpponentActivityResponse = {
  findings: RaceOpponentActivityItem[]
  researchStatus: RaceOpponentResearchStatus
  refresh: {
    status: 'running' | 'completed' | 'failed'
    lastCompletedAt: string | null
  }
}

// Wire shape of GET /v1/campaigns/mine/race-opponent. Mirrors
// RaceOpponentResponseSchema in @goodparty_org/contracts, but dates arrive over
// JSON as ISO strings (the contract type coerces them to Date), so they're
// typed as string here.
export type RaceOpponentItem = {
  id: number
  opponentName: string
  sourceType: RaceOpponentSourceType
  sourceUrl: string | null
  content: unknown
  collectedAt: string
}

// Display-ready summary structured by the race_opponent_summary step. Mirrors
// RaceOpponentSummarySchema in @goodparty_org/contracts, but generatedAt arrives
// over JSON as an ISO string (the contract coerces it to Date).
//
// v2 (ENG-10630/ENG-10634): mirrors NormalizedSummarySource in contracts — the
// rich fields (url/title/publisher) are always present (the contract backfills
// them from the hostname for legacy-normalized rows), while sourceType/
// sourceUrl are the legacy passthrough gp-api still sends during the rollout.
// RaceOpponentList/IssueContrastCard/the PDF still key off sourceType/sourceUrl
// until ENG-10635 migrates them onto the rich fields, so those stay optional
// (not removed) rather than required.
export type RaceOpponentSummarySourceRef = {
  url: string
  title: string
  publisher: string
  description?: string
  sourceType?: RaceOpponentSourceType
  sourceUrl?: string
}

export type RaceOpponentSummarySection = {
  text: string
  sources: RaceOpponentSummarySourceRef[]
}

export type RaceOpponentSummaryKeyPosition = {
  label: string
  detail: string
  sources: RaceOpponentSummarySourceRef[]
}

export type RaceOpponentSummary = {
  opponentName: string
  overview: RaceOpponentSummarySection | null
  background: RaceOpponentSummarySection | null
  keyPositions: RaceOpponentSummaryKeyPosition[]
  generatedAt: string | null
  threatTier?: RaceOpponentThreatTier
  // v2 (ENG-10630/ENG-10635): interpretive, no required sources.
  whyTheyreRunning?: { text: string } | null
  // v2 (ENG-10630/ENG-10635): sourced-or-silent, like overview/background.
  issuesThatMatter?: {
    items: string[]
    sources: RaceOpponentSummarySourceRef[]
  } | null
  // Phase 3 analytical fields, all optional (the analysis may be absent).
  whyTheyMatter?: string
  whatYouNeedToKnow?: Array<{
    text: string
    sources?: RaceOpponentSummarySourceRef[]
  }>
  // Relaxed sourcing: an item cites a source where one is direct, else omits it.
  whereSoft?: Array<{ text: string; sources?: RaceOpponentSummarySourceRef[] }>
  issueContrasts?: RaceOpponentIssueContrast[]
}

export type IssueSalience = 'high' | 'medium' | 'low'

export type RaceOpponentIssueContrast = {
  issue: string
  salience: IssueSalience
  whyItMatters: string
  opponentStance: string
  opponentSources?: RaceOpponentSummarySourceRef[]
  candidateStance: string
}

// Campaign-level SWOT (ENG-10630/ENG-10636). Mirrors
// RaceOpponentFieldAnalysisSchema in @goodparty_org/contracts, but
// generatedAt arrives over JSON as an ISO string (the contract coerces it to
// Date). Interpretive section: sources may be empty, unlike the
// sourced-or-silent summary sections above.
export type RaceOpponentFieldAnalysis = {
  strengths: string[]
  weaknesses: string[]
  opportunities: string[]
  threats: string[]
  sources: SummarySource[]
  generatedAt: string | null
}

// Stand-out action cards (ENG-10644/ENG-10650). Mirrors
// RaceOpponentStandoutActionSchema in @goodparty_org/contracts.
export type RaceOpponentStandoutAction = {
  title: string
  body: string
  smsMessage: string
  // Nullish: DB nulls round-trip, and older payloads may omit it.
  opponentName?: string | null
  issue: string
}

export type RaceOpponentResponse = {
  opponents: Array<{
    opponentName: string
    // Enriched from the campaign-strategy opponent roster by name match; null
    // when the collected name doesn't match a roster row (don't guess).
    party: string | null
    isIncumbent: boolean | null
    // Phase 3: surfaced on the opponent object (in addition to summary) so the
    // roster can tier and order without opening the detail. Optional until an
    // opponent has analysis.
    threatTier?: RaceOpponentThreatTier
    // Sent only as the no-summary fallback; gp-api omits it once a structured
    // summary exists (ENG-10622).
    items?: RaceOpponentItem[]
    // Optional + nullable: ENG-10588 wires the producer to populate this from
    // the race_opponent_summary step; until then gp-api omits the field.
    summary?: RaceOpponentSummary | null
    // v2 (ENG-10630/ENG-10635): populated from the opponent's roster/collected
    // data; nullish so older gp-api payloads that predate this field still parse.
    websiteUrl?: string | null
  }>
  lastCollectedAt: string | null
  collectionStatus: RaceOpponentCollectionStatus
  // v2 (ENG-10630/ENG-10636): campaign-level SWOT, null until candidate_platform
  // data is available; nullish so older gp-api payloads still parse.
  fieldAnalysis?: RaceOpponentFieldAnalysis | null
  // Phase 6 (ENG-10644/ENG-10650): the contract defaults this to [] so current
  // gp-api always sends an array (never null); optional here so older payloads
  // that predate the field still parse.
  standoutActions?: RaceOpponentStandoutAction[]
}

// Where a contrast is routed. Mirrors RaceOpponentContrastRoutingSchema in
// @goodparty_org/contracts (the read shape, which includes 'mail') vs the
// narrower route target (story | texting only).
export type ContrastRouting = 'story' | 'texting' | 'mail'
export type ContrastRouteTarget = 'story' | 'texting'
export type ContrastStatus =
  | 'draft'
  | 'pending_review'
  | 'cleared'
  | 'blocked'
  | 'approved'
  | 'used'
  | 'discarded'

// Wire shape of a contrast. Mirrors RaceOpponentContrastSchema in
// @goodparty_org/contracts, but date leaves arrive over JSON as ISO strings
// (the contract coerces them to Date). All six content fields are non-empty;
// the UI additionally guards that every field is present before rendering.
export type ContrastRecord = {
  id: number
  opponentFact: string
  sourceUrl: string
  candidateFact: string
  contrastSentence: string
  issueTag: string
  routing: ContrastRouting
  status: ContrastStatus
  editCount: number
  findingId: number | null
  routedWebsiteId: number | null
  routedOutreachId: number | null
  createdAt: string
  updatedAt: string
}

export type ListContrastsResponse = {
  contrasts: ContrastRecord[]
}

export type GenerateContrastsResponse = {
  contrasts: ContrastRecord[]
  routedToReviewCount: number
}

export type ContrastResponse = {
  contrast: ContrastRecord
}

// The route endpoint returns one of two channel-specific shapes: a story route
// carries routedWebsiteId, a texting route carries routedOutreachId.
export type RouteContrastResponse =
  | { contrast: ContrastRecord; routedWebsiteId: number }
  | { contrast: ContrastRecord; routedOutreachId: number }

export type CommunityIssueCard = {
  id: string
  list: string
  category: string
  priority: string
  title: string
  summary: string
  rank: number | null
  prioritized: boolean
}

export type CommunityIssueSource = {
  id: string
  name: string
  source_type:
    | 'news'
    | 'government_website'
    | 'research'
    | 'poll'
    | 'advocacy_org'
  url?: string | null
  publisher?: string | null
  article_type?: string | null
  article_date?: string | null
}

export type CommunityIssueSubsection = {
  summary: string
  source_ids: string[]
}

export type CommunityIssueQuoteItem = {
  text: string
  attribution?: string
  source_id: string
}

export type CommunityIssueContent = {
  sources: CommunityIssueSource[]
  overview: CommunityIssueSubsection
  history?: CommunityIssueSubsection
  quotes?: { items: CommunityIssueQuoteItem[] }
  research?: CommunityIssueSubsection
  legislation?: CommunityIssueSubsection
}

export type CommunityIssueDetail = CommunityIssueCard & {
  archived: boolean
  detail: CommunityIssueContent | null
  relatedBriefings: Array<{
    meetingBriefingId: string
    briefingItemId: string
    meetingDate: string
  }>
  priorityId: string | null
}

// Backend (snake_case) annotation types. Mirrors @goodparty_org/contracts
// in gp-api. The AnnotationsApi client maps to/from the camelCase shape
// the rest of the frontend uses.
export type ApiAnnotationKind = 'note' | 'chat' | 'bug_report' | 'review'
export type ApiAnnotationResourceType = 'briefing'

export interface ApiAnnotationAnchorInput {
  json_path: string | null
  start: number | null
  end: number | null
}

export type ApiOcrStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'skipped'

export interface ApiAnnotationNoteAttachment {
  id: string
  file_name: string
  mime_type: string
  size_bytes: number
  ocr_status: ApiOcrStatus
  ocr_text: string | null
  ocr_error: string | null
  ocr_completed_at: string | null
  created_at: string
}

export interface ApiAnnotationNote {
  id: string
  /** Optional once attachment-only notes ship (Phase 2). */
  body: string | null
  attachments: ApiAnnotationNoteAttachment[]
  created_at: string
  updated_at: string
}

export interface ApiAttachmentPresignRequest {
  file_name: string
  mime_type: string
  size_bytes: number
}

export interface ApiAttachmentPresignResponse {
  attachment_id: string
  upload_url: string
  storage_key: string
}

export interface ApiAttachmentDownloadUrlResponse {
  download_url: string
  expires_at: string
}

export interface ApiAnnotationBugReport {
  id: string
  description: string
  submitted_at: string
}

export interface ApiAnnotationChat {
  id: string
  created_at: string
}

export interface ApiAnnotationReview {
  id: string
  body: string
  reviewer_email: string | null
  created_at: string
  updated_at: string
}

export interface ApiBriefingReviewVerdict {
  verdict: 'passed' | 'failed'
  failReason: string | null
  reviewerEmail: string | null
  reviewedAt: string
}

export interface ApiAnnotation {
  id: string
  kind: ApiAnnotationKind
  resource_type: ApiAnnotationResourceType
  resource_id: string
  author_user_id: number
  json_path: string | null
  start: number | null
  end: number | null
  created_at: string
  updated_at: string
  note?: ApiAnnotationNote
  bug_report?: ApiAnnotationBugReport
  chat?: ApiAnnotationChat
  review?: ApiAnnotationReview
}

export type ApiCreateAnnotationInput =
  | {
      kind: 'note'
      anchor: ApiAnnotationAnchorInput
      /** body is optional for attachment-only notes (Phase 2). */
      payload: { body?: string }
    }
  | {
      kind: 'bug_report'
      anchor: ApiAnnotationAnchorInput
      payload: { description: string }
    }
  | {
      kind: 'review'
      anchor: ApiAnnotationAnchorInput
      payload: { body: string }
    }

export type ApiArtifactResourceType = 'agenda_item'
export type ApiArtifactFeedbackKind = 'positive' | 'negative'

export interface ApiArtifactFeedback {
  id: string
  organization_slug: string
  submitter_user_id: number
  artifact_type: ApiArtifactResourceType
  artifact_id: string
  feedback: ApiArtifactFeedbackKind
  comment: string | null
  created_at: string
  updated_at: string
}

export type Organization = {
  slug: string
  name: string | null
  positionName: string | null
  position: null | { id: string; brPositionId: string; state: string }
  district: null | { id: string; l2Type: string; l2Name: string }
  electedOfficeId: string | null
  campaignId: number | null
  // Derived on read by gp-api (never persisted); present on every org response.
  status: 'active' | 'past'
}

// Mirrors EligibilitySchema in @goodparty_org/contracts. Derived on read by
// gp-api's EligibilityService; the webapp has no contracts dependency, so the
// shape is mirrored here in lockstep with the source.
export type Eligibility = {
  hasActiveCampaign: boolean
  holdsOffice: boolean
  canStartCampaign: boolean
  canGainOffice: boolean
  reelectionOfficeSlug: string | null
}

export type AdminOrganization = Organization & {
  extra: {
    positionName: string | null
    hasDistrictOverride: boolean
    owner: {
      id: string
      email: string
      firstName: string | null | undefined
      lastName: string | null | undefined
      phone: string | null | undefined
    }
    campaign: {
      id: number
      slug: string
      details: CampaignDetails | null
    } | null
  }
}

export type ElectedOffice = {
  id: string
  swornInDate: string | null
  electedDate: string | null
  termStartDate: string | null
  termEndDate: string | null
  termLengthDays: number | null
  isActive: boolean
  party: string | null
  pledgedAt: string | null
  onboardingCompletedAt: string | null
  // True when the holder self-reported their office/term via the net-new serve
  // onboarding flow (vs a sales/BallotReady prefill). Drives deterministic
  // resume branch classification.
  selfReported: boolean
  // Resume checkpoint: the furthest serve-onboarding step the holder reached,
  // written on every "Continue". Null when no checkpoint has been recorded.
  onboardingStep: string | null
  // The campaign this office was created from, when the holder reached office by
  // winning a GoodParty.org campaign (the "I won" flow). Null for a net-new serve
  // lead (sales/magic-link/BallotReady) who was never a candidate. Marks a
  // win-origin official who already onboarded as a candidate, so post-auth
  // routing must NOT send them into serve onboarding for a missing term/date.
  campaignId: number | null
}

export type ElectedOfficeInput = {
  swornInDate?: string | null
  electedDate?: string | null
  termStartDate?: string | null
  termEndDate?: string | null
  party?: string | null
  pledgedAt?: string | null
  onboardingCompletedAt?: string | null
  selfReported?: boolean
  onboardingStep?: string | null
  ballotReadyPositionId?: string | null
  customPositionName?: string | null
  overrideDistrictId?: string | null
}
