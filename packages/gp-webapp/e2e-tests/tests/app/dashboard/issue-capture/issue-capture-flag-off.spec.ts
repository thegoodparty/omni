import { expect, test, type Page } from '@playwright/test'
import { setFlagOverrides } from 'src/helpers/campaignStory.helper'
import {
  createFlowStepHeading,
  gotoDoorKnocking,
} from 'src/helpers/door-knocking-e2e'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import { setupProCampaignUser } from 'src/helpers/organizations'

// The rollout gate for issue capture: with `issue-capture` off, nothing of it
// reaches a candidate. The flag is pinned off here rather than read from
// Amplitude, so turning it on for test users later cannot break this spec.
//
// The drawer has no real effort behind it: a phone row is stubbed, as in
// outreach-assign-member.spec.ts, because its "What we heard" action reads
// only the flag, and a real list would have to be built through the whole
// phone-banking flow first.

const FIXTURE_OUTREACH_ID = 424242

const outreachListFixture = [
  {
    id: FIXTURE_OUTREACH_ID,
    outreachType: 'nativePhoneBanking',
    name: 'Ward 1 Calls',
    status: 'in_progress',
    createdAt: '2026-01-01T00:00:00.000Z',
    date: '2026-01-01T00:00:00.000Z',
    phoneListId: 10,
  },
]

const outreachDetailFixture = {
  id: FIXTURE_OUTREACH_ID,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  campaignId: null,
  outreachType: 'nativePhoneBanking',
  projectId: null,
  name: 'Ward 1 Calls',
  status: 'in_progress',
  error: null,
  audienceRequest: null,
  script: null,
  message: null,
  date: '2026-01-01T00:00:00.000Z',
  imageUrl: null,
  voterFileFilterId: 1,
  doorKnockingRouteId: null,
  phoneListId: 10,
  identityId: null,
  didState: null,
  didNpaSubset: [],
  title: null,
  textCount: null,
  billableTextCount: null,
  campaignPlanDueDate: null,
  organizationSlug: null,
  archivedAt: null,
  phoneBanking: {
    listId: 10,
    entriesTotal: 25,
    entriesCalled: 5,
    peopleTotal: 25,
    peopleCalled: 5,
    byOutcome: {},
    supporters: 2,
    unsure: 1,
    nonSupporters: 2,
    byFollowUp: {},
  },
}

const stubPhoneOutreach = async (page: Page) => {
  await page.route(/\/api\/v1\/outreach(\?|$)/, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ json: outreachListFixture })
      : route.continue(),
  )
  await page.route(
    new RegExp(`/api/v1/outreach/${FIXTURE_OUTREACH_ID}(\\?|$)`),
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ json: outreachDetailFixture })
        : route.continue(),
  )
  await page.route(
    new RegExp(`/api/v1/outreach/${FIXTURE_OUTREACH_ID}/assignments(\\?|$)`),
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ json: { assignees: [] } })
        : route.continue(),
  )
}

test.describe('issue capture with its flag off', () => {
  test.use({ serviceWorkers: 'block' })

  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  test('offers no question, no report and no report link', async ({ page }) => {
    test.setTimeout(4 * 60 * 1000)
    await setFlagOverrides(page, { 'issue-capture': 'off' })
    await setupProCampaignUser(page)

    await gotoDoorKnocking(page)
    await expect(
      createFlowStepHeading(page, 'What do you want to do?'),
    ).toBeVisible({ timeout: 60_000 })
    await expect(
      page.getByRole('button', { name: 'Introduce myself' }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Hear from voters' }),
    ).toHaveCount(0)

    await page.goto('/dashboard/outreach')
    await expect(page.locator('#win-contacts-dashboard')).toBeVisible({
      timeout: 30_000,
    })
    await page.getByRole('button', { name: /^Phone banking/ }).click()
    await expect(
      page.getByRole('button', { name: 'Write my own script' }),
    ).toBeVisible({ timeout: 15_000 })
    await expect(
      page.getByRole('button', { name: 'Introduce myself to voters' }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Hear from voters' }),
    ).toHaveCount(0)

    await page.goto(`/dashboard/issue-capture/${FIXTURE_OUTREACH_ID}`)
    await page.waitForURL(
      (url) =>
        url.pathname.startsWith('/dashboard') &&
        !url.pathname.startsWith('/dashboard/issue-capture'),
      { timeout: 30_000 },
    )
    await expect(
      page.getByRole('heading', { name: 'What we heard' }),
    ).toHaveCount(0)

    await stubPhoneOutreach(page)
    await page.goto(`/dashboard/outreach?outreachId=${FIXTURE_OUTREACH_ID}`, {
      waitUntil: 'domcontentloaded',
    })
    await NavigationHelper.dismissOverlays(page)
    await expect(
      page.getByRole('heading', { name: 'Ward 1 Calls' }),
    ).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('link', { name: /What we heard/ })).toHaveCount(
      0,
    )
  })
})
