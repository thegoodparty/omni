import { HttpException, HttpExceptionOptions } from '@nestjs/common'
import { PeerlyCvVerificationStatus } from '@goodparty_org/contracts'
import { z } from 'zod'
import { Campaign } from '../../generated/prisma'
import {
  peerlyCampaignConfigSchema,
  peerlyGetIdentitiesResponseBodySchema,
  peerlyIdentityCreateResponseBodySchema,
  peerlyIdentityProfileResponseBodySchema,
  peerlyIdentityProfileSchema,
  peerlyIdentitySchema,
  peerlyIdentityUseCaseResponseBodySchema,
  peerlyIdentityUseCaseSchema,
} from './schemas/peerlyIdentity.schema'
import {
  approve10DLCBrandResponseBodySchema,
  CampaignVerificationStatus,
  peerly10DLCBrandSubmitResponseBodySchema,
  peerlyCreateCVTokenResponseSchema,
  peerlyCvVerificationDataSchema,
  peerlyGetCvRequestResponseBodySchema,
  peerlyResendPinResponseBodySchema,
  peerlyRetrieveCampaignVerifyStatusResponseBodySchema,
  peerlyRetrieveCvResponseBodySchema,
  peerlySubmitCVResponseBodySchema,
  peerlyVerifyCVPinResponseSchema,
} from './schemas/peerlyTdlc.schema'

// Peerly's retrieve_cv `verification_status` values. Single source of truth is
// @goodparty_org/contracts (surfaced in the compliance-state response);
// re-exported here so the Peerly vendor layer keeps importing it locally.
export { PeerlyCvVerificationStatus }

export type PeerlyIdentity = z.infer<typeof peerlyIdentitySchema>
export type PeerlyJobArea = {
  didState?: string
  didNpaSubset?: string[]
}

export type PeerlyIdentityCreateResponseBody = z.infer<
  typeof peerlyIdentityCreateResponseBodySchema
>

export type PeerlyCampaignConfig = z.infer<typeof peerlyCampaignConfigSchema>

export type PeerlyIdentityProfile = z.infer<typeof peerlyIdentityProfileSchema>

export type PeerlyIdentityProfileResponseBody = z.infer<
  typeof peerlyIdentityProfileResponseBodySchema
>

export type PeerlyGetIdentitiesResponseBody = z.infer<
  typeof peerlyGetIdentitiesResponseBodySchema
>

export type PeerlyGetCvRequestResponseBody = z.infer<
  typeof peerlyGetCvRequestResponseBodySchema
>
export type PeerlySubmitCVResponseBody = z.infer<
  typeof peerlySubmitCVResponseBodySchema
>
// Peerly's resend_pin response body is undocumented; nothing is read off it.
export type PeerlyResendPinResponseBody = z.infer<
  typeof peerlyResendPinResponseBodySchema
>
export interface Peerly10DlcBrandData {
  entityType: string
  vertical: string
  is_political: boolean
  displayName: string
  companyName: string
  ein: string
  phone: string
  street?: string
  city?: string
  state?: string
  postalCode?: string
  website: string
  email: string
  jobAreas?: PeerlyJobArea[]
}
export type Peerly10DLCBrandSubmitResponseBody = z.infer<
  typeof peerly10DLCBrandSubmitResponseBodySchema
>
export type Approve10DLCBrandResponseBody = z.infer<
  typeof approve10DLCBrandResponseBodySchema
>

/** Full brand data returned by the Peerly approve 10DLC endpoint. */
export type BrandApprovalResult = Omit<
  Approve10DLCBrandResponseBody,
  'campaign_verify_token'
>

// Media status enum
export enum MediaStatus {
  ERROR = 'ERROR',
  SUCCESS = 'SUCCESS', // Inferred - likely success status
  PROCESSING = 'PROCESSING', // Inferred - likely processing status
}

// Media type enum
export enum MediaType {
  IMAGE = 'IMAGE',
  VIDEO = 'VIDEO',
}

// Phone list state enum
export enum PhoneListState {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
}

// P2P SMS API types
export type PhoneListUploadResponse = {
  token: string
}

export type PhoneListStatusResponse = {
  list_status: string
  list_id?: number
}

export type MediaCreateResponse = {
  media_id: string
  status?: MediaStatus
  error?: string
}

export type P2pJobCreateResponse = {
  job_id: string
}

export type P2pTemplate = {
  title: string
  text: string
  is_default?: boolean
  advanced?: {
    media: {
      media_id: string
      media_type: MediaType
      preview_url?: string
      thumbnail_url?: string
      title?: string
    }
  }
}
export { CampaignVerificationStatus }

export type PeerlyVerifyCVPinResponse = z.infer<
  typeof peerlyVerifyCVPinResponseSchema
>

export type PeerlyTcrCampaign = {
  account_id: string
  ageGated: string | null
  att_msg_class: string | null
  att_status: string | null
  att_tpm: string | null
  autoRenewal: number
  create_date: string
  description: string
  directLending: string | null
  embeddedLink: string | null
  embeddedPhone: string | null
  helpMessage: string | null
  is_expired: number
  is_suspended: number
  messageFlow: string | null
  numberPool: string | null
  sample1: string | null
  sample1_media: string | null
  sample2: string | null
  sample2_media: string | null
  sample3: string | null
  sample3_media: string | null
  sample4: string | null
  sample4_media: string | null
  sample5: string | null
  sample5_media: string | null
  subUsecases: string | null
  subscriberHelp: string | null
  subscriberOptin: string | null
  subscriberOptout: string | null
  tcr_brand_id: string
  tcr_campaign_id: string
  tmo_brand_daily_cap: string | null
  tmo_brand_tier: string | null
  tmo_status: string | null
  usc_status: string | null
  usecase: string
  vertical: string
  vz_status: string | null
}

