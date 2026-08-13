# SMS delivery for sales-sent magic links — implementation plan

Companion to `docs/adr/0006-sms-magic-link-delivery.md`, which carries the decision and the rejected alternatives. This document is the build plan: schema, endpoints, provider integration, and rollout order.

**Goal.** A sales rep on a call with a lead clicks "Text link" on the HubSpot contact card, and the lead receives a single-segment SMS containing a short link that signs them into onboarding.

## Critical path

A2P 10DLC registration is already complete, so there is no external gate on this work. The only hard prerequisite is Phase 1: **the current link cannot be texted at all**, so short links come before any SMS code.

### Why, in numbers

Clerk signs sign-in tokens with RS256 over a 2048-bit key (read from the instance JWKS), which fixes the signature at 342 base64url characters. A representative token:

| Part | Characters |
| --- | --- |
| JWT header (with `kid`) | 90 |
| JWT payload (`iss`, `sid`, `sub`, `st`, `exp`, `iat`, `nbf`) | 254 |
| RS256 signature | 342 |
| **Token total** | **688** |
| `https://app.goodparty.org/serve/welcome?__clerk_ticket=…` | **743** |

At 153 characters per concatenated segment that is **5 segments for the bare URL and 6 once you add a compliant body** — before considering that a 700-character opaque query string is exactly what carrier link filters flag. Shortening is not an optimization here, it is the feature.

To reproduce the measurement, decode `CLERK_PUBLISHABLE_KEY` to get the frontend API host and read `/.well-known/jwks.json`; the modulus length gives the signature length directly.

## What already exists

| Piece | Where |
| --- | --- |
| Mint sign-in token + return URL | `src/admin/electedOffice/adminElectedOffice.controller.ts`, `src/admin/campaigns/adminCampaignMagicLink.controller.ts` |
| Provisioning + guardrails | `UsersService.provisionMagicLinkUser` (`src/users/services/users.service.ts`) |
| Lifecycle source of truth | `src/magicLink/magicLink.service.ts`, `prisma/schema/magicLink.prisma` |
| Status mirroring to HubSpot | `CrmUsersService.syncMagicLinkContactProperties` |
| Rep-facing UI | `omni/hubspot/serve-magic-link/`, `omni/hubspot/win-magic-link/` |

Both admin endpoints are already `AdminOrM2MGuard`-protected and callable with a Clerk M2M token, which is how the HubSpot functions reach them. No auth work is needed.

## Phase 1 — short links

The texted URL must be short and must live on a GoodParty domain. Target shape:

```
https://app.goodparty.org/s/K7m2Qx4bNp3v
```

That is 40 characters, which yields a 127-character message — comfortably one segment with ~30 characters of headroom.

### Schema

Add a slug to the existing `MagicLink` model rather than introducing a second table. `MagicLink` is already one row per user, upserted on resend, so the slug rotates with the link it points at and the old slug dies automatically. A separate table would only buy an audit trail of dead slugs, which we do not need.

```prisma
// prisma/schema/magicLink.prisma
model MagicLink {
  // ...existing fields...

  // Short-link slug texted to the lead. Rotates on resend along with `url`.
  // A bearer credential, same as `url` — never mirrored to HubSpot.
  slug String? @unique
}
```

