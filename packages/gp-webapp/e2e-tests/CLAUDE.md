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
- **`@dev-only` (merge-only) tests.** A test that depends on the warm dev stack or live async pipelines (e.g. the SQS analyze round-trip and the Stripe expansion webhook in `polls-onboarding`) can't pass against an ephemeral per-PR preview. Tag such a test `@dev-only` in its title (e.g. `test('... @dev-only', ...)`); for a `describe.serial` block whose tests share state seeded by the gated test, tag the **describe** title so the whole block is excluded together. The CI workflow greps these **out** on `pull_request` runs and **includes** them on the post-merge `develop` run (and they always run locally / on demand). Add the tag plus a one-line comment naming the live dependency; that's the whole pattern — no per-test workflow plumbing.

  **`@dev-only` means "needs the real dev stack" — it is NOT a place to hide flaky or broken tests from PR gates.** The develop run is not a quieter, lower-stakes lane; tagging a flaky/red test `@dev-only` only moves the red from PRs (where you'd fix it) to develop (where it rots, and trains everyone to ignore the gate). If a test flakes, stabilize it; if it's broken, fix it or `test.fixme()` it (visible, not failing). Only genuine warm-stack/live-pipeline dependencies (Stripe webhook, SQS round-trip, live BallotReady future-election data, pro provisioning + real district voter data, a live model round-trip) earn the tag.

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
- **Contacts specs drive the flag-on CRM page** (ENG-10756). The contacts suite (`tests/app/contacts/`, plus `contacts-org-scoping.spec.ts`) forces `win-crm`/`serve-crm` **on** via the override cookie (`enableCrmFlags` in `src/helpers/crm-contacts-e2e.ts`) and asserts against the rebuilt UI: no member table exists by design — filter correctness triangulates through the wizard's live count, the list-detail demographics, and typeahead-opened person records. `contacts-legacy-smoke.spec.ts` is the ONE retained flag-off spec (flags pinned **off**) covering the legacy page until it's deleted. Three legacy specs (`saved-lists`, `segment-builder-count-order`, `door-knocking-household-dedupe`) still target the flag-off page WITHOUT pinning the flags — port or pin them before ramping the CRM flags, or the ramp will flip their surface under them.
- **Prefer a stable `data-testid` over copy or DOM structure** for any element a test drives repeatedly (e.g. `campaign-story-card-<id>`). UI copy and component structure churn on `develop` and silently break selectors; a `data-testid` is a deliberate, durable contract. Add one to the component (styleguide primitives forward it) when the alternative selector would be brittle — it's a legitimate, behavior-free change to make a flow testable.
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
