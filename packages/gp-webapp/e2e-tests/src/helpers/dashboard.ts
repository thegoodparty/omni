import { type Page, expect } from '@playwright/test'

// HeaderSection's greeting h1 ("Hi <name>"), or the ElectionOver heading that
// replaces it once the election has passed. CampaignManager renders nothing
// until the campaign query hydrates, and the whole dashboard shell (greeting,
// sidebar, mobile menu) lives behind that gate, so this heading doubles as the
// "dashboard is ready" signal. Shared so the dashboard and mobile specs query it
// the same way instead of each redefining the locator.
export const dashboardGreetingHeading = (page: Page) =>
  page
    .getByRole('heading', { level: 1 })
    .filter({ hasText: /Hi|Hello|until|General|Primary|Election|concluded/ })
    .first()

// Wait for the campaign-gated dashboard chrome to be present and interactable:
// no stray modal aria-hiding the page, and the greeting heading rendered.
//
// A task detail modal (e.g. the awareness "Fundraising ask" sheet) occasionally
// ends up open on the dashboard home during setup. It is a modal Radix dialog,
// so while open it sets aria-hidden on the rest of the page — which drops the
// greeting, the org switcher, and the mobile menu trigger out of the
// accessibility tree, making every role-based query resolve to zero elements.
// It can open late (after hydration settles), so a one-shot check would miss a
// dialog that appears after it runs. Retry on a loop instead: each attempt
// closes any open dialog (it dismisses on Escape) and re-checks for the
// greeting, so a dialog appearing at any point in the window is caught. The
// window is generous because a cold preview deploy can lag the SSR campaign
// fetch well past the default 15s expect timeout.
export const waitForDashboardReady = async (page: Page) => {
  await expect(async () => {
    const dialog = page.getByRole('dialog').first()
    if (await dialog.isVisible().catch(() => false)) {
      await page.keyboard.press('Escape')
      await dialog
        .waitFor({ state: 'hidden', timeout: 5_000 })
        .catch(() => undefined)
    }
    await expect(dashboardGreetingHeading(page)).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 30_000 })
}
