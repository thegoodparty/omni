import { expect, test } from '@playwright/test'
import { blockSlowScripts } from 'src/helpers/navigation.helper'
import { setupProCampaignUser } from 'src/helpers/organizations'
import { printWalkListPath, seedTurf } from 'src/helpers/door-knocking-e2e'

// The printable walk list is the feature's offline story: a server component
// with no client code of its own, reached on a phone with one bar. Its unit
// tests cover the branches with `serverRequest` and `candidateAccess` mocked,
// which is exactly what leaves the interesting question open — whether gp-api
// really answers the way the page assumes. These assert the wiring end to end.
//
// The route is never built here. POST turfs/:id/knock is the only call in the
// feature that reaches a paid external vendor (Geoapify's route planner), so a
// spec that rendered a populated sheet would spend real credits from a shared
// pool on every run of a suite that gates every PR in the monorepo, and would
// take a 30s third-party call as a dependency. See the PR for the full
// reasoning; the rendered sheet stays covered by WalkSheet.test.tsx.
test.describe('printable door-knocking walk list', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  // The sheet is voter data. candidateAccess() has to bounce a signed-out
  // browser before anything is fetched, not render a shell and fetch anyway.
  test('bounces a signed-out visitor to sign-up', async ({ page }) => {
    await page.goto(printWalkListPath(1), { waitUntil: 'domcontentloaded' })

    await expect(page).toHaveURL(/\/sign-up/, { timeout: 30_000 })
  })

  test('404s a non-numeric turf id', async ({ page }) => {
    test.setTimeout(3 * 60 * 1000)

    await setupProCampaignUser(page)

    // gp-api parses this param with ParseIntPipe, which 400s rather than 404s,
    // so the page short-circuits a hand-mangled URL before asking at all. The
    // status is the contract here — a soft 404 rendered as 200 would still look
    // right on screen while telling crawlers and monitoring the opposite.
    const response = await page.goto(printWalkListPath('not-a-turf'), {
      waitUntil: 'domcontentloaded',
    })

    expect(response?.status()).toBe(404)
    await expect(
      page.getByRole('heading', { name: 'Error: 404 Not Found' }),
    ).toBeVisible({ timeout: 20_000 })
  })

  // The case a canvasser actually hits: they open the print link for a list
  // they own but have not knocked yet, so no route exists to print. gp-api
  // answers 404 ("This turf has not been knocked yet") and the page has to
  // treat that as "nothing to show" rather than surfacing an error — a
  // cross-service assumption no mock can confirm.
  test('404s a turf of your own that has never been knocked', async ({
    page,
  }) => {
    test.setTimeout(3 * 60 * 1000)

    const { client } = await setupProCampaignUser(page)
    const turf = await seedTurf(client, `E2E print turf ${Date.now()}`)

    const response = await page.goto(printWalkListPath(turf.id), {
      waitUntil: 'domcontentloaded',
    })

    expect(response?.status()).toBe(404)
    await expect(
      page.getByRole('heading', { name: 'Error: 404 Not Found' }),
    ).toBeVisible({ timeout: 20_000 })
  })
})
