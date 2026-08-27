import { z } from 'zod'

// A voice broadcast campaign as returned by GET /v1/voice_broadcasts/{id}/.
// The serializer carries no numeric `id`/`pk_str` — the canonical identifier is
// the hyperlinked `url` (which embeds the id), so callers address a campaign by
// the id string they already hold and read `url` back, never a numeric field.
// Fields are docs-derived: the live account had no VB campaign to confirm them
// (GET /v1/voice_broadcasts/ returned an empty page, and the detail route is
// wired — a missing id 404s with "No Campaign matches the given query").
export const VoiceBroadcastCampaignSchema = z.object({
  url: z.string(),
  owner: z.string().nullish(),
  name: z.string(),
  frequency: z.number().nullish(),
  status: z.number().int(),
  phonebook: z.array(z.string()).nullish(),
})
export type VoiceBroadcastCampaign = z.infer<
  typeof VoiceBroadcastCampaignSchema
>

// CallHub encodes the VB lifecycle as an integer `status` (docs-derived):
//   1 START · 2 PAUSE · 3 ABORT · 4 END — a completed run reads back as END.
export const VOICE_BROADCAST_STATUS_LABELS: Partial<Record<number, string>> = {
  1: 'START',
  2: 'PAUSE',
  3: 'ABORT',
  4: 'END',
}
export const VOICE_BROADCAST_STATUS_UNKNOWN = 'UNKNOWN' as const

export interface VoiceBroadcastCampaignStatus extends VoiceBroadcastCampaign {
  statusLabel: string
}

// Post-run results are pull-based: an export job is created (a separate,
// non-GET action left to a later slice), then its result is polled here at
// GET /v1/export_data/export_{job_id}/. `state` gates readiness — 'SUCCESS'
// means `data.url` holds the call-detail (CDR) CSV whose per-call disposition
// rows a later pay slice aggregates into placed/answered/voicemail/failed. The
// billable/dialed count is that CSV's dialed-row count, cross-checkable against
// POST /v2/credits_usage/ (campaign_type=6) `voice_calls` (dialed calls) and
// `voice_billsec` (billable seconds) — a POST, so out of this GET-only read.
// This shape is docs-derived and UNVERIFIED against a real completed run: the
// account has no completed VB campaign, and one is not created here (that would
// dial real phones). Verify against a real run before the pay slice relies on
// the CSV column mapping.
export const CAMPAIGN_REPORT_EXPORT_SUCCESS = 'SUCCESS' as const

export const CampaignReportExportSchema = z.object({
  state: z.string(),
  data: z
    .object({
      url: z.string(),
      code: z.number().nullish(),
    })
    .nullish(),
})
export type CampaignReportExport = z.infer<typeof CampaignReportExportSchema>
