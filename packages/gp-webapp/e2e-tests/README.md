# E2E Tests

End-to-end tests for GoodParty.org built with [Playwright](https://playwright.dev/).

## Quick Start

#### Setup

```bash
# Install dependencies and browser
npm install
npx playwright install chromium

# Copy and configure env
cp .env.example .env
```

**Notes**:

- The `BASE_URL` in `.env` controls which app to test against. Values you can use:
  - `http://localhost:4000` (test against a local-running app)
  - `http://dev.goodparty.org` (test against the dev app)
  - ...etc

- Reach out to other engineers (or in `#devs-only`) for any secret values that are needed in `.env`.

- Some tests require you to be authenticated to the AWS CLI (e.g. via `aws sso login --profile gp-engineer`).

#### Run Tests

```bash
# Run all tests
npx playwright test

# Run a specific test file or directory
npx playwright test tests/core/pages/blog.spec.ts
npx playwright test polls
```

## Authentication

Tests that need an authenticated user call `authenticateTestUser(page)` from `tests/utils/api-registration.ts`. This:

1. Registers a user via the API
2. Completes the full onboarding flow via API calls
3. Injects `token` and `user` cookies into the browser context

By default, a single user is cached and shared across tests in a worker. Pass `{ isolated: true }` to create a dedicated user for a test.

Test users are not cleaned up per-run. A scheduled job on gp-api (`UsersService.deleteTestUsers`, every 6h) removes any `@test.goodparty.org` user older than 3 hours from both the DB and Clerk, so every e2e run leaves a short-lived footprint that the next scheduled sweep clears.

```typescript
import { authenticateTestUser } from '../utils/api-registration'

test('my authenticated test', async ({ page }) => {
  await authenticateTestUser(page)
  await page.goto('/dashboard')
  // ...
})
```
