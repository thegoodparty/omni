# Websites Module

Backend for campaign websites — public-facing static sites generated per campaign with optional custom domains, contact-form intake, and view tracking. Vercel hosts the rendered output; this module owns the database side and the domain-registration flow through Route 53.

A longer narrative lives in `README.md` (data model, endpoint catalogue). This file is the navigation pointer.

## Key files

| Path                                  | Purpose                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `websites.module.ts`                  | Wires controllers + services; depends on `VercelModule`, `AwsModule`, `PaymentsModule`, `ForwardEmailModule` |
| `controllers/websites.controller.ts`  | CRUD on `Website`, contact form submission, view tracking                                                    |
| `controllers/domains.controller.ts`   | Custom domain registration, status polling, suggestions                                                      |
| `services/websites.service.ts`        | Website CRUD, default content generation, publish/unpublish                                                  |
| `services/domains.service.ts`         | Route 53 + Vercel domain orchestration                                                                       |
| `services/websiteContacts.service.ts` | Inbound contact form persistence                                                                             |
| `services/websiteViews.service.ts`    | UUID-keyed visitor view counter                                                                              |
| `schemas/`                            | Zod schemas for create/update website, contact form, list filters                                            |
| `domains.types.ts`                    | `DomainRegistrationStatus`, payload shapes                                                                   |
| `README.md`                           | DB models + endpoint reference                                                                               |

## Patterns

- **Domain registration is a multi-step async flow** (Stripe charge → Route 53 op → polling → Vercel attach). State lives on the `Domain` row; never short-circuit by reading from Route 53 ad hoc.
- **Forward Email is the inbound mail provider** for custom-domain campaign emails. New email-related domain features go through `ForwardEmailModule`, not direct DNS edits.
- Website creation auto-seeds content from the campaign's positions and user data — see `WebsitesService.createForCampaign`.
- **The site's headline and page `<title>` are not stored.** candidate-sites derives them from the campaign owner's name on every render (`getCandidateHeadline`), so a name correction reaches the live site immediately and cannot drift. `content.main` holds only `tagline` and `image`. Publishing therefore requires the owner to have a name — see `assertReadyToPublish`.
- **`Website.legacyTitleOverride` is a temporary exception to that**, not a feature: 47 published Pro campaigns with a race still ahead keep the headline they had authored before headlines became derived. Nothing writes it — it was populated once by `20260817090000_strip_website_main_title` from an explicit ID list, and adding a write path would reintroduce the stale-name divergence. Only the hero and `<title>` read it; the footer disclaimer and the SMS privacy/terms copy always use the derived name. Slated for removal after 2026-11-03.
- `WebsitesModule` has a non-trivial constructor that wires `PurchaseService` for the domain purchase flow — uncommon for a Nest module class; if you're adding logic here, prefer pushing it into a service.
- **`assertReadyToPublish` gates the status the site will HAVE, not the publish transition.** `PUT /websites/mine` validates `REQUIRED_PUBLISH_FIELDS` whenever `body.status ?? currentStatus` is `published`, so an edit that omits `status` on a live site is validated too. Gating on `body.status === published` alone let a body carrying `about: { bio: '' }` empty a required field on a published site (lodash `merge` overwrites with an explicit empty string), leaving it live with content that would fail this same check on republish — and silently disqualifying the candidate from 10DLC submission.

## Gotchas

- **`searchDomainsForCampaign` returns a shortlist, not an inventory.** It
  stops once enough candidates qualify and hard-stops on a wall-clock budget
  under the broker's upstream timeout (constants in `domains.service.ts`) —
  an exhaustive check under Route53 throttling backoff took ~6 minutes, timed
  out every agent call, and resume-looped nine compliance runs to death
  (2026-09-20..22). Budget exhausted with zero found is a 502 (retryable),
  never an empty list.
- **The budget must never discard a verdict we already hold.** Checks run in
  batches, and each check is raced against the remaining budget _individually_.
  Racing the batch as one unit meant a single candidate still in registrar
  backoff threw away every sibling result the batch had already settled — four
  available, priced domains became "nothing could be checked" and a 502
  (2026-09-30, campaign 327394). Only checks still in flight when the budget
  runs out are lost, and those count as unchecked.
