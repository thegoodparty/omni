# callhub

Vendor wrapper for CallHub (robocall / voice broadcast): the HTTP/auth
foundation plus the API surface a send needs. Composed by `src/outreach/`; no
HTTP routes of its own.

## Key files

| File | Role |
|------|------|
| `callhub.module.ts` | Registers + exports every service below |
| `config/callhubBaseConfig.ts` | Base URL + key; key asserted at first use, not import |
| `services/callhubHttp.service.ts` | Token auth + retry (429/idempotent-5xx); callers Zod-parse |
| `services/callhubErrorHandling.service.ts` | Maps any CallHub failure to `BadGatewayException` (502) |
| `services/callhubNumbers.service.ts` | Rent/list the caller-ID number (`phone_number`) |
| `services/callhubMedia.service.ts` | Multipart audio upload → `media_file_id` |
| `services/callhubPhonebook.service.ts` | Create phonebook + poll loaded count |
| `services/callhubBulkImport.service.ts` | Async CSV contact load (no job id) |
| `services/callhubCampaign.service.ts` | Create + schedule a voice broadcast (never launches) |
| `services/callhubDnc.service.ts` | DNC list lookup |

## Gotchas

- **CallHub numeric ids exceed JS's safe-integer range.** JSON.parse has
  already corrupted the sibling `id` by the time we see it. Always read/send the
  string `pk_str` (phonebook, campaign) or the string `media_file_id`, never the
  numeric `id`. IDs travel in request bodies as strings and CallHub's DRF
  backend coerces them.
- **Tight rate limits.** A burst of calls 429s; the HTTP service retries with
  backoff, and `bulk_create` is ~1/min. Serialize; let a phonebook load settle
  before creating the campaign.
- **Voice broadcast is create-then-launch.** `POST /v1/vb_campaign/` (trailing
  slash — the slashless path returns the campaign list) creates the campaign in
  a PAUSED (status 2) state that does NOT dial. Calls are placed only by a
  separate, explicit `PUT /v1/voice_broadcasts/{pk_str}/` with `status: 1`
  (START). `CallhubCampaignService` deliberately stops at create + schedule and
  never exposes START — do not add a dial path here without the compliance/pay
  gates that guard it.
- **`vb_campaign` schedule + contact options must be NESTED objects**
  (`schedule{}`, `contact_options{}`). Flat top-level fields are silently
  ignored and the campaign falls back to a dangerous start-now default.
  `schedule.startingdate`/`expirationdate` are `yyyy-MM-dd HH:mm:ss` (seconds
  required) in `schedule.timezone`; the operational weekdays must span the
  start→expiration range. Pre-recorded audio attaches as
  `script.live_message.audiofile` (the `media_file_id`); the sibling `question`
  is text-to-speech, which a robocall must not use (FCC).
- **`dont_call_dnc` / `block_cellphone_numbers` may be account-gated.** They can
  read back `false` even when sent `true`, depending on the CallHub plan; we
  still send them as the intended config.

## Config

`CALLHUB_API_KEY` (required, asserted lazily), `CALLHUB_API_BASE_URL`
(regional, defaults to the NA host — the generic host 403s),
`CALLHUB_HTTP_TIMEOUT`.
