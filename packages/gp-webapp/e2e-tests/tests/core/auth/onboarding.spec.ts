import { expect, type Page, test } from '@playwright/test'
import { setupClerkTestingToken } from '@clerk/testing/playwright'
import {
  blockSlowScripts,
  NavigationHelper,
} from '../../../src/helpers/navigation.helper'
import { fillClerkSignUpForm } from '../../../src/helpers/clerk.helper'
import { completeOnboardingUpToPledge } from '../../../src/helpers/onboarding.helper'

test.beforeEach(async ({ page }) => {
  await blockSlowScripts(page)
})

test('authenticate with onboarded user', async ({ page }) => {
  console.log('Setting up authenticated user...')

  await setupClerkTestingToken({ page })

  await page.goto('/sign-up')
  await NavigationHelper.dismissOverlays(page)

  const testUser = await fillClerkSignUpForm(page)

  await page.waitForURL((url) => url.pathname.startsWith('/onboarding/'), {
    timeout: 15000,
  })
  console.log('User created, now completing onboarding...')

  await NavigationHelper.dismissOverlays(page)

  await completeOnboardingFlow(page)

  if (!/\/(dashboard|onboarding\/success)/.test(page.url())) {
    throw new Error(`Onboarding failed - ended at: ${page.url()}`)
  }

  console.log(`Fully onboarded user created: ${testUser.email}`)
  console.log(`Final URL: ${page.url()}`)
})

async function completeOnboardingFlow(page: Page): Promise<void> {
  await completeOnboardingUpToPledge(page)
  await completePledgeStep(page)
}

async function completePledgeStep(page: Page): Promise<void> {
  console.log('Step: Pledge')
  await expect(
    page.getByRole('heading', { level: 1, name: /take our pledge/i }),
  ).toBeVisible()
  const submit = page
    .getByRole('button', { name: /agree.*create my plan/i })
    .first()
  await expect(submit).toBeVisible({ timeout: 15000 })
  await expect(submit).toBeEnabled()
  await submit.click()
  await page.waitForURL(/\/(dashboard|onboarding\/success)/, { timeout: 30000 })
}
