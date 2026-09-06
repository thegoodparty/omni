import { expect, test } from '@playwright/test'
import { blockSlowScripts } from 'src/helpers/navigation.helper'
import { setupProCampaignUser } from 'src/helpers/organizations'
import { setFlagOverrides } from 'src/helpers/campaignStory.helper'
import { createFlowStepHeading } from 'src/helpers/door-knocking-e2e'

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
    // Before auth and navigation, because it is resolved server-side into the
    // first SSR render.
    await setFlagOverrides(page, {
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
    // The sr-only `h1 "Door knocking"` on the page can't be the anchor any
    // more: the create flow now opens itself on arrival (an org with no
    // saved lists lands directly on the purpose step), and Radix's dialog
    // inerts everything outside the drawer — the h1 lives on the page,
    // outside the drawer, so it drops out of the accessibility tree the
    // moment the modal opens. Anchor on the purpose step's own heading
    // instead: it renders as soon as the gate picks the native branch
    // AND the create flow mounts, which is the state a candidate lands
    // on from this tile.
    await expect(
      createFlowStepHeading(page, 'What do you want to do?'),
    ).toBeVisible({ timeout: 60_000 })
  })
})
