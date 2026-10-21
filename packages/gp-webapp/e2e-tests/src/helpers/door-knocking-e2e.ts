import { expect, type Locator, type Page } from '@playwright/test'
import { NavigationHelper } from 'src/helpers/navigation.helper'

// Helpers for the door-knocking surface (app/dashboard/door-knocking/).

export const DOOR_KNOCKING_PATH = '/dashboard/door-knocking'

export const printWalkListPath = (turfId: number | string): string =>
  `${DOOR_KNOCKING_PATH}/print/${turfId}`

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

// A create-flow step, by the title a canvasser reads at the top of it.
//
// `OutreachFlowShell` draws that title twice: once as the `sr-only`
// `DrawerTitle` that gives the dialog its accessible name, and once as the
// visible `h3` `Intro` renders in the step body. So an unqualified
// `getByRole('heading', { name })` is a strict-mode violation on every step of
// every v2 outreach flow, not only this one. Pinned to the visible `h3` — the
// thing the step actually shows; the sr-only twin is covered where it matters,
// as the dialog's name.
export const createFlowStepHeading = (page: Page, name: string): Locator =>
  page.getByRole('heading', { name, exact: true, level: 3 })
