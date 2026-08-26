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

// Four Win assertions in ONE test, not four. Each `setupProCampaignUser` mints
// an isolated Clerk user and provisions Pro through test-set-pro, and that
// path is the suite's most fragile shared resource — a sibling spec's setup
// 400'd on this PR's first CI run precisely because five more provisions
// landed in one shard. The neighbouring contacts-filters.spec.ts amortises
// setup the same way, with test.step.
test('precinct filter: option list, counts and the View all sheet', async ({
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
  // Far inside the 1,000-row cap; a truncated response would mean the cap or
  // the pinned district changed.
  expect(truncated).toBe(false)

  const named = namedOptions(options)
  const unknown = options.find((option) => option.precinct === '')
  const hasUnknown = Boolean(unknown)
  // The inline row holds 8 pills, one of which Unknown claims when it exists.
  const inlineNamedSlots = hasUnknown ? 7 : 8

  // One precondition for the whole test rather than a skip per assertion: if
  // the pinned district stops having an unassigned bucket or enough precincts
  // to overflow the inline row, the fixture has drifted far enough that the
  // rest of these assertions are not describing what they claim to.
  test.skip(
    !hasUnknown || named.length <= inlineNamedSlots,
    'pinned district no longer has both an unassigned bucket and more precincts than fit inline',
  )

  const wizard = await openWinVoterFileStep(page)
  await expect(wizardPillGroup(wizard, 'Precinct')).toBeVisible({
    timeout: 20_000,
  })
  const unfiltered = await readSettledWizardCount(page)
  expect(unfiltered).toBeGreaterThan(0)

  const [biggest, second] = [...named].sort((a, b) => b.voters - a.voters)

  await test.step('the enumerated voters partition the district', () => {
    // Every voter is in exactly one (county, precinct) bucket including the
    // unassigned one, so the option list must sum to the universe. A mismatch
    // means enumeration and the universe query disagree on scope.
    const total = options.reduce((sum, option) => sum + option.voters, 0)
    expect(total).toBe(unfiltered)
  })

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
    // Precincts are disjoint populations, so OR is exactly the sum; an AND
    // would collapse this to zero.
    expect(count).toBe(biggest!.voters + second!.voters)
    await clearFilters(page, wizard, unfiltered)
  })

  await test.step('the unassigned bucket resolves to IS NULL, not to an empty string', async () => {
    // A tuple comparison against '' matches nobody, and an empty audience
    // looks like a narrow filter rather than a bug — so zero here is the
    // silent regression this guards.
    await selectWizardPill(wizard, 'Precinct', 'Unknown')
    const count = await readSettledWizardCount(page, {
      differentFrom: unfiltered,
    })
    expect(count).toBe(unknown!.voters)
    expect(count).toBeGreaterThan(0)
    await clearFilters(page, wizard, unfiltered)
  })

  await test.step('the View all sheet reaches a precinct the inline row hides', async () => {
    // Sorted last by the control's own ordering, so guaranteed hidden.
    const hidden = named[named.length - 1]!

    await expect(
      wizardPillGroup(wizard, 'Precinct').getByRole('button', {
        name: precinctLabel(hidden),
        exact: true,
      }),
      'the last precinct should not be inline',
    ).toHaveCount(0)

    // Matched on the prefix, not the count: the label carries the precinct
    // total, which is live data.
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

    // Closed by asserting THIS sheet's content is gone rather than via
    // closeCrmSheet: that helper re-resolves drawer-content.last() and waits
    // for it to hide, but the precinct sheet is nested inside the wizard
    // drawer — so the moment it closes, .last() falls back to the wizard,
    // which is correctly still open, and the helper fails on the wrong node.
    await sheet.getByRole('button', { name: 'Close' }).first().click()
    await expect(allPrecincts).toBeHidden({ timeout: 10_000 })

    // A sheet selection must survive the sheet closing, or the user cannot
    // see or clear what they picked.
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
})

// Kept as its own test: it is the only one that WRITES, and folding a
// persistence round trip into the read-only assertions above would leave a
// saved list behind whenever an earlier step failed.
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

  // The round trip that matters: the selection has to survive being persisted
  // as VoterFileFilter.precincts and re-resolved on read. The filter key is
  // `precinct` while the column is `precincts`, and the schema strips a
  // malformed key silently — so a broken round trip surfaces here as the
  // People tile reporting the whole district instead of one precinct.
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
