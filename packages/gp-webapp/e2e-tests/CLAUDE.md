# e2e-tests/

End-to-end tests using Playwright. Runs against a deployed environment (local app, dev, qa, prod). Separate from Vitest unit/component tests under `helpers/test-utils/`.

## Key files

| File                   | Role                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `playwright.config.ts` | Playwright config — testDir is `./tests`, BASE_URL required                                                                                       |
| `global-setup.ts`      | One-shot `clerkSetup()` before tests run                                                                                                          |
| `tests/core/`          | Cross-cutting tests (auth, navigation, public pages)                                                                                              |
| `tests/app/`           | Feature-area tests mirroring `app/` (`organizations/`, `polls/`, `website/`, `contacts/`, `content/`, `dashboard/`, `profile/`, `mobile/`, `ai/`) |
| `tests/utils/`         | Test-only helpers (selectors, factories)                                                                                                          |
| `src/fixtures/`        | Static fixtures (PDFs, images, JSON poll results)                                                                                                 |
| `src/helpers/`         | Reusable test helpers (clerk, navigation, account, organizations, contacts, wait, data)                                                           |
| `.env.example`         | Required env (`BASE_URL`, secrets per `#devs-only`)                                                                                               |

## Patterns

- **One config, many environments.** Set `BASE_URL` in `.env` to point at local / dev / qa. Tests fail-fast if missing.
- **`@dev-only` (merge-only) tests.** The tag exists for ONE reason: a test that genuinely **cannot** run against an ephemeral per-PR preview because of an **infrastructure** dependency the preview can't stand up or reach — specifically an **inbound** dependency the preview can't receive. The bar is narrow; qualifying shapes are:
  - An external service must **deliver an inbound webhook** to the backend (e.g. Stripe `checkout.session.completed`) and the preview URL isn't registered to receive it.
  - The test drives a **live async pipeline the preview doesn't run** (e.g. the SQS analyze round-trip in `polls-onboarding`).
  - It needs **live external data the preview doesn't have** (e.g. BallotReady future-election data) or **core external infrastructure a preview can't reach or stand up.**

  **Before tagging, confirm the test meets that bar and name the specific inbound/infra dependency** in a one-line comment above the test. If you can't name one, do NOT tag — the test must run on PRs. Tag `@dev-only` in the test title (e.g. `test('... @dev-only', ...)`); for a `describe.serial` block whose tests share state seeded by a gated test, tag the **describe** title so the whole block is excluded together. CI greps the tag **out** on `pull_request` runs and **in** on the post-merge `main` run against dev (they always run locally / on demand) — no per-test workflow plumbing. That post-merge run publishes the required `E2E` status check that gates the `main` ruleset, so its result is what promote-on-green waits for before prod is reached.

  **Inbound vs outbound is the line.** An inbound delivery the preview can't receive = valid. An **outbound** call the preview's own gp-api initiates is NOT preview-incapable and does NOT earn the tag: it runs on the `GP_API_DEV` secret like any other request. That explicitly includes a live model/LLM round-trip (e.g. the Chief of Staff chat) — the preview makes it; if it's slow or rate-limited, stabilize the wait, don't hide it.

  **These are NOT valid reasons — they are the common mis-tags. Do not tag for any of them:**
  - **A Pro campaign.** `isPro` is provisionable without Stripe via `setupProCampaignUser` (`src/helpers/organizations.ts`), which flips it through the test-only `POST /v1/campaigns/mine/test-set-pro` endpoint — see the "Provisioning a Pro Win campaign" pattern below. Pro-gated Win surfaces run on PRs.
  - **Real district voter data.** A per-PR preview's gp-api runs on the `GP_API_DEV` secret, so it serves the same real people-api / voter data as dev.
  - **A feature-flagged surface.** Force the flag deterministically via the off-prod override cookie — see the "Flag-gated surfaces" pattern below. Never depend on live Amplitude targeting.
  - **An outbound call the preview's backend makes** (including a live LLM round-trip) — see the inbound-vs-outbound line above.
  - **Flakiness. Never.** A flaky test must be made reliable (stabilize the wait/assertion), not hidden on `main`. Tagging a flaky or red test `@dev-only` only moves the red from PRs (where you'd fix it) to the post-merge `main` run (where it rots and trains everyone to ignore the gate). If it's broken, fix it or `test.fixme()` it (visible, not silently green).

- **Authenticated flows** use Clerk via `@clerk/testing/playwright`. `clerkSetup()` runs once in `global-setup.ts`; per-test sign-in helpers live in `src/helpers/clerk.helper.ts`.
- **`authenticateTestUser(page, options?)`** (`tests/utils/api-registration.ts`) is the one-call way to get a logged-in user. Use it in a `beforeEach` (or at the top of a test) when the scenario needs an authenticated candidate. It:
  1. creates a real Clerk user via the backend SDK, signs in through the UI, and mints a long-lived (1h) API token from a backend session — browser-minted Clerk session tokens expire after 60s, which 401s any `client` call made late in a long test,
  2. calls gp-api `/v1/users/me`, then (unless `skipCampaignCreation`) creates **and launches** a campaign for a real race, and
  3. writes the `token` / `user` / `organization-slug` cookies onto the Playwright context so the `page` is authenticated.

  It returns `{ user, client }` — `user` is the `AuthenticatedUser`, and `client` is an Axios instance pre-authed against gp-api (`Bearer` token, baseURL `${API_BASE_URL || BASE_URL}/api`) for hitting the API directly from a test.

  Options:
  - `isolated` — `true` gives the test its own dedicated user; otherwise the user is **cached and shared per worker** (fast; use this unless the test mutates account-level state).
  - `race: { zip, office }` — picks the race the campaign is created for (`office` can be an exact name or a predicate over the office name). Defaults to `Cheyenne City Council - Ward 1`.
  - `user` — override generated `firstName` / `lastName` / `email` / `phone`.
  - `skipCampaignCreation: true` — stops after user creation (no campaign); **requires `isolated: true`** so an incomplete user is never cached.

  Requires `BASE_URL` and `CLERK_SECRET_KEY` (throws at import if missing); `API_BASE_URL` is optional and defaults to `BASE_URL`. Created users are **not** deleted by the test — gp-api's scheduled `deleteTestUsers` sweep removes stale `@test.goodparty.org` users older than 3 hours.

- **Flag-gated surfaces: force the flag, don't depend on Amplitude.** A test that exercises a feature behind an Amplitude flag must NOT rely on that flag's live targeting/rollout for the synthetic `@test.goodparty.org` user — that's flaky and couples the test to experiment config. Resolution is server-side (gp-api → Amplitude; the browser never calls Amplitude), so force the flag deterministically via the override-cookie seam: call `setFlagOverrides(page, { 'my-flag': 'on' })` (or a per-flag wrapper like `enableCampaignStoryFlag`, both in `src/helpers/campaignStory.helper.ts`) **before** auth/navigation, so the first SSR render already sees it. It's honored off-prod only (gated on `VERCEL_ENV`); there is no client SDK to stub. Mechanism + safety: `docs/feature-flags.md` § E2E overrides and `app/shared/experiments/flagOverrides.ts`.
- **Contacts specs drive the flag-on CRM page** (ENG-10756). The contacts suite (`tests/app/contacts/`, plus `contacts-org-scoping.spec.ts`) forces `win-crm`/`serve-crm` **on** via the override cookie (`enableCrmFlags` in `src/helpers/crm-contacts-e2e.ts`) and asserts against the rebuilt UI: no member table exists by design — filter correctness triangulates through the wizard's live count, the list-detail demographics, and typeahead-opened person records. `contacts-legacy-smoke.spec.ts` is the ONE retained flag-off spec (flags pinned **off**) covering the legacy page until it's deleted. Three legacy specs (`saved-lists`, `segment-builder-count-order`, `door-knocking-household-dedupe`) still target the flag-off page but now pin the flags **off** via `disableCrmFlags` so the CRM ramp can't flip their surface under them; port them to the CRM UI when the legacy page is deleted.
- **Provisioning a Pro Win campaign.** Use `setupProCampaignUser` (`src/helpers/organizations.ts`), which flips `campaign.isPro` via the test-only `POST /v1/campaigns/mine/test-set-pro` endpoint (non-prod + `@test.goodparty.org` only, own campaign) — no Stripe, so Pro-gated Win surfaces (e.g. the CRM create-list wizard) run on PRs. The full Stripe path (`seedEinAndFiled` + `seedFilingComplete` + `seedCandidateProfileComplete` then `upgradeCampaignToProViaStripe`, in `src/helpers/pro-upgrade.helper.ts`) is reserved for the one spec that tests the upgrade flow itself (`pro-upgrade-happy-path`), which stays `@dev-only` because it needs the inbound `checkout.session.completed` webhook a preview can't receive.
- **Prefer a stable `data-testid` over copy or DOM structure** for any element a test drives repeatedly (e.g. `campaign-story-card-<id>`). UI copy and component structure churn on `main` and silently break selectors; a `data-testid` is a deliberate, durable contract. Add one to the component (styleguide primitives forward it) when the alternative selector would be brittle — it's a legitimate, behavior-free change to make a flow testable.
- **Mirroring**: a feature dir under `app/` should have a matching dir under `tests/app/`. Add tests in the matching dir, not at the top of `tests/`.

## Running

```bash
# From repo root
npm run test:e2e                                   # all tests, headless
# From this dir (e2e-tests/)
npx playwright test                                # all
npx playwright test tests/core/pages/blog.spec.ts  # one file
npx playwright test polls                          # name pattern
```

**Always pass `--retries=0` when running locally.** The config retries (for CI flake tolerance) just make a deterministic local failure take 3x as long before you see it — kill the feedback loop, not your afternoon:

```bash
BASE_URL=https://dev.goodparty.org npx playwright test --config="$PWD/playwright.config.ts" \
  tests/app/polls/polls-onboarding.spec.ts --retries=0 --workers=1
```

Some tests need AWS auth: `aws sso login --profile gp-engineer` (or set `AWS_PROFILE` to whatever profile is currently authed for the dev account).

## Gotchas

- `BASE_URL` is enforced in `playwright.config.ts` — there's no default. Configure `.env` first.
- **Always invoke Playwright with `--config="$PWD/playwright.config.ts"`** (an absolute path), as the `test:e2e` script and CI do. Playwright resolves the config (and the implicit config search) against the nearest `package.json` directory — which in this monorepo is `packages/gp-webapp`, one level _above_ `e2e-tests`. So a bare `npx playwright test` (or a relative `--config`) finds **no** config and silently runs with defaults: no `baseURL` (every `page.goto('/...')` fails with "Cannot navigate to invalid URL") and no `globalSetup` (clerkSetup never runs → "Clerk Frontend API URL is required"). If you see either symptom, check the config is actually loading first.
- Don't import from `app/` or `helpers/` here. This dir is a separate workspace with its own `tsconfig` and no Next runtime — pulling in app code drags in client-only modules (`next/navigation`, the `@shared/*` alias, MUI, etc.) that fail to resolve under Playwright. Put shared test-side helpers in `e2e-tests/src/helpers/` instead.

## Related

- `e2e-tests/README.md` — onboarding + setup details (env vars, secret handoff).
- `docs/testing.md` — Vitest (unit/component) testing.
