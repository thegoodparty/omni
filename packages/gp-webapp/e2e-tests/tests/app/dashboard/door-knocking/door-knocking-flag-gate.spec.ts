import { expect, test } from '@playwright/test'
import { blockSlowScripts } from 'src/helpers/navigation.helper'
import { setupProCampaignUser } from 'src/helpers/organizations'
import {
  disableNativeDoorKnockingFlag,
  enableNativeDoorKnockingFlag,
  gotoDoorKnocking,
  legacyDashboardHeading,
  nativeShellHeading,
} from 'src/helpers/door-knocking-e2e'

// `native-door-knocking` decides which of two entirely different products a
// candidate sees at /dashboard/door-knocking: the native voter map, or the
// legacy eCanvasser dashboard. DoorKnockingPageGate.test.tsx already covers the
// branch itself, but it mocks the flag hook — so it says nothing about whether
// the variant actually arrives. This does: the override cookie is read by
// gp-api, seeded into the SSR render, and consumed by the gate, and a break
// anywhere along that chain silently serves the wrong product to everyone.
//
// Both arms pin the flag explicitly, so a live Amplitude ramp can never flip
// either surface under the spec.
test.describe('native door-knocking flag gate', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  test('flag off renders the legacy eCanvasser dashboard', async ({ page }) => {
    await disableNativeDoorKnockingFlag(page)
    await setupProCampaignUser(page)

    await gotoDoorKnocking(page)

    await expect(legacyDashboardHeading(page)).toBeVisible({ timeout: 30_000 })
    // The eCanvasser refresh affordance exists only on the legacy surface.
    await expect(page.getByRole('button', { name: 'Sync Now' })).toBeVisible()
    await expect(nativeShellHeading(page)).toBeHidden()
  })

  test('flag on renders the native voter-map shell', async ({ page }) => {
    await enableNativeDoorKnockingFlag(page)
    await setupProCampaignUser(page)

    await gotoDoorKnocking(page)

    await expect(nativeShellHeading(page)).toBeVisible({ timeout: 30_000 })
    // The create-list entry point is the native shell's own chrome; it renders
    // with the header, before (and regardless of) the voter pack or the map.
    await expect(
      page.getByRole('button', { name: 'Create list' }),
    ).toBeVisible()
    await expect(legacyDashboardHeading(page)).toBeHidden()
  })
})
