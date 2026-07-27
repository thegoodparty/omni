import { expect, type Locator, type Page } from '@playwright/test'
import type { AxiosInstance } from 'axios'
import { setFlagOverrides } from 'src/helpers/campaignStory.helper'
import { NavigationHelper } from 'src/helpers/navigation.helper'
import { personContactPanel } from 'src/helpers/contacts-e2e'

// Helpers for the flag-on CRM contacts page (ENG-10756 port). The legacy
// flag-off helpers stay in contacts-e2e.ts — the retained legacy smoke and the
// not-yet-ported legacy specs still import them.

// Force the CRM rebuild on for BOTH modes via the off-prod override cookie.
// Call BEFORE auth/navigation so the first SSR render already sees it — flag
// resolution is server-side and this cookie is the only deterministic lever
// (e2e-tests/CLAUDE.md "Flag-gated surfaces").
export const enableCrmFlags = async (page: Page): Promise<void> => {
  await setFlagOverrides(page, { 'win-crm': 'on', 'serve-crm': 'on' })
}

// Pin the legacy flag-off page for the retained smoke, so it keeps testing the
// old surface deterministically even after the CRM flags ramp in Amplitude.
export const disableCrmFlags = async (page: Page): Promise<void> => {
  await setFlagOverrides(page, { 'win-crm': 'off', 'serve-crm': 'off' })
}

export const gotoCrmContacts = async (page: Page): Promise<void> => {
  await page.goto('/dashboard/contacts', { waitUntil: 'domcontentloaded' })
  await NavigationHelper.dismissOverlays(page)
  await expect(page).toHaveURL(/\/dashboard\/contacts/)
}

// The full-width top sheet (vaul bottom drawer, crm/shared/CrmSheet.tsx) that
// hosts both the create-list wizard and the list-detail view. `.last()`
// because the wizard→detail handoff (save, duplicate) briefly overlaps the
// closing drawer's exit animation with the newly opened one — the newest
// drawer is always the intended target.
export const crmSheet = (page: Page): Locator =>
  page.locator('[data-slot="drawer-content"]').last()

// A filter pill group on the wizard's conditions step. VoterFileStep passes
// the filters.config.ts field label (title case, e.g. 'Voter Likelihood') as
// the ToggleGroup's aria-label — the visible heading is sentence-cased, but
// the accessible name is the config label. Radix ToggleGroup renders
// role="toolbar" (not "group") for type="multiple".
export const wizardPillGroup = (sheet: Locator, groupLabel: string): Locator =>
  sheet.getByRole('toolbar', { name: groupLabel, exact: true })

export const selectWizardPill = async (
  sheet: Locator,
  groupLabel: string,
  option: string,
): Promise<void> => {
  const pill = wizardPillGroup(sheet, groupLabel).getByRole('button', {
    name: option,
    exact: true,
  })
  await pill.click()
  await expect(pill).toHaveAttribute('aria-pressed', 'true')
}

export const wizardBuildButton = (page: Page): Locator =>
  page.getByRole('button', { name: /build your list/i })

// A chip row on the wizard's ACTIVITY branch (ENG-10757). ActivityStep mixes
// single-type ToggleGroups (channel "Previous activity", "Campaign") with a
// multiple-type one ("Activity" outcomes), and Radix gives the two different
// accessible roles (radio items vs toolbar buttons) — so these anchor on the
// aria-label and the element tag instead of a role. With stacked conditions
// the same label repeats per condition; scope with .nth(i) at the call site.
export const activityPillGroup = (scope: Locator, label: string): Locator =>
  scope.locator(`[aria-label="${label}"]`)

const escapeForRegex = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Radix renders every ToggleGroupItem as a <button> in both group types, and
// data-state "on"/"off" is the one selected-state contract shared by both.
export const activityPill = (group: Locator, option: string): Locator =>
  group
    .locator('button')
    .filter({ hasText: new RegExp(`^${escapeForRegex(option)}$`) })

export const selectActivityPill = async (
  group: Locator,
  option: string,
): Promise<void> => {
  const pill = activityPill(group, option)
  await pill.click()
  await expect(pill).toHaveAttribute('data-state', 'on')
}

const parseWizardCount = (label: string | null): number | undefined => {
  const digits = label?.match(/\(([\d,]+)\)/)?.[1]
  if (!digits) return undefined
  return Number(digits.replace(/,/g, ''))
}

