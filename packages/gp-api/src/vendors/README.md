# `src/vendors/`

Thin wrappers around third-party SDKs. Each subdirectory is a Nest module that owns the auth + retry + error-mapping for one vendor.

- `aws/` — S3, SSM, Route53 (etc.)
- `braintrust/` — LLM eval logging
- `callhub/` — robocall / voice broadcast: caller-ID number rental, media upload, phonebooks, bulk contact import, account DNC scrub, campaign status + post-run report/CDR reads
- `clerk/` — Clerk auth (M2M token verification lives in `SessionGuard`) + team invitations (`ClerkInvitationsService`)
- `contentful/` — CMS content
- `forwardEmail/` — domain email forwarding
- `google/` — Maps, OAuth, Sheets
- `peerly/` — SMS sending
- `segment/` — analytics
- `slack/` — bot + alerts
- `stripe/` — billing
- `vercel/` — site deploys

Convention: vendor calls happen in services here. Application code injects the vendor service rather than calling the SDK directly. Wrap external calls in try/catch and throw `BadGatewayException` on failure.

Vendor response schemas (`<vendor>/schemas/`, parsed through `shared/parseVendorResponse.ts`) require only the fields gp-api reads. Every other field is nullish with its honest type, so a vendor omitting or nulling a field nothing uses does not fire the schema-mismatch alert, while a wrong type on a field we read still does. Check a new schema against the vendor's rendered docs and against what callers actually read. The vendor mock builds its bodies from the same schemas, so make it emit the absent shapes too.

`vendorDriftProbe.service.ts` (with `vendorDriftProbe.schemas.ts`) is the nightly live-vendor drift probe: read-only calls through the real clients, parsed with the shared schemas via `parseVendorResponse(..., { mode: 'enforce' })`, Slack only on failure. A new vendor read endpoint that prod traffic rarely hits belongs in its `buildProbes()` list. Never add a write endpoint, and never `retrieve_cv` (Peerly limits it to 1 call a minute). See `docs/scheduled-jobs.md`.
