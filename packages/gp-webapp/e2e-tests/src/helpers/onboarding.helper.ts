import { expect, type Page } from '@playwright/test'
import { wait } from 'tests/utils/eventually'

// Shared drive through the onboarding steps up to (but not including) the
// pledge step. Both the generic onboarding smoke test and the campaign-story
// routing test need to reach the pledge; the pledge ending itself differs by
// the campaign-story flag (button copy + post-pledge destination), so callers
// own that last step.

const continueButton = (page: Page) =>
  page.getByRole('button', { name: /continue/i }).first()

export const clickOnboardingContinue = async (page: Page): Promise<void> => {
  const button = continueButton(page)
  await expect(button).toBeVisible()
  await expect(button).toBeEnabled()
  await button.click()
}

const completeWelcomeStep = async (page: Page): Promise<void> => {
  await expect(
    page.getByRole('heading', { level: 1, name: /winning campaign plan/i }),
  ).toBeVisible({ timeout: 15000 })
  await clickOnboardingContinue(page)
}

const completeBallotStatusStep = async (page: Page): Promise<void> => {
  await expect(
    page.getByRole('heading', { level: 1, name: /already on the ballot/i }),
  ).toBeVisible()
  await page.getByRole('radio').first().click({ force: true })
  await clickOnboardingContinue(page)
}

const completePartyAffiliationStep = async (page: Page): Promise<void> => {
  await expect(
    page.getByRole('heading', { level: 1, name: /party designation/i }),
  ).toBeVisible()
  await page.getByRole('radio').first().click({ force: true })
  await clickOnboardingContinue(page)
}

const completeOfficeSelectionStep = async (page: Page): Promise<void> => {
  await expect(
    page.getByRole('heading', { level: 1, name: /what office/i }),
  ).toBeVisible()

  await page.getByLabel(/zip code/i).fill('82001')
  await page.getByRole('button', { name: /search/i }).click()

  const officeGroup = page.getByRole('radiogroup', {
    name: /available offices/i,
  })
  await officeGroup
    .getByRole('radio')
    .first()
    .waitFor({ state: 'visible', timeout: 30000 })
  await officeGroup.getByRole('radio').first().click()

  await wait(1000)

  await clickOnboardingContinue(page)
}

const completePathToVictoryStep = async (page: Page): Promise<void> => {
  await expect(
    page.getByRole('heading', { level: 1, name: /votes needed to win/i }),
  ).toBeVisible({ timeout: 30000 })
  // Wait for the metrics card to render before continuing.
  await expect(page.getByText(/votes needed to win/i).first()).toBeVisible({
    timeout: 30000,
  })
  await clickOnboardingContinue(page)
}

// The campaign story is three skippable steps (why → background → issues). This
// helper's only caller runs with the campaign-story flag on, so the first step
// (why) is present here; Skip on any of them skips all three and jumps to the
// pledge (the caller asserts routing/pledge behavior, not story authoring). Wait
// on the step's page heading (always rendered) rather than the card, whose
// render waits on the story fetch.
const skipCampaignStoryStep = async (page: Page): Promise<void> => {
  await expect(
    page.getByRole('heading', { level: 1, name: /why are you running/i }),
  ).toBeVisible({ timeout: 30000 })
  await page.getByRole('button', { name: /^skip$/i }).click()
}

export const completeOnboardingUpToPledge = async (
  page: Page,
): Promise<void> => {
  await completeWelcomeStep(page)
  await completeBallotStatusStep(page)
  await completePartyAffiliationStep(page)
  await completeOfficeSelectionStep(page)
  await completePathToVictoryStep(page)
  await skipCampaignStoryStep(page)
  await expect(
    page.getByRole('heading', { level: 1, name: /take our pledge/i }),
  ).toBeVisible()
}
