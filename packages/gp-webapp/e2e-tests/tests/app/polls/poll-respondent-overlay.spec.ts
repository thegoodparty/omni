import { expect, test } from '@playwright/test'
import type {
  SeedPollResultsRequest,
  SeedPollResultsResponse,
} from '@goodparty_org/contracts'
import { setFlagOverrides } from 'src/helpers/campaignStory.helper'
import {
  fetchListMembers,
  fullPersonName,
  openPersonViaTypeahead,
} from 'src/helpers/crm-contacts-e2e'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import {
  setupElectedOfficeUser,
  switchOrganization,
} from 'src/helpers/organizations'

// What the Constituents overlay shows for someone who answered a poll: the
// issue their reply was filed under and the poll's sent and responded events,
// each linking back to the poll. On dev those rows come from the poll analysis
// pipeline (polls-onboarding.spec.ts drives it and checks it wrote them), which
// a PR preview never runs, so this spec seeds the same rows through
// POST /v1/test-fixtures/polls/results and runs on every PR.

const district = {
  zip: '82001',
  office: 'Cheyenne City Council - Ward 1',
}

const ISSUE = {
  issueTitle: 'Traffic Congestion',
  issueSummary:
    'Traffic congestion is a major problem in the city. It is causing ' +
    'delays and frustration for residents.',
}

test.beforeEach(async ({ page }) => {
  // The overlay's Top Issues and poll activity sections render only with
  // this flag on; pin it so live dev targeting can't hide them.
  await setFlagOverrides(page, {
    'serve-contacts-activities-and-issues': 'on',
  })
  await blockSlowScripts(page)
})

test('person overlay shows constituent issues and activities', async ({
  page,
}) => {
  test.setTimeout(4 * 60 * 1000)

  const { client } = await setupElectedOfficeUser(page, district)

  const people = await fetchListMembers(client, 'all')
  const person = people.find(
    (candidate) => fullPersonName(candidate).length >= 3,
  )
  expect(person, 'a constituent in the district').toBeTruthy()

  const { data: poll } = await client.post<SeedPollResultsResponse>(
    '/v1/test-fixtures/polls/results',
    { personId: person!.id, ...ISSUE } satisfies SeedPollResultsRequest,
  )

  await page.goto('/dashboard')
  await switchOrganization(page, district.office)
  await page.goto('/dashboard/contacts')
  await NavigationHelper.dismissOverlays(page)

  const personSheet = await openPersonViaTypeahead(page, person!)

  await expect(
    personSheet.getByText(person!.firstName!, { exact: false }).first(),
  ).toBeVisible({ timeout: 5_000 })

  await expect(personSheet.getByText('Top Issues')).toBeVisible({
    timeout: 10_000,
  })
  // A link role, because the summary under it repeats the title in prose.
  const issueLink = personSheet
    .getByRole('link', { name: ISSUE.issueTitle })
    .first()
  await expect(issueLink).toBeVisible()
  await expect(issueLink).toHaveAttribute(
    'href',
    `/dashboard/polls/${poll.pollId}`,
  )

  await expect(personSheet.getByText('Activity Feed')).toBeVisible({
    timeout: 10_000,
  })
  await expect(personSheet.getByText('Sent').first()).toBeVisible()
  await expect(personSheet.getByText('Responded').first()).toBeVisible()

  const activityLink = personSheet
    .getByRole('link', { name: poll.pollName })
    .first()
  await expect(activityLink).toHaveAttribute(
    'href',
    `/dashboard/polls/${poll.pollId}`,
  )
})