Generate the slug with `nanoid(12)` (72 bits over nanoid's URL-safe alphabet), matching the existing precedent for an opaque security token — `nanoid(48)` backs the password-reset token in `src/authentication/authentication.service.ts`. Never a counter or a hash of anything guessable. Twelve rather than a tighter eight because the segment budget makes the extra characters free and the slug is the whole credential.

### Resolution

Two small pieces:

1. **gp-api** — `GET /v1/magic-link/resolve/:slug`, `@PublicAccess()`, returns `{ url }` for a slug whose link is still in `sent` status and `{ url: null, status }` otherwise. Reuse `computeMagicLinkStatus` so a redeemed or expired link yields nothing, exactly as the existing `GET /admin/elected-office/magic-link` already behaves. Rate-limit it — this is the one public endpoint that trades a short token for a session credential.
2. **gp-webapp** — `app/s/[slug]/route.ts`, a route handler that calls the above server-side and returns a 307 to the resolved URL, or redirects to `/login?magicLinkExpired=1` when there is no usable URL.

Because `serverRequest` authenticates as the end user and simply omits the header when no session exists, the gp-api endpoint has to be public. The new route also needs adding to the `isPublicRoute` allowlist in `gp-webapp/middleware.ts`, or Clerk middleware bounces it to `/login` before the handler runs.

Two properties fall out of this design and are worth stating so nobody "simplifies" them away:

- **`/s/<slug>` needs no serve-vs-win branching.** `MagicLink.url` already stores the fully-formed destination, including the right welcome path for the link's `kind`. The route resolves and forwards; it never reasons about the flow.
- **The redirect must not consume the Clerk ticket.** It only forwards to `/serve/welcome?__clerk_ticket=…`, where the existing button gate performs the redemption. That gate is what stops a scanner from burning a one-time token, and it matters for SMS too — carrier-side and security-suite link scanning both exist.

### TTL stays at seven days

`provisionMagicLinkUser` accepts `expiresInSeconds` and no caller passes it, so links live seven days. SMS keeps that: one expiry for both channels means one lifecycle to reason about, and the sales flow does not always end with the lead opening the link during the call.

## Phase 2 — Sinch integration

New vendor module at `src/vendors/sinch/`, following the layout `src/vendors/peerly/` already establishes (`config/`, `services/`, a module file).

### Environment

```
SINCH_SERVICE_PLAN_ID=
SINCH_API_TOKEN=
SINCH_FROM_NUMBER=          # E.164, the 10DLC-registered number
SINCH_REGION=us             # us | eu | au | br | ca
SMS_INTERCEPT_PHONE=        # non-prod: redirect all sends here
```

`SMS_INTERCEPT_PHONE` mirrors the existing `MAILGUN_INTERCEPT_EMAIL` convention so dev and QA cannot text real leads. Follow the Peerly config pattern of throwing at class-load time when a required variable is missing in production.

### Send

A single POST, bearer auth:

```
POST https://{region}.sms.api.sinch.com/xms/v1/{service_plan_id}/batches
Authorization: Bearer {SINCH_API_TOKEN}

{ "from": "+1...", "to": ["+1..."], "body": "..." }
```

`SmsService` sits next to `EmailService` in the same role: one `sendSms({ to, body })` method, E.164 normalization via `libphonenumber-js` (already a dependency, used in `peerlyIdentity.service.ts`), and retry on 5xx and 429 only. Log the returned batch id — with Sinch's thinner error vocabulary compared to Twilio, that id is the thread to pull when a rep reports a text that never arrived.

### Message body

Keep it under 160 GSM-7 characters so it stays one segment. Brand name, purpose, link, opt-out:

```
GoodParty: your sign-in link to finish setting up your account:
https://app.goodparty.org/s/K7m2Qx4bNp3v Reply STOP to opt out.
```

That is 127 characters — one segment with room to spare.

Avoid emoji and non-GSM characters, and be specific about which: a straight ASCII apostrophe is GSM-7, but the curly `’` that editors and copywriters produce is not. One of those silently switches the whole message to UCS-2 and cuts the budget from 160 to 70, splitting a message that tested fine into two segments. Assert the encoding in a test rather than trusting review.

## Phase 3 — consent, opt-out, and endpoints

### Consent

Consent is a property of the person, not of a link, so it belongs on `User`:

```prisma
// prisma/schema/user.prisma
model User {
  // ...existing fields...
  smsConsentAt     DateTime? @map("sms_consent_at")
  smsConsentSource String?   @map("sms_consent_source")  // e.g. "hubspot_card:<repEmail>"
  smsOptedOutAt    DateTime? @map("sms_opted_out_at")
}
```

The rep ticks a confirmation on the card ("the lead agreed on this call to receive a text"), and the source records who claimed it. Refuse to send when `smsOptedOutAt` is set or `smsConsentAt` is null — as a hard block in the service, not a UI-only check.

Delivery metadata goes on `MagicLink` alongside the existing timestamps: `phone`, `smsSentAt`, `smsBatchId`.

### Endpoints

Both the serve and win controllers need this, so put the shared logic in a `MagicLinkDeliveryService` under `src/magicLink/`. Two call sites is enough to justify the extraction; the alternative is a verbatim copy in each controller.

**1. Extend the existing mint endpoints.** `CreateMagicLinkDto` gains optional `phone` and `smsConsent`. When both are present, mint the slug and text it as part of the same call. Keep the SMS send best-effort and non-fatal, exactly as the HubSpot function already treats the email send: return `{ url, userId, prefill, smsSent, smsError? }` so the rep gets a copyable link even when the text fails.

**2. Add a resend.** `POST /v1/admin/elected-office/magic-link/sms` with `{ email, phone, smsConsent }` texts the *current* active link without minting a new one — the SMS counterpart to the existing `GET` fetch action. This covers the common case where the rep emailed the link, the lead did not get it, and they want to text it while still on the phone.

### Opt-out

Sinch honors STOP at the platform level and will stop delivering, but we should record it so the block is enforced before we ever call the API and so the data is auditable. Add an inbound webhook receiving Sinch's MO callbacks that sets `smsOptedOutAt` on STOP and clears it on START.

Model it on the Stripe handler (`src/payments/payments.controller.ts`) — `@PublicAccess()` with signature verification, not an unauthenticated open endpoint. Cross-check Sinch's callback authentication options during implementation; if it offers no signature, use an unguessable callback path plus an allowlist and note the compromise.

## Phase 4 — HubSpot card

Small changes to both `omni/hubspot/serve-magic-link/` and `omni/hubspot/win-magic-link/`:

- Add `phone` and `mobilephone` to `CONTACT_PROPERTIES`, preferring `mobilephone` when both are set.
- Add a "Text link" button next to the existing send, with a required consent checkbox. Disable it when the contact has no phone.
- Pass `action: 'sms'` through `hubspot.serverless()` and forward `phone` and `smsConsent` to gp-api.
- Surface `smsSent` and `smsError` the same way `sent` and `sendError` are handled today.

No `app-hsmeta.json` change is needed. The function still only talks to gp-api, which is already in `permittedUrls.fetch` — the Sinch call happens server-side in gp-api, so Sinch never needs allowlisting in HubSpot.

## Testing

Slug generation and message-body rendering are pure and belong in directly instantiated unit tests. The lifecycle behavior below depends on Prisma and the real request pipeline, so it earns `useTestService()` — see `docs/writing-tests.md`. Cover the cases that will actually bite:

- A send is refused when consent is absent or the user has opted out.
- `resolve/:slug` returns 404 for a redeemed, expired, or unknown slug.
- Resolving a slug does **not** mark the link redeemed.
- A resend rotates the slug and invalidates the previous one.
- Sinch failure leaves the link usable and returns `smsSent: false` rather than failing the request.
- The rendered message body stays within one GSM-7 segment.

## Open questions

- Which registered number and campaign do we send from, and the same one for serve and win? One number is simpler and concentrates sending reputation.
- Should the short link also replace the long URL in the **email**? Email has no length problem, so this is purely about one code path and tidier messages — but it means editing the HubSpot-authored template. Easy to adopt later; the slug exists either way.
