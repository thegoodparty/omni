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
// the variant actually arrives. This does: the override cookie is merged by
// gp-api, seeded into the SSR render, and consumed by the gate, and a break
// anywhere along that chain silently serves the wrong product to everyone.
//
// Both arms live in ONE test on purpose. It flips the variant for a single user
// and reloads, which is both stronger than two independent renders (it shows the
// gate *following* the flag, not merely two pages existing) and half the setup:
// `setupProCampaignUser` provisions a fresh Clerk user + campaign, and every
// other spec file in this suite spends exactly one of those. Concurrent
// bootstraps against a cold preview are the suite's dominant flake source — see
// the 401 note in tests/utils/headless-user.ts.
test.describe('native door-knocking flag gate', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  test('the flag decides which door-knocking product renders', async ({
    page,
  }) => {
    // Provisioning the Pro campaign is most of this test's wall clock and can
    // outlast the config's 120s default on a slow worker.
    test.setTimeout(3 * 60 * 1000)

    // Control arm. The variant is resolved server-side and seeded into the first
    // SSR render (FeatureFlagsProvider starts `ready` from that seed), so the
    // cookie has to be set before the user is authenticated and the page loads.
    // Pinning it also stops a live Amplitude ramp flipping this arm under us.
    await disableNativeDoorKnockingFlag(page)
    await setupProCampaignUser(page)

    await gotoDoorKnocking(page)

    await expect(legacyDashboardHeading(page)).toBeVisible({ timeout: 30_000 })
    // The eCanvasser refresh affordance exists only on the legacy surface.
    await expect(page.getByRole('button', { name: 'Sync Now' })).toBeVisible()
    await expect(nativeShellHeading(page)).toBeHidden()

    // Treatment arm: same user, same session, only the variant changes.
    await enableNativeDoorKnockingFlag(page)
    await gotoDoorKnocking(page)

    // Both anchors are NativeDoorKnockingPage's own header chrome, which renders
    // as soon as the gate picks the native branch. Deliberately nothing that
    // waits on the deck.gl/maplibre canvas or the district voter pack — the map
    // is a next/dynamic ssr:false import of heavy WebGL libraries, so anchoring
    // the gate assertion on it would make this a race on every cold deploy.
    await expect(nativeShellHeading(page)).toBeVisible({ timeout: 30_000 })
    await expect(
      page.getByRole('button', { name: 'Create list' }),
    ).toBeVisible()
    await expect(legacyDashboardHeading(page)).toBeHidden()
  })
})
