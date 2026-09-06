import { expect, test } from '@playwright/test'
import { blockSlowScripts } from 'src/helpers/navigation.helper'
import { setupProCampaignUser } from 'src/helpers/organizations'
import {
  createFlowStepHeading,
  enableNativeDoorKnockingFlag,
  gotoDoorKnocking,
} from 'src/helpers/door-knocking-e2e'

// What the native shell does for an org with no lists, which since 3.0 is the
// only state a spec here can reach without spending money.
//
// The rail itself is no longer testable end to end. A saved list IS a bought
// Geoapify route now — the two are one transaction — so seeding a row to look
// at would bill a shared credit pool on every run of a suite that gates every
// PR in the monorepo, and would take a 30s third-party call as a dependency.
// The rail's own rendering is covered by TurfList.test.tsx and the details
// sheet by TurfDetailsSheet.test.tsx, where a row costs a fixture.
//
// What is left is the half those unit tests cannot see: whether the page, its
// flag, its Pro gate and gp-api's `GET /turfs` really line up on a live
// preview — and 3.0 made that reachable, because an org with no lists opens
// the create flow by itself.
//
// One test, one `setupProCampaignUser` — every other spec file in this suite
// spends exactly one, because concurrent Clerk-user bootstraps against a cold
// preview are its dominant flake source (the 401 note in
// tests/utils/headless-user.ts).
test.describe('native door-knocking zero state', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
    // Set before auth/navigation: the variant is resolved server-side and seeded
    // into the first SSR render, and pinning it stops a live ramp flipping the
    // surface under this spec.
    await enableNativeDoorKnockingFlag(page)
  })

  test('opens the create flow on its own, and leaves door knocking when dismissed', async ({
    page,
  }) => {
    test.setTimeout(3 * 60 * 1000)

    await setupProCampaignUser(page)

    await gotoDoorKnocking(page)

    // No Create list press: the flow opens itself. That it gets this far is
    // the cross-service assertion — the page only decides to open when
    // `GET /v1/door-knocking/turfs` has actually answered, so a 401, a 403
    // from the Pro gate or a 500 all leave the map bare instead.
    await expect(
      createFlowStepHeading(page, 'What do you want to do?'),
    ).toBeVisible({ timeout: 60_000 })
    // Bar stepper's "Step X of Y" text is suppressed on this shell
    // (OutreachFlowShell passes `showLabel={false}` — the DrawerTitle
    // carries the flow's identity, the bars carry position). Assert
    // the same position via the progressbar's aria attributes, which
    // is what the stepper still exposes with its label hidden.
    const stepper = page.getByRole('progressbar', { name: 'Progress' })
    await expect(stepper).toHaveAttribute('aria-valuenow', '1')
    await expect(stepper).toHaveAttribute('aria-valuemax', '5')

    // And the rail's own Create list is not the way in any more — the design
    // disables the empty state's card and lets the flow open instead.
    await expect(page.getByRole('button', { name: 'Create list' })).toHaveCount(
      0,
    )

    // Backing out with nothing picked is not a question, and it leaves door
    // knocking rather than closing onto a dimmed map with no control on it.
    await page.getByRole('button', { name: 'Close', exact: true }).click()

    await page.waitForURL(
      (url) => !url.pathname.startsWith('/dashboard/door-knocking'),
      { timeout: 30_000 },
    )
  })
})
