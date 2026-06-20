import { expect, type Page, test } from '@playwright/test'
import { authenticateTestUser } from 'tests/utils/api-registration'
import {
  blockSlowScripts,
  NavigationHelper,
} from '../../../src/helpers/navigation.helper'
import { WaitHelper } from '../../../src/helpers/wait.helper'
import {
  dashboardGreetingHeading,
  waitForDashboardReady,
} from 'src/helpers/dashboard'

// Open the mobile drawer and click a nav link, retrying the whole sequence. A
// dashboard promo/coachmark overlay can pop in late and intercept the first
// click; openMobileMenu is idempotent (won't toggle an open drawer shut), so
// re-running it and re-clicking is safe until the click lands.
const openMobileNavLink = async (page: Page, name: string) => {
  await expect(async () => {
    await NavigationHelper.dismissOverlays(page)
    await NavigationHelper.openMobileMenu(page)
    await page.getByRole('link', { name }).click({ timeout: 3000 })
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

  test('should navigate to AI Assistant on mobile', async ({ page }) => {
    await WaitHelper.waitForPageReady(page)

    await openMobileNavLink(page, 'AI Assistant')
    // The mobile header renders the page title as a heading in addition to the
    // page's own heading, so scope to the first match to avoid strict mode.
    await expect(
      page.getByRole('heading', { name: 'AI Assistant' }).first(),
    ).toBeVisible({ timeout: 15000 })
    await expect(page).toHaveURL(/\/dashboard\/campaign-assistant$/)
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
      page.getByRole('heading', { name: 'Contact Information' }).first(),
    ).toBeVisible({ timeout: 15000 })
    await expect(page).toHaveURL(/\/profile$/)

    const bodyContent = page.locator('body')
    await expect(bodyContent).toBeVisible()

    console.log('✅ Mobile profile page accessible')
  })
})
