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
| `services/callhubCampaign.service.ts` | Create + schedule a voice broadcast; `launchVoiceBroadcast` (START) dials it; `abortVoiceBroadcast` (ABORT, status 3) retires a PAUSED one so it never dials |
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
  (START), exposed as `CallhubCampaignService.launchVoiceBroadcast(pkStr)`. That
  method only sends the START — the money (live-hold) and compliance gates that
  MUST precede a real dial live in the caller (`OutreachRobocallSendService`),
  never here; do not call it from any path that has not passed them.
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
- **`frequency` (calls/min) shares ONE account-wide cap, so set it low.** The
  account's total Voice Broadcast capacity is ~60 calls/min, SHARED across every
  scheduled/running campaign, and CallHub defaults a new campaign to 60 — the
  whole pool. With the default, a second campaign's START 400s `over_cps_limit`
  (incident 2026-10-08: a batch of staged runs all defaulting to 60 could not
  dial). `createVoiceBroadcast` now sends an explicit low `frequency`
  (`CALLHUB_VB_CALLS_PER_MINUTE`, default 10) so several campaigns coexist under
  the cap; each dials slower but the 48h run window absorbs it. Raising total
  throughput means raising the account cap with CallHub (support@callhub.io,
  billed monthly), not just this knob. The existing 5 stuck campaigns were
  created BEFORE this — lower their frequency in the CallHub dashboard (or
  re-stage) for them to dial.
  - **The serial send sweep reads this value via
    `getConfiguredCallsPerMinute()`** to estimate when a dialing run finishes and
    the shared pool can be freed (`outreachRobocallSend.service.ts`). Two
    consequences before RAISING it: (1) in-flight runs were STAGED at the old
    rate, so the estimate (reading the new, higher rate) would predict an early
    finish for them and free the pool while they are still dialing — cutting calls
    — so DRAIN all dialing/dialed-unfreed runs first. (2) It is unconfirmed whether
    CallHub reserves the pool for merely-SCHEDULED (PAUSED) campaigns as well as
    running ones (this gotcha says "scheduled/running"); if it does, raising
    frequency to the account cap means only one campaign can be STAGED at a time,
    which the staging sweep does not currently enforce. Settle both before moving
    the default toward the cap for the serial model.

## Config

`CALLHUB_API_KEY` (required, asserted lazily), `CALLHUB_API_BASE_URL`
(regional, defaults to the NA host — the generic host 403s),
`CALLHUB_HTTP_TIMEOUT`, `CALLHUB_VB_CALLS_PER_MINUTE` (per-campaign `frequency`,
default 10 — see the account-cap gotcha above).
