import { expect, test } from '@playwright/test'
import { blockSlowScripts } from 'src/helpers/navigation.helper'
import { setupProCampaignUser, winRaceAsPro } from 'src/helpers/organizations'

test.beforeEach(async ({ page }) => {
  await blockSlowScripts(page)
})

test('"I won" hands a Pro winner to Serve onboarding until they finish it', async ({
  page,
}) => {
  const { client } = await setupProCampaignUser(page, {
    zip: '82001',
    office: 'Cheyenne City Council - Ward 1',
  })

  await winRaceAsPro(page)
  await expect(
    page
      .getByRole('heading', { level: 1 })
      .filter({ hasText: /party designation|term run|look right/i }),
  ).toBeVisible({ timeout: 15_000 })

  // The office is linked to the campaign and starts unfinished: the pledge at
  // the end of onboarding finishes it.
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

  // Leaving partway, the dashboard brings them back.
  await page.goto('/dashboard/polls')
  await page.waitForURL('**/serve/onboarding', { timeout: 15_000 })
})
