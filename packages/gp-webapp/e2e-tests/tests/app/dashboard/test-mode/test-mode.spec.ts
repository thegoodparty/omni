import { randomUUID } from 'crypto'
import { expect, test, type Page } from '@playwright/test'
import type { AxiosInstance } from 'axios'
import { setFlagOverrides } from 'src/helpers/campaignStory.helper'
import { authenticateTestUser } from 'tests/utils/api-registration'

// Staff Test mode (ENG-11230). The sidebar item renders only for
// @goodparty.org emails, so the staff specs sign in a qa-<uuid>@goodparty.org
// user: the shape gp-api's isTestUser matches (stubbed vendors, swept by
// sweepTestUsers) and dev's staff-test-mode segment targets. gp-api's
// TestModeGuard evaluates the flag itself; the override cookie only reaches
// the webapp, so these specs also rely on dev serving the flag to that
// segment (a preview's gp-api has no Amplitude key and serves every flag on).

const STAFF_TEST_MODE_FLAG = 'staff-test-mode'

type TestModeState = {
  organizations: { slug: string; name: string; type: string }[]
  active: {
    slug: string
    families: Record<string, { current: string | null } | undefined>
  } | null
}

const staffEmail = () => `qa-${randomUUID()}@goodparty.org`

const getTestMode = async (client: AxiosInstance, organizationSlug?: string) =>
  (
    await client.get<TestModeState>('/v1/test-mode', {
      headers: organizationSlug
        ? { 'X-Organization-Slug': organizationSlug }
        : {},
    })
  ).data

const gotoDashboard = async (page: Page) => {
  await page.goto('/dashboard')
  await expect(page.getByTestId('user-menu-name')).toBeVisible({
    timeout: 60_000,
  })
}

const openTestMode = async (page: Page) => {
  const sheet = page.getByRole('dialog', { name: 'Test mode' })
  if (!(await sheet.isVisible())) {
    await page.getByRole('button', { name: 'Test mode' }).click()
  }
  await expect(sheet).toBeVisible()
  return sheet
}

const pickOption = async (
  page: Page,
  trigger: ReturnType<Page['locator']>,
  name: string,
) => {
  await trigger.click()
  await page.getByRole('option', { name, exact: true }).click()
}

test.describe('staff test mode', () => {
  test.beforeEach(async ({ page }) => {
    await setFlagOverrides(page, { [STAFF_TEST_MODE_FLAG]: 'on' })
  })

  test('is not offered to a non-staff account', async ({ page }) => {
    await authenticateTestUser(page)
    await gotoDashboard(page)

    await expect(page.getByRole('button', { name: 'Test mode' })).toHaveCount(0)
  })

  test('creates, rewrites and deletes a test elected office', async ({
    page,
  }) => {
    test.setTimeout(4 * 60 * 1000)
    const { client } = await authenticateTestUser(page, {
      isolated: true,
      user: { email: staffEmail() },
    })
    await gotoDashboard(page)

    const sheet = await openTestMode(page)
    await pickOption(
      page,
      sheet.getByRole('combobox').first(),
      'Elected Office',
    )
    await sheet.getByPlaceholder('12345').fill('82001')
    await sheet.getByRole('button', { name: 'Search' }).click()
    const office = sheet
      .getByRole('combobox')
      .filter({ hasText: 'Select office' })
    await expect(office).toBeVisible({ timeout: 30_000 })
    await office.click()
    await page.getByRole('option').first().click()
    await sheet.getByRole('button', { name: 'Create' }).click()

    await expect
      .poll(async () => (await getTestMode(client)).organizations.length, {
        timeout: 60_000,
      })
      .toBe(1)
    const [created] = (await getTestMode(client)).organizations
    expect(created?.type).toBe('elected_office')
    const slug = created?.slug ?? ''

    // post-auth-redirect hops through /dashboard before the elected-office
    // home; opening the sheet mid-hop loses it to the remount.
    await page.waitForURL(/\/dashboard\/chief-of-staff/, { timeout: 60_000 })
    await expect(page.getByTestId('user-menu-name')).toBeVisible({
      timeout: 60_000,
    })

    const reopened = await openTestMode(page)
    const row = reopened.getByTestId(`test-mode-org-${slug}`)
    const term = row.getByTestId('test-mode-family-term')
    await expect(
      term.getByRole('button', { name: 'active', exact: true }),
    ).toBeDisabled({ timeout: 30_000 })
    await term.getByRole('button', { name: 'ending_soon' }).click()
    // Every preset button is disabled while the apply is in flight, so
    // ending_soon reads as disabled before the server has written anything.
    // `active` coming back enabled is what proves the apply finished.
    await expect(
      term.getByRole('button', { name: 'active', exact: true }),
    ).toBeEnabled({ timeout: 30_000 })
    await expect(
      term.getByRole('button', { name: 'ending_soon' }),
    ).toBeDisabled()
    await expect
      .poll(
        async () =>
          (await getTestMode(client, slug)).active?.families.term?.current,
        { timeout: 30_000 },
      )
      .toBe('ending_soon')

    await row.getByRole('button', { name: 'Delete' }).click()
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Delete' })
      .click()

    await expect
      .poll(async () => (await getTestMode(client)).organizations.length, {
        timeout: 60_000,
      })
      .toBe(0)
  })

  test('creates a test campaign on a real race in the chosen bundle', async ({
    page,
  }) => {
    test.setTimeout(4 * 60 * 1000)
    const { client } = await authenticateTestUser(page, {
      isolated: true,
      user: { email: staffEmail() },
    })
    await gotoDashboard(page)

    const sheet = await openTestMode(page)
    await sheet.getByPlaceholder('12345').fill('82001')
    await sheet.getByRole('button', { name: 'Search' }).click()

    const office = sheet
      .getByRole('combobox')
      .filter({ hasText: 'Select office' })
    await expect(office).toBeVisible({ timeout: 30_000 })
    await office.click()
    await page.getByRole('option').first().click()

    // Comboboxes after the office pick: Type, Office, Onboarding, Pro, ...
    await pickOption(page, sheet.getByRole('combobox').nth(3), 'on')
    await sheet.getByRole('button', { name: 'Create' }).click()

    await expect
      .poll(async () => (await getTestMode(client)).organizations.length, {
        timeout: 90_000,
      })
      .toBe(1)
    const [created] = (await getTestMode(client)).organizations
    expect(created?.type).toBe('campaign')
    const slug = created?.slug ?? ''

    const active = (await getTestMode(client, slug)).active
    expect(active?.families.pro?.current).toBe('on')
    expect(active?.families.onboarding?.current).toBe('complete')
    expect(active?.families.election?.current).toBe('in_8_weeks')

    await client.delete(`/v1/test-mode/organizations/${slug}`)
  })

  test('refuses to rewrite a real organization', async ({ page }) => {
    const { client } = await authenticateTestUser(page, {
      isolated: true,
      user: { email: staffEmail() },
    })
    const { data } = await client.get<{ organizations: { slug: string }[] }>(
      '/v1/organizations',
    )
    const realSlug = data.organizations.find((o) =>
      o.slug.startsWith('campaign-'),
    )?.slug
    expect(realSlug).toBeTruthy()

    const response = await client.post(
      '/v1/test-mode/apply',
      { family: 'pro', preset: 'on' },
      {
        headers: { 'X-Organization-Slug': realSlug },
        validateStatus: () => true,
      },
    )
    expect(response.status).toBe(409)
  })
})
