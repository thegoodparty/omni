# 0006 — SMS delivery for sales-sent magic links

Status: proposed

## Context

Sales reps send onboarding magic links from a HubSpot App Card on the contact record. Today the HubSpot serverless function emails the link via HubSpot's Single-Send transactional API. Reps want to text it instead, because they are usually on a call with the lead when they send it and SMS is read immediately.

Two things make this more than "call an SMS API":

1. **The link is far too long to text.** Clerk signs sign-in tokens with RS256 over a 2048-bit key (confirmed from the instance JWKS), so the signature alone is 342 base64url characters and a realistic token is ~688. The full `${APP_ROOT}/serve/welcome?__clerk_ticket=<jwt>` measures **~743 characters — five SMS segments before any message text, six with a compliant body.** Cost aside, a 700-character opaque query string is precisely the shape carrier spam filters treat as phishing. Public shorteners (bit.ly and friends) are not an option: carriers reject campaigns that use them and filter messages that contain them.
2. **Consent has to be captured and honored.** Nothing in the schema records SMS consent today; `User.phone` is an unverified optional string.

A2P 10DLC registration is **already complete** for GoodParty.org, so it is not a constraint on this work. It does still shape the message body: keep the brand name and STOP language in every send, and keep the link on a `goodparty.org` domain matching the registered brand.

Where the send lives was the main open question:

1. In the HubSpot serverless functions, mirroring how email works today
2. In gp-api, alongside `EmailService`
3. HubSpot's native SMS product (Marketing Hub SMS add-on)

## Decision

**Send from gp-api via Sinch.** Mint a short link in gp-api, resolve it through a `gp-webapp` route so the texted URL is `https://app.goodparty.org/s/<slug>` (40 characters, a 127-character message, one segment), and send through the Sinch Conversation API's SMS channel: `POST https://{region}.conversation.api.sinch.com/v1/projects/{project_id}/messages:send`.

gp-api over HubSpot because the serve and win App Cards are two separate HubSpot projects — building it there means implementing SMS twice and duplicating provider credentials into both. The short link needs database access that only gp-api has, and consent capture plus STOP suppression need to be centralized to be auditable. The HubSpot functions stay thin pass-throughs, which suits their 10-second sandbox with no external dependencies.

Sinch over Twilio because we already have a Sinch relationship. Technically the two are close; Twilio's advantage is better-documented carrier error codes, which we give up and compensate for with explicit delivery-status logging.

HubSpot native SMS is rejected outright: templating the link into a workflow requires mirroring it onto a contact property, which contradicts the existing decision that the redemption URL never lands in the CRM.

### Conversation API, not the standalone SMS API

Sinch's standalone SMS (XMS) API is end-of-sale, so we use the Conversation API even though this is a one-way, SMS-only use case that the simpler API would have covered. Three choices follow from it:

- **OAuth2 rather than Basic auth.** The Conversation API accepts HTTP Basic with the project access key, but Sinch scopes that to testing. `SinchTokenService` exchanges the key for a one-hour bearer token, caching it and collapsing concurrent callers into a single mint. A 401 on send invalidates the cache and retries once, which covers a token revoked ahead of its advertised TTL.
- **DISPATCH processing mode.** The alternative, CONVERSATION mode, has Sinch create and store a contact record per recipient. We are sending transactional one-offs and have no use for conversation threading, so dispatch keeps lead phone numbers from accumulating in a second system. It also means sends must address the recipient by channel identity rather than by a Sinch-side contact id.
- **`SMS_MAX_NUMBER_OF_MESSAGE_PARTS: 1`.** The one-segment budget is already asserted when composing the body; setting it as a channel property makes Sinch reject an overflowing message instead of silently billing two segments and inviting carrier filtering. A copy edit that busts the budget fails loudly, which is the intent.

One thing gets easier: Conversation API webhook HMAC signing is self-service. The secret is set when registering the webhook, so verifying inbound STOP callbacks no longer waits on an account manager enabling signature authentication.

## Consequences

- Delivery is split for one release: gp-api sends SMS while HubSpot still sends email. Consolidating email into gp-api is a follow-up, deferred because it means rebuilding the HubSpot-authored email template.
- The short link is a bearer credential, same as the URL it replaces. It gets the same treatment: stored only in gp-db, never mirrored to HubSpot.
- The short link only redirects; it does not consume the Clerk ticket. The button gate on `/serve/welcome` stays, so a link scanner cannot burn the ticket.
- `User` gains SMS consent and opt-out columns, making consent a first-class, queryable fact rather than something implied by a rep's memory.
- We keep `User.smsOptedOutAt` as the source of truth for suppression rather than the Conversation API's Consents API, because consent gating must hold even when Sinch is unreachable.

Provisioning this needs a human in the Sinch dashboard: note the project ID, create an access key under Settings, create a Conversation API app in DISPATCH mode, attach the SMS channel to the 10DLC number, then register the callback with a secret we choose:

```bash
curl -X POST 'https://us.conversation.api.sinch.com/v1/projects/{PROJECT_ID}/webhooks' \
  -H 'Authorization: Bearer {ACCESS_TOKEN}' -H 'Content-Type: application/json' \
  -d '{"app_id":"{APP_ID}","target":"https://<gp-api>/v1/sinch/inbound",
       "target_type":"HTTP","triggers":["MESSAGE_INBOUND"],"secret":"{SINCH_WEBHOOK_SECRET}"}'
```

Only `MESSAGE_INBOUND` is needed today; `MESSAGE_DELIVERY` is the hook to add if we later want delivery receipts against `MagicLink.smsMessageId`.

See `docs/sms-magic-link-implementation-plan.md` for schema, endpoints, and rollout. Note that its Sinch section predates this switch and still describes the XMS endpoint.
