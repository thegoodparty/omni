import { expect, type Page, test } from '@playwright/test'
import type { AxiosInstance } from 'axios'
import { setupElectedOfficeUser } from 'src/helpers/organizations'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import { eventually } from 'tests/utils/eventually'

// Regression coverage for the ENG-10396 fix: a same-office re-election follow-on
// derives its electionDate from the held office's termEndAt, so the new campaign
// reads "active" (not "Past") and a second re-election is rejected. This drives
// the same-office happy path through the real UI and verifies the produced state
// (org status, hidden actions, 409), not just navigation.

test.beforeEach(async ({ page }) => {
  await blockSlowScripts(page)
})

const HEADER = '[data-sidebar="header"]'

const openSwitcher = async (page: Page) => {
  await page.locator(HEADER).getByRole('button').first().click()
}

const closeSwitcher = async (page: Page) => {
  await page.keyboard.press('Escape')
}

const continueButton = (page: Page) =>
  page.getByRole('button', { name: /continue/i }).first()

const clickContinue = async (page: Page) => {
  const button = continueButton(page)
  await expect(button).toBeVisible()
  await expect(button).toBeEnabled()
  await button.click()
}

const getElectedOfficeOrg = async (client: AxiosInstance) => {
  const { data } = await client.get<{
    organizations: { slug: string; name: string; status: string }[]
  }>('/v1/organizations')
  const org = data.organizations.find((o) => o.slug.startsWith('eo-'))
  if (!org) throw new Error('No elected office organization found')
  return org
}

const getCampaignOrgSlugs = async (
  client: AxiosInstance,
): Promise<string[]> => {
  const { data } = await client.get<{ organizations: { slug: string }[] }>(
    '/v1/organizations',
  )
  return data.organizations
    .map((o) => o.slug)
    .filter((slug) => slug.startsWith('campaign-'))
}

