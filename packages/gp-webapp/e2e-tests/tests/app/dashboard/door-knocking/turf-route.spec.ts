import { expect, test } from '@playwright/test'
import {
  setupElectedOfficeUser,
  setupProCampaignUser,
} from 'src/helpers/organizations'
import { mockAction, mockRecords } from 'src/helpers/vendor-mocks.helper'
import { withGatewayRetry } from 'tests/utils/headless-user'

// A convex polygon inside Cheyenne WY Ward 1 — the fixture district used by
// both setupProCampaignUser and setupElectedOfficeUser.
//
// With VENDOR_MODE=mock active on the preview, POST /v1/door-knocking/turfs
// routes its Geoapify call to the mock controller (Story M1-3) instead of the
// real Geoapify API, so no credits are billed and no 30s third-party round-trip
// blocks the test.
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

test.describe('Win — turf route via Geoapify mock', () => {
  test('happy path: route builds, knock records, turf completes', async ({
    page,
  }) => {
    const { client } = await setupProCampaignUser(page)

    // 0. Resolve the campaign ID (needed for vendor-mock assertions).
    const { data: mine } = await client.get<{ id: number }>(
      '/v1/campaigns/mine',
    )
    const campaignId = mine.id

    // 1. Create a voter file filter (no Geoapify involved).
    const { data: list } = await withGatewayRetry(
      'POST /v1/voters/voter-file/filter',
      () =>
        client.post<{ id: number }>('/v1/voters/voter-file/filter', {
          name: 'E2E mock route list',
        }),
    )

    // 2. Create a routed turf — with VENDOR_MODE=mock this calls the Geoapify
    //    mock controller (Story M1-3), not the real API.
    const { data: turf } = await withGatewayRetry(
      'POST /v1/door-knocking/turfs',
      () =>
        client.post<{ id: number }>('/v1/door-knocking/turfs', {
          voterFileFilterId: list.id,
          name: 'E2E turf route test',
          color: '#3b82f6',
          geoPoly: FIXTURE_GEO_POLY,
          mode: 'walk',
          loop: false,
          purpose: 'introduce_myself',
        }),
    )

    // 3. Confirm the mock routed the turf (routeSeconds is non-null).
    const { data: routedTurf } = await client.get<{
      routeSeconds: number | null
    }>(`/v1/door-knocking/turfs/${turf.id}`)
    expect(routedTurf.routeSeconds).not.toBeNull()

    // 3b. Confirm the Geoapify mock wrote a routeplanner_request record.
    const records = await mockRecords(client, campaignId)
    const routeRecord = records.records.find(
      (r) => r.kind === 'routeplanner_request',
    )
    expect(routeRecord).toBeTruthy()

    // 4. Navigate directly to the walk surface for this pre-routed turf.
    await page.goto(`/dashboard/door-knocking?walkTurfId=${turf.id}`)

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

    // 9. Record a knock: Answered → Engaged → support Yes → will vote Yes.
    await page.getByRole('radio', { name: 'Answered' }).click()
    await page.getByRole('radio', { name: 'Engaged' }).click()
    // Support question appears after "Engaged"; "Will they vote?" after support.
    await page.getByRole('radio', { name: 'Yes' }).first().click()
    await page.getByRole('radio', { name: 'Yes' }).last().click()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'Save', exact: true }),
    ).toBeHidden()

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
            `/v1/door-knocking/turfs/${turf.id}`,
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

    // Create a voter file filter.
    const { data: list } = await withGatewayRetry(
      'POST /v1/voters/voter-file/filter',
      () =>
        client.post<{ id: number }>('/v1/voters/voter-file/filter', {
          name: 'E2E mock route fail list',
        }),
    )

    // Create an UNROUTED turf (no mode/loop) — no Geoapify call yet.
    const { data: turf } = await withGatewayRetry(
      'POST /v1/door-knocking/turfs (unrouted)',
      () =>
        client.post<{ id: number }>('/v1/door-knocking/turfs', {
          voterFileFilterId: list.id,
          name: 'E2E mock route fail turf',
          color: '#ef4444',
          geoPoly: FIXTURE_GEO_POLY,
          purpose: 'introduce_myself',
          // Omitting mode/loop: turf is saved without buying a route.
        }),
    )

    // Arm the Geoapify route-failure flag via the test-fixtures endpoint.
    await mockAction(client, campaignId, 'geoapify.route.fail')

    // Navigate to the walk surface — StartKnockingDialog appears (no route).
    await page.goto(`/dashboard/door-knocking?walkTurfId=${turf.id}`)

    await expect(
      page.getByRole('heading', {
        name: 'How are you getting there?',
      }),
    ).toBeVisible()

    // Select walking mode and request the route.
    await page.getByRole('radio', { name: 'Walking' }).click()
    await page.getByRole('button', { name: 'Build route', exact: true }).click()

    // The Geoapify mock returns an error → the dialog must surface it.
    await expect(page.getByRole('alert')).toContainText(
      "We couldn't plan this route. Try again in a moment.",
    )

    // routeSeconds stays null because the route attempt failed.
    const { data: turfAfter } = await client.get<{
      routeSeconds: number | null
    }>(`/v1/door-knocking/turfs/${turf.id}`)
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
    await expect(
      page.getByRole('button', { name: 'Save', exact: true }),
    ).toBeHidden()

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
