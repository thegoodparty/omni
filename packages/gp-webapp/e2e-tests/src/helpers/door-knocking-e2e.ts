import { expect, type Locator, type Page } from '@playwright/test'
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

// There is deliberately no turf seeder here any more.
//
// Until 3.0 a turf could be written on its own — polygon and filter, nothing
// bought — and the route was a separate, paid call no spec made. Creating a
// list and buying its Geoapify route are now ONE transaction, so seeding a row
// to look at would bill a shared credit pool on every run of a suite that gates
// every PR in the monorepo, and would take a 30s third-party call as a
// dependency of the gate. Nothing in this suite is worth that.
//
// So the specs here cover only what an org with no lists can reach, and
// everything about a list that exists — the rail row, the details sheet, the
// printed sheet — is asserted in unit tests, where a list costs a fixture:
// TurfList.test.tsx, TurfDetailsSheet.test.tsx, WalkSheet.test.tsx. The
// cross-service half that no mock can confirm has its own gp-api suite in
// src/doorKnocking/tests/doorKnocking.routes.test.ts.

// The native shell's header — present as soon as NativeDoorKnockingPage mounts,
// independent of the voter pack and of whether the WebGL canvas came up.
export const nativeShellHeading = (page: Page): Locator =>
  page.getByRole('heading', { name: 'Door knocking', exact: true })

export const legacyDashboardHeading = (page: Page): Locator =>
  page.getByRole('heading', { name: 'Interactions', exact: true })