test('same-office re-election follow-on: derived date, active org, duplicate blocked', async ({
  page,
}) => {
  test.setTimeout(180_000)

  const { client } = await setupElectedOfficeUser(page)
  const electedOfficeOrg = await getElectedOfficeOrg(client)
  const eoSlug = electedOfficeOrg.slug
  const campaignSlugsBefore = await getCampaignOrgSlugs(client)

  // 1–2: open the switcher and start the re-election flow.
  await NavigationHelper.dismissOverlays(page)
  await openSwitcher(page)
  const reelectionAction = page.getByRole('menuitem', {
    name: 'Run for re-election',
  })
  await expect(reelectionAction).toBeVisible({ timeout: 15_000 })
  await reelectionAction.click()

  // 3: routes to the office-selection entry with same-office intent + from-slug.
  await expect(page).toHaveURL(
    new RegExp(
      `/onboarding/office-selection\\?intent=same-office&from=${eoSlug}$`,
    ),
    { timeout: 15_000 },
  )

  // 4: IntentStep names the held office and pre-selects "same office".
  const intentHeading = page.getByRole('heading', {
    level: 1,
    name: /running for re-election in .+ or a new office/i,
  })
  await expect(intentHeading).toBeVisible({ timeout: 15_000 })
  await expect(intentHeading).toContainText(electedOfficeOrg.name)
  await expect(page.getByRole('radio', { name: /same office/i })).toBeChecked()
  // Leaving the intent step fires POST /v1/campaigns/follow-on.
  await clickContinue(page)

  // welcome (follow-on copy).
  await expect(
    page.getByRole('heading', { level: 1, name: /set up your new campaign/i }),
  ).toBeVisible({ timeout: 15_000 })
  await clickContinue(page)

  // ballot-status.
  await expect(
    page.getByRole('heading', { level: 1, name: /already on the ballot/i }),
  ).toBeVisible()
  await page.getByRole('radio').first().click({ force: true })
  await clickContinue(page)

  // party-affiliation (pick the first non-major option so the step validates).
  await expect(
    page.getByRole('heading', { level: 1, name: /party designation/i }),
  ).toBeVisible()
  await page.getByRole('radio').first().click({ force: true })
  await clickContinue(page)

  // 5: office-picker is SKIPPED for same-office — we land on path-to-victory,
  // never on the office-selection step.
  await expect(
    page.getByRole('heading', { level: 1, name: /votes needed to win/i }),
  ).toBeVisible({ timeout: 30_000 })
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: /what office are you running/i,
    }),
  ).toHaveCount(0)
  await clickContinue(page)

  // voter-demographics.
  await expect(
    page.getByRole('heading', { level: 1, name: /voter insights/i }),
  ).toBeVisible({ timeout: 15_000 })
  await clickContinue(page)

  // 6: pledge -> launch -> dashboard.
  await expect(
    page.getByRole('heading', { level: 1, name: /take our pledge/i }),
  ).toBeVisible()
  const submit = page
    .getByRole('button', { name: /agree.*create my plan/i })
    .first()
  await expect(submit).toBeVisible({ timeout: 15_000 })
  await expect(submit).toBeEnabled()
  await submit.click()
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 })

  // 7: the new campaign org is active (produced state, verified via the API).
  const newCampaignSlug = await eventually(
    { that: 'the new re-election campaign org exists and reads active' },
    async () => {
      const { data } = await client.get<{
        organizations: { slug: string; status: string }[]
      }>('/v1/organizations')
      const created = data.organizations.find(
        (o) =>
          o.slug.startsWith('campaign-') &&
          !campaignSlugsBefore.includes(o.slug),
      )
      if (!created)
        throw new Error('New re-election campaign org not found yet')
      if (created.status !== 'active') {
        throw new Error(
          `New campaign org status is ${created.status}, not active`,
        )
      }
      return created.slug
    },
  )
  expect(newCampaignSlug).toBeTruthy()

  // 7 (UI): the switcher shows the new campaign without a "Past" label; only the
  // original won campaign is "Past".
  await NavigationHelper.dismissOverlays(page)
  await openSwitcher(page)
  const orgItems = page.getByRole('menuitem')
  await expect(orgItems.first()).toBeVisible({ timeout: 15_000 })
  // toHaveCount polls (the switcher refetches the org list independently of the
  // API eventually() above, so the new org's item may not be in the DOM yet).
  await expect(
    page.getByRole('menuitem').filter({ hasText: 'Past' }),
  ).toHaveCount(1, { timeout: 15_000 })

  // 8 (UI): eligibility flipped — the "run for" actions are now hidden.
  await expect(
    page.getByRole('menuitem', { name: 'Run for re-election' }),
  ).toHaveCount(0, { timeout: 15_000 })
  await expect(
    page.getByRole('menuitem', { name: 'Run for a new office' }),
  ).toHaveCount(0, { timeout: 15_000 })
  await closeSwitcher(page)

  // 8 (produced state): a direct second follow-on is rejected with 409.
  await eventually(
    { that: 'a second same-office follow-on is rejected with 409' },
    async () => {
      try {
        await client.post('/v1/campaigns/follow-on', {
          intent: 'same-office',
          fromOrganizationSlug: eoSlug,
        })
        throw new Error('Expected the second follow-on to be rejected')
      } catch (error) {
        const status = (error as { response?: { status?: number } }).response
          ?.status
        if (status !== 409) {
          throw new Error(`Expected 409, got ${status ?? 'no response'}`)
        }
      }
    },
  )

  // eligibility endpoint agrees the user can no longer start a campaign.
  await eventually(
    { that: 'eligibility reports canStartCampaign:false' },
    async () => {
      const { data } = await client.get<{ canStartCampaign: boolean }>(
        '/v1/eligibility',
      )
      if (data.canStartCampaign !== false) {
        throw new Error('canStartCampaign is still true')
      }
    },
  )
})
