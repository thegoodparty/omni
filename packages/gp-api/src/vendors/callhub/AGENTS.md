# callhub

Vendor wrapper for CallHub (robocall / voice broadcast): the HTTP/auth
foundation plus the API surface a send needs. Composed by `src/outreach/`; no
HTTP routes of its own.

## Key files

| File                                       | Role                                                                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `callhub.module.ts`                        | Registers + exports every service below                                                                                                                      |
| `config/callhubBaseConfig.ts`              | Base URL + key; key asserted at first use, not import                                                                                                        |
| `services/callhubHttp.service.ts`          | Token auth + retry (429/idempotent-5xx); callers Zod-parse                                                                                                   |
| `services/callhubErrorHandling.service.ts` | Maps any CallHub failure to `BadGatewayException` (502)                                                                                                      |
| `services/callhubNumbers.service.ts`       | Rent/list the caller-ID number (`phone_number`)                                                                                                              |
| `services/callhubMedia.service.ts`         | Multipart audio upload → `media_file_id`                                                                                                                     |
| `services/callhubPhonebook.service.ts`     | Create phonebook + poll loaded count                                                                                                                         |
| `services/callhubBulkImport.service.ts`    | Async CSV contact load (no job id)                                                                                                                           |
| `services/callhubCampaign.service.ts`      | Create + schedule a voice broadcast; `launchVoiceBroadcast` (START) dials it; `abortVoiceBroadcast` (ABORT, status 3) retires a PAUSED one so it never dials |
| `services/callhubDnc.service.ts`           | DNC list lookup                                                                                                                                              |

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
- **`frequency` (calls/min) is the per-campaign dial rate, defaulted to the
  whole account pool.** CallHub's total Voice Broadcast capacity is ~120
  calls/min, SHARED across RUNNING campaigns — two at 60 each tripped
  `over_cps_limit` when both ran (incident 2026-10-08). `createVoiceBroadcast`
  sends `CALLHUB_VB_CALLS_PER_MINUTE` (default 120, set 2026-10-15; 10 → 30 →
  120 as the serial model let the rate climb). The default is the full pool
  because the serial send sweep runs exactly ONE campaign at a time, so a single
  run never contends with our own others; a stray `over_cps` self-heals via
  `startCampaign`'s throttle revert. Raising total throughput ABOVE ~120 needs
  CallHub to raise the account cap (support@callhub.io, billed monthly), not
  this knob. A live PATCH confirmed CallHub accepts 120 on a campaign.
  - **The serial send sweep reads this value via
    `getConfiguredCallsPerMinute()`** to estimate when a dialing run finishes and
    the shared pool can be freed (`outreachRobocallSend.service.ts`). The rate
    each campaign was created with is FROZEN per-run at stage time
    (`OutreachRobocall.stagedCallsPerMinute`; `createVoiceBroadcast` returns the
    `frequency` it stamped), and the dial-completion estimate (plus the backlog
    projection) reads THAT, falling back to this live value only for a run staged
    before the freeze. The estimate walks the frozen rate at a fixed ratio
    (`ROBOCALL_DIAL_SAFETY_RATE_DIVISOR`), so raising this env never shortens an
    in-flight run's ceiling AND a higher rate shortens the estimate for new runs
    in step — no manual drain needed. The once-open caveat (does CallHub reserve
    the pool for merely-SCHEDULED PAUSED campaigns?) was settled AGAINST by the
    Oct incident: leroy ran at 60 while others sat Paused at 60, so only RUNNING
    campaigns consume the cap — which is why the full-pool default is safe under
    serial even though the staging sweep does not enforce one-staged-at-a-time.

- **No reliable per-campaign dialed-call count read — the serial completion seam
  lives in `outreachRobocallSend.service.ts`, not here.** CallHub's
  `POST /v2/credits_usage/` (`campaign_type=6`) `voice_calls` turned out
  ACCOUNT-WIDE, not per-broadcast, and omitted a required `start_date`, so the old
  per-campaign `CallhubCreditsService` read was retired (settlement moved to time).
  Because of that, the serial send sweep decides a dialed run is finished through a
  completion SEAM (`isDoneDialing`) whose wired signal is a money-SAFE TIME FLOOR —
  `estimateRobocallDialCompletion` walked at a conservative rate haircut (so it can
  never abort a still-dialing run) plus a buffer. Correctness does NOT depend on the
  serial model: the floor works in any mode. A serial-ONLY SPEEDUP — an account-wide
  `voice_calls` delta (valid because exactly one robocall dials at a time, so the
  account-wide count IS that campaign's) — is the documented extension point behind
  the seam but is DEFERRED until a reliable account-wide read (with `start_date`, its
  field semantics verified against a real completed run) or a true per-campaign CDR
  signal lands. If you add such a read here, wire it as that speedup and keep the
  time floor as the fallback. A `dialing` row whose status read never resolves is
  force-failed by the sweep's deadlock backstop (it VOIDs the hold) so it can't
  block the serial queue — that lives in `outreachRobocallSend.service.ts` too.

## Config

`CALLHUB_API_KEY` (required, asserted lazily), `CALLHUB_API_BASE_URL`
(regional, defaults to the NA host — the generic host 403s),
`CALLHUB_HTTP_TIMEOUT`, `CALLHUB_VB_CALLS_PER_MINUTE` (per-campaign `frequency`,
default 120 — see the account-cap gotcha above).
