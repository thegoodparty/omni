# app/dashboard/pro-upgrade/

The **pre-payment Pro upgrade wizard** — a single guided flow that takes a candidate
from "see the Pro pitch" to "paid + 10DLC compliance data submitted" in one session.
Shipped as Phase 3 (+ Phase 4 banner) of the Pro Upgrade → 10DLC Compliance redesign
(epic ENG-7508).

## Why this exists (the core behavioral change)

Before this flow, a candidate **paid first** (`/dashboard/pro-sign-up/*`) and was *then*
asked to assemble their EIN, filing details, and candidate profile in a separate
post-payment "Texting Compliance" card. Only ~0.86% of Pro candidates ever finished
10DLC compliance. This wizard collapses both experiences into **one pre-payment flow:
all compliance data is collected before the candidate pays.** Front-loading the data
collection into the purchase flow is the lever for fixing that funnel.

## Flag status — none. This is the default.

The flow originally shipped behind the `pro-upgrade3` Amplitude flag (superseding the
older `pro-upgrade1` data-card and the unflagged `pro-sign-up` payment flow). **Both
flags were retired in ENG-10474 (PR #258)** — the wizard is now the default for
everyone. `proUpgradeFlag.ts` was deleted; `proUpgrade3Flag.ts` was trimmed to just
`PRO_UPGRADE_ENTRY_PATH`. The legacy `/dashboard/pro-sign-up` and
`/dashboard/upgrade-to-pro` route trees and the `TextingComplianceAgentic` / legacy
`TextingCompliance` cards are gone. Do not reintroduce a flag gate here.

## The big idea: no server-side session, step derived from canonical state

There is **no `ProUpgradeSession` model** (tech doc v2). The wizard holds no
server-side progress. The current step is **derived purely from canonical state** —
`campaign.isPro`, the filing-status answer, EIN presence/sanity, TCR filing + PIN
completeness, and candidate-profile completeness — so a candidate who leaves and
returns lands on the right step and prefills from those tables.

`proUpgradeStep.ts` is the heart of this. `deriveProUpgradeStep(inputs)` is a **pure,
side-effect-free** router (keep it that way). First-incomplete-step-in-canonical-order
wins; already-Pro short-circuits to the post-payment `SUCCESS` surface.

## Route tree & key files

| File | Role |
|------|------|
| `page.tsx` → `components/ProUpgradeEntry.tsx` | Wizard **index**. Reads the canonical-state queries, calls `deriveProUpgradeStep`, `router.replace`s to the resume step. Shows a recoverable error (not a mis-route) if any query fails. |
| `layout.tsx` → `components/ProUpgradeWizard.tsx` | Wizard **shell**. Renders the chrome (Exit link, desktop vertical `Stepper`, the 640px card), provides `useProUpgradeWizard()` (`currentStep` / `goToStep` / `goToNextStep` / `goToPreviousStep`). |
| `proUpgradeStep.ts` | Pure step-derivation router + `PRO_UPGRADE_STEP`, `PRO_UPGRADE_STEP_ORDER`, `filingStatusFromDetails`. Single source for step identity and linear order. |
| `<step>/page.tsx` | One route per step; each renders its component from `components/`. |
| `components/*Step.tsx` | The screen for each step. |

### Steps, routes, and runtime order

Linear order: **value-prop → status → (filing-instructions dead-end | guidance) → ein
→ filing-details → candidate-profile → payment → success**.

| Step | Route | Component | Notes |
|------|-------|-----------|-------|
| Value prop / paywall | `value-prop` | `ValuePropStep` | "76% of candidates who use Pro win", Free-vs-Pro, "Get Pro". |
| Filing status branch | `status` | `FilingStatusStep` | "Have you already filed?" Writes `campaign.details.hasFiledForRace` (tri-state). |
| Filing instructions | `filing-instructions` | `FilingInstructionsStep` | **Dead-end** for not-yet-filed candidates (window/fee/requirements/office + "email this to me"). Only "Continue to dashboard". |
| Guidance interstitial | `guidance` | `GuidanceStep` | "what we'll gather" list. Presentational. |
| EIN | `ein` | `EinStep` | Front-end EIN collection + sanity check only (no IRS/backend verification — Peerly is the backstop). |
| Filing details | `filing-details` | `FilingDetailsStep` | Committee name, filing link, PIN contact methods. **Submits to the agentic endpoint** (see below). |
| Candidate profile | `candidate-profile` | `CandidateProfileStep` | Bio + policy priorities via `PUT /websites/mine`. |
| Payment | `payment` | `PaymentStep` | Embedded Stripe Custom Checkout (`ui_mode: 'custom'`) + order summary. No redirect. |
| Success | `success` | `SuccessStep` | Stripe `return_url` landing. Polls until `isPro` flips (see seam below). |

**Two steps are intentionally NOT in `PRO_UPGRADE_STEP_ORDER`** (`filing-instructions`,
`guidance`): they are off-order branches reached only by explicit nav from `status`,
never derived by the router. The shell's Back button targets `status` explicitly for
them (router.back would leave the wizard for a direct-URL arrival).

## Reuse, don't rebuild (the anti-drift rule)

The EIN input, election-filing form, candidate-profile form, and PIN entry already
existed under `app/dashboard/profile/texting-compliance/`. Wizard steps **wrap those
shared building blocks**, they do not reimplement validators/mappers/submit:

- EIN: `EinCheckInput` + `isValidEIN` + `checkEinSanity` (sanity check shared with committee-check).
- Filing details: `submitTcrCompliance` + `toRegistrationFormData` + `validateRegistrationForm` (same path the standalone election-filing form uses).
- Candidate profile: `useCandidateProfileForm` + `CandidateProfileFields` (extracted so the standalone profile page and the wizard step share one source).
- PIN: `useSubmitCvPin` + `PinForm` + `getPinChannels`.

If you change a validator or submit path, change it in the shared module — both chromes
consume it, so a fork drifts silently.

The standalone election-filing form (`election-filing/components/ElectionFiling.tsx`)
is a **third** consumer of the candidate-profile blocks (ENG-10857): when
`isCandidateProfileComplete(website)` is false it renders
`CandidateProfileFields` inline above the registration form and persists the
profile **before** calling `createAgentic` (which dispatches the compliance
agent inline for already-Pro campaigns — submitting first would burn a
`profile_incomplete` run). The hook's `handleSubmit` returns a boolean for
this chaining; gp-api independently gates dispatch on the same publishability
bar (see `packages/gp-api/src/campaigns/tcrCompliance/CLAUDE.md`). The
Pro-only dashboard entry into that form is `TextingSetupBanner`
(`app/dashboard/components/campaignManager/`, ENG-10858), shown when no TCR
record exists or the record is in `error`.

## Same endpoints as the agent (carried from Phase 1)

The wizard's forms call the **same gp-api endpoints the `compliance_setup` agent uses
through the broker** — there are no wizard-specific endpoints:

- `PUT /websites/mine` — candidate profile (bio/about, policy priorities).
- `POST /campaigns/tcr-compliance/agentic` — EIN + filing details submission (`createAgentic`).

The gp-api side of this is documented in
`packages/gp-api/src/campaigns/tcrCompliance/CLAUDE.md`. The key correctness contract:
**filing-details submission no longer launches the agent.** Because data is now
submitted before payment, dispatch was decoupled and moved to the
`checkout.session.completed` webhook. Nothing client-side enforces that — it's entirely
gp-api (ENG-10323). Don't add a client-side "kick off the agent" call.

## Post-payment surface lives elsewhere

After payment, `isPro` flips and the **post-payment compliance states** (PIN entry / in
review / approved / denied) render in `ProUpgrade3Compliance` on the **profile page**
(`app/dashboard/profile/texting-compliance/`), not in this dir. The wizard's `success`
step just lands the candidate and routes them to `/dashboard`.

## Phase 4 entry points live elsewhere too

The dashboard **entry banner** ("76% … win", `ProUpgradeBanner`) and the **locked-item
rerouting** are in `app/dashboard/components/campaignManager/` and the shared
`TasksList`, not here. They route into this wizard at `/dashboard/pro-upgrade`.

## Gotchas

- **Webhook-latency seam (the recurring bug class).** `isPro` flips only via the async
  `checkout.session.completed` webhook. The SSR-seeded `CAMPAIGN_QUERY_KEY` has a 5-min
  `staleTime`, so a just-paid candidate reads stale `isPro=false`. `SuccessStep`
  therefore **polls** the shared campaign query (refetch on mount, then every 2s until
  `isPro` flips, capped ~30s) so the banner/derivation pick up the flip without a manual
  refresh (ENG-10369). The `deriveProUpgradeStep` index still returns `PAYMENT` until
  `isPro` is true — don't bounce a just-paid candidate through the index; the success
  route owns the wait. A near-instant Continue click + a slow webhook can still flash
  the stale banner briefly — accepted async window. This seam caused a real double
  charge (ENG-10771): a just-paid candidate re-entering the wizard derived `PAYMENT`
  from stale `isPro=false`, and `PaymentStep` POSTs a checkout-session on mount —
  gp-api now 409s that (`ALREADY_PRO` / `CHECKOUT_ALREADY_COMPLETED` /
  `CHECKOUT_IN_PROGRESS`), so the backstop is server-side, but don't add more
  POST-on-mount paths that trust the cached campaign.
- **"Not filed" is a branch point, not progress** (ENG-10372/10355). A persisted
  `not-filed` answer must NOT count as progress and the router must NOT derive
  `filing-instructions` — otherwise a returning not-filed candidate is stranded on the
  dead-end on every "Get Pro" click. `has-filed` *does* count as progress (resume at
  EIN). See the `hasProgress` logic in `deriveProUpgradeStep`.
- **EIN presence is not enough.** Older surfaces persisted shape-valid placeholder EINs.
  `ProUpgradeEntry` derives `hasEin` via `checkEinSanity(...).valid`, not mere presence,
  so a bad EIN routes back to the EIN step instead of skipping it and failing later.
- **Don't derive from partial state.** `ProUpgradeEntry` waits for all three queries
  (campaign, website, TCR) and bails on any error — a failed fetch leaves data
  undefined, which would mis-derive a returning candidate back to value-prop.
- **Persist-then-navigate.** Steps that write state (`updateCampaign`, submits) only
  advance on success; a failed write shows an error snackbar and does NOT navigate, so
  there's never a stranded un-persisted answer.
- **Scroll reset** on step change is handled by the shell (dashboard convention).
- **Address autocomplete is a helper, not a gate.** Google Places
  (`types: ['address']`) doesn't index PO Boxes — which election filings
  commonly use — and misses some rural addresses, so a Google match cannot be
  required (that dead-end blocked real Pro upgrades). Both filing-address
  surfaces (this wizard and the standalone register form) render the shared
  `FilingAddressFields`: always-visible structured fields (street/PO Box,
  unit, city, state, ZIP) with autocomplete attached to the street input.
  Picking a suggestion auto-fills the components (via `extractPostalAddress`)
  and keeps the resolved place authoritative — submission rides the
  `placeId`/`formattedAddress` pair. Any hand edit to any field drops the
  place (a placeId submission is resolved from Google server-side, so the
  edit would otherwise be silently ignored) and the submission switches to
  `manualAddress` structured components, validated by `validateManualAddress`
  (the API requires exactly one source; see
  `packages/gp-api/src/campaigns/tcrCompliance/CLAUDE.md`).

## Debugging the flow

**"Purchase Error [POST] /payments/purchase/checkout-session: 400"** — the payment
step surfaces a *generic* error for every non-2xx, so read the response body/logs
before touching this dir. The common codes come from gp-api guards, not from wizard
bugs:

- 400 `NO_ACTIVE_CAMPAIGN` — none of the user's campaigns passes `isActiveCampaign`
  (past election, `didWin` set, or `primary_result='lost'`). The most common cause is
  the **PrimaryResultModal trap**: `app/dashboard/components/PrimaryResultModal.tsx`
  force-opens (no close/esc) when a campaign's BallotReady `primaryElectionDate` is
  already past, and independents with no primary answer "I did not win" → the fresh
  campaign is dead minutes after signup. Triage SQL + repair recipe:
  `packages/gp-api/src/payments/CLAUDE.md` § Debugging Pro billing issues.
- 409 `ALREADY_PRO` / `CHECKOUT_ALREADY_COMPLETED` / `CHECKOUT_IN_PROGRESS` — the
  double-charge guards (ENG-10771). Usually means the webhook seam above, not a bug.
  Known deferred UX gap: the wizard shows the same generic error for all of these.

**Manual test recipe (dev.goodparty.org)**: `/dashboard/pro-upgrade` → "Yes, I'm
already filed" → EIN must look *real* (`12-3456789` is rejected as a placeholder;
`84-3917265` passes) → filing details → candidate profile (500-char bio + ≥1 policy
priority) → Stripe test card `4242 4242 4242 4242`, any future expiry/CVC/ZIP —
**uncheck "Save my information"** or the Link phone prompt blocks "Complete upgrade".
Post-payment, dev has two more gates before texting: any numeric PIN validates on
dev, but the 10DLC "under review" state stays until the registration is APPROVED.

