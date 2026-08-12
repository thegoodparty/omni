import { expect, test } from '@playwright/test'
import { blockSlowScripts } from 'src/helpers/navigation.helper'
import { setupProCampaignUser } from 'src/helpers/organizations'
import {
  enableNativeDoorKnockingFlag,
  gotoDoorKnocking,
  nativeShellHeading,
  seedTurf,
  turfRow,
} from 'src/helpers/door-knocking-e2e'

// The native shell's saved-list rail, driven only through DOM the map does not
// own. The turf is seeded through gp-api: drawing one means synthesizing pointer
// events on a deck.gl/WebGL canvas, and the resulting polygon is not something a
// headless browser reproduces reliably enough to put in front of every PR in the
// monorepo.
//
// One test, one `setupProCampaignUser` — every other spec file in this suite
// spends exactly one, because concurrent Clerk-user bootstraps against a cold
// preview are its dominant flake source (the 401 note in
// tests/utils/headless-user.ts).
test.describe('native door-knocking turf rail', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
    // Set before auth/navigation: the variant is resolved server-side and seeded
    // into the first SSR render, and pinning it stops a live ramp flipping the
    // surface under this spec.
    await enableNativeDoorKnockingFlag(page)
  })

  test('a saved list shows in the rail, and its details report an unknocked route', async ({
    page,
  }) => {
    test.setTimeout(3 * 60 * 1000)

    const { client } = await setupProCampaignUser(page)
    const name = `E2E rail turf ${Date.now()}`
    const turf = await seedTurf(client, name)

    await gotoDoorKnocking(page)
    await expect(nativeShellHeading(page)).toBeVisible({ timeout: 30_000 })

    // The rail renders off the turfs query alone — no voter pack, no canvas — so
    // nothing here waits on WebGL or on the district pack being built.
    const row = turfRow(page, turf.id)
    await expect(row).toBeVisible({ timeout: 30_000 })
    await expect(row.getByRole('button', { name, exact: true })).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Saved lists · 1' }),
    ).toBeVisible()

    await row.getByRole('button', { name: 'Details', exact: true }).click()

    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible({
      timeout: 20_000,
    })

    // `locked` is derived from the route row's existence, not stored. A turf
    // that has never been knocked must therefore report no route AND still
    // offer deletion — the two halves of that derivation, asserted together so
    // a regression in either one fails here rather than at a frozen turf
    // nobody can remove.
    await expect(page.getByText('Not knocked yet').first()).toBeVisible()
    await expect(
      page.getByRole('button', { name: `Delete ${name}` }),
    ).toBeVisible()

    await page.getByRole('button', { name: 'Close details' }).click()
    await expect(row).toBeVisible()
  })
})
