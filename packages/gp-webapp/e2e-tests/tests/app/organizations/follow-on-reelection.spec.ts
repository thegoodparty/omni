import { expect, type Page, test } from '@playwright/test'
import type { AxiosInstance } from 'axios'
import {
  setupReelectionEligibleUser,
  openOrgSwitcher,
  closeOrgSwitcher,
} from 'src/helpers/organizations'
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

// @dev-only: drives the full re-election follow-on through live async pipelines
// (eligibility recompute, election-api term/electionDate derivation, multi-step
// org-status settling). It is flaky/failing against the ephemeral per-PR preview
// — already red on develop pre-dating this PR (commit ee2c423f3) — so it runs on
// the warm post-merge develop e2e, not on PR runs.
test('same-office re-election follow-on: derived date, active org, duplicate blocked @dev-only', async ({
  page,
}) => {
  test.setTimeout(180_000)

  const client = await setupReelectionEligibleUser(page)
  const electedOfficeOrg = await eventually(
    { that: 'the elected office organization exists' },
    () => getElectedOfficeOrg(client),
  )
  const eoSlug = electedOfficeOrg.slug
  const campaignSlugsBefore = await getCampaignOrgSlugs(client)

  // A held-office user is only eligible for re-election once the prior campaign
  // is concluded. The win happens on a freshly launched campaign whose
  // electionDate is still in the future, and "I won my race" sets only
  // details.wonGeneral (never the didWin column) — so the won campaign still
  // reads "active" and canStartCampaign stays false, hiding the action. Backdate
  // its electionDate (the production state once the election has happened) so
  // eligibility opens up; this also makes the won campaign org read "Past". PUT
  // /v1/campaigns/mine merges details, so only electionDate changes, and
  // resolves the campaign from x-organization-slug.
  const wonCampaignSlug = campaignSlugsBefore[0]
  if (!wonCampaignSlug) throw new Error('No won campaign org found after setup')
  client.defaults.headers['x-organization-slug'] = wonCampaignSlug
  await client.put('/v1/campaigns/mine', {
    details: { electionDate: '2020-11-03' },
  })

  // 1–2: reload so the picker's eligibility query refetches, then open the
  // switcher and start the re-election flow.
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
  await NavigationHelper.dismissOverlays(page)
  await openOrgSwitcher(page)
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

  // 4: no intent screen — the "Run for re-election" action is the intent, so we
  // land straight on welcome (follow-on copy). Leaving welcome fires POST
  // /v1/campaigns/follow-on (same-office creates immediately; picker skipped).
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
  await openOrgSwitcher(page)
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
  await closeOrgSwitcher(page)

  // 8 (produced state): wait for eligibility to settle to canStartCampaign:false
  // first (the only async step), so the duplicate follow-on below is then
  // deterministically rejected.
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

  // Assert the duplicate is rejected exactly once (not under eventually) — a
  // retried POST that unexpectedly succeeds would spawn extra campaigns, and a
  // non-HTTP error must surface rather than be masked as "not 409".
  let secondFollowOnStatus: number | undefined
  try {
    await client.post('/v1/campaigns/follow-on', {
      intent: 'same-office',
      fromOrganizationSlug: eoSlug,
    })
    secondFollowOnStatus = 201
  } catch (error) {
    const response = (error as { response?: { status?: number } }).response
    if (!response) throw error
    secondFollowOnStatus = response.status
  }
  expect(secondFollowOnStatus).toBe(409)
})
