# Campaign Plan Shares Module

Public sharing of campaign-plan PDFs. The webapp renders the PDF client-side
and uploads it here; recipients open an unauthenticated link that streams the
bytes back. **There is intentionally no database model** — the S3 key
structure `{campaignId}/{uuid}.pdf` in the `campaign-plan-shares-{env}`
bucket is the entire data model (existence = validity, delete = revoke,
LastModified = createdAt). The service is a plain `@Injectable`, not
PrismaBase.

## Routes

| Method | Path                                             | Auth                       |
| ------ | ------------------------------------------------ | -------------------------- |
| POST   | `/v1/campaigns/mine/plan-pdf-share`              | session + `@UseCampaign()` |
| GET    | `/v1/campaign-plan-shares/:campaignId/:fileName` | `@PublicAccess()`          |

POST accepts a multipart `file` part (PDF, 15MB cap, magic-byte checked),
enforces `MAX_SHARES_PER_CAMPAIGN` (100) via `listKeys` count, and returns
`{ url }`. GET validates both params against strict regexes before any S3
call and streams the PDF inline, `Cache-Control: private, no-store` (the
uuid is a capability token; no-store makes object deletion an effective
revocation).

## Things that look like bugs but aren't

- **503 in qa/prod is by design.** `CAMPAIGN_PLAN_SHARES_BUCKET` and
  `API_PUBLIC_ROOT_URL` are only set for dev/preview (conditional spread in
  `deploy/index.ts`) — their absence IS the rollout gate. The service reads
  them per-call so missing vars 503 cleanly instead of crashing boot.
  `API_PUBLIC_ROOT_URL` is deliberately distinct from the Secrets-Manager
  `PUBLIC_API_URL` (speech) so the gate stays Pulumi-managed.
- **Bad links return HTML, not JSON.** The public GET 404s with a small
  branded HTML page because the consumer is a human clicking an email link.
- **Rate limiting is an in-memory per-IP token bucket**
  (`guards/campaignPlanSharesRateLimit.guard.ts`) — a deliberate WET copy of
  the briefings PDF guard (same threat model: UUID enumeration). It doesn't
  share state across instances; edge/WAF limiting is the tracked follow-up,
  as is deduplicating the two guards.
- **No revocation endpoint yet.** Revoke by deleting the S3 object. Every
  webapp session-first-share uploads a new object; sha-based dedupe is a
  documented future improvement.

## Infra

Bucket component: `deploy/components/campaign-plan-shares-bucket.ts`
(private, SSE, versioned, dev-only; preview reuses the dev bucket). The ECS
task role already has `s3:*` so no IAM wiring. qa/prod enablement = extend
the env gate in `deploy/index.ts` and let Pulumi create the buckets.
