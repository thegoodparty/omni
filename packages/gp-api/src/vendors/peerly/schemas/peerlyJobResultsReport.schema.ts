import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

// Discovered via ENG-10727 against the dev Peerly account (2026-07-17).
// Peerly exposes per-lead job results only as generated report files, not as
// a paginated JSON row API:
//   GET /v2/p2p/{jobId}/cdrs                 — every message row (in/out)
//   GET /1to1/jobs/{jobId}/questionresponses — per-lead answers + optout flag
//   GET /1to1/jobs/{jobId}/trackedlinkclicks — per-click rows
// All three require date_range=CUSTOM&start_date=YYYY-MM-DD&end_date=... and
// respond with a signed file URL (`link`): plain CSV on GCS for cdrs, zipped
// CSV on S3 for the /1to1 reports. The export-as-list tokens appear only when
// create_phone_list / create_suppression_list are requested.
const peerlyReportLinkResponseSchema = z.object({
  result: z.string(),
  link: z.string().url(),
  p2p_list_status_token: z.string().nullish(),
  suppression_list_status_token: z.string().nullish(),
})

export class PeerlyReportLinkResponseDto extends createZodDto(
  peerlyReportLinkResponseSchema,
) {}

// One row of the cdrs CSV (headers verbatim, show_headers=true). Rows carry
// no per-message id — Conversation_id is stable per lead conversation, so
// ingestion needs a synthetic per-event key (see ENG-10727 findings).
// Direction observed as 'sent'; the inbound literal is unverified in dev, so
// it stays a plain string until a real reply is captured.
export const peerlyCdrCsvRowSchema = z.object({
  Timestamp: z.string(),
  Direction: z.string(),
  Agent_id: z.string(),
  Agent_name: z.string(),
  Conversation_id: z.string(),
  From: z.string(),
  To: z.string(),
  Content: z.string(),
  Chunk: z.string(),
  Result: z.string(),
  Cost: z.string(),
  Canvasser_rate: z.string(),
  Unicode: z.string(),
  MMS: z.string(),
  'Media Url': z.string(),
  Extern_id: z.string(),
  Sublist_id: z.string(),
  Title: z.string(),
  First_name: z.string(),
  Mid_name: z.string(),
  Last_name: z.string(),
  Suffix: z.string(),
  Address1: z.string(),
  Address2: z.string(),
  City: z.string(),
  State: z.string(),
  Zip: z.string(),
  Email: z.string(),
  Aux_data1: z.string(),
  Aux_data2: z.string(),
  Aux_data3: z.string(),
  Aux_data4: z.string(),
  Aux_data5: z.string(),
})

export type PeerlyCdrCsvRow = z.infer<typeof peerlyCdrCsvRowSchema>

// One row of the questionresponses CSV. The job's question titles are
// appended as extra dynamic columns after `optout`; they are intentionally
// not modeled here and Zod strips them on parse.
export const peerlyQuestionResponsesCsvRowSchema = z.object({
  date: z.string(),
  conversation_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
  agent_email: z.string(),
  from_did: z.string(),
  lead_phone: z.string(),
  sublist_id: z.string(),
  extern_id: z.string(),
  first_name: z.string(),
  mid_name: z.string(),
  last_name: z.string(),
  suffix: z.string(),
  address1: z.string(),
  address2: z.string(),
  city: z.string(),
  state: z.string(),
  zip: z.string(),
  email: z.string(),
  aux_data1: z.string(),
  aux_data2: z.string(),
  aux_data3: z.string(),
  aux_data4: z.string(),
  aux_data5: z.string(),
  optout: z.string(),
})

export type PeerlyQuestionResponsesCsvRow = z.infer<
  typeof peerlyQuestionResponsesCsvRowSchema
>

// One row of the trackedlinkclicks CSV — the only report whose rows carry a
// stable per-event `id`.
export const peerlyTrackedLinkClicksCsvRowSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  account_id: z.string(),
  identity_id: z.string(),
  job_id: z.string(),
  conversation_id: z.string(),
  link_id: z.string(),
  domain_id: z.string(),
  domain_name: z.string(),
  slash_tag: z.string(),
  short_url: z.string(),
  destination: z.string(),
  remote_ip: z.string(),
  user_country: z.string(),
  user_state: z.string(),
  user_city: z.string(),
  user_city_lat_long: z.string(),
  user_agent: z.string(),
  operating_system: z.string(),
  referer: z.string(),
  utm_source: z.string(),
  utm_medium: z.string(),
  utm_campaign: z.string(),
  utm_content: z.string(),
  utm_term: z.string(),
  contact_phone: z.string(),
  sublist_id: z.string(),
  extern_id: z.string(),
  title: z.string(),
  first_name: z.string(),
  mid_name: z.string(),
  last_name: z.string(),
  suffix: z.string(),
  address1: z.string(),
  address2: z.string(),
  city: z.string(),
  state: z.string(),
  zip: z.string(),
  email: z.string(),
  aux_data1: z.string(),
  aux_data2: z.string(),
  aux_data3: z.string(),
  aux_data4: z.string(),
  aux_data5: z.string(),
  cost: z.string(),
})

export type PeerlyTrackedLinkClicksCsvRow = z.infer<
  typeof peerlyTrackedLinkClicksCsvRowSchema
>
