import { expect, test } from 'src/fixtures/test'
import { captureAnalyticsEvents } from 'src/helpers/analyticsEvents.helper'
import { blockSlowScripts } from 'src/helpers/navigation.helper'
import { setupProCampaignUser, winRaceAsPro } from 'src/helpers/organizations'

test.beforeEach(async ({ page }) => {
  await blockSlowScripts(page)
})

test('"I won" hands a Pro winner to the warm welcome until they finish it', async ({
  page,
}) => {
  const analytics = await captureAnalyticsEvents(page)
  const { client } = await setupProCampaignUser(page, {
    zip: '82001',
    office: 'Cheyenne City Council - Ward 1',
  })

  await winRaceAsPro(page)
  const won = page.getByRole('heading', { level: 1, name: /You won!/ })
  await expect(won).toBeVisible({ timeout: 20_000 })
  await analytics.expectEvent('Serve Onboarding - You Won Viewed', {
    electedOfficeId: expect.any(String),
  })

  // The office is linked to the campaign and starts unfinished: Done at the
  // end of the welcome finishes it.
  const { data: offices } = await client.get<
    { campaignId: number | null; onboardingCompletedAt: string | null }[]
  >('/v1/elected-office/mine')
  expect(offices).toHaveLength(1)
  expect(offices[0]?.campaignId).not.toBeNull()
  expect(offices[0]?.onboardingCompletedAt).toBeNull()

  const { data } = await client.get<{ organizations: { slug: string }[] }>(
    '/v1/organizations',
  )
  expect(data.organizations.some((org) => org.slug.startsWith('eo-'))).toBe(
    true,
  )

  // The welcome's own button arrives last, after the numbers have counted.
  await page
    .getByRole('button', { name: 'Let’s get ready' })
    .click({ timeout: 20_000 })
  await expect(won).toBeHidden({ timeout: 10_000 })
  await analytics.expectEvent('Serve Onboarding - You Won Completed', {
    hasPopulation: expect.any(Boolean),
    hasVotes: expect.any(Boolean),
  })

  // Leaving partway, the dashboard brings them back.
  await page.goto('/dashboard/polls')
  await page.waitForURL('**/serve/onboarding', { timeout: 15_000 })
})
