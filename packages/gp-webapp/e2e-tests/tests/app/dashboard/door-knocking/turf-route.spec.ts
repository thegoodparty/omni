import { expect, test, type Page } from '@playwright/test'
import {
  setupElectedOfficeUser,
  setupProCampaignUser,
} from 'src/helpers/organizations'
import {
  mockAction,
  mockRecords,
  mockRecordsForOrganization,
} from 'src/helpers/vendor-mocks.helper'
import {
  createFlowStepHeading,
  drawPolygon,
  gotoDoorKnocking,
  type LngLat,
} from 'src/helpers/door-knocking-e2e'

// A convex polygon inside Cheyenne WY Ward 1 — the fixture district used by
// both setupProCampaignUser and setupElectedOfficeUser.
//
// With VENDOR_MODE=mock active on the preview, the route build routes its
// Geoapify call to the mock controller (Story M1-3) instead of the real
// Geoapify API, so no credits are billed and no 30s third-party round-trip
// blocks the test. Both the Win and the Serve tests draw this polygon on the
// map.
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

const FIXTURE_RING = FIXTURE_GEO_POLY.coordinates[0] as LngLat[]

const ROUTE_RESPONSE = /\/v1\/door-knocking\/turfs\/(\d+)\/route$/

// The part of the create flow every door-knocking test shares (Win and Serve): purpose, audience, talking
// points, name, then drawing the fixture district's polygon, ending on the
// success screen with the turf's Start knocking button in view. Nothing here
// touches the API from the test client — the UI creates the list and the turf.
const createCampaignInUi = async (
  page: Page,
  campaignName: string,
  purposeLabel: RegExp = /Introduce myself/,
): Promise<void> => {
  // Cold pack download (4.5s p50 / 34s p95) sits behind the who step.
  test.setTimeout(5 * 60 * 1000)

  await gotoDoorKnocking(page)

  // An org with no lists has the create flow opened for it.
  await expect(
    createFlowStepHeading(page, 'What do you want to do?'),
  ).toBeVisible({ timeout: 120_000 })
  await page.getByRole('button', { name: purposeLabel }).click()

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
  await drawPolygon(page, FIXTURE_RING)
  // Corners alone say nothing about the audience inside them. The pill is
  // what proves the polygon landed on houses, and not on empty ground.
  await expect(page.getByText(/^[1-9][\d,]* selected$/)).toBeVisible()
  await turfs.getByRole('textbox', { name: 'Turf name' }).fill('E2E turf')
  await turfs.getByRole('button', { name: 'Save', exact: true }).click()

  // Back on the draw step, which is where the one write happens.
  await page
    .getByRole('button', { name: 'Create campaign', exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: 'Your campaign is ready' }),
  ).toBeVisible({ timeout: 60_000 })
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
    await createCampaignInUi(page, `E2E mock route ${Date.now()}`)
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
    const mean = (index: 0 | 1, ring: LngLat[]) =>
      ring.reduce((sum, point) => sum + point[index], 0) / ring.length
    // Both rings are closed, so the repeated vertex weighs the same in each;
    // 0.0005 degrees is ~50m, against a polygon ~330m across.
    expect(Math.abs(mean(0, drawn) - mean(0, FIXTURE_RING))).toBeLessThan(
      0.0005,
    )
    expect(Math.abs(mean(1, drawn) - mean(1, FIXTURE_RING))).toBeLessThan(
      0.0005,
    )

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
    await createCampaignInUi(page, `E2E mock route fail ${Date.now()}`)
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
  test('happy path: list and turf are created in the UI, route builds, knock records, turf completes', async ({
    page,
  }) => {
    const { client } = await setupElectedOfficeUser(page)

    // Serve has no campaign: the Geoapify mock stamps the organization slug
    // on its records, and setupElectedOfficeUser pins that org on the client.
    const organizationSlug = String(
      client.defaults.headers['x-organization-slug'],
    )
    expect(organizationSlug).toMatch(/^eo-/)

    // Previews, dev and local all resolve VENDOR_MODE=mock. The guard only
    // trips when dev is rolled back with VENDOR_MODE=live (real Geoapify).
    const { vendorMode } = await mockRecordsForOrganization(
      client,
      organizationSlug,
    )
    test.skip(vendorMode !== 'mock', 'needs VENDOR_MODE=mock')

    // 1. The UI creates the list and the turf, with a Serve purpose;
    // 2. Start knocking builds the route through
    //    POST /v1/door-knocking/turfs/:id/route (org-scoped, no serve sibling).
    await createCampaignInUi(page, `E2E serve mock route ${Date.now()}`)
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
    const mean = (index: 0 | 1, ring: LngLat[]) =>
      ring.reduce((sum, point) => sum + point[index], 0) / ring.length
    expect(Math.abs(mean(0, drawn) - mean(0, FIXTURE_RING))).toBeLessThan(
      0.0005,
    )
    expect(Math.abs(mean(1, drawn) - mean(1, FIXTURE_RING))).toBeLessThan(
      0.0005,
    )

    // 3b. The Geoapify mock saw one route-planner request for this org. Its
    //     jobs are the turf's block faces, one per street side, so the count
    //     is bounded by the stops rather than equal to them.
    const records = await mockRecordsForOrganization(client, organizationSlug)
    const routeRecord = records.records.find(
      (r) => r.vendor === 'geoapify' && r.kind === 'routeplanner_request',
    )
    expect(routeRecord).toBeTruthy()
    const waypoints = (routeRecord?.state as { waypoints?: number }).waypoints
    expect(waypoints).toBeGreaterThanOrEqual(1)
    expect(waypoints).toBeLessThanOrEqual(routedTurf.stopCount)

    // 4. The walk surface for the turf just routed; wait for the route
    //    skeleton to disappear, which confirms the route payload arrived.
    await expect(page.locator('[data-testid="walk-view-loading"]')).toBeHidden({
      timeout: 15_000,
    })

    // 5. Expand the walk sheet if needed.
    const grip = page.getByRole('button', { name: /Expand the route/ })
    if (await grip.isVisible()) {
      await grip.click()
    }

    await expect(page.getByRole('button', { name: /Stop 1/ })).toBeVisible()

    // 6. Open Stop 1 and click through to PersonSheet.
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

    // 7. Record a knock for Serve: Answered → Engaged → follow-up Yes.
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

    // 8. Close PersonSheet if still open before marking the route done.
    //    Use .first() to disambiguate the overlay backdrop from the icon button.
    const closePersonDetails = page
      .getByRole('button', { name: 'Close person details' })
      .first()
    if (await closePersonDetails.isVisible()) {
      await closePersonDetails.click()
    }
    await expect(closePersonDetails).toBeHidden()

    // 9. Mark route done.
    await page
      .getByRole('button', { name: 'Mark this route done', exact: true })
      .click()
    await expect(
      page.getByRole('heading', { name: 'Mark this route done?' }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Mark done', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Mark this route done?' }),
    ).toBeHidden()

    // 10. The turf is completed; poll until the mutation lands. Serve reads a
    //     turf through the same by-id route as Win.
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
})
