# `src/vendors/`

Thin wrappers around third-party SDKs. Each subdirectory is a Nest module that owns the auth + retry + error-mapping for one vendor.

- `aws/` — S3, SSM, Route53 (etc.)
- `braintrust/` — LLM eval logging
- `callhub/` — robocall / voice broadcast: caller-ID number rental, media upload, phonebooks, bulk contact import, account DNC scrub
- `clerk/` — Clerk auth (M2M token verification lives in `SessionGuard`)
- `contentful/` — CMS content
- `ecanvasserIntegration/` — Ecanvasser CRM
- `forwardEmail/` — domain email forwarding
- `google/` — Maps, OAuth, Sheets
- `peerly/` — SMS sending
- `segment/` — analytics
- `slack/` — bot + alerts
- `stripe/` — billing
- `vercel/` — site deploys

Convention: vendor calls happen in services here. Application code injects the vendor service rather than calling the SDK directly. Wrap external calls in try/catch and throw `BadGatewayException` on failure.
