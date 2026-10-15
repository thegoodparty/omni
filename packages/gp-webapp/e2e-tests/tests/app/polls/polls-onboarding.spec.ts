import { expect, type Page, test } from '@playwright/test'
import { addBusinessDays, format, subDays } from 'date-fns'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import { setupElectedOfficeUser } from 'src/helpers/organizations'

type OutreachRow = {
  id: number
  outreachType: string
  status: string
  textCount: number | null
}

const district = {
  zip: '82001',
  office: 'Cheyenne City Council - Ward 1',
  constituents: 8717,
}

const expectToBeWithin = (
  value: number,
  expected: number,
  plusOrMinus: number,
) => {
  expect(value).toBeGreaterThanOrEqual(expected - plusOrMinus)
  expect(value).toBeLessThanOrEqual(expected + plusOrMinus)
}

const pickDateOnCalendar = async (page: Page, date: Date) => {
  const dateLocator = page.locator(`[data-day="${format(date, 'yyyy-MM-dd')}"]`)

  // If the date is not visible (e.g., it's in the next month), navigate forward
  if (!(await dateLocator.isVisible())) {
    await page.getByRole('button', { name: 'Go to the Next Month' }).click()
  }

  await dateLocator.click()
}

test.beforeEach(async ({ page }) => {
  await blockSlowScripts(page)
})

// @dev-only: runs on merge to dev (the develop e2e run) and on demand, never
// on PRs, because the constituent count comes from the live people database
// an ephemeral per-PR preview can't provide. See e2e-tests/CLAUDE.md
// ("@dev-only").
test.describe('poll onboarding @dev-only', () => {
  test('onboarding creates a poll held for staff review', async ({ page }) => {
    const { client } = await setupElectedOfficeUser(page, {
      zip: district.zip,
      office: district.office,
    })

    // Elected office users land on /dashboard/chief-of-staff after winning
    // their race, so navigate to the polls welcome screen before onboarding.
    await page.goto('/polls/welcome')
    // Dismiss the cookie banner AFTER landing on /polls/welcome — it re-renders
    // per page and overlaps the "Let's get started" CTA, intercepting the click.
    await NavigationHelper.dismissOverlays(page)
    // The CTA is a styleguide Button rendered `asChild` over a <Link>, so it is
    // an <a> (role=link), not a <button>.
    await page.getByRole('link', { name: "Let's get started" }).click()

    // The count comes from GET /v1/contacts/stats, a Databricks voter scan — a
    // fresh org's first hit can sit behind a cold warehouse, so wait out the
    // skeleton rather than flake on latency.
    const constituentCount = await page
      .getByTestId('total-constituents')
      .textContent({ timeout: 120_000 })

    expect(constituentCount).toBeTruthy()
    expectToBeWithin(
      parseInt(constituentCount!.replace(/,/g, ''), 10),
      district.constituents,
      500,
    )

    await page.getByRole('button', { name: 'Next', exact: true }).click()

    const yesterday = subDays(new Date(), 1)
    await page
      .locator(`[data-day="${format(yesterday, 'yyyy-MM-dd')}"]`)
      .click()
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await page.getByRole('button', { name: 'Create poll' }).click()
    await page.getByRole('button', { name: 'Pick Send Date' }).click()

    await pickDateOnCalendar(page, addBusinessDays(new Date(), 6))

    await page.getByRole('button', { name: 'Add Image' }).click()
    await page.getByRole('button', { name: 'See Preview' }).click()
    await page.getByRole('button', { name: 'Send SMS poll' }).click()

    await page.waitForURL(
      (url) => new URL(url).pathname === '/polls/onboarding/success',
    )

    const { data: rows } = await client.get<OutreachRow[]>('/v1/outreach/serve')
    const polls = rows.filter((row) => row.outreachType === 'poll')
    expect(polls).toHaveLength(1)
    expect(polls[0]).toMatchObject({ status: 'pending' })
    expect(polls[0]!.textCount).toBeGreaterThan(0)
    expect(polls[0]!.textCount).toBeLessThanOrEqual(500)
  })
})
