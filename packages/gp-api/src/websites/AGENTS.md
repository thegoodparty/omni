# Websites Module

Backend for campaign websites — public-facing static sites generated per campaign with optional custom domains, contact-form intake, and view tracking. Vercel hosts the rendered output; this module owns the database side and the domain-registration flow.

**Two registrars, split by concern.** Route 53 answers availability checks and name suggestions only. Vercel's registrar does pricing, the actual registration, renewal, project hosting, and transfer auth codes. A domain is therefore _searched_ through Route 53 but _registered_ through Vercel — treat any doc or comment describing registration, renewal, or DNS as a Route 53 operation as out of date.

A longer narrative lives in `README.md` (data model, endpoint catalogue). This file is the navigation pointer.

## Key files

| Path                                  | Purpose                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `websites.module.ts`                  | Wires controllers + services; depends on `VercelModule`, `AwsModule`, `PaymentsModule`, `ForwardEmailModule` |
| `controllers/websites.controller.ts`  | CRUD on `Website`, contact form submission, view tracking                                                    |
| `controllers/domains.controller.ts`   | Custom domain registration, status polling, suggestions                                                      |
| `services/websites.service.ts`        | Website CRUD, default content generation, publish/unpublish                                                  |
| `services/domains.service.ts`         | Domain orchestration: Route 53 for availability/suggestions, Vercel for price/purchase/hosting               |
| `services/websiteContacts.service.ts` | Inbound contact form persistence                                                                             |
| `services/websiteViews.service.ts`    | UUID-keyed visitor view counter                                                                              |
| `schemas/`                            | Zod schemas for create/update website, contact form, list filters                                            |
| `domains.types.ts`                    | `DomainRegistrationStatus`, payload shapes                                                                   |
| `README.md`                           | DB models + endpoint reference                                                                               |

## Patterns

- **Domain registration is a multi-step async flow**: Stripe charge, then a Vercel registrar order, then polling that order to completion, then attaching the domain to the Vercel project. The order id is stored as `Domain.operationId`. State lives on the `Domain` row; never short-circuit by querying a registrar ad hoc.
- **Auto-renew is never turned off.** Purchases go out with `autoRenew: true` and nothing in the module disables it — a domain lapsing mid-campaign is the worse failure. `configureDomain` does not touch renewal despite older comments saying so; it only runs Vercel's domain verification and flips status to `registered`.
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
- **Do not poll `GET /domains/status` for `registered` after a purchase — it deadlocks.** The purchase flow's own polling stops at `submitted`, and `configureDomain` is the only code path that writes `registered`, so the transition a poller is waiting for is the one that only fires when it stops waiting and calls `POST /domains/configure`. `submitted` is the signal to configure. (`updateDomainStatusToRegistered` looks like a second writer but is dead code — nothing calls it.) `DomainStatus.active` is never written at all, despite being accepted in status allowlists and mapping to `SUCCESSFUL`.
- `forwardRef(() => CampaignsModule)` — circular with campaigns. Keep new edges to the campaigns side as forwardRefs to avoid breaking module init.
- `WebsiteView` uses a localStorage-issued visitor UUID; treat it as advisory, not authoritative analytics.
- Public-facing endpoints use `@PublicAccess()` and `@UseCampaign()` together — don't drop one when refactoring or you'll either expose admin data or 401 the public site.
- Contact form submissions are write-only from the public site; the admin-side read goes through a separate authenticated endpoint with `GetWebsiteContactsSchema`.
