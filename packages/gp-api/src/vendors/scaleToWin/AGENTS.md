# scaleToWin

Vendor wrapper for Scale to Win (S2W), the peer-texting platform civic panel
waves send through. It copies a template campaign, loads contacts from a CSV,
previews, starts and sends. No HTTP routes of its own; the in-process mock is
`src/vendorMocks/scaleToWin/`.

## Key files

| File                                     | Role                                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| `scaleToWin.module.ts`                   | Exports the campaign and contacts services                             |
| `config/scaleToWinBaseConfig.ts`         | Base URL, basic-auth keys and subaccount, each asserted at first use   |
| `config/sendingNumbers.config.ts`        | Sending number per organization, then per state, then a toll-free one  |
| `services/scaleToWinHttp.service.ts`     | Basic auth, retry, `ScaleToWinApiError`, enforce-mode response parsing |
| `services/scaleToWinCampaign.service.ts` | `copy`, `get`, `previewMessages`, `start`, `getStartJob`, `sendFull`   |
| `services/scaleToWinContacts.service.ts` | `presignedPut`, `putCsv`, `csvUpload`, `getLoadJob`                    |
| `schemas/`                               | Request and response Zod schemas, plus the mock's stored state         |

## Gotchas

- **Dev and preview never call Scale to Win.** `VENDOR_MODE` is mock outside
  prod, so `baseUrl` points at the in-process mock and the client sends the
  fixed mock credentials. `S2W_API_KEY_ID`, `S2W_API_KEY_SECRET` and
  `S2W_SUBACCOUNT_ID` exist in prod only. A missing key throws on first use,
  never at boot.
- **One rate limit, 60 requests a minute, shared by the whole account.**
  Never fan calls out in parallel. 429s are retried with backoff.
- **5xx is retried on GETs only.** A POST that 5xxed may have copied a
  campaign or started a send, so it is surfaced, not repeated.
- **A POST with no body sends `{}`**, so every POST carries a JSON body.
- **Errors are `{ message, code, issues? }`.** The HTTP service maps them to
  `ScaleToWinApiError` (a 502) carrying `vendorStatus` and `code`. A 409 on
  `csv-upload` means a load or start job is already running.
- **The presigned PUT is a credential.** `putCsv` sends no auth header and no
  base URL, streams the body with an explicit `Content-Length`, and never
  retries (a stream cannot be replayed). Never log the URL, the upload token
  or the auth header. Recipient phone numbers go only in the CSV body.
- **Contact load and start are background jobs.** `csvUpload` and `start`
  return at once. Poll `getLoadJob` and `getStartJob` until `DONE` or
  `FAILED`, and read the skip counts from the load result.

## Known debt

- **Sending numbers are hand-maintained.** The S2W API cannot list a
  subaccount's numbers, so `sendingNumbers.config.ts` is copied from the S2W
  dashboard. A number added or released there must be changed here by hand.
- **Template campaign ids are not configured yet.** They wait on an open
  question to Scale to Win.
- **The drift probe is skipped until `DRIFT_PROBE_S2W_CAMPAIGN_ID` is set.**
  S2W has no sandbox, so the probe reads one template campaign in prod.