export type PeerlyGetIdentityBrandInfoResponse = {
  account_id: string
  aegis_vetting_score: string
  aegis_vetting_status: string
  cv_vetting_status: string | null
  tcr_brand_id: string
  tcr_campaigns: PeerlyTcrCampaign[]
  tcr_entity_type: string
  tcr_identity_status: string
  tcr_vertical: string
}
export type PeerlyCreateCVTokenResponse = z.infer<
  typeof peerlyCreateCVTokenResponseSchema
>

// TODO: make this an enum once we have the answer to this question:
//  https://goodpartyorg.slack.com/archives/C09H3K02LLV/p1759423143435669
export type PeerlyRetrieveCampaignVerifyStatusResponseBody = z.infer<
  typeof peerlyRetrieveCampaignVerifyStatusResponseBodySchema
>

// The `verification_data` block Peerly's retrieve_cv returns once the PIN has
// been sent. See peerlyCvVerificationDataSchema.
export type PeerlyCvVerificationData = z.infer<
  typeof peerlyCvVerificationDataSchema
>

export type PeerlyRetrieveCvResponseBody = z.infer<
  typeof peerlyRetrieveCvResponseBodySchema
>
export enum PeerlyCommitteeType {
  House = 'H',
  Senate = 'S',
  Presidential = 'P',
  Candidate = 'CA',
}

export enum PeerlyCvVerificationType {
  StateLocal = 'state_local',
  Federal = 'federal',
}

export type PeerlyIdentityUseCase = z.infer<typeof peerlyIdentityUseCaseSchema>

export type PeerlyIdentityUseCaseResponseBody = z.infer<
  typeof peerlyIdentityUseCaseResponseBodySchema
>

export type HttpExceptionConstructor = new (
  message: string,
  options?: HttpExceptionOptions,
) => HttpException

export interface PeerlyAuthenticatedUser {
  user_id: number
  last_name: string
  email: string
  user_type: string
  identities: PeerlyIdentity[]
  first_name: string
  local_timezone: string
}

export enum PeerlyJobStatus {
  ACTIVE = 'active',
  PAUSED = 'paused',
  DELETED = 'deleted',
  PENDING = 'pending',
  ERROR = 'error',
}

export interface PeerlyJob {
  id: string
  account_id: string
  identity_id: string
  name: string
  internal_name: string
  status: PeerlyJobStatus
  job_type: string
  created_date: string
  created_by: string
  last_touched_date: string
  start_date: string
  end_date: string
  schedule_id: number
  schedule_details?: {
    schedule_id: number
    schedule_name: string
    is_global: number
  }
  did_state: string
  did_npa_subset: string[]
  disable_did_purchase: boolean
  can_use_mms: boolean
  ai_enabled: boolean
  ai_auto_opt_out_threshold: string
  deliverability_check: boolean
  deliverability_check_error?: string
  dynamic_reassignment: boolean
  can_add_new_lead: boolean
  has_canvassers_scheduled: boolean
  leads_remaining: number
  agent_ids: string[]
  agents: Record<string, never>
  phone_lists: number[]
  phone_list_assignments: Array<{
    list_id: number
    deduplicate: boolean
  }>
  suppression_list_assignments: string[]
  templates: Array<{
    id: string
    title: string
    text: string
    is_default: boolean
    has_dynamic_media: boolean
    has_dynamic_media_rendered: boolean
    media?: {
      media_id: string
      media_type: string
      title: string
    }
    advanced?: {
      show_stop: boolean
      organization?: string
      bodies?: string[]
      minimized?: boolean
      call_to_actions?: Array<{
        text: string
        url?: string
      }>
    }
  }>
  canvassers_schedule?: {
    requested_initials: string
    requested_date: string
    requested_at: string
    requested_start_time: string
    requested_end_time: string
    requested_timezone: string
    requested_timeframe: string
    requested_by: string
    start_time: string
    end_time: string
    approved: boolean
  }
  questions: string[]
  tracked_links: string[]
  integrations: string[]
}

export interface PeerlyJobTemplate {
  is_default: boolean
  title: string
  text: string
  advanced?: {
    show_stop: boolean
    organization?: string
    bodies?: Array<{
      text: string
    }>
    call_to_actions?: Array<{
      text: string
      url?: string
    }>
  }
  media?: {
    media_type: string
    media_id: string
    title: string
  }
}

export interface CreateJobParams {
  name: string
  templates: PeerlyJobTemplate[]
  didState: string
  didNpaSubset?: string[]
  identityId?: string
  scheduledDate?: string
  scheduleId: number
}

export type PeerlyRecoveryInfo = Record<string, string | number | undefined>

export interface PeerlyApiErrorContext {
  campaign?: Campaign
  peerlyIdentityId?: string
  httpExceptionClass?: HttpExceptionConstructor
  customMessage?: string
  recoveryInfo?: PeerlyRecoveryInfo
  // Background sweeps poll Peerly with no human waiting; a transient failure
  // there should log + throw but not page the 10DLC Slack channel.
  suppressSlackAlert?: boolean
  // This failure is an expected outcome of the flow rather than a fault: the
  // vendor declined the request on its own terms and whoever triggered it
  // already sees the refusal in the response. Logs the `Peerly API ERROR`
  // line at `warn` instead of `error`.
  //
  // DISTINCT FROM suppressSlackAlert, which every background sweep sets on a
  // genuinely transient failure it does not want to page for. That failure is
  // still a fault and still belongs at `error`; this one is not a fault at
  // all. Coupling the two would downgrade every swept transport error and
  // blind `win-peerly-warnings` to the vendor actually being down.
  expectedRejection?: boolean
}
