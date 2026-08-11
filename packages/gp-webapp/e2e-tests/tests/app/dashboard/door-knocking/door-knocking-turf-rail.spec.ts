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

// The native shell's right rail and create panel, driven only through DOM the
// map does not own. The turf itself is seeded through gp-api: drawing it would
// mean synthesizing pointer events on a deck.gl/WebGL canvas, and the resulting
// polygon is not something a headless browser reproduces reliably enough to put
// in front of every PR in the monorepo.
test.describe('native door-knocking turf rail', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
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

    const row = turfRow(page, turf.id)
    await expect(row).toBeVisible({ timeout: 30_000 })
    await expect(row.getByRole('button', { name, exact: true })).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Saved lists · 1' }),
    ).toBeVisible()

    await row.getByRole('button', { name: 'Details', exact: true }).click()

    const details = page.getByRole('heading', { name, exact: true })
    await expect(details).toBeVisible({ timeout: 20_000 })

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

  // The create panel's step machine, up to the point where the map takes over.
  // Step 2 -> 3 is deliberately not covered: Continue is gated on a drawn ring
  // with at least one stop inside it, which only the WebGL canvas can produce.
  test('the create-list panel advances to the draw step and back', async ({
    page,
  }) => {
    // Longer than the rail test: this one additionally waits out the district
    // voter pack, which is built server-side before it can be downloaded.
    test.setTimeout(4 * 60 * 1000)

    await setupProCampaignUser(page)

    await gotoDoorKnocking(page)
    await expect(nativeShellHeading(page)).toBeVisible({ timeout: 30_000 })

    // Create list stays disabled until the district's voter pack has decoded,
    // so this doubles as the assertion that the pack loads at all.
    const createList = page.getByRole('button', { name: 'Create list' })
    await expect(createList).toBeEnabled({ timeout: 90_000 })
    await createList.click()

    await expect(
      page.getByRole('heading', { name: 'Filter voters' }),
    ).toBeVisible()
    await expect(page.getByText('Step 1 of 3')).toBeVisible()

    await page.getByRole('button', { name: 'Continue', exact: true }).click()

    await expect(
      page.getByRole('heading', { name: 'Draw your door knocking boundaries' }),
    ).toBeVisible()
    await expect(page.getByText('Step 2 of 3')).toBeVisible()
    // The draw step's instruction card is the map's only entry point, and it
    // swallows the first click so a dismissing tap can't drop a stray vertex.
    await expect(page.getByText('Draw your knocking boundaries.')).toBeVisible()

    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await expect(page.getByText('Step 1 of 3')).toBeVisible()

    await page.getByRole('button', { name: 'Close list creation' }).click()
    await expect(createList).toBeVisible()
  })
})