// Read the live running total off the wizard's footer CTA ("Build your list
// (N)") once it has SETTLED. The count is debounced ~600ms behind pill
// clicks and the label drops its "(N)" while a refetch is in flight, so a
// single read can catch the previous selection's stale number. Two reads
// 800ms apart (longer than the debounce window) must agree: a stale first
// read is followed by either the blank in-flight label or the new number,
// both of which force a re-poll. `differentFrom` additionally rejects the
// prior selection's value when the caller knows the count must change.
export const readSettledWizardCount = async (
  page: Page,
  options: { differentFrom?: number } = {},
): Promise<number> => {
  const button = wizardBuildButton(page)
  let settled: number | undefined
  await expect(async () => {
    const first = parseWizardCount(await button.textContent())
    expect(first).not.toBeUndefined()
    if (options.differentFrom !== undefined) {
      expect(first).not.toBe(options.differentFrom)
    }
    await page.waitForTimeout(800)
    const second = parseWizardCount(await button.textContent())
    expect(second).toBe(first)
    settled = first
  }).toPass({ timeout: 60_000 })
  return settled!
}

// Complete the wizard's name step and save. Resolves the new list's id from
// the /dashboard/contacts/lists/<id> URL the on-create navigation lands on
// (the detail sheet opens via shallow pushState).
export const saveWizardList = async (
  page: Page,
  name: string,
): Promise<string> => {
  const nameInput = page.getByLabel('List name')
  await expect(nameInput).toBeVisible({ timeout: 15_000 })
  await nameInput.fill(name)
  await page.getByRole('button', { name: 'Save list' }).click()
  await page.waitForURL(/\/dashboard\/contacts\/lists\/\d+/, {
    timeout: 30_000,
  })
  const listId = page.url().match(/\/lists\/(\d+)/)?.[1]
  expect(listId).toBeTruthy()
  return listId!
}

export const closeCrmSheet = async (page: Page): Promise<void> => {
  const sheet = crmSheet(page)
  await sheet.getByRole('button', { name: 'Close' }).click()
  await expect(sheet).toBeHidden({ timeout: 10_000 })
}

// A list row card in the lists index, located by its h3 title.
export const listCard = (page: Page, name: string): Locator =>
  page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByRole('heading', { name, exact: true }) })

export const openListCardMenu = async (
  page: Page,
  name: string,
): Promise<void> => {
  await listCard(page, name)
    .getByRole('button', { name: 'List options' })
    .click()
}

// One demographics stat tile (dt label + dd value) inside the list-detail
// sheet, e.g. statTileValue(sheet, 'People').
export const statTileValue = (sheet: Locator, label: string): Locator =>
  sheet.locator('dl > div').filter({ hasText: label }).first().locator('dd')

export const typeaheadInput = (page: Page): Locator =>
  page.locator('[data-slot="command-input"]')

// The subset of the GET /v1/contacts person row this suite asserts on.
// Mirrors @goodparty_org/contracts PersonSchema (e2e-tests can't import app
// or contracts code — separate workspace, see e2e-tests/CLAUDE.md).
export type ContactsApiPerson = {
  id: string
  firstName: string | null
  lastName: string | null
  nameSuffix: string | null
  age: number | null
  gender: 'Male' | 'Female' | null
  homeowner: 'Yes' | 'Likely' | 'No' | null
  cellPhone: string | null
}

// Same composition as PersonOverlay's formatPersonName, replicated because
// e2e-tests can't import from app/.
export const fullPersonName = (person: ContactsApiPerson): string =>
  [person.firstName, person.lastName, person.nameSuffix]
    .filter(Boolean)
    .map((part) => part!.trim())
    .join(' ')

// The rebuilt page has no member table, so a "known seeded person" for the
// typeahead/person-record verification comes from the same GET /v1/contacts
// the legacy table read, called directly with the saved list as the segment.
export const fetchListMembers = async (
  client: AxiosInstance,
  listId: string,
  resultsPerPage = 25,
): Promise<ContactsApiPerson[]> => {
  const { data } = await client.get<{ people: ContactsApiPerson[] }>(
    '/v1/contacts',
    { params: { page: 1, resultsPerPage, segment: listId } },
  )
  return data.people
}

// Open a person's record through the persistent typeahead and wait for the
// detail fetch to settle (the overlay renders skeletons until
// GET /v1/contacts/:id resolves). The result row is matched by cmdk's
// data-value attribute — the CommandItem value is the person id — so a
// same-named neighbor can't be opened by mistake.
export const openPersonViaTypeahead = async (
  page: Page,
  person: ContactsApiPerson,
): Promise<Locator> => {
  const input = typeaheadInput(page)
  await expect(input).toBeVisible({ timeout: 20_000 })
  await input.fill(fullPersonName(person))
  const option = page.locator(
    `[data-slot="command-item"][data-value="${person.id}"]`,
  )
  await expect(option).toBeVisible({ timeout: 30_000 })
  await option.click()
  const panel = personContactPanel(page)
  await expect(panel).toBeVisible({ timeout: 15_000 })
  await expect(panel.locator('.animate-pulse')).toHaveCount(0, {
    timeout: 30_000,
  })
  return panel
}

export const closePersonPanel = async (panel: Locator): Promise<void> => {
  await panel.getByRole('button', { name: /close/i }).click()
  await expect(panel).toBeHidden({ timeout: 10_000 })
}
