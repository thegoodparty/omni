import { expect, type Locator, type Page, test } from '@playwright/test'
import type { AxiosInstance } from 'axios'
import { blockSlowScripts } from 'src/helpers/navigation.helper'
import {
  closeCrmSheet,
  crmSheet,
  enableCrmFlags,
  gotoCrmContacts,
  readSettledWizardCount,
  saveWizardList,
  selectWizardPill,
  statTileValue,
  wizardBuildButton,
  wizardPillGroup,
} from 'src/helpers/crm-contacts-e2e'
import {
  setupElectedOfficeUser,
  setupProCampaignUser,
} from 'src/helpers/organizations'

// The Precinct filter (Win-only). Every other filter in this suite can only be
// verified by triangulation — a pill has to MOVE the live count, and the count
// has to match the saved list's People tile — because a precinct is not a field
// on the person response, so there is no "every member carries the value" check
// available.
//
// Precinct earns a stronger assertion instead. GET /v1/contacts/precincts
// returns a voter count per precinct, so the enumeration and the filter can be
// held against each other EXACTLY: selecting one precinct must count precisely
// the voters the option list attributed to it. That equality is the real
// invariant — the option list and the filter must agree on one population, and
// they are built by two separate SQL builders (Databricks tuple-IN, Postgres
// unnest) that a shared count would otherwise hide a divergence between.
//
// Anchored on the same district the rest of the suite pins (Cheyenne City
// Council Ward 1, WY): one county, 9 named precincts plus a real
// no-precinct-on-file bucket. That shape matters — 9 named precincts exceeds
// the 8-pill inline cap, so the "View all" sheet is on the only path to the
// two smallest precincts rather than being a state this spec has to fake.

const TEST_TIMEOUT = 8 * 60 * 1000

type PrecinctOption = { county: string; precinct: string; voters: number }

const fetchPrecincts = async (
  client: AxiosInstance,
): Promise<{ options: PrecinctOption[]; truncated: boolean }> => {
  const { data } = await client.get<{
    options: PrecinctOption[]
    truncated: boolean
  }>('/v1/contacts/precincts')
  return data
}

// The pill label the UI composes: county title-cased, em-dash, precinct
// verbatim. Replicated because e2e-tests cannot import from app/ — so it must
// MIRROR PrecinctFilter.tsx's titleCase exactly, Mc-rule included. A drift here
// makes every pill lookup miss, and the failure reads as a missing control
// rather than a label mismatch.
const titleCase = (value: string): string =>
  value
    .toLowerCase()
    .replace(/\b[a-z]/g, (char) => char.toUpperCase())
    .replace(/\bMc([a-z])/g, (_, char: string) => 'Mc' + char.toUpperCase())

const precinctLabel = (option: PrecinctOption): string =>
  option.precinct === ''
    ? 'Unknown'
    : `${titleCase(option.county)} — ${option.precinct}`

const namedOptions = (options: PrecinctOption[]): PrecinctOption[] =>
  options
    .filter((option) => option.precinct !== '')
    .sort((a, b) =>
      a.county === b.county
        ? a.precinct.localeCompare(b.precinct)
        : a.county.localeCompare(b.county),
    )

const openWinVoterFileStep = async (page: Page): Promise<Locator> => {
  await page.getByRole('button', { name: 'Create new list' }).click()
  const wizard = crmSheet(page)
  await expect(wizard).toBeVisible({ timeout: 15_000 })
  // Win opens on the branch chooser; the voter-file branch is where filters
  // live.
  await wizard
    .getByText('Build a list using voter demographics and data')
    .click()
  await wizard.getByRole('button', { name: 'Continue' }).click()
  await expect(
    wizard.getByText('Build a voter list', { exact: true }),
  ).toBeVisible({ timeout: 10_000 })
  return wizard
}

const clearFilters = async (
  page: Page,
  wizard: Locator,
  unfiltered: number,
): Promise<void> => {
  await wizard.getByRole('button', { name: 'Clear filters' }).click()
  await expect(wizardBuildButton(page)).toContainText(
    `(${unfiltered.toLocaleString('en-US')})`,
    { timeout: 30_000 },
  )
}

test.beforeEach(async ({ page }) => {
  await blockSlowScripts(page)
  await enableCrmFlags(page)
})

