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
// Both arms live in ONE test on purpose: it flips the variant for a single user
// and reloads, which shows the gate *following* the flag rather than merely
// proving two pages exist.
//
// It needs a PRO campaign, which is why it pays for an isolated user
// (`setupProCampaignUser`) rather than the per-worker cached one. It used to use
// the cached user on the grounds that the gate sits upstream of every
// entitlement; ENG-10888 ended that — the native arm is Pro-gated on the page
// and on every /v1/door-knocking route, so a plain campaign user now renders the
// upgrade card and the treatment assertions below would fail on the entitlement
// rather than on the flag. That cost is real: minting a fresh Clerk user is the
// suite's dominant flake source (a brand-new session 401ing while it propagates;
// see tests/utils/headless-user.ts), and it is what made this spec flaky on its
// first two real runs. Hence the widened timeout. The upgrade card itself is
// covered by DoorKnockingPageGate.test.tsx and needs no second browser user.
test.describe('native door-knocking flag gate', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  test('the flag decides which door-knocking product renders', async ({
    page,
  }) => {
    // Generous because this mints an isolated user, upgrades it through the
    // test-only Pro endpoint, and then loads the dashboard twice.
    test.setTimeout(4 * 60 * 1000)

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
