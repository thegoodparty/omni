import { type Page } from '@playwright/test'
import { setupClerkTestingToken } from '@clerk/testing/playwright'
import { uniquePhone } from './testIdentifiers.helper'

/**
 * Helpers for the elected-official ("serve") magic-link onboarding flow.
 *
 * The real entry point is a Clerk sign-in *ticket* appended to the redemption
 * landing page as `/serve/welcome?__clerk_ticket=<token>`. In production that
 * ticket is minted server-side by `POST /v1/admin/elected-office/magic-link`
 * (gp-api), which is guarded by `AdminOrM2MGuard` — credentials the E2E harness
 * does not hold. The harness *does* hold the Clerk **test instance** secret
 * (`CLERK_SECRET_KEY`), so the user, its ticket and its office are all created
 * by `@goodparty_org/test-users`, the package the judge provisions through too.
 *
 * The webapp authenticates browser `/api/v1/*` calls purely from the Clerk
 * session (the Next middleware injects `auth().getToken()` into the rewrite —
 * see `middleware.ts`), so redeeming the ticket in the browser is fully
 * self-authenticating; no manual `token` cookie is needed (unlike
 * `authenticateTestUser`, which sets one for its own long-lived API client).
 */

export {
  buildServeWelcomeUrl,
  createServeLeadUser,
  createServeMagicLink,
  mintServeTicket,
  seedPrefilledElectedOffice,
  type SeedPrefilledOfficeOptions,
  type SeededElectedOffice,
  type ServeLeadUser,
  type ServeMagicLink,
} from '@goodparty_org/test-users'

const baseURL = process.env.BASE_URL
if (!baseURL) {
  throw new Error('BASE_URL is not set')
}

/**
 * Drive the public redemption landing page: navigate to the ticketed welcome
 * URL and click the button that redeems the ticket. Resolves once the redeemed
 * session lands the lead on `/serve/onboarding`.
 *
 * `setupClerkTestingToken` is required first because the page performs a real
 * frontend `client.signIn.create({ strategy: 'ticket' })`, which Clerk bot
 * protection would otherwise block.
 */
export const redeemServeTicket = async (
  page: Page,
  welcomeUrl: string,
): Promise<void> => {
  await setupClerkTestingToken({ page })
  // The cookie-consent snackbar (`app/shared/layouts/CookiesSnackbar.tsx`)
  // renders `fixed bottom-4 … w-full` on every page and overlays the onboarding
  // footer, intercepting the welcome step's Continue click. Pre-seed the
  // accepted cookie so the banner never mounts (it reads `cookiesAccepted` from
  // document.cookie once on mount) — more robust than racing a dismiss click
  // after each navigation.
  await page
    .context()
    .addCookies([{ name: 'cookiesAccepted', value: 'true', url: baseURL }])
  await page.goto(welcomeUrl)
  await page
    .getByRole('button', { name: /continue to goodparty/i })
    .click({ timeout: 30_000 })
  // A sales-provisioned account has no phone, so post-auth routing sends it
  // through /sign-up/phone before onboarding (ENG-11538). Fill it when shown.
  await page.waitForURL(
    (url) =>
      url.pathname.startsWith('/serve/onboarding') ||
      url.pathname.startsWith('/sign-up/phone'),
    { timeout: 45_000 },
  )
  if (new URL(page.url()).pathname.startsWith('/sign-up/phone')) {
    await page.locator('input[name=phone]').fill(uniquePhone())
    await page.getByTestId('signup-phone-submit').click()
    await page.waitForURL(
      (url) => url.pathname.startsWith('/serve/onboarding'),
      { timeout: 45_000 },
    )
  }
}
