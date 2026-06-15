import { expect, type Page, test } from '@playwright/test'
import type { AxiosInstance } from 'axios'
import { authenticateTestUser } from 'tests/utils/api-registration'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import { eventually, wait } from 'tests/utils/eventually'

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

const RACE = { zip: '82001', office: 'Cheyenne City Council - Ward 1' }

type RaceListItem = {
  id: string
  brPositionId: string
  position: { name: string }
  election: { electionDay: string }
}

// Build a held-office user whose elected office has a DERIVED termEndAt, so the
// same-office follow-on can in turn derive a future electionDate (the whole
// point of ENG-10396). The shared api-registration helper creates the campaign
// straight from races-by-year and stores race.id — a ZipToPosition id — as
// details.raceId; EO term derivation looks the cadence up by Race.brHashId, so
// that id never resolves and termEndAt stays null. Mirror the real onboarding
// office picker instead: hydrate the race via race-by-position (whose data.id IS
// the BallotReady race hash) and repoint details.raceId at it BEFORE winning, so
// EO creation derives the term.
const setupReelectionEligibleUser = async (
  page: Page,
): Promise<AxiosInstance> => {
  const { client } = await authenticateTestUser(page, {
    isolated: true,
    race: RACE,
  })

  const { data: races } = await client.get<RaceListItem[]>(
    '/v1/elections/races-by-year',
    { params: { zipcode: RACE.zip } },
  )
  const race = races.find((r) => r.position.name === RACE.office)
  if (!race) throw new Error(`Race not found: ${RACE.office}`)

  const { data: hydrated } = await client.get<{ id: string }>(
    '/v1/elections/race-by-position',
    {
      params: {
        brPositionId: race.brPositionId,
        zip: RACE.zip,
        electionDate: race.election.electionDay,
      },
    },
  )
  // client header is campaign-<id> after authenticateTestUser, so this repoints
  // the just-created campaign's raceId at the BallotReady race hash.
  await client.put('/v1/campaigns/mine', { details: { raceId: hydrated.id } })

  // Win the race -> create the elected office (now with a derivable term).
  await page.goto('/dashboard/election-result')
  await wait(250)
  await page
    .getByRole('button', { name: 'I won my race' })
    .click({ timeout: 10_000 })
  await page.waitForURL('**/dashboard/briefings', { timeout: 15_000 })

  return client
}

test('same-office re-election follow-on: derived date, active org, duplicate blocked', async ({
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
