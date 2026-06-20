import { expect, type Page, test } from '@playwright/test'
import type { AxiosInstance } from 'axios'
import {
  setupElectedOfficeUser,
  openOrgSwitcher,
  closeOrgSwitcher,
} from 'src/helpers/organizations'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import { eventually } from 'tests/utils/eventually'

// E2E coverage for the "Run for a new office" branch of the follow-on flow
// (ENG-10389 task 11). Unlike same-office, this path must NOT skip the office
// picker: the office-holder makes an explicit new-office choice on the intent
// screen, picks a different seat, and the flow creates a brand-new campaign org
// alongside the existing ones (multi-org). Verifies the produced state (the new
// active campaign org plus the prior orgs), not just navigation.

test.beforeEach(async ({ page }) => {
  await blockSlowScripts(page)
})

const RACE = { zip: '82001', office: 'Cheyenne City Council - Ward 1' }

const continueButton = (page: Page) =>
  page.getByRole('button', { name: /continue/i }).first()

const clickContinue = async (page: Page) => {
  const button = continueButton(page)
  await expect(button).toBeVisible()
  await expect(button).toBeEnabled()
  await button.click()
}

type Org = { slug: string; name: string; status: string }

const getOrgs = async (client: AxiosInstance): Promise<Org[]> => {
  const { data } = await client.get<{ organizations: Org[] }>(
    '/v1/organizations',
  )
  return data.organizations
}

test('new-office follow-on: intent screen, office picker shown, new active org', async ({
  page,
}) => {
  test.setTimeout(180_000)

  // A held-office user reaches the intent screen (a no-office candidate would
  // skip it). reelectionOfficeSlug is populated from the elected office, so the
  // switcher offers both "run for" actions and FollowOnFlow renders the intent
  // step — we then take the new-office branch.
  const { client } = await setupElectedOfficeUser(page, RACE)

  const orgsBefore = await getOrgs(client)
  const electedOfficeOrg = orgsBefore.find((o) => o.slug.startsWith('eo-'))
  if (!electedOfficeOrg) throw new Error('No elected office org after setup')
  const wonCampaignOrg = orgsBefore.find((o) => o.slug.startsWith('campaign-'))
  if (!wonCampaignOrg) throw new Error('No won campaign org after setup')
  const orgSlugsBefore = orgsBefore.map((o) => o.slug)

  // "I won my race" launches the campaign with a still-future electionDate, so
  // it reads "active" and canStartCampaign stays false (the actions are hidden).
  // Backdate it (the production state once the election has happened) so
  // eligibility opens up. PUT /v1/campaigns/mine merges details and resolves the
  // campaign from x-organization-slug, so point the header at the won campaign.
  client.defaults.headers['x-organization-slug'] = wonCampaignOrg.slug
  await client.put('/v1/campaigns/mine', {
    details: { electionDate: '2020-11-03' },
  })

  // 1–2: reload so the picker's eligibility query refetches, then open the
  // switcher and start the new-office flow.
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
  await NavigationHelper.dismissOverlays(page)
  await openOrgSwitcher(page)
  const newOfficeAction = page.getByRole('menuitem', {
    name: 'Run for a new office',
  })
  await expect(newOfficeAction).toBeVisible({ timeout: 15_000 })
  await newOfficeAction.click()

  // 3: routes to the office-selection entry with new-office intent (no from).
  await expect(page).toHaveURL(
    /\/onboarding\/office-selection\?intent=new-office$/,
    { timeout: 15_000 },
  )

  // 4: IntentStep names the held office. new-office is NOT pre-selected — the
  // office-holder makes an explicit choice (neither card is checked on arrival).
  const intentHeading = page.getByRole('heading', {
    level: 1,
    name: /running for re-election in .+ or a new office/i,
  })
  await expect(intentHeading).toBeVisible({ timeout: 15_000 })
  await expect(intentHeading).toContainText(electedOfficeOrg.name)
  await expect(
    page.getByRole('radio', { name: /same office/i }),
  ).not.toBeChecked()
  await expect(
    page.getByRole('radio', { name: /new office/i }),
  ).not.toBeChecked()
  await page.getByRole('radio', { name: /new office/i }).click()
  await expect(page.getByRole('radio', { name: /new office/i })).toBeChecked()
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

  // 5: office-picker IS shown for new-office (not skipped). Search by ZIP and
  // pick a different seat than the held office.
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: /what office are you running/i,
    }),
  ).toBeVisible({ timeout: 15_000 })
  await page.getByLabel(/zip code/i).fill(RACE.zip)
  await page.getByRole('button', { name: /search/i }).click()

  const officeGroup = page.getByRole('radiogroup', {
    name: /available offices/i,
  })
  await officeGroup
    .getByRole('radio')
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 })
  // Need ≥2 results to pick a seat other than the held one; assert it so a
  // single-office API response fails immediately and clearly instead of the
  // hasNotText filter matching nothing and timing out with no signal.
  const allOffices = officeGroup.getByRole('radio')
  const officeCount = await allOffices.count()
  if (officeCount < 2) {
    throw new Error(
      `zip ${RACE.zip} returned only ${officeCount} office(s) from the election API — need at least 2 to pick a different seat`,
    )
  }
  const differentOffice = allOffices.filter({ hasNotText: RACE.office }).first()
  await expect(differentOffice).toBeVisible()
  await differentOffice.click()
  // Selecting an office hydrates its race via race-by-position; FollowOnFlow
  // keeps Continue disabled (canContinue → !isHydratingOffice) until that lands,
  // so clickContinue's enabled-wait gates on the hydration — no fixed timeout.
  await clickContinue(page)

  // path-to-victory (not skipped — the picked office is structured).
  await expect(
    page.getByRole('heading', { level: 1, name: /votes needed to win/i }),
  ).toBeVisible({ timeout: 30_000 })
  await clickContinue(page)

  // voter-demographics.
  await expect(
    page.getByRole('heading', { level: 1, name: /voter insights/i }),
  ).toBeVisible({ timeout: 15_000 })
  await clickContinue(page)

  // pledge -> launch -> dashboard.
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

  // 6: the new campaign org exists and reads active (produced state, via API).
  const newCampaignOrg = await eventually(
    { that: 'the new-office campaign org exists and reads active' },
    async () => {
      const created = (await getOrgs(client)).find(
        (o) =>
          o.slug.startsWith('campaign-') && !orgSlugsBefore.includes(o.slug),
      )
      if (!created) throw new Error('New campaign org not found yet')
      if (created.status !== 'active') {
        throw new Error(`New campaign org status is ${created.status}`)
      }
      return created
    },
  )

  // AC3: the resulting org list contains the new campaign plus the prior orgs.
  const orgsAfter = await getOrgs(client)
  const slugsAfter = orgsAfter.map((o) => o.slug)
  for (const slug of orgSlugsBefore) {
    expect(slugsAfter).toContain(slug)
  }
  expect(slugsAfter).toContain(newCampaignOrg.slug)

  // 7 (UI): the switcher shows the new campaign alongside the prior orgs.
  await NavigationHelper.dismissOverlays(page)
  await openOrgSwitcher(page)
  await expect(
    page.getByRole('menuitem', { name: newCampaignOrg.name }).first(),
  ).toBeVisible({ timeout: 15_000 })
  await expect(
    page.getByRole('menuitem', { name: wonCampaignOrg.name }).first(),
  ).toBeVisible({ timeout: 15_000 })
  await expect(
    page.getByRole('menuitem', { name: electedOfficeOrg.name }).first(),
  ).toBeVisible({ timeout: 15_000 })
  await closeOrgSwitcher(page)
})
