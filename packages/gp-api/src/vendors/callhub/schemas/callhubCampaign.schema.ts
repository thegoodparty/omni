import { z } from 'zod'

// A voice broadcast has a create-then-launch lifecycle: POST /v1/vb_campaign/
// creates the campaign in a PAUSED (status 2), non-dialing state; a later,
// explicit PUT /v1/voice_broadcasts/{pk_str}/ carrying `status` transitions it.
// START (1) is the step that actually places calls, so this slice — create +
// schedule — never sends it. The other codes exist only to document the
// lifecycle. Verified live: a freshly created campaign reads back status 2 and
// does not dial until an explicit START.
export const CALLHUB_VB_STATUS = {
  START: 1,
  PAUSE: 2,
  ABORT: 3,
  END: 4,
} as const

// The wire body for POST /v1/vb_campaign/ (the trailing slash matters — the
// slashless path returns the campaign list instead of creating). CallHub's
// numeric ids exceed JS's safe-integer range, so every id crosses the wire as a
// STRING (phonebook pk_str, the audio's media_file_id) and CallHub's DRF
// backend coerces it — the same string-id trick bulk_create's phonebook_id
// relies on. The audio the broadcast plays on pickup is a pre-recorded upload
// referenced by that media id (script.live_message.audiofile); CallHub also
// accepts a `question` string there for text-to-speech, but a robocall must be
// a human recording (FCC), so only the uploaded file is set. `schedule` and
// `contact_options` MUST be nested objects — verified live that flat top-level
// fields are silently ignored and the campaign falls back to a start-now
// default.
export const CreateVbCampaignBodySchema = z.object({
  name: z.string(),
  phonebooks: z.array(z.string()),
  script: z.object({
    label: z.string(),
    live_message: z.object({ audiofile: z.string() }),
  }),
  callerid_options: z.object({ callerid: z.string() }),
  schedule: z.object({
    // 'yyyy-MM-dd HH:mm:ss' (seconds required), interpreted in `timezone`.
    startingdate: z.string(),
    expirationdate: z.string(),
    timezone: z.string(),
    daily_start_time: z.string(),
    daily_stop_time: z.string(),
    // The operational days must span the start→expiration range or CallHub
    // rejects the create, so every day is enabled.
    monday: z.boolean(),
    tuesday: z.boolean(),
    wednesday: z.boolean(),
    thursday: z.boolean(),
    friday: z.boolean(),
    saturday: z.boolean(),
    sunday: z.boolean(),
  }),
  contact_options: z.object({
    use_contact_tz: z.boolean(),
    dont_call_dnc: z.boolean(),
    dont_call_litigator: z.boolean(),
    block_cellphone_numbers: z.boolean(),
  }),
})
export type CreateVbCampaignBody = z.infer<typeof CreateVbCampaignBodySchema>

// Fields we read back from a create. `pk_str` is the campaign handle a later
// launch/status step addresses; the sibling numeric `id` is deliberately NOT
// read — it arrives already corrupted by JSON's safe-integer limit. CallHub
// returns much more (schedule/contact_options/callerid_options/amd_options),
// stripped by z.object.
export const CreateVbCampaignResponseSchema = z.object({
  pk_str: z.string(),
  name: z.string().nullish(),
})
export type CreateVbCampaignResponse = z.infer<
  typeof CreateVbCampaignResponseSchema
>
