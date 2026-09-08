import { expect, test } from '@playwright/test'
import { blockSlowScripts } from 'src/helpers/navigation.helper'
import { setupProCampaignUser } from 'src/helpers/organizations'
import { setFlagOverrides } from 'src/helpers/campaignStory.helper'
import { gotoCrmContacts, listCard } from 'src/helpers/crm-contacts-e2e'
import { createFlowStepHeading } from 'src/helpers/door-knocking-e2e'
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
// What this deliberately does not cover: drawing the polygon and pressing Build
// route, which would prove the turf appears. Two reasons, either sufficient —
// drawing means synthesizing pointer events on a deck.gl/WebGL canvas, and
// since 3.0 that press buys a real Geoapify route (see the note in
// src/helpers/door-knocking-e2e.ts).
//
// Not @dev-only: setupProCampaignUser provisions Pro without the Stripe
// webhook, and a per-PR preview's gp-api serves the same real Cheyenne voter
// data as dev — which this spec needs, because the who step's Continue carries
// a count that only exists once GET /v1/door-knocking/pack decodes.
test.describe('outreach list handoff to door knocking', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
    // One call, two flags: setFlagOverrides REPLACES the whole override
    // cookie, so serve-crm and the door-knocking flag cannot be set by
    // separate helpers without the last one clobbering the rest. Before auth
    // and navigation, because every one of these is resolved server-side into
    // the first SSR render. win-crm (Win CRM is unconditional, ENG-11009) and
    // voter-outreach-v2 (the outreach hub is unconditional, ENG-11007) are
    // both gone — no overrides needed for either on this Win spec.
    await setFlagOverrides(page, {
      'serve-crm': 'on',
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
    // Since 3.0 the create flow opens itself for an org with no lists, so the
    // param is read by the flow on the same frame it mounts rather than waiting
    // on a press — it still has to survive the navigation to be read at all. ---
    await page.waitForURL(
      (url) =>
        url.pathname === '/dashboard/door-knocking' &&
        url.searchParams.get('listId') === String(list.id),
      { timeout: 45_000 },
    )
    // Anchor moved from the page's sr-only h1 to the create flow's own
    // purpose-step heading: the flow auto-opens on arrival now, and
    // Radix inerts everything outside the dialog — so the page-level h1
    // is unreachable while the modal is up. The purpose heading below
    // is the honest signal that the page mounted AND the flow opened.

    // --- The answer to the question. Arriving from Send outreach has created
    // no door-knocking saved list, which since 3.0 is visible in the surface
    // itself: an org with no lists has the create flow opened for it, so
    // landing on the purpose step IS the assertion that the rail is empty. ---
    await expect(
      createFlowStepHeading(page, 'What do you want to do?'),
    ).toBeVisible({ timeout: 120_000 })
    await expect(
      page.getByRole('heading', { name: /^Saved lists/ }),
    ).toHaveCount(0)

    await page.getByRole('button', { name: /Introduce myself/ }).click()

    // --- The who step opens on the carried list ---
    await expect(
      createFlowStepHeading(page, 'Who do you want to reach?'),
    ).toBeVisible({ timeout: 30_000 })

    // Read where a candidate reads it: the 3.0 picker is a single collapsed
    // combobox whose displayed value IS the selection, not a set of rows with
    // checked state. Matching on the name is not a race against the pack
    // decoding either — the household count is the `sub` line under it
    // (`doorCount`), so the name itself never changes once rendered.
    const audience = page.getByRole('combobox', { name: 'All lists' })
    await expect(audience).toContainText(listName, { timeout: 30_000 })
    // Asserted as a pair: "it shows the carried list" only means something
    // alongside the default it displaced. Without this, a picker that ignored
    // `?listId=` and sat on its default would still have to be caught by the
    // name above — but a picker that showed BOTH would not.
    await expect(audience).not.toContainText('All contacts')

    // And the flow is still only a flow — reaching the who step with the list
    // picked has written nothing. Two steps remain before anything is: the
    // polygon, and then the route step's Build route, which is the single
    // transaction that writes the turf, the route and the outreach envelope.
    //
    // The CTA carries the filtered audience's size, which is also what makes
    // this wait for the pack rather than race it.
    await expect(
      page.getByRole('button', { name: /^Continue \(/ }),
    ).toBeEnabled({ timeout: 30_000 })

    const { data: turfs } = await client.get<unknown[]>(
      '/v1/door-knocking/turfs',
    )
    expect(turfs).toHaveLength(0)
  })
})
