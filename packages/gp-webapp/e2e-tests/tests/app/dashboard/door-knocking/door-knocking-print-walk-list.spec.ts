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

  // The sheet is voter data, and this URL is the one people share and bookmark —
  // middleware.ts intercepts it before the page's candidateAccess() ever runs,
  // and has to preserve the deep link so a canvasser who taps a print link on
  // their phone lands back on the sheet after logging in rather than on a
  // dashboard home with no idea which list they wanted.
  //
  // Needs no authenticated user at all, which is why it stays its own test.
  test('bounces a signed-out visitor to login, preserving the deep link', async ({
    page,
  }) => {
    const target = printWalkListPath(1)

    await page.goto(target, { waitUntil: 'domcontentloaded' })

    await page.waitForURL(/\/login\?/, { timeout: 30_000 })
    const url = new URL(page.url())
    expect(url.pathname).toBe('/login')
    expect(url.searchParams.get('redirect_url')).toBe(target)
  })

  // Both inputs share one authenticated user on purpose: `setupProCampaignUser`
  // provisions a fresh Clerk user + campaign, and concurrent bootstraps against
  // a cold preview are this suite's dominant flake source (see the 401 note in
  // tests/utils/headless-user.ts). Every other spec file here spends exactly one.
  // The two assertions are independent page loads, so sharing costs no isolation.
  test('404s a print URL with nothing to print', async ({ page }) => {
    test.setTimeout(3 * 60 * 1000)

    const { client } = await setupProCampaignUser(page)
    const turf = await seedTurf(client, `E2E print turf ${Date.now()}`)

    // gp-api parses this param with ParseIntPipe, which 400s rather than 404s,
    // so the page short-circuits a hand-mangled URL before asking at all.
    const mangled = await page.goto(printWalkListPath('not-a-turf'), {
      waitUntil: 'domcontentloaded',
    })
    // The status is the contract, not just the rendered copy: a soft 404 served
    // as 200 looks identical on screen and wrong to everything else.
    expect(mangled?.status()).toBe(404)
    await expect(
      page.getByRole('heading', { name: 'Error: 404 Not Found' }),
    ).toBeVisible({ timeout: 20_000 })

    // The case a canvasser actually hits: the print link for a list they own but
    // have not knocked yet, so no route exists to print. gp-api answers 404
    // ("This turf has not been knocked yet") and the page has to treat that as
    // "nothing to show" rather than surfacing an error — a cross-service
    // assumption no mock can confirm.
    const unknocked = await page.goto(printWalkListPath(turf.id), {
      waitUntil: 'domcontentloaded',
    })
    expect(unknocked?.status()).toBe(404)
    await expect(
      page.getByRole('heading', { name: 'Error: 404 Not Found' }),
    ).toBeVisible({ timeout: 20_000 })

    // Control: the turf really does exist and belong to this org. Without it the
    // assertion above would pass just as happily against a seed that silently
    // failed, which would make this a test that the print route 404s everything.
    // So the 404 is specifically about the missing route, not a missing turf.
    const { status } = await client.get(`/v1/door-knocking/turfs/${turf.id}`, {
      validateStatus: () => true,
    })
    expect(status).toBe(200)
  })
})
