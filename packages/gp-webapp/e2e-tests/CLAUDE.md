# e2e-tests/

End-to-end tests using Playwright. Runs against a deployed environment (local app, dev, qa, prod). Separate from Vitest unit/component tests under `helpers/test-utils/`.

## Key files

| File | Role |
|------|------|
| `playwright.config.ts` | Playwright config — testDir is `./tests`, BASE_URL required, visual diff thresholds tuned for CI |
| `global-setup.ts` | One-shot `clerkSetup()` before tests run |
| `tests/core/` | Cross-cutting tests (auth, navigation, public pages) |
| `tests/app/` | Feature-area tests mirroring `app/` (`organizations/`, `polls/`, `website/`, `contacts/`, `content/`, `dashboard/`, `profile/`, `mobile/`, `ai/`) |
| `tests/utils/` | Test-only helpers (selectors, factories) |
| `tests/__visual_snapshots__/` | Pixel snapshots — versioned per-platform |
| `src/fixtures/` | Static fixtures (PDFs, images, JSON poll results) |
| `src/helpers/` | Reusable test helpers (clerk, navigation, account, organizations, contacts, visual, wait, data) |
| `.env.example` | Required env (`BASE_URL`, secrets per `#devs-only`) |

## Patterns

- **One config, many environments.** Set `BASE_URL` in `.env` to point at local / dev / qa. Tests fail-fast if missing.
- **Authenticated flows** use Clerk via `@clerk/testing/playwright`. `clerkSetup()` runs once in `global-setup.ts`; per-test sign-in helpers live in `src/helpers/clerk.helper.ts`.
- **`authenticateTestUser(page, options?)`** (`tests/utils/api-registration.ts`) is the one-call way to get a logged-in user. Use it in a `beforeEach` (or at the top of a test) when the scenario needs an authenticated candidate. It:
  1. creates a real Clerk user via the backend SDK, signs in through the UI to mint a session token,
  2. calls gp-api `/v1/users/me`, then (unless `skipCampaignCreation`) creates **and launches** a campaign for a real race, and
  3. writes the `token` / `user` / `organization-slug` cookies onto the Playwright context so the `page` is authenticated.

  It returns `{ user, client }` — `user` is the `AuthenticatedUser`, and `client` is an Axios instance pre-authed against gp-api (`Bearer` token, baseURL `${API_BASE_URL || BASE_URL}/api`) for hitting the API directly from a test.

  Options:
  - `isolated` — `true` gives the test its own dedicated user; otherwise the user is **cached and shared per worker** (fast; use this unless the test mutates account-level state).
  - `race: { zip, office }` — picks the race the campaign is created for (`office` can be an exact name or a predicate over the office name). Defaults to `Cheyenne City Council - Ward 1`.
  - `user` — override generated `firstName` / `lastName` / `email` / `phone`.
  - `skipCampaignCreation: true` — stops after user creation (no campaign); **requires `isolated: true`** so an incomplete user is never cached.

  Requires `BASE_URL` and `CLERK_SECRET_KEY` (throws at import if missing); `API_BASE_URL` is optional and defaults to `BASE_URL`. Created users are **not** deleted by the test — gp-api's scheduled `deleteTestUsers` sweep removes stale `@test.goodparty.org` users older than 3 hours.
- **Visual diffs**: thresholds are deliberately permissive (`maxDiffPixels: 25000`, ratio `0.045`) to absorb font/layout drift across machines. Tighten only with a clear reason.
- **Mirroring**: a feature dir under `app/` should have a matching dir under `tests/app/`. Add tests in the matching dir, not at the top of `tests/`.

## Running

```bash
# From repo root
npm run test:e2e                                   # all tests, headless
# From this dir (e2e-tests/)
npx playwright test                                # all
npx playwright test tests/core/pages/blog.spec.ts  # one file
npx playwright test polls                          # name pattern
npm run test:visual:update                         # refresh visual snapshots (use carefully)
```

Some tests need AWS auth: `aws sso login --profile gp-engineer`.

## Gotchas

- **Visual snapshots are platform-specific** — refreshing them on a Mac may not match CI Linux. Prefer letting CI regenerate via PR if you change UI.
- `BASE_URL` is enforced in `playwright.config.ts` — there's no default. Configure `.env` first.
- **Always invoke Playwright with `--config="$PWD/playwright.config.ts"`** (an absolute path), as the `test:e2e` script and CI do. Playwright resolves the config (and the implicit config search) against the nearest `package.json` directory — which in this monorepo is `packages/gp-webapp`, one level *above* `e2e-tests`. So a bare `npx playwright test` (or a relative `--config`) finds **no** config and silently runs with defaults: no `baseURL` (every `page.goto('/...')` fails with "Cannot navigate to invalid URL") and no `globalSetup` (clerkSetup never runs → "Clerk Frontend API URL is required"). If you see either symptom, check the config is actually loading first.
- Don't import from `app/` or `helpers/` here. This dir is a separate workspace with its own `tsconfig` and no Next runtime — pulling in app code drags in client-only modules (`next/navigation`, the `@shared/*` alias, MUI, etc.) that fail to resolve under Playwright. Put shared test-side helpers in `e2e-tests/src/helpers/` instead.

## Related

- `e2e-tests/README.md` — onboarding + setup details (env vars, secret handoff).
- `docs/testing.md` — Vitest (unit/component) testing.