test('precinct filter: counts agree with the enumerated option list', async ({
  page,
}) => {
  test.setTimeout(TEST_TIMEOUT)
  const { client } = await setupProCampaignUser(page)
  await gotoCrmContacts(page)
  await expect(page.getByRole('heading', { name: 'Voter Data' })).toBeVisible({
    timeout: 20_000,
  })

  const { options, truncated } = await fetchPrecincts(client)
  expect(options.length, 'district should enumerate precincts').toBeGreaterThan(
    0,
  )
  // This district is far inside the 1,000-row cap; a truncated response here
  // would mean the cap or the district pin changed.
  expect(truncated).toBe(false)

  const named = namedOptions(options)
  expect(named.length).toBeGreaterThanOrEqual(2)

  const wizard = await openWinVoterFileStep(page)
  await expect(wizardPillGroup(wizard, 'Precinct')).toBeVisible({
    timeout: 20_000,
  })
  const unfiltered = await readSettledWizardCount(page)
  expect(unfiltered).toBeGreaterThan(0)

  // The two largest precincts are the two the inline row is guaranteed to
  // show, so neither of these steps depends on the sheet.
  const [biggest, second] = [...named].sort((a, b) => b.voters - a.voters)

  await test.step('one precinct counts exactly its enumerated voters', async () => {
    await selectWizardPill(wizard, 'Precinct', precinctLabel(biggest!))
    const count = await readSettledWizardCount(page, {
      differentFrom: unfiltered,
    })
    expect(count).toBe(biggest!.voters)
  })

  await test.step('a second precinct ORs within the category', async () => {
    await selectWizardPill(wizard, 'Precinct', precinctLabel(second!))
    const count = await readSettledWizardCount(page, {
      differentFrom: biggest!.voters,
    })
    // OR within a category — precincts are disjoint populations, so the
    // selection is exactly the sum. An AND would collapse this to zero.
    expect(count).toBe(biggest!.voters + second!.voters)
    await clearFilters(page, wizard, unfiltered)
  })

  await test.step('the enumerated voters sum to the district universe', async () => {
    // Every voter belongs to exactly one (county, precinct) bucket including
    // the unassigned one, so the option list has to partition the district. A
    // mismatch means the enumeration and the universe query disagree on scope.
    const total = options.reduce((sum, option) => sum + option.voters, 0)
    expect(total).toBe(unfiltered)
  })
})

test('precinct filter: the unassigned bucket is selectable and real', async ({
  page,
}) => {
  test.setTimeout(TEST_TIMEOUT)
  const { client } = await setupProCampaignUser(page)
  await gotoCrmContacts(page)

  const { options } = await fetchPrecincts(client)
  const unknown = options.find((option) => option.precinct === '')
  // Guarded rather than assumed: the bucket only exists where the voter file
  // has rows with no precinct. This district has one today; if the pinned
  // district or the data changes, skip rather than fail on an unrelated shift.
  test.skip(
    !unknown,
    'pinned district has no unassigned-precinct voters to exercise',
  )

  const wizard = await openWinVoterFileStep(page)
  const unfiltered = await readSettledWizardCount(page)

  // Selecting Unknown must resolve to IS NULL. A tuple comparison against ''
  // would match nobody, so a zero count here is the regression this guards —
  // and it is silent, since an empty audience looks like a narrow filter.
  await selectWizardPill(wizard, 'Precinct', 'Unknown')
  const count = await readSettledWizardCount(page, {
    differentFrom: unfiltered,
  })
  expect(count).toBe(unknown!.voters)
  expect(count).toBeGreaterThan(0)
})

