import type { Page } from '@playwright/test'
import { WaitHelper } from './wait.helper'

// LinkedIn's analytics script (snap.licdn.com) intermittently stalls in CI,
// which prevents the browser's `load` event from firing and causes Playwright's
// `page.goto()` to time out at 45s. Blocking it has no effect on test coverage.
export const blockSlowScripts = async (page: Page) => {
  await page.route('**/snap.licdn.com/**', (route) => route.abort())
}

export class NavigationHelper {
  /**
   * Opens the mobile nav drawer. The trigger is a button with an
   * accessible name of "Open menu" (aria-label) in every layout.
   */
  static async openMobileNavMenu(page: Page): Promise<void> {
    const openMenu = page.getByRole('button', { name: /open menu/i }).first()
    if (await openMenu.isVisible().catch(() => false)) {
      await openMenu.click()
      return
    }
    throw new Error('No mobile menu trigger found')
  }

  static async navigateToPage(page: Page, path: string): Promise<void> {
    await page.goto(path)
    await WaitHelper.waitForPageReady(page)
  }

  static async dismissCookieBanner(page: Page): Promise<void> {
    try {
      // Try multiple common cookie banner patterns
      const cookieSelectors = [
        page.getByRole('button', { name: 'Close' }),
        page.getByRole('button', { name: /accept/i }),
        page.getByRole('button', { name: /agree/i }),
        page.getByRole('button', { name: /ok/i }),
        page.getByRole('button', { name: /dismiss/i }),
        page.locator(
          '[data-testid*="cookie"] button, [class*="cookie"] button, [id*="cookie"] button',
        ),
        page.locator('button:has-text("×"), button:has-text("✕")'),
      ]

      for (const selector of cookieSelectors) {
        try {
          if (await selector.first().isVisible({ timeout: 2000 })) {
            await selector.first().click()
            await selector.first().waitFor({ state: 'hidden', timeout: 5000 })
            return
          }
        } catch {
          // Try next selector
        }
      }
    } catch {
      // Cookie banner not present - continue silently
    }
  }

  static async dismissOverlays(page: Page): Promise<void> {
    try {
      // Dismiss cookie banner
      await NavigationHelper.dismissCookieBanner(page)

      // Dismiss promotional overlays
      const promoOverlay = page.getByRole('heading', {
        name: 'Win with GoodParty.org Pro!',
      })
      if (await promoOverlay.isVisible({ timeout: 2000 })) {
        await page.getByRole('img').first().click() // Close button
      }
    } catch {
      // Overlays not present - continue
    }
  }

  static async openMobileMenu(page: Page): Promise<void> {
    // The drawer mounts a "Close menu" button only while it is open. Treat that
    // as the open signal so this is idempotent: clicking the trigger again while
    // the drawer is open would toggle it shut, so a caller that retries
    // (open -> click a nav link, on a flake) doesn't accidentally close it.
    const closeButton = page.getByRole('button', { name: /close menu/i })
    if (await closeButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      return
    }

    const openMenu = page.getByRole('button', { name: /open menu/i })
    if (await openMenu.isVisible().catch(() => false)) {
      await openMenu.click()
    } else {
      const trigger = page.getByTestId('mobile-menu-trigger')
      if (await trigger.isVisible().catch(() => false)) {
        await trigger.click()
      } else {
        await NavigationHelper.openMobileNavMenu(page)
      }
    }

    // Confirm the drawer actually opened before callers reach for a nav link;
    // the trigger click can no-op while the page is still settling.
    await closeButton.waitFor({ state: 'visible', timeout: 10_000 })
  }
}
