import { expect, type Locator, type Page } from '@playwright/test'
import type { AxiosInstance } from 'axios'
import { setFlagOverrides } from 'src/helpers/campaignStory.helper'
import { NavigationHelper } from 'src/helpers/navigation.helper'

// Helpers for the native door-knocking surface
// (app/dashboard/door-knocking/native/ + print/). The legacy eCanvasser
// dashboard behind the same route needs no helpers — it is only ever asserted
// as the control arm of the flag gate.

export const DOOR_KNOCKING_PATH = '/dashboard/door-knocking'

export const printWalkListPath = (turfId: number | string): string =>
  `${DOOR_KNOCKING_PATH}/print/${turfId}`

// Name of the override cookie setFlagOverrides writes. Duplicated from
// campaignStory.helper.ts (which doesn't export it) so the variant can be
// cleared before it is re-set; keep the two in lockstep.
const FLAG_OVERRIDE_COOKIE = 'e2e-flag-overrides'

// Pin `native-door-knocking` to one variant through the off-prod override
// cookie. Call BEFORE auth/navigation so the first SSR render already resolves
// it — resolution is server-side and this cookie is the only deterministic lever
// (e2e-tests/AGENTS.md "Flag-gated surfaces").
//
// The cookie is cleared by name first so the flag-gate spec can flip the variant
// mid-test and know exactly one value is in flight. addCookies is documented to
// replace a cookie matching name+domain+path, but "the browser sent two
// overrides and the server picked one" is precisely the kind of ambiguity that
// turns into an unreproducible flake, so this doesn't rely on it.
const setNativeDoorKnockingFlag = async (
  page: Page,
  variant: 'on' | 'off',
): Promise<void> => {
  await page.context().clearCookies({ name: FLAG_OVERRIDE_COOKIE })
  await setFlagOverrides(page, { 'native-door-knocking': variant })
}

export const enableNativeDoorKnockingFlag = (page: Page): Promise<void> =>
  setNativeDoorKnockingFlag(page, 'on')

// Pin the legacy eCanvasser dashboard, so the control arm keeps testing the old
// surface deterministically even once the flag ramps in Amplitude.
export const disableNativeDoorKnockingFlag = (page: Page): Promise<void> =>
  setNativeDoorKnockingFlag(page, 'off')

export const gotoDoorKnocking = async (page: Page): Promise<void> => {
  await page.goto(DOOR_KNOCKING_PATH, { waitUntil: 'domcontentloaded' })
  await NavigationHelper.dismissOverlays(page)
  await expect(page).toHaveURL(/\/dashboard\/door-knocking/)
}

// A small closed ring over Cheyenne, WY — the district every door-knocking spec
// pins via setupProCampaignUser. Nothing here knocks the turf, so the ring only
// has to be a geometrically valid polygon (>= 4 positions, first === last);
// it is never routed and never has to contain a particular voter.
const CHEYENNE_RING: Array<[number, number]> = [
  [-104.83, 41.13],
  [-104.81, 41.13],
  [-104.81, 41.15],
  [-104.83, 41.15],
  [-104.83, 41.13],
]

export type SeededTurf = {
  id: number
  name: string
  voterFileFilterId: number
}

// Seed a saved list + its turf straight through gp-api rather than through the
// create flow. Drawing the polygon means synthesizing pointer events on a
// deck.gl/WebGL canvas, which is exactly the kind of interaction that turns
// into a coin flip in CI; the API is the same write the flow performs.
//
// The turf is deliberately left UNKNOCKED. POST turfs/:id/knock is the one call
// in this feature that reaches a paid external vendor (Geoapify's route
// planner, inside a 120s transaction against a shared credit pool), so no spec
// here builds a route.
export const seedTurf = async (
  client: AxiosInstance,
  name: string,
): Promise<SeededTurf> => {
  const { data: filter } = await client.post<{ id: number }>(
    '/v1/voters/voter-file/filter',
    { name },
  )

  const { data: turf } = await client.post<SeededTurf>(
    '/v1/door-knocking/turfs',
    {
      voterFileFilterId: filter.id,
      name,
      color: '#2563eb',
      geoPoly: { type: 'Polygon', coordinates: [CHEYENNE_RING] },
    },
  )

  return turf
}

// A saved-list row in the native right rail (TurfList). Keyed on the turf id
// rather than its name or the row's DOM shape, so neither copy churn nor a
// second list in the rail can point this at the wrong row.
export const turfRow = (page: Page, turfId: number): Locator =>
  page.getByTestId(`turf-row-${turfId}`)

// The native shell's header — present as soon as NativeDoorKnockingPage mounts,
// independent of the voter pack and of whether the WebGL canvas came up.
export const nativeShellHeading = (page: Page): Locator =>
  page.getByRole('heading', { name: 'Door knocking', exact: true })

export const legacyDashboardHeading = (page: Page): Locator =>
  page.getByRole('heading', { name: 'Interactions', exact: true })
