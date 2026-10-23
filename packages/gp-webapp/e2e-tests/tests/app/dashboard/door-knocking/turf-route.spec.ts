import { expect, test, type Page } from '@playwright/test'
import {
  setupElectedOfficeUser,
  setupProCampaignUser,
} from 'src/helpers/organizations'
import { mockAction, mockRecords } from 'src/helpers/vendor-mocks.helper'
import {
  createFlowStepHeading,
  drawPolygon,
  ringInView,
  gotoDoorKnocking,
  type LngLat,
} from 'src/helpers/door-knocking-e2e'
import { withGatewayRetry } from 'tests/utils/headless-user'

// A convex polygon inside Cheyenne WY Ward 1 — the fixture district used by
// both setupProCampaignUser and setupElectedOfficeUser.
//
// With VENDOR_MODE=mock active on the preview, the route build routes its
// Geoapify call to the mock controller (Story M1-3) instead of the real
// Geoapify API, so no credits are billed and no 30s third-party round-trip
// blocks the test. The Win tests draw this polygon on the map; the Serve test
// below still posts it.
const FIXTURE_GEO_POLY = {
  type: 'Polygon',
  coordinates: [
    [
      [-104.821, 41.133],
      [-104.818, 41.133],
      [-104.818, 41.136],
      [-104.821, 41.136],
      [-104.821, 41.133],
    ],
  ],
}

// ---------------------------------------------------------------------------
// Win — candidate (happy path + failure)
// ---------------------------------------------------------------------------

// Where on the visible map to try a square, as pixel offsets from its middle,
// clear of the zoom/undo cluster in the bottom-right corner. The map cannot be
// moved on the preview (see `ringInView`), so the district is searched in
// place: the first square holding a workable audience wins.
const CANDIDATE_OFFSETS = [
  [0, 0],
  [-150, 0],
  [0, -120],
  [-150, -120],
  [150, -120],
  [0, 120],
  [-150, 120],
] as const
const SQUARE_PX = 160
// The route planner is only asked when there are two or more block faces, and
// the create refuses more than 150 stops. 10 is comfortably past the first.
const MIN_STOPS = 10
const MAX_STOPS = 120

// The centre of a ring's bounding box, which does not care that a GeoJSON ring
// repeats its first vertex.
const center = (ring: LngLat[]): LngLat => {
  const lngs = ring.map(([lng]) => lng)
  const lats = ring.map(([, lat]) => lat)
  return [
    (Math.min(...lngs) + Math.max(...lngs)) / 2,
    (Math.min(...lats) + Math.max(...lats)) / 2,
  ]
}

const ROUTE_RESPONSE = /\/v1\/door-knocking\/turfs\/(\d+)\/route$/

// The part of the create flow both Win tests share: purpose, audience, talking
// points, name, then drawing the fixture district's polygon, ending on the
// success screen with the turf's Start knocking button in view. Nothing here
// touches the API from the test client — the UI creates the list and the turf.
const createWinCampaignInUi = async (
  page: Page,
  campaignName: string,
): Promise<LngLat[]> => {
  // Cold pack download (4.5s p50 / 34s p95) sits behind the who step.
  test.setTimeout(5 * 60 * 1000)

  await gotoDoorKnocking(page)

  // An org with no lists has the create flow opened for it.
  await expect(
    createFlowStepHeading(page, 'What do you want to do?'),
  ).toBeVisible({ timeout: 120_000 })
  await page.getByRole('button', { name: /Introduce myself/ }).click()

  // Who: an explicit pick is what enables Continue.
  await expect(
    createFlowStepHeading(page, 'Who do you want to reach?'),
  ).toBeVisible({ timeout: 30_000 })
  await page.getByRole('combobox', { name: 'All lists' }).click()
  await page.getByRole('option', { name: /All contacts/ }).click()
  const continueWithCount = page.getByRole('button', { name: /^Continue \(/ })
  await expect(continueWithCount).toBeEnabled({ timeout: 120_000 })
  await continueWithCount.click()

  // Talking points: never blocks, so no wait on the AI draft.
  await page.getByRole('button', { name: 'Continue', exact: true }).click()

  // Name.
  await page.getByLabel('Campaign name').fill(campaignName)
  await page.getByRole('button', { name: 'Continue', exact: true }).click()

  // Draw: open the map, start the first turf, and click the polygon's corners.
  await page.getByRole('button', { name: 'Draw turfs', exact: true }).click()
  const turfs = page.getByRole('complementary', { name: 'Turfs' })
  await turfs.getByRole('button', { name: 'Draw the first turf' }).click()
  const pill = page.getByText(/^[\d,]+ selected$/)
  const readStops = async () =>
    Number((await pill.innerText()).replace(/\D/g, ''))
  let drawn: LngLat[] | null = null
  for (const [dx, dy] of CANDIDATE_OFFSETS) {
    const ring = await ringInView(page, { dx, dy, size: SQUARE_PX })
    await drawPolygon(page, ring)
    // Corners alone say nothing about the audience inside them. The pill is
    // what proves the square landed on houses, and not on empty ground.
    await expect(pill).toBeVisible()
    // The count settles a beat after the last corner; a square with too few
    // stops simply runs out the wait and is read as it stands.
    await expect
      .poll(readStops, { timeout: 3_000 })
      .toBeGreaterThanOrEqual(MIN_STOPS)
      .catch(() => undefined)
    const stops = await readStops()
    if (stops >= MIN_STOPS && stops <= MAX_STOPS) {
      drawn = ring
      break
    }
    for (let i = 0; i < ring.length; i++) {
      await page.getByRole('button', { name: 'Undo', exact: true }).click()
    }
  }
  if (!drawn) throw new Error('no square on the map held a workable audience')
  await turfs.getByRole('textbox', { name: 'Turf name' }).fill('E2E turf')
  await turfs.getByRole('button', { name: 'Save', exact: true }).click()

  // Back on the draw step, which is where the one write happens.
  await page
    .getByRole('button', { name: 'Create campaign', exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: 'Your campaign is ready' }),
  ).toBeVisible({ timeout: 60_000 })
  return drawn
}

