import { expect, test, type Page } from '@playwright/test'
import { setFlagOverrides } from 'src/helpers/campaignStory.helper'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import { setupProCampaignUser } from 'src/helpers/organizations'

// The email stepper up to its audience: compose, then pick a voter-file list
// with the email filter forced on. Email addresses reach the people data only
// through a Serve organization's imported contacts, so a Win campaign's list
// has no one to email yet. This spec asserts exactly that: the picker, the
// email-only line, the empty state, and a Next that will not move on. The
// paid send (confirm, the hold, prepare, send and settle) runs in gp-api's
// route tests and in scripts/email-dev-e2e.ts against the SES simulator.

// The flow shell repeats each step's title in an sr-only drawer title (h2),
// so match the visible step heading (h3) to stay strict-mode safe.
const stepHeading = (page: Page, title: string) =>
  page.getByRole('heading', { level: 3, name: title, exact: true })

test.describe('Email send — audience', () => {
  test.use({ serviceWorkers: 'block' })

  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  test('picks a voter-file audience and is told no one has an email yet', async ({
    page,
  }) => {
    test.setTimeout(3 * 60 * 1000)

    await setFlagOverrides(page, { 'win-email-outreach': 'on' })
    await setupProCampaignUser(page)

    await page.goto('/dashboard/outreach/email', {
      waitUntil: 'domcontentloaded',
    })
    await NavigationHelper.dismissOverlays(page)

    // ── Goal ─────────────────────────────────────────────────────────────
    await expect(stepHeading(page, 'What do you want to do?')).toBeVisible({
      timeout: 30_000,
    })
    await page
      .getByRole('button', { name: 'Introduce myself to voters' })
      .click()

    // ── Compose ──────────────────────────────────────────────────────────
    await expect(stepHeading(page, 'What do you want to say?')).toBeVisible({
      timeout: 30_000,
    })
    await page.locator('#email-subject').fill('Meet your candidate')
    const body = page.locator('[aria-label="Message body"]').first()
    await body.click()
    await page.keyboard.type('I am running to fix our roads. Say hello.')
    await page.getByRole('button', { name: 'Next' }).click()

    // ── Audience: the voter-file picker, email forced on ─────────────────
    await expect(stepHeading(page, 'Who do you want to reach?')).toBeVisible({
      timeout: 30_000,
    })
    await expect(
      page.getByText(
        'Select a list or create a new one. Only voters with an email address are included.',
      ),
    ).toBeVisible()
    await page.getByText('Choose a voter list').click()
    await page.getByRole('button', { name: /All voters/ }).click()

    await expect(page.getByTestId('email-audience-empty')).toContainText(
      'No one in this list has an email address yet.',
      { timeout: 60_000 },
    )
    await expect(page.locator('#email-consent')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled()
  })
})
