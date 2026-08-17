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
- `WebsitesModule` has a non-trivial constructor that wires `PurchaseService` for the domain purchase flow — uncommon for a Nest module class; if you're adding logic here, prefer pushing it into a service.
- **`assertReadyToPublish` gates the status the site will HAVE, not the publish transition.** `PUT /websites/mine` validates `REQUIRED_PUBLISH_FIELDS` whenever `body.status ?? currentStatus` is `published`, so an edit that omits `status` on a live site is validated too. Gating on `body.status === published` alone let a body carrying `about: { bio: '' }` empty a required field on a published site (lodash `merge` overwrites with an explicit empty string), leaving it live with content that would fail this same check on republish — and silently disqualifying the candidate from 10DLC submission.

## Gotchas

- **Vercel registrar buys are asynchronous orders.** `buySingleDomain` 2xx means "order accepted", not "domain bought" — an order can still fail on Vercel's side (completion is typically ~13s). `completeDomainRegistration` polls `getRegistrarOrder` and only stamps `submitted`/`registrantVerifiedAt` once the order reports completed; the real orderId is persisted as `Domain.operationId`. Never treat the buy response alone as proof of registration.
- `forwardRef(() => CampaignsModule)` — circular with campaigns. Keep new edges to the campaigns side as forwardRefs to avoid breaking module init.
- `WebsiteView` uses a localStorage-issued visitor UUID; treat it as advisory, not authoritative analytics.
- Public-facing endpoints use `@PublicAccess()` and `@UseCampaign()` together — don't drop one when refactoring or you'll either expose admin data or 401 the public site.
- Contact form submissions are write-only from the public site; the admin-side read goes through a separate authenticated endpoint with `GetWebsiteContactsSchema`.
