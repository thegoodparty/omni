import { expect, type Page, test } from '@playwright/test'
import { setupClerkTestingToken } from '@clerk/testing/playwright'
import {
  blockSlowScripts,
  NavigationHelper,
} from '../../../src/helpers/navigation.helper'
import { fillClerkSignUpForm } from '../../../src/helpers/clerk.helper'
import { clickOnboardingContinue } from '../../../src/helpers/onboarding.helper'

// Regression for the Win onboarding office picker on zip 28806 (Asheville, NC).
// election-api returns several offices whose Race rows are duplicated for the
// same election date (a stale + fresh BallotReady PositionElection). That broke
// the picker three ways: role pills stopped filtering, selecting one row lit up
// a different one, and rows collided. This drives the real dev data end to end
// and asserts the two user-visible behaviors — pills filter, and a selection
// highlights exactly one row. Both hold whether or not the duplicates are still
// present, so this stays green after the data team prunes them upstream.

test.beforeEach(async ({ page }) => {
  await blockSlowScripts(page)
})

const advanceToOfficeSelection = async (page: Page): Promise<void> => {
  await expect(
    page.getByRole('heading', { level: 1, name: /winning campaign plan/i }),
  ).toBeVisible({ timeout: 15000 })
  await clickOnboardingContinue(page)

  await expect(
    page.getByRole('heading', { level: 1, name: /already on the ballot/i }),
  ).toBeVisible()
  await page.getByRole('radio').first().click({ force: true })
  await clickOnboardingContinue(page)

  await expect(
    page.getByRole('heading', { level: 1, name: /party designation/i }),
  ).toBeVisible()
  await page.getByRole('radio').first().click({ force: true })
  await clickOnboardingContinue(page)

  await expect(
    page.getByRole('heading', { level: 1, name: /what office/i }),
  ).toBeVisible()
}

test('office picker filters by role pill and highlights one row for zip 28806', async ({
  page,
}) => {
  await setupClerkTestingToken({ page })

  await page.goto('/sign-up')
  await NavigationHelper.dismissOverlays(page)
  await fillClerkSignUpForm(page)

  await page.waitForURL((url) => url.pathname.startsWith('/onboarding/'), {
    timeout: 15000,
  })
  await NavigationHelper.dismissOverlays(page)

  await advanceToOfficeSelection(page)

  await page.getByLabel(/zip code/i).fill('28806')
  await page.getByRole('button', { name: /search/i }).click()

  const officeGroup = page.getByRole('radiogroup', {
    name: /available offices/i,
  })
  await officeGroup
    .getByRole('radio')
    .first()
    .waitFor({ state: 'visible', timeout: 30000 })

  // Regression 1 — selecting a duplicate row highlights exactly that row, not
  // its twin. 28806 returns two "Asheville City Mayor" rows (same office + date,
  // different race id); before the fix they shared a radio value and lit up
  // together. Match on the accessible name — RadioCardItem exposes the office
  // title via aria-labelledby, so the radio's DOM textContent is empty.
  const mayorRows = officeGroup.getByRole('radio', {
    name: /Asheville City Mayor/i,
  })
  await expect(mayorRows.first()).toBeVisible()
  await mayorRows.first().click()
  await expect(officeGroup.getByRole('radio', { checked: true })).toHaveCount(1)

  // Regression 2 — the role pill actually narrows the list. The pill renders as
  // a radio named "City Council (N)" in a separate group from the office rows;
  // match its leading-paren label so it isn't confused with an office row.
  // After clicking, every remaining office row must be a City Council office
  // (compare the total count with the City-Council-named count).
  await page
    .getByRole('radio', { name: /^City Council \(\s*\d+\s*\)/i })
    .click()

  await expect
    .poll(async () => {
      const total = await officeGroup.getByRole('radio').count()
      const cityCouncil = await officeGroup
        .getByRole('radio', { name: /city council/i })
        .count()
      return total > 0 && total === cityCouncil
    })
    .toBe(true)
})
