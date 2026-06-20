import { expect, test } from '@playwright/test'
import { authenticateTestUser } from 'tests/utils/api-registration'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import { waitForDashboardReady } from 'src/helpers/dashboard'

// The "not yet filed" dead-end (FilingStatusStep → FilingInstructionsStep)
// writes only details.hasFiledForRace and hits no Stripe/webhook, so the shared
// cached user is fine and this runs on every PR preview (not @dev-only).
test.describe('Pro upgrade — not-yet-filed dead-end', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  test('routes "No, not yet" to filing-instructions, emails it, and exits to dashboard', async ({
    page,
  }) => {
    test.setTimeout(120000)

    await authenticateTestUser(page)
    await page.goto('/dashboard')
    await page.waitForURL(/\/dashboard/)
    // Dismiss the Pro promo modal first: it aria-hides the page and ignores
    // Escape, so waitForDashboardReady's Escape-based close can't clear it —
    // only dismissOverlays (clicks the close button) can. Matches dashboard.spec.
    await NavigationHelper.dismissOverlays(page)
    await waitForDashboardReady(page)

    // Dashboard banner entry → wizard index, which redirects to the value-prop
    // step only after its canonical-state queries resolve. Wait for the
    // redirect to settle before asserting, so a cold preview's slow fetch
    // doesn't outrun the heading assertion.
    await page.getByRole('button', { name: 'Get Pro' }).click()
    await page.waitForURL(/\/dashboard\/pro-upgrade\/value-prop$/)
    await expect(
      page.getByRole('heading', { name: /76% of candidates who use Pro win/i }),
    ).toBeVisible()

    // Value prop → filing-status step.
    await page.getByRole('button', { name: 'Get Pro for $10/mo' }).click()
    await page.waitForURL(/\/dashboard\/pro-upgrade\/status$/)
    await expect(
      page.getByRole('heading', {
        name: /Have you already filed for your race/i,
      }),
    ).toBeVisible()

    // "No, not yet" → the filing-instructions dead-end.
    await page.getByRole('button', { name: /No, not yet/i }).click()
    await page.waitForURL(/\/dashboard\/pro-upgrade\/filing-instructions$/)
    await expect(
      page.getByRole('heading', {
        name: /You're not eligible for Pro yet/i,
      }),
    ).toBeVisible()

    // Dead-end content from existing campaign data. Assert the labels are
    // present with non-empty values rather than hard-coding the dates, which
    // are race-specific and change over time. Each InstructionRow renders the
    // label span and a value sibling inside one flex row, so the row that has
    // the label text must carry a value beyond the label itself.
    const labelHasValue = async (label: string): Promise<void> => {
      const labelSpan = page.getByText(label, { exact: true })
      await expect(labelSpan).toBeVisible()
      const row = page.locator('div.flex.gap-3').filter({ has: labelSpan })
      await expect(row).not.toContainText('Loading…')
      await expect(row).not.toContainText('Not yet available')
      await expect
        .poll(async () =>
          (await row.innerText())
            .replace(label, '')
            .replace(/\s+/g, ' ')
            .trim(),
        )
        .not.toBe('')
    }

    // Filing window is always rendered. The Filing office row is conditional
    // (FilingInstructionsStep's `hasOffice` guard) — it only renders when
    // BallotReady has address/phone for the race. The default race surfaces it
    // (verified), but assert it only when present so a data gap fails as a
    // skipped block, not an opaque timeout.
    await labelHasValue('Filing window')
    const filingOfficeLabel = page.getByText('Filing office', { exact: true })
    if (await filingOfficeLabel.isVisible().catch(() => false)) {
      await labelHasValue('Filing office')
    }

    // "Email this to me" fires the success toast (sonner, bottom-center).
    await page.getByRole('button', { name: /Email this to me/i }).click()
    await expect(
      page.getByText('Filing instructions sent to your email.'),
    ).toBeVisible()

    // True dead-end: no payment path is offered here.
    await expect(
      page.getByRole('button', { name: /continue to payment/i }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: 'Get Pro for $10/mo' }),
    ).toHaveCount(0)

    // Exit returns to the dashboard.
    await page.getByRole('button', { name: 'Continue to dashboard' }).click()
    await page.waitForURL(/\/dashboard$/)
    await expect(page).toHaveURL(/\/dashboard$/)
  })
})
