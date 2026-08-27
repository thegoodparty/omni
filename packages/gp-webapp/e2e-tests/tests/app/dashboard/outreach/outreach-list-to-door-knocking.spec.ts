import { expect, test } from '@playwright/test'
import { blockSlowScripts } from 'src/helpers/navigation.helper'
import { setupProCampaignUser } from 'src/helpers/organizations'
import { setFlagOverrides } from 'src/helpers/campaignStory.helper'
import { gotoCrmContacts, listCard } from 'src/helpers/crm-contacts-e2e'
import { nativeShellHeading } from 'src/helpers/door-knocking-e2e'
import { withGatewayRetry } from 'tests/utils/headless-user'

// The cross-feature journey a candidate takes when they press "Send outreach"
// on a voter list and pick door knocking: Voter Data → the outreach hub →
// `/dashboard/door-knocking?listId=` → the create flow's who step, opened on
// the list they came from.
//
// It pins the answer to "does Send outreach create a saved list in door
// knocking?" — it does NOT, and must not. A `DoorKnockingTurf` requires a drawn
// polygon as well as a `voterFileFilterId` (its four required columns are
// `voterFileFilterId`, `name`, `color`, `geoPoly`), and the handoff carries no
// geography. So the rail is asserted to still show its "No lists yet" empty
// state on arrival, and the carried list is asserted to be a PRESELECTION in
// the who step rather than a saved turf. The complementary half of that claim
// — that gp-api refuses a turf with no polygon, and that creating a voter list
// creates no turf — is proved deterministically in
// gp-api/src/doorKnocking/tests/outreachListHandoff.test.ts, where it costs a
// Prisma call instead of a browser.
//
// What this deliberately does not cover: drawing the polygon and saving, which
// would prove the turf appears. Drawing means synthesizing pointer events on a
// deck.gl/WebGL canvas — the coin-flip interaction every other door-knocking
// spec avoids (see the note on `seedTurf` in src/helpers/door-knocking-e2e.ts).
//
// Not @dev-only: setupProCampaignUser provisions Pro without the Stripe
// webhook, and a per-PR preview's gp-api serves the same real Cheyenne voter
// data as dev — which this spec needs, because "Create list" is disabled until
// GET /v1/door-knocking/pack decodes.
test.describe('outreach list handoff to door knocking', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
    // One call, four flags: setFlagOverrides REPLACES the whole override
    // cookie, so the CRM pair and the two outreach/door-knocking flags cannot
    // be set by separate helpers without the last one clobbering the rest.
    // Before auth and navigation, because every one of these is resolved
    // server-side into the first SSR render.
    await setFlagOverrides(page, {
      'win-crm': 'on',
      'serve-crm': 'on',
      'voter-outreach-v2': 'on',
      'native-door-knocking': 'on',
    })
  })

  test('a voter list sent to door knocking arrives preselected, and creates no saved list on its own', async ({
    page,
  }) => {
    test.setTimeout(5 * 60 * 1000)

    const { client } = await setupProCampaignUser(page)

    // Seeded through gp-api rather than the CRM's create-list wizard: this spec
    // is about what happens to a list AFTER it exists, and the wizard is three
    // steps with a debounced count already covered by win-contacts.spec.ts.
    const listName = `E2E outreach handoff ${Date.now()}`
    const { data: list } = await withGatewayRetry(
      'POST /v1/voters/voter-file/filter',
      () =>
        client.post<{ id: number }>('/v1/voters/voter-file/filter', {
          name: listName,
        }),
    )

    // --- Voter Data: the list is there, and it offers Send outreach ---
    await gotoCrmContacts(page)
    const card = listCard(page, listName)
    await expect(card).toBeVisible({ timeout: 30_000 })

    const sendOutreach = card.getByRole('link', {
      name: 'Send outreach',
      exact: true,
    })
    // The affordance carries the list's own id in the href — the contract the
    // rest of this journey is built on, asserted before it is followed so a
    // regression here fails as "the link stopped carrying the list" rather than
    // as a missing preselection three navigations later.
    await expect(sendOutreach).toHaveAttribute(
      'href',
      `/dashboard/outreach?listId=${list.id}`,
    )
    await sendOutreach.click()

    // --- The outreach hub ---
    await expect(
      page.getByRole('heading', { name: 'Create an outreach campaign' }),
    ).toBeVisible({ timeout: 30_000 })

    // Wait for the hub to strip `?listId=` before pressing the tile, and wait
    // for THAT rather than for the heading. The heading is server-rendered, so
    // it is on screen before React has hydrated and a tile pressed on that
    // frame is a button with no handler — the press is swallowed and the
    // journey silently stops here. The strip is `OutreachComposeDeepLink`'s own
    // client effect (a router.replace on mount), so its completion is proof the
    // hub's client code is live AND that the deep link has been consumed. The
    // id survives the strip in ChannelTileGrid's state, which is the whole
    // reason it is held there.
    await page.waitForURL((url) => !url.searchParams.has('listId'), {
      timeout: 30_000,
    })

    await page
      .getByRole('button', { name: /^Door knocking/ })
      .click({ timeout: 15_000 })

    // --- The handoff: the list travels as ?listId=, and is NOT stripped here.
    // The door-knocking create flow opens on a Create list press rather than on
    // mount, so the param has to survive until the candidate opens it. ---
    await page.waitForURL(
      (url) =>
        url.pathname === '/dashboard/door-knocking' &&
        url.searchParams.get('listId') === String(list.id),
      { timeout: 45_000 },
    )
    await expect(nativeShellHeading(page)).toBeVisible({ timeout: 60_000 })

    // --- The answer to the question. Arriving from Send outreach has created
    // no door-knocking saved list: the rail is still in its first-run empty
    // state, whose copy names the missing half — the streets to walk. ---
    await expect(
      page.getByText(
        /No lists yet\. Pick who you want to reach and draw the streets you want to walk/,
      ),
    ).toBeVisible({ timeout: 30_000 })
    await expect(
      page.getByRole('heading', { name: /^Saved lists \(/ }),
    ).toHaveCount(0)

    // --- The create flow: Create list is disabled until the voter pack
    // decodes, so this waits on the button's own enabled state rather than on
    // the pack response. A pack served from cache produces no request at all,
    // and the button is the condition the flow actually reads. ---
    const createList = page.getByRole('button', { name: 'Create list' }).first()
    await expect(createList).toBeEnabled({ timeout: 120_000 })
    await createList.click()

    await expect(
      page.getByRole('heading', { name: 'What do you want to do?' }),
    ).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: /Introduce myself/ }).click()

    // --- The who step opens on the carried list ---
    await expect(
      page.getByRole('heading', { name: 'Who do you want to reach?' }),
    ).toBeVisible({ timeout: 30_000 })

    // Keyed on the row's id rather than its title: the title carries a
    // household count once the pack has decoded, so matching on the list's name
    // alone would be a race against that number appearing.
    const carriedRow = page.locator(`#create-list-audience-${list.id}`)
    await expect(carriedRow).toHaveAttribute('data-state', 'checked', {
      timeout: 30_000,
    })
    // Asserted as a pair: "the row is checked" is only meaningful alongside the
    // default it displaced. Without this, a picker that checked every row would
    // pass.
    await expect(page.locator('#create-list-audience-all')).toHaveAttribute(
      'data-state',
      'unchecked',
    )

    // And the flow is still only a flow — reaching the who step with the list
    // picked has written nothing. The next step is Draw, which is where a
    // saved list actually comes from.
    //
    // The CTA is the bare word: no Continue button in this flow carries a
    // count any more. This still waits for the pack rather than racing it —
    // until a count exists the button reads `No matching households`, so the
    // name being matched at all is the same signal the old `/^Continue \(/`
    // was waiting for.
    await expect(
      page.getByRole('button', { name: 'Continue', exact: true }),
    ).toBeEnabled({ timeout: 30_000 })

    const { data: turfs } = await client.get<unknown[]>(
      '/v1/door-knocking/turfs',
    )
    expect(turfs).toHaveLength(0)
  })
})
