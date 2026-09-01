import { expect, test } from '@playwright/test'
import { setupElectedOfficeUser } from 'src/helpers/organizations'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import { setFlagOverrides } from 'src/helpers/campaignStory.helper'

// First-ever e2e coverage for Serve "Ordinances". serve-ordinances is
// unconditional for every elected office now (ENG-11005), so these run with
// no override cookie — that absence is itself the regression test for the
// removed per-request 403 gate. The layered serve-ordinance-quality-loop flag
// is still dark and untouched by that change, so the one case that touches it
// forces it via the override cookie rather than live Amplitude targeting.
test.describe('Ordinances', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  test('the nav item opens the Ordinances page and the new-ordinance form', async ({
    page,
  }) => {
    await setupElectedOfficeUser(page)
    await page.goto('/dashboard/chief-of-staff', {
      waitUntil: 'domcontentloaded',
    })
    await NavigationHelper.dismissOverlays(page)

    const navItem = page.locator('#ordinances-dashboard')
    await expect(navItem).toBeVisible({ timeout: 30_000 })
    await navItem.click()
    await page.waitForURL(/\/dashboard\/ordinances/, { timeout: 15_000 })

    await expect(
      page.getByRole('heading', { level: 1, name: 'Ordinances' }),
    ).toBeVisible()

    await page.getByRole('link', { name: 'New ordinance' }).click()
    await page.waitForURL(/\/dashboard\/ordinances\/new/, { timeout: 15_000 })
    await expect(
      page.getByRole('heading', { level: 1, name: 'New ordinance' }),
    ).toBeVisible()
  })

  test('the ordinances list route is open, not 403, for a fresh office', async ({
    page,
  }) => {
    const { client } = await setupElectedOfficeUser(page)

    // Direct regression test for the removed assertEnabled gate — a flag-off
    // user used to get a 403 here.
    const res = await client.get('/v1/ordinances')

    expect(res.status).toBe(200)
    expect(res.data.items).toEqual([])
  })

  test('creates an ordinance from the form and lists it on the page', async ({
    page,
  }) => {
    const { client } = await setupElectedOfficeUser(page)
    // Skips the chat-styled typewriter intro so the form fields mount
    // immediately instead of waiting on the type-out animation.
    await page.emulateMedia({ reducedMotion: 'reduce' })

    await page.goto('/dashboard/ordinances/new', {
      waitUntil: 'domcontentloaded',
    })
    await NavigationHelper.dismissOverlays(page)

    const goalText = `E2E ordinance ${Date.now()}`
    await page.getByLabel('What are you hoping to accomplish?').fill(goalText)

    const created = page.waitForResponse(
      (r) =>
        r.url().includes('/api/v1/ordinances') &&
        r.request().method() === 'POST',
    )
    await page.getByRole('button', { name: 'Start guided flow' }).click()
    const createdRes = await created
    expect(createdRes.ok()).toBeTruthy()

    // The button's own handler redirects into the guided clarify flow, which
    // opens a live LLM chat — go straight to the list page instead so this
    // stops at record creation.
    await page.goto('/dashboard/ordinances', {
      waitUntil: 'domcontentloaded',
    })
    await NavigationHelper.dismissOverlays(page)

    await expect(page.getByText(goalText)).toBeVisible({ timeout: 15_000 })

    const { data } = await client.get<{
      items: { goalText: string | null }[]
    }>('/v1/ordinances')
    expect(data.items.some((o) => o.goalText === goalText)).toBe(true)
  })

  test('the quality-loop widget stays absent with the flag forced off', async ({
    page,
  }) => {
    const { client } = await setupElectedOfficeUser(page)
    const { data: created } = await client.post<{ slug: string }>(
      '/v1/ordinances',
      { seedType: 'new', goalText: 'Tree canopy' },
    )
    await client.patch(`/v1/ordinances/${created.slug}`, {
      status: 'draft',
      draftTitle: 'Draft canopy amendment',
      draftBody: 'Section 1. Canopy goal of forty percent by 2040.',
    })

    // serve-ordinance-quality-loop is a separate, still-dark flag — force it
    // off so this doesn't depend on live Amplitude targeting for the
    // synthetic test user. Set before navigating per the SSR seed rule.
    await setFlagOverrides(page, { 'serve-ordinance-quality-loop': 'off' })

    await page.goto(`/dashboard/ordinances/draft/${created.slug}`, {
      waitUntil: 'domcontentloaded',
    })
    await NavigationHelper.dismissOverlays(page)

    await expect(page.getByText('Draft canopy amendment')).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByText('Improvements are running')).toHaveCount(0)
  })
})