test('precinct filter: the View all sheet reaches a hidden precinct', async ({
  page,
}) => {
  test.setTimeout(TEST_TIMEOUT)
  const { client } = await setupProCampaignUser(page)
  await gotoCrmContacts(page)

  const { options } = await fetchPrecincts(client)
  const named = namedOptions(options)
  const hasUnknown = options.some((option) => option.precinct === '')
  // The inline row holds 8 pills; Unknown claims one whenever it exists.
  const inlineNamedSlots = hasUnknown ? 7 : 8
  test.skip(
    named.length <= inlineNamedSlots,
    'every precinct fits inline, so there is no sheet to open',
  )

  // Sorted last by the control's own ordering, so guaranteed to be hidden.
  const hidden = named[named.length - 1]!

  const wizard = await openWinVoterFileStep(page)
  const unfiltered = await readSettledWizardCount(page)

  await expect(
    wizardPillGroup(wizard, 'Precinct').getByRole('button', {
      name: precinctLabel(hidden),
      exact: true,
    }),
    'the last precinct should not be inline',
  ).toHaveCount(0)

  // Matched on the prefix, not the count: the label carries the precinct total,
  // which is live data — pinning it would make this a data-drift failure
  // rather than a behavior one.
  await wizard.getByRole('button', { name: /^View all \d/ }).click()

  const sheet = crmSheet(page)
  const allPrecincts = sheet.getByRole('toolbar', {
    name: 'All precincts',
    exact: true,
  })
  await expect(allPrecincts).toBeVisible({ timeout: 15_000 })

  const hiddenPill = allPrecincts.getByRole('button', {
    name: precinctLabel(hidden),
    exact: true,
  })
  await expect(hiddenPill).toBeVisible({ timeout: 10_000 })
  await hiddenPill.click()
  await closeCrmSheet(page)

  // A selection made in the sheet has to survive it closing — otherwise the
  // user cannot see or clear what they picked.
  await expect(
    wizardPillGroup(wizard, 'Precinct').getByRole('button', {
      name: precinctLabel(hidden),
      exact: true,
    }),
    'a sheet selection should be promoted into the inline row',
  ).toHaveAttribute('aria-pressed', 'true')

  const count = await readSettledWizardCount(page, {
    differentFrom: unfiltered,
  })
  expect(count).toBe(hidden.voters)
})

test('precinct filter: a saved list keeps the precinct scope', async ({
  page,
}) => {
  test.setTimeout(TEST_TIMEOUT)
  const { client } = await setupProCampaignUser(page)
  await gotoCrmContacts(page)

  const { options } = await fetchPrecincts(client)
  const biggest = [...namedOptions(options)].sort(
    (a, b) => b.voters - a.voters,
  )[0]!

  const wizard = await openWinVoterFileStep(page)
  await readSettledWizardCount(page)

  await selectWizardPill(wizard, 'Precinct', precinctLabel(biggest))
  const count = await readSettledWizardCount(page)
  expect(count).toBe(biggest.voters)

  // The round trip that matters: the precinct selection has to survive being
  // persisted as VoterFileFilter.precincts and re-resolved on read. The
  // filter key is `precinct` while the column is `precincts`, and the schema
  // strips a malformed key silently — so a broken round trip shows up here as
  // the People tile reporting the whole district instead of one precinct.
  await wizardBuildButton(page).click()
  const listId = await saveWizardList(page, `E2E precinct ${Date.now()}`)
  const detailSheet = crmSheet(page)
  await expect(statTileValue(detailSheet, 'People')).toHaveText(
    count.toLocaleString('en-US'),
    { timeout: 30_000 },
  )
  await closeCrmSheet(page)

  // And again through the API the list drives outreach with, so the assertion
  // does not rest on one tile's rendering.
  const { data } = await client.get<{ pagination: { totalResults: number } }>(
    '/v1/contacts',
    { params: { page: 1, resultsPerPage: 1, segment: listId } },
  )
  expect(data.pagination.totalResults).toBe(count)
})

test('precinct filter: absent for an elected office (Win-only)', async ({
  page,
}) => {
  test.setTimeout(TEST_TIMEOUT)
  const { client } = await setupElectedOfficeUser(page, {
    zip: '82001',
    office: 'Cheyenne City Council - Ward 1',
  })
  await gotoCrmContacts(page)
  await expect(
    page.getByRole('heading', { name: 'Constituent Data' }),
  ).toBeVisible({ timeout: 20_000 })

  // Serve lands straight on the filters step (no branch chooser).
  await page.getByRole('button', { name: 'Create new list' }).click()
  const wizard = crmSheet(page)
  await expect(
    wizard.getByText('Build a constituent list', { exact: true }),
  ).toBeVisible({ timeout: 15_000 })

  // Asserted on the visible group LABEL, not on the pill group's accessible
  // name. An absence check anchored on the same locator the positive tests use
  // is unfalsifiable here: if the aria-label ever regresses, that locator
  // resolves to 0 for Win as well and this test passes while the gate is
  // broken. The heading is rendered whenever the control is.
  await expect(wizard.getByText('Precinct', { exact: true })).toHaveCount(0)
  await expect(wizardPillGroup(wizard, 'Precinct')).toHaveCount(0)

  // The endpoint refuses the org too, so the gate does not depend on the UI
  // simply not rendering the control.
  const response = await client.get('/v1/contacts/precincts', {
    validateStatus: () => true,
  })
  expect(response.status).toBe(400)
})