**E2E specs** live in `e2e-tests/tests/app/dashboard/pro-upgrade/` (entry,
happy-path, not-filed, step-resume, validation). Traps learned fixing the
permanently-red develop gate (PR #1009):

- The happy-path spec is `@dev-only` and needs `BASE_URL=https://dev.goodparty.org`
  (the alias, not the raw Vercel deploy URL) — the referer-restricted Google Maps key
  rejects `*.vercel.app`, so Places suggestions (`.pac-item`) never render and the
  filing-details address step hangs. Run locally with
  `BASE_URL=https://dev.goodparty.org --retries=0 --workers=1`; Clerk keys are in
  `packages/gp-webapp/.env.local`, not `e2e-tests/.env`.
- Playwright `getByRole(name:)` is case-insensitive SUBSTRING matching — a generic
  `{ name: 'Close' }` matcher once clicked a dashboard task titled "…close out the
  month strong" and aria-hid the page. Target testids, never generic role names.
- Stripe's webhook lands ~2s AFTER the success step exits, so the dashboard can
  render pre-Pro; assert `isPro` via API, then reload, before asserting Pro UI.
- The post-payment card says "Your registration is being verified" — "Enter your
  PIN" only appears after CampaignVerify approves (ENG-10785), never within a test
  run. Don't assert on the PIN state.

## Related

- `proUpgradeStep.test.ts` + each `*Step.test.tsx` — integration-style tests; mock only the SDK/endpoint boundary, exercise the real shared form/validator.
- `packages/gp-api/src/campaigns/tcrCompliance/CLAUDE.md` — the backend agentic flow this wizard feeds.
- `app/dashboard/profile/texting-compliance/` — the shared form components + the post-payment compliance card.
- `app/dashboard/campaign-story/CLAUDE.md` (Pro-upgrade sync section): the candidate-profile bio + policy priorities are the SAME `Website.content.about` fields the Campaign Story reads and writes, so they pre-fill bidirectionally with no backfill/sync work; only the story's `background` field is not shared (Pro has no counterpart).
- Epic plan (local): `~/.claude/plans/86ah2ezny-plan.md` — full task-by-task history and design decisions.
