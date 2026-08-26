import { expect, test } from '@playwright/test'
import { blockSlowScripts } from 'src/helpers/navigation.helper'
import { setupProCampaignUser } from 'src/helpers/organizations'
import { setFlagOverrides } from 'src/helpers/campaignStory.helper'
import { nativeShellHeading } from 'src/helpers/door-knocking-e2e'

// Door knocking is a channel of Voter Outreach, not a peer of it: the left rail
// no longer offers it, and the hub's channel tile is how a candidate gets in.
//
// Both halves are asserted together on purpose. "The nav entry is gone" is only
// safe alongside "and this is the way in instead" — asserted separately, a
// regression that removed the tile would leave the absence test passing while
// the feature had no entry point at all. DashboardMenu.test.tsx covers the
// gating arithmetic; what this adds is that the rail a real candidate is served
// agrees with it.
//
// The user is deliberately one that WOULD qualify for the old entry — Pro, on
// `native-door-knocking`, with the Cheyenne district `setupProCampaignUser`
// pins — so the absence below is the change and not an unmet precondition.
//
// The list handoff through the same tile (`?listId=` into the create flow's who
// step) is pinned separately in
// tests/app/dashboard/outreach/outreach-list-to-door-knocking.spec.ts; this
// spec stops at the door-knocking surface.
test.describe('door knocking is entered from Voter Outreach', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
    // setFlagOverrides REPLACES the whole override cookie, so both flags go in
    // one call. Before auth and navigation, because both are resolved
    // server-side into the first SSR render.
    await setFlagOverrides(page, {
      'voter-outreach-v2': 'on',
      'native-door-knocking': 'on',
    })
  })

  test('the left rail offers no door-knocking entry, and the hub tile reaches it', async ({
    page,
  }) => {
    // Generous: this mints an isolated Clerk user, upgrades it to Pro, and then
    // loads the hub and the native door-knocking surface.
    test.setTimeout(5 * 60 * 1000)

    await setupProCampaignUser(page)

    // `?listId=` is carried in purely as a hydration signal. The hub's heading
    // is server-rendered, so it is on screen before React is live and a tile
    // pressed on that frame is a button with no handler. `OutreachComposeDeepLink`
    // strips the param in a mount effect, so the strip landing is proof the
    // hub's client code is running.
    await page.goto('/dashboard/outreach?listId=1', {
      waitUntil: 'domcontentloaded',
    })
    await expect(
      page.getByRole('heading', { name: 'Create an outreach campaign' }),
    ).toBeVisible({ timeout: 30_000 })
    await page.waitForURL((url) => !url.searchParams.has('listId'), {
      timeout: 30_000,
    })

    // Anchored on the Voter Data entry rather than on Voter Outreach: it is
    // committed only once `useElectedOffice` settles, which is the same query
    // the door-knocking entry used to wait on. Asserting the absence before
    // that settles would have passed against the old nav too.
    await expect(page.locator('#win-contacts-dashboard')).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.locator('#door-knocking-dashboard')).toHaveCount(0)

    await page
      .getByRole('button', { name: /^Door knocking/ })
      .click({ timeout: 15_000 })

    await page.waitForURL(
      (url) => url.pathname === '/dashboard/door-knocking',
      { timeout: 45_000 },
    )
    // The native shell's header, which renders as soon as the page's gate picks
    // the native branch — deliberately not anything that waits on the deck.gl
    // canvas or the district voter pack.
    await expect(nativeShellHeading(page)).toBeVisible({ timeout: 60_000 })
  })
})
