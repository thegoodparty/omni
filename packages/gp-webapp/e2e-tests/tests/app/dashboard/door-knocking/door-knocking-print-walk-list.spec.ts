import { expect, test } from '@playwright/test'
import { blockSlowScripts } from 'src/helpers/navigation.helper'
import { printWalkListPath } from 'src/helpers/door-knocking-e2e'

// The printable walk list is the feature's offline story: a server component
// with no client code of its own, reached on a phone with one bar. Its unit
// tests cover the branches with `serverRequest` and `candidateAccess` mocked,
// which is exactly what leaves the interesting question open — whether gp-api
// really answers the way the page assumes.
//
// Only the refusals are asserted here, and neither needs a list. A populated
// sheet would: since 3.0 a saved list IS a bought Geoapify route — the two are
// one transaction — so seeding one would spend real credits from a shared pool
// on every run of a suite that gates every PR in the monorepo, and would take a
// 30s third-party call as a dependency. The rendered sheet stays covered by
// WalkSheet.test.tsx.
//
// The third refusal this file used to carry is gone with the state it named: a
// turf that existed with no route to print. 3.0 has no such turf.
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

  // Needs no authenticated user either, for the same reason as the bounce
  // above: middleware.ts sends a signed-out visitor to login before the page
  // runs, and this asserts the step BEFORE that — the page short-circuits a
  // hand-mangled id rather than asking gp-api about it, because gp-api parses
  // the param with ParseIntPipe and would answer 400 rather than 404.
  test('404s a print URL whose id names nothing', async ({ page }) => {
    const mangled = await page.goto(printWalkListPath('not-a-turf'), {
      waitUntil: 'domcontentloaded',
    })
    // The status is the contract, not just the rendered copy: a soft 404 served
    // as 200 looks identical on screen and wrong to everything else.
    expect(mangled?.status()).toBe(404)
    await expect(
      page.getByRole('heading', { name: 'Error: 404 Not Found' }),
    ).toBeVisible({ timeout: 20_000 })
  })
})