- **The candidate cap applies after the TLD fan-out, not before it.**
  `MAX_PATTERN_CANDIDATES` bounds SLDs, and the fan-out then multiplies each
  by `SUPPORTED_TLDS`, so the nominal 50 was really up to 300 Route53 calls
  per search. `MAX_AVAILABILITY_CHECKS` bounds the number that actually
  reaches the registrar; raising one without the other silently multiplies
  quota spend on an account-wide bucket shared with the purchase path.
- **A throttled availability check is not a taken domain.** Route53
  throttling surfaces as a 503 (`AwsService.handleAwsError`) and returns the
  `UNCHECKED` sentinel, so it is counted rather than folded into "unavailable".
  An empty candidate list is therefore authoritative: it is only returned when
  every candidate got a real verdict. If anything went unchecked — throttled,
  truncated at `MAX_AVAILABILITY_CHECKS`, or cut off by the time budget — and
  nothing else qualified, the search raises a 502 instead. Never return an
  empty list the caller could read as "the namespace is taken".
- **Vercel registrar buys are asynchronous orders.** `buySingleDomain` 2xx means "order accepted", not "domain bought" — an order can still fail on Vercel's side (completion is typically ~13s). `completeDomainRegistration` polls `getRegistrarOrder` and only stamps `submitted`/`registrantVerifiedAt` once the order reports completed; the real orderId is persisted as `Domain.operationId`. Never treat the buy response alone as proof of registration.
- **The registrar bills GoodParty, not the candidate, on the agent path.**
  `purchaseDomainForCampaign` buys with `skipPaymentVerification`, so the
  $1.99-and-up charge lands on GoodParty's Vercel team account. Vercel can
  accept the order and then fail it with `payment-failed`, which is that
  account being refused — nothing about the request, and nothing gp-api can
  see or fix. It is logged as its own event (`REGISTRAR_CHARGE_FAILED_EVENT`)
  so it is legible as a billing fault rather than as a route that errored, and
  `domain-registrar-charge-failed` pages when it happens more than twice in
  ten minutes. It is **not** treated as permanent: on 2026-10-07 three orders
  for one campaign failed in 45 seconds and the next attempt 11 minutes later
  registered normally, so the caller still gets the retryable bad gateway and
  should retry.
- **The checkout flow takes the money before it registers.** Order is
  Stripe charge -> registrar buy, so a registration that fails leaves a
  candidate who has paid with no domain, and refunds here are human
  (`src/payments/AGENTS.md`). `processDomainRegistration` logs
  `DomainRegistrationFailedAfterPayment` with the payment to refund and tells
  the candidate not to pay again; `domain-registration-failed-after-payment`
  pages on it. Reversing the order is the real fix and has not been done.
- `forwardRef(() => CampaignsModule)` — circular with campaigns. Keep new edges to the campaigns side as forwardRefs to avoid breaking module init.
- `WebsiteView` uses a localStorage-issued visitor UUID; treat it as advisory, not authoritative analytics. The handler's 60s dedupe is keyed on `(websiteId, visitorId)`, so `visitorId` is pinned to a UUID and the route is metered by `WebsiteTrackViewRateLimitGuard` (60 per 60s per IP) — a fresh id per request would otherwise write a fresh row every time. Draft sites record no views.
- Public-facing endpoints use `@PublicAccess()` and `@UseCampaign()` together — don't drop one when refactoring or you'll either expose admin data or 401 the public site.
- Contact form submissions are write-only from the public site; the admin-side read goes through a separate authenticated endpoint with `GetWebsiteContactsSchema`.
- `POST :vanityPath/contact-form` is metered by `WebsiteContactFormRateLimitGuard` (5 per 60s per IP, in-memory and therefore per replica), and `name`/`message` are length-capped in `ContactForm.schema.ts`. Candidate sites call the route through their own Next route handler, which forwards the visitor's address as `X-Forwarded-For` (`helpers/clientAddress.ts` in `packages/candidate-sites`), so the per-IP number is per visitor. Dropping that forwarding would silently collapse every visitor of every site onto the function's egress address.
