import { type Page, expect } from '@playwright/test'

// The /dashboard/election-result h1 (still shown once the election has
// passed — unrelated to campaign-story), or CampaignManagerTasks' "Your top
// priorities this week" h2 — the one heading CampaignManagerHome always
// renders, regardless of task-loading state. Shared so the dashboard and
// mobile specs query it the same way instead of each redefining the locator.
export const dashboardGreetingHeading = (page: Page) =>
  page
    .getByRole('heading', { level: 1 })
    .filter({ hasText: /until|General|Primary|Election|concluded/ })
    .or(
      page.getByRole('heading', {
        level: 2,
        name: /your top priorities this week/i,
      }),
    )
    .first()

// A task detail modal (e.g. the awareness "Fundraising ask" sheet) occasionally
// ends up open on the dashboard home during setup. It is a modal Radix dialog,
// so while open it sets aria-hidden on the rest of the page — which drops the
// greeting, the org switcher, and the mobile menu trigger out of the
// accessibility tree, making every role-based query resolve to zero elements.
// Close any open dialog (it dismisses on Escape) so the dashboard chrome is back
// in the a11y tree. Call this inside a retry loop (see waitForDashboardReady),
// because the dialog can open late — a one-shot close misses one that appears
// after it runs.
//
// CampaignManagerTasks' cards can also pop a vaul Drawer (not a Radix dialog —
// no `role="dialog"`, so the check above misses it), same as the awareness-task
// drawer NavigationHelper.dismissTaskDrawer already handles for the mobile nav
// sheet. Check its overlay too so the same stray-modal window is covered here.
export const closeStrayDialog = async (page: Page) => {
  const dialog = page.getByRole('dialog').first()
  if (await dialog.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape')
    await dialog
      .waitFor({ state: 'hidden', timeout: 5_000 })
      .catch(() => undefined)
  }

  const drawerOverlay = page.locator('[data-slot="drawer-overlay"]').first()
  if (await drawerOverlay.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await page.keyboard.press('Escape')
    await drawerOverlay
      .waitFor({ state: 'hidden', timeout: 5_000 })
      .catch(() => undefined)
  }
}

// Wait for the campaign-gated dashboard chrome to be present and interactable:
// no stray modal aria-hiding the page, and the greeting heading rendered. Retry
// on a loop so a dialog opening at any point in the window is caught. The window
// is generous because a cold preview deploy can lag the SSR campaign fetch well
// past the default 15s expect timeout.
export const waitForDashboardReady = async (page: Page) => {
  await expect(async () => {
    await closeStrayDialog(page)
    await expect(dashboardGreetingHeading(page)).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 30_000 })
}
