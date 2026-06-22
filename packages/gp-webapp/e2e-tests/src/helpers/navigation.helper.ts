import type { Page } from '@playwright/test'
import { WaitHelper } from './wait.helper'

// Accessible name of the mobile sidebar Sheet (its sr-only SheetTitle), used to
// target the drawer dialog without matching other dialogs (promos, task modals).
export const MOBILE_DRAWER_TITLE = 'Sidebar'

// LinkedIn's analytics script (snap.licdn.com) intermittently stalls in CI,
// which prevents the browser's `load` event from firing and causes Playwright's
// `page.goto()` to time out at 45s. Blocking it has no effect on test coverage.
export const blockSlowScripts = async (page: Page) => {
  await page.route('**/snap.licdn.com/**', (route) => route.abort())
}

export class NavigationHelper {
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
    // The mobile drawer is a modal Radix Sheet (role="dialog", titled
    // "Sidebar"). While open it aria-hides the page chrome — the header trigger
    // AND the separate "Close menu" button both drop out of the accessibility
    // tree — so the only reliable "open" signal is the dialog itself. Key the
    // idempotency check on the dialog (not the aria-hidden close button): a
    // retry must not fall through and re-click the trigger, which is behind the
    // sheet overlay and gets its click intercepted.
    const drawer = page.getByRole('dialog', { name: MOBILE_DRAWER_TITLE })
    if (await drawer.isVisible().catch(() => false)) {
      return
    }
    // Closed: the trigger is in the live tree and not covered, so click it.
    await page.getByTestId('mobile-menu-trigger').click()
    await drawer.waitFor({ state: 'visible', timeout: 10_000 })
  }
}
