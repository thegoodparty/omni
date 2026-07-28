import { expect, type Page, test } from '@playwright/test'
import { authenticateTestUser } from 'tests/utils/api-registration'
import {
  blockSlowScripts,
  MOBILE_DRAWER_TITLE,
  NavigationHelper,
} from '../../../src/helpers/navigation.helper'
import { WaitHelper } from '../../../src/helpers/wait.helper'
import {
  dashboardGreetingHeading,
  waitForDashboardReady,
} from 'src/helpers/dashboard'

// Open the mobile drawer and click a nav link inside it. Dismiss any
// promo/coachmark overlay ONCE up front (while the drawer is closed) — not
// inside the retry, because dismissOverlays clicks any "Close"-named button and
// would close the drawer itself. The link is scoped to the drawer dialog so a
// hidden desktop-sidebar copy can't be matched, and openMobileMenu is idempotent
// (returns early when the dialog is open) so re-running it on a retry is safe.
// dismissTaskDrawer runs each retry: an awareness-task vaul Drawer can pop open
// late and its overlay intercepts the menu-trigger click, so clear it (scoped
// to the vaul overlay, no-op while the sidebar is open) before opening the menu.
const openMobileNavLink = async (page: Page, name: string) => {
  await NavigationHelper.dismissOverlays(page)
  const drawer = page.getByRole('dialog', { name: MOBILE_DRAWER_TITLE })
  await expect(async () => {
    await NavigationHelper.dismissTaskDrawer(page)
    await NavigationHelper.openMobileMenu(page)
    await drawer.getByRole('link', { name }).click({ timeout: 5000 })
  }).toPass({ timeout: 30000 })
}

test.describe('Mobile Navigation', () => {
  // Configure mobile viewport
  test.use({
    viewport: { width: 375, height: 667 },
  })

  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
    await authenticateTestUser(page)
    await page.goto('/dashboard')
    await NavigationHelper.dismissOverlays(page)
    // Ensure the campaign-gated dashboard has rendered and no stray task modal is
    // aria-hiding it before any test reaches for the greeting or the mobile menu.
    await waitForDashboardReady(page)
  })

  test('should display mobile dashboard', async ({ page }) => {
    test.setTimeout(120000)
    await WaitHelper.waitForPageReady(page)
    await expect(page).toHaveURL(/\/dashboard$/)

    await expect(dashboardGreetingHeading(page)).toBeVisible()

    console.log('✅ Mobile dashboard accessible')
  })

  test('should have mobile navigation menu', async ({ page }) => {
    await WaitHelper.waitForPageReady(page)
    const mobileMenuButton = page.getByTestId('mobile-menu-trigger')

    await expect(mobileMenuButton).toBeAttached()
    await expect(mobileMenuButton).toBeVisible()
    console.log('✅ Mobile menu button is visible')
  })

  test('should navigate to Content Builder on mobile', async ({ page }) => {
    await WaitHelper.waitForPageReady(page)

    await openMobileNavLink(page, 'Content Builder')
    // The mobile header renders the page title as a heading in addition to the
    // page's own heading, so scope to the first match to avoid strict mode.
    await expect(
      page.getByRole('heading', { name: 'Content Builder' }).first(),
    ).toBeVisible({ timeout: 15000 })
    await expect(page).toHaveURL(/\/dashboard\/content$/)
  })

  test('should navigate to My Profile on mobile', async ({ page }) => {
    test.setTimeout(120000)
    await WaitHelper.waitForPageReady(page)

    await page.goto('/dashboard/profile')
    await page.waitForURL(/\/dashboard\/profile/)
    await WaitHelper.waitForPageReady(page)
    await expect(
      page.getByRole('heading', { name: 'Office Details' }).first(),
    ).toBeVisible({ timeout: 15000 })
    await expect(page).toHaveURL(/\/profile$/)

    const bodyContent = page.locator('body')
    await expect(bodyContent).toBeVisible()

    console.log('✅ Mobile profile page accessible')
  })
})