// Opens Start knocking on the turf the flow just made, picks walking, and
// presses Build route. Resolves with the route response, whatever its status.
const pressBuildRoute = async (page: Page) => {
  await page
    .getByRole('button', { name: 'Start knocking', exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: 'How are you getting there?' }),
  ).toBeVisible()
  await page.getByRole('radio', { name: 'Walking' }).click()
  const routeResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      ROUTE_RESPONSE.test(new URL(response.url()).pathname),
  )
  await page.getByRole('button', { name: 'Build route', exact: true }).click()
  const response = await routeResponse
  const turfId = Number(
    ROUTE_RESPONSE.exec(new URL(response.url()).pathname)?.[1],
  )
  return { response, turfId }
}

test.describe('Win — turf route via Geoapify mock', () => {
  test('happy path: list and turf are created in the UI, route builds, knock records, turf completes', async ({
    page,
  }) => {
    const { client } = await setupProCampaignUser(page)

    // Resolve the campaign ID (needed for vendor-mock assertions).
    const { data: mine } = await client.get<{ id: number }>(
      '/v1/campaigns/mine',
    )
    const campaignId = mine.id

    // Previews, dev and local all resolve VENDOR_MODE=mock. The guard only
    // trips when dev is rolled back with VENDOR_MODE=live (real Geoapify).
    const { vendorMode } = await mockRecords(client, campaignId)
    test.skip(vendorMode !== 'mock', 'needs VENDOR_MODE=mock')

    // 1. The UI creates the list and the turf; 2. Start knocking builds the
    //    route through POST /v1/door-knocking/turfs/:id/route.
    const ring = await createWinCampaignInUi(
      page,
      `E2E mock route ${Date.now()}`,
    )
    const { response, turfId } = await pressBuildRoute(page)
    expect(response.status()).toBeLessThan(300)

    // 3. The turf is routed, and it is the polygon that was drawn.
    const { data: routedTurf } = await client.get<{
      routeSeconds: number | null
      stopCount: number
      geoPoly: { coordinates: LngLat[][] }
    }>(`/v1/door-knocking/turfs/${turfId}`)
    expect(routedTurf.routeSeconds).not.toBeNull()
    const drawn = routedTurf.geoPoly.coordinates[0] ?? []
    // The turf holds the square that was clicked, to within a few metres of
    // pixel rounding: 0.0003 degrees is ~30m against a square ~150m across.
    const [drawnLng, drawnLat] = center(drawn)
    const [clickedLng, clickedLat] = center(ring)
    expect(Math.abs(drawnLng - clickedLng)).toBeLessThan(0.0003)
    expect(Math.abs(drawnLat - clickedLat)).toBeLessThan(0.0003)

    // 3b. The Geoapify mock saw one route-planner request. Its jobs are the
    //     turf's block faces, one per street side, so the count is bounded by
    //     the stops rather than equal to them.
    const records = await mockRecords(client, campaignId)
    const routeRecord = records.records.find(
      (r) => r.vendor === 'geoapify' && r.kind === 'routeplanner_request',
    )
    expect(routeRecord).toBeTruthy()
    const waypoints = (routeRecord?.state as { waypoints?: number }).waypoints
    expect(waypoints).toBeGreaterThanOrEqual(1)
    expect(waypoints).toBeLessThanOrEqual(routedTurf.stopCount)

    // 4. The walk surface for the turf just routed.
    // 5. Wait for the route skeleton to disappear — confirms route payload arrived.
    await expect(page.locator('[data-testid="walk-view-loading"]')).toBeHidden({
      timeout: 15_000,
    })

    // 6. Expand the walk sheet (may start at peek snap).
    const grip = page.getByRole('button', { name: /Expand the route/ })
    if (await grip.isVisible()) {
      await grip.click()
    }

    // 7. At least one stop must be visible.
    await expect(page.getByRole('button', { name: /Stop 1/ })).toBeVisible()

    // 8. Expand Stop 1 and open PersonSheet for the first resident.
    //    For a house: the first sub-button is a resident row (opens PersonSheet).
    //    For a multi-unit stop: it is a door row (needs one more click).
    await page.getByRole('button', { name: /Stop 1/ }).click()
    const stopLi = page
      .locator('li')
      .filter({ has: page.getByRole('button', { name: /Stop 1/ }) })
    await stopLi.getByRole('button').nth(1).click()
    if (
      !(await page
        .getByRole('button', { name: 'Close person details' })
        .first()
        .isVisible())
    ) {
      await stopLi.getByRole('button').nth(2).click()
    }

    // 9. Record a knock: Answered → Engaged → will vote Yes → support Yes.
    await page.getByRole('radio', { name: 'Answered' }).click()
    await page.getByRole('radio', { name: 'Engaged' }).click()
    // "Will they vote?" appears after "Engaged"; support after will-vote.
    await page.getByRole('radio', { name: 'Yes' }).first().click()
    await page.getByRole('radio', { name: 'Yes' }).last().click()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    // Save reads "Saving…" while the knock is in flight, and only when it lands
    // does the walk advance, which reopens PersonSheet on the next door. Wait
    // for both labels to go, or a close below races that reopen.
    await expect(
      page.getByRole('button', { name: /^(Save|Saving…)$/ }),
    ).toHaveCount(0)

    // 10. Close PersonSheet if still open (auto-closes when no residents remain;
    //     stays open to advance to the next resident in the same stop).
    //     Use .first() to disambiguate the overlay backdrop from the icon button.
    const closePersonDetails = page
      .getByRole('button', { name: 'Close person details' })
      .first()
    if (await closePersonDetails.isVisible()) {
      await closePersonDetails.click()
    }
    // Wait for the PersonSheet to fully close before attempting to click the
    // route-done button — if the overlay still covers it the click is swallowed.
    await expect(closePersonDetails).toBeHidden()

    // 11. Mark route done.
    await page
      .getByRole('button', { name: 'Mark this route done', exact: true })
      .click()
    await expect(
      page.getByRole('heading', { name: 'Mark this route done?' }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Mark done', exact: true }).click()
    // Wait for the confirmation dialog to close before polling the API —
    // the server mutation may not have landed yet.
    await expect(
      page.getByRole('heading', { name: 'Mark this route done?' }),
    ).toBeHidden()

    // 12. Assert the turf is marked completed via the API.
    // Use expect.poll so we retry until the completion mutation has landed.
    await expect
      .poll(
        async () => {
          const { data } = await client.get<{ completed: boolean }>(
            `/v1/door-knocking/turfs/${turfId}`,
          )
          return data.completed
        },
        { timeout: 10_000 },
      )
      .toBe(true)
  })

  test('failure: geoapify.route.fail causes error copy, no successful route', async ({
    page,
  }) => {
    const { client } = await setupProCampaignUser(page)

    // Resolve the campaign ID (needed to arm the mock action).
    const { data: mine } = await client.get<{ id: number }>(
      '/v1/campaigns/mine',
    )
    const campaignId = mine.id

    // Previews, dev and local all resolve VENDOR_MODE=mock. The guard only
    // trips when dev is rolled back with VENDOR_MODE=live (real Geoapify).
    const { vendorMode } = await mockRecords(client, campaignId)
    test.skip(vendorMode !== 'mock', 'needs VENDOR_MODE=mock')

    // Creating the campaign buys nothing, so the unrouted turf comes from the
    // UI and the failure is armed only for the press that does.
    await createWinCampaignInUi(page, `E2E mock route fail ${Date.now()}`)
    await mockAction(client, campaignId, 'geoapify.route.fail')
    const { turfId } = await pressBuildRoute(page)

    // The Geoapify mock returns an error → the dialog must surface it.
    await expect(page.getByRole('alert')).toContainText(
      "We couldn't plan this route. Try again in a moment.",
    )

    // routeSeconds stays null because the route attempt failed.
    const { data: turfAfter } = await client.get<{
      routeSeconds: number | null
    }>(`/v1/door-knocking/turfs/${turfId}`)
    expect(turfAfter.routeSeconds).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Serve — elected official (happy path)
// ---------------------------------------------------------------------------

test.describe('Serve — turf route via Geoapify mock', () => {
  test('happy path: route builds and knock records for elected official', async ({
    page,
  }) => {
    const { client } = await setupElectedOfficeUser(page)

    // Create a voter file filter.
    const { data: list } = await withGatewayRetry(
      'POST /v1/voters/voter-file/filter',
      () =>
        client.post<{ id: number }>('/v1/voters/voter-file/filter', {
          name: 'E2E mock route list (serve)',
        }),
    )

    // Create a routed Serve turf — hits the Geoapify mock under VENDOR_MODE=mock.
    const { data: turf } = await withGatewayRetry(
      'POST /v1/door-knocking/serve/turfs',
      () =>
        client.post<{ id: number }>('/v1/door-knocking/serve/turfs', {
          voterFileFilterId: list.id,
          name: 'E2E turf route test (serve)',
          color: '#3b82f6',
          geoPoly: FIXTURE_GEO_POLY,
          mode: 'walk',
          loop: false,
          purpose: 'introduce_myself',
        }),
    )

    // Navigate to the walk surface.
    await page.goto(`/dashboard/door-knocking?walkTurfId=${turf.id}`)

    // Wait for route skeleton to disappear.
    await expect(page.locator('[data-testid="walk-view-loading"]')).toBeHidden({
      timeout: 15_000,
    })

    // Expand the walk sheet if needed.
    const grip = page.getByRole('button', { name: /Expand the route/ })
    if (await grip.isVisible()) {
      await grip.click()
    }

    await expect(page.getByRole('button', { name: /Stop 1/ })).toBeVisible()

    // Open Stop 1 and click through to PersonSheet.
    await page.getByRole('button', { name: /Stop 1/ }).click()
    const stopLi = page
      .locator('li')
      .filter({ has: page.getByRole('button', { name: /Stop 1/ }) })
    await stopLi.getByRole('button').nth(1).click()
    if (
      !(await page
        .getByRole('button', { name: 'Close person details' })
        .first()
        .isVisible())
    ) {
      await stopLi.getByRole('button').nth(2).click()
    }

    // Record a knock for Serve: Answered → Engaged → follow-up Yes.
    await page.getByRole('radio', { name: 'Answered' }).click()
    await page.getByRole('radio', { name: 'Engaged' }).click()
    // Serve shows "Do they need follow-up?" instead of support/will-vote.
    await page.getByRole('radio', { name: 'Yes' }).click()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    // Wait for the knock to land, not just for the Save label to change: the
    // walk advances and reopens PersonSheet on the next door only then.
    await expect(
      page.getByRole('button', { name: /^(Save|Saving…)$/ }),
    ).toHaveCount(0)

    // Close PersonSheet if still open before marking the route done.
    // Use .first() to disambiguate the overlay backdrop from the icon button.
    const closePersonDetails = page
      .getByRole('button', { name: 'Close person details' })
      .first()
    if (await closePersonDetails.isVisible()) {
      await closePersonDetails.click()
    }
    // Wait for the PersonSheet to fully close before attempting to click the
    // route-done button.
    await expect(closePersonDetails).toBeHidden()

    // Mark route done.
    await page
      .getByRole('button', { name: 'Mark this route done', exact: true })
      .click()
    await expect(
      page.getByRole('heading', { name: 'Mark this route done?' }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Mark done', exact: true }).click()
    // Wait for the confirmation dialog to close before polling the API.
    await expect(
      page.getByRole('heading', { name: 'Mark this route done?' }),
    ).toBeHidden()

    // Assert turf is completed — poll until the mutation lands.
    await expect
      .poll(
        async () => {
          const { data } = await client.get<{ completed: boolean }>(
            `/v1/door-knocking/turfs/${turf.id}`,
          )
          return data.completed
        },
        { timeout: 10_000 },
      )
      .toBe(true)
  })
})
