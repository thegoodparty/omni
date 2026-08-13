import { expect, type Locator, type Page, test } from '@playwright/test'
import type { AxiosInstance } from 'axios'
import { blockSlowScripts } from 'src/helpers/navigation.helper'
import {
  closeCrmSheet,
  closePersonPanel,
  crmSheet,
  enableCrmFlags,
  fetchListMembers,
  fullPersonName,
  gotoCrmContacts,
  openPersonViaTypeahead,
  readSettledWizardCount,
  saveWizardList,
  selectWizardPill,
  statTileValue,
  wizardBuildButton,
  wizardPillGroup,
  type ContactsApiPerson,
} from 'src/helpers/crm-contacts-e2e'
import { setupElectedOfficeUser } from 'src/helpers/organizations'

// ENG-10756: the functional core of the contacts suite, ported to the CRM UI.
// The rebuilt page has NO member table by design, so the legacy
// "table cells show the filtered values" assertions translate to the
// sanctioned triangulation:
//   1. every filter pill must move the wizard's live count (POST
//      /v1/contacts/count runs the exact payload the saved list would use, so
//      a broken pill→filter mapping shows up as an unmoved count),
//   2. a representative filter per group is saved as a list and its
//      list-detail demographics (People tile) must equal the wizard count,
//   3. that list's members — fetched through the same GET /v1/contacts the
//      legacy table read, with the saved list as the segment — must carry the
//      filtered field value, and one member is opened through the typeahead
//      so the person RECORD shows the value (the AC's data-level check for
//      gender, age, homeowner, plus cell phone).
// Strictly-decreasing count assertions lean on the same live-data facts the
// legacy suite proved for this district (both option sides of each asserted
// field have matching rows, so any single side is a proper subset).

const TEST_TIMEOUT = 8 * 60 * 1000

const setUpCrmContacts = async (page: Page): Promise<AxiosInstance> => {
  const { client } = await setupElectedOfficeUser(page, {
    zip: '82001',
    office: 'Cheyenne City Council - Ward 1',
  })
  await gotoCrmContacts(page)
  await expect(
    page.getByRole('heading', { name: 'Constituent Data' }),
  ).toBeVisible({ timeout: 20_000 })
  return client
}

// Open the wizard (Serve lands directly on the constituent filters) and read
// the settled unfiltered total — ENG-10751 fires the count with zero
// selections so the disabled CTA shows the full universe.
const openWizard = async (
  page: Page,
): Promise<{ wizard: Locator; unfiltered: number }> => {
  await page.getByRole('button', { name: 'Create new list' }).click()
  const wizard = crmSheet(page)
  await expect(wizard).toBeVisible({ timeout: 15_000 })
  await expect(
    wizard.getByText('Build a constituent list', { exact: true }),
  ).toBeVisible({ timeout: 10_000 })
  const unfiltered = await readSettledWizardCount(page)
  expect(unfiltered).toBeGreaterThan(0)
  return { wizard, unfiltered }
}

const clearWizardFilters = async (
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

// Select pills, assert the live count reflects the narrowed set, clear.
// `strict: false` is reserved for coverage-style filters (Has Cell Phone /
// Has Landline / Language English) where full-universe coverage is a
// legitimate data shape, so equality with the unfiltered total can't be
// ruled out.
const probeCount = async (
  page: Page,
  wizard: Locator,
  unfiltered: number,
  selections: ReadonlyArray<readonly [string, string]>,
  { strict = true }: { strict?: boolean } = {},
): Promise<number> => {
  for (const [group, option] of selections) {
    await selectWizardPill(wizard, group, option)
  }
  const count = await readSettledWizardCount(
    page,
    strict ? { differentFrom: unfiltered } : {},
  )
  expect(count).toBeGreaterThan(0)
  expect(count).toBeLessThanOrEqual(unfiltered)
  if (strict) expect(count).toBeLessThan(unfiltered)
  await clearWizardFilters(page, wizard, unfiltered)
  return count
}

// Build a list from the wizard's CURRENT selection and verify the
// list-detail demographics reflect the same count the wizard showed.
const buildListFromSelection = async (
  page: Page,
  expectedCount: number,
  name: string,
): Promise<string> => {
  await wizardBuildButton(page).click()
  const listId = await saveWizardList(page, name)
  const detailSheet = crmSheet(page)
  await expect(statTileValue(detailSheet, 'People')).toHaveText(
    expectedCount.toLocaleString('en-US'),
    { timeout: 30_000 },
  )
  await closeCrmSheet(page)
  return listId
}

const pickNamedMember = (
  members: ContactsApiPerson[],
  { requireAge = false }: { requireAge?: boolean } = {},
): ContactsApiPerson => {
  const member = members.find(
    (candidate) =>
      fullPersonName(candidate).length >= 3 &&
      (!requireAge || candidate.age !== null),
  )
  expect(
    member,
    requireAge
      ? 'expected a list member with a displayable age'
      : 'expected a list member with a searchable name',
  ).toBeTruthy()
  return member!
}

// A labeled field on the person record — same label/value composition the
// legacy person-panel assertions used (label <p> + value in the same
// container).
const expectPanelField = async (
  panel: Locator,
  label: string,
  value: RegExp,
): Promise<void> => {
  const fieldLabel = panel.locator('p', { hasText: label }).first()
  await expect(fieldLabel.locator('xpath=..')).toHaveText(value)
}

test.beforeEach(async ({ page }) => {
  await blockSlowScripts(page)
  await enableCrmFlags(page)
})

test('contacts filters: demographics', async ({ page }) => {
  test.setTimeout(TEST_TIMEOUT)
  const client = await setUpCrmContacts(page)
  const { wizard, unfiltered } = await openWizard(page)

  await test.step('Filter: Gender (Male)', async () => {
    await probeCount(page, wizard, unfiltered, [['Gender', 'Male']])
  })

  await test.step('Filter: Age (25-34, then widened with 35-49)', async () => {
    // The legacy suite documented that this district's live L2 data doesn't
    // populate a displayed age for every matched row, so single-age value
    // assertions stay data-level in the combo test below. Here: each range
    // narrows the universe, and adding a second range (OR semantics) widens
    // the selection again.
    await selectWizardPill(wizard, 'Age', '25-34')
    const single = await readSettledWizardCount(page, {
      differentFrom: unfiltered,
    })
    expect(single).toBeGreaterThan(0)
    expect(single).toBeLessThan(unfiltered)

    await selectWizardPill(wizard, 'Age', '35-49')
    const widened = await readSettledWizardCount(page, {
      differentFrom: single,
    })
    expect(widened).toBeGreaterThan(single)
    expect(widened).toBeLessThanOrEqual(unfiltered)
    await clearWizardFilters(page, wizard, unfiltered)
  })

  await test.step('Filter: Marital Status', async () => {
    await probeCount(page, wizard, unfiltered, [['Marital Status', 'Married']])
    await probeCount(page, wizard, unfiltered, [['Marital Status', 'Single']])
  })

  await test.step('Filter: Veteran Status', async () => {
    await probeCount(page, wizard, unfiltered, [['Veteran Status', 'Yes']])
  })

  await test.step('Gender Female: count + list detail + person record', async () => {
    await selectWizardPill(wizard, 'Gender', 'Female')
    const femaleCount = await readSettledWizardCount(page, {
      differentFrom: unfiltered,
    })
    expect(femaleCount).toBeGreaterThan(0)
    expect(femaleCount).toBeLessThan(unfiltered)

    const listId = await buildListFromSelection(
      page,
      femaleCount,
      `E2E gender F ${Date.now()}`,
    )

    const members = await fetchListMembers(client, listId)
    expect(members.length).toBeGreaterThan(0)
    for (const member of members) {
      expect(member.gender).toBe('Female')
    }

    const member = pickNamedMember(members)
    const panel = await openPersonViaTypeahead(page, member)
    await expect(panel.locator('p.text-xl').first()).toHaveText(/Female/)
    await closePersonPanel(panel)
  })
})

test('contacts filters: contact methods', async ({ page }) => {
  test.setTimeout(TEST_TIMEOUT)
  const client = await setUpCrmContacts(page)
  const { wizard, unfiltered } = await openWizard(page)

  await test.step('Filter: Landline', async () => {
    await probeCount(page, wizard, unfiltered, [['Landline', 'Has Landline']], {
      strict: false,
    })
  })

  await test.step('Filter: Language (English)', async () => {
    // The Spanish option has no matching constituent in this district's live
    // L2 data (documented in the legacy suite), so English is the one
    // asserted language — and it may legitimately cover the whole universe.
    await probeCount(page, wizard, unfiltered, [['Language', 'English']], {
      strict: false,
    })
  })

  await test.step('Voter Likelihood is absent for Serve', async () => {
    await expect(wizardPillGroup(wizard, 'Voter Likelihood')).toHaveCount(0)
  })

  await test.step('Filter: Business Owner', async () => {
    await probeCount(page, wizard, unfiltered, [['Business Owner', 'Yes']])
  })

  await test.step('Cell Phone: count + list detail + person record', async () => {
    await selectWizardPill(wizard, 'Cell Phone', 'Has Cell Phone')
    const cellCount = await readSettledWizardCount(page)
    expect(cellCount).toBeGreaterThan(0)
    expect(cellCount).toBeLessThanOrEqual(unfiltered)

    const listId = await buildListFromSelection(
      page,
      cellCount,
      `E2E cell phone ${Date.now()}`,
    )

    const members = await fetchListMembers(client, listId)
    expect(members.length).toBeGreaterThan(0)
    for (const member of members) {
      expect(member.cellPhone).toMatch(/\d/)
    }

    const member = pickNamedMember(members)
    const panel = await openPersonViaTypeahead(page, member)
    await expectPanelField(panel, 'Cell Phone Number', /\d/)
    await closePersonPanel(panel)
  })
})

test('contacts filters: household and socioeconomic', async ({ page }) => {
  test.setTimeout(TEST_TIMEOUT)
  const client = await setUpCrmContacts(page)
  const { wizard, unfiltered } = await openWizard(page)

  await test.step('Filter: Children', async () => {
    await probeCount(page, wizard, unfiltered, [['Children', 'Yes']])
    await probeCount(page, wizard, unfiltered, [['Children', 'No']])
  })

  await test.step('Filter: Homeowner (No)', async () => {
    await probeCount(page, wizard, unfiltered, [['Homeowner', 'No']])
  })

  await test.step('Filter: Education', async () => {
    await probeCount(page, wizard, unfiltered, [
      ['Level of Education', 'College Degree'],
    ])
    await probeCount(page, wizard, unfiltered, [
      ['Level of Education', 'High School Diploma'],
    ])
  })

  await test.step('Filter: Income', async () => {
    await probeCount(page, wizard, unfiltered, [
      ['Household Income Range', '$50k - $75k'],
    ])
    await probeCount(page, wizard, unfiltered, [
      ['Household Income Range', '$75k - $100k'],
    ])
  })

  await test.step('Homeowner Yes: count + list detail + person record', async () => {
    await selectWizardPill(wizard, 'Homeowner', 'Yes')
    const homeownerCount = await readSettledWizardCount(page, {
      differentFrom: unfiltered,
    })
    expect(homeownerCount).toBeGreaterThan(0)
    expect(homeownerCount).toBeLessThan(unfiltered)

    const listId = await buildListFromSelection(
      page,
      homeownerCount,
      `E2E homeowner ${Date.now()}`,
    )

    // homeownerYes maps to eq 'Yes' server-side (never 'Likely'), so every
    // member must carry the exact value.
    const members = await fetchListMembers(client, listId)
    expect(members.length).toBeGreaterThan(0)
    for (const member of members) {
      expect(member.homeowner).toBe('Yes')
    }

    const member = pickNamedMember(members)
    const panel = await openPersonViaTypeahead(page, member)
    await expectPanelField(panel, 'Homeowner', /Yes/i)
    await closePersonPanel(panel)
  })
})

test('contacts filters: ethnicity and multi-filter combos', async ({
  page,
}) => {
  test.setTimeout(TEST_TIMEOUT)
  const client = await setUpCrmContacts(page)
  const { wizard, unfiltered } = await openWizard(page)

  await test.step('Filter: Ethnicity', async () => {
    await probeCount(page, wizard, unfiltered, [['Ethnicity', 'Hispanic']])
    await probeCount(page, wizard, unfiltered, [['Ethnicity', 'European']])
  })

  let maleCount = 0
  let age2534Count = 0
  await test.step('Single-filter baselines for the combo', async () => {
    maleCount = await probeCount(page, wizard, unfiltered, [['Gender', 'Male']])
    age2534Count = await probeCount(page, wizard, unfiltered, [
      ['Age', '25-34'],
    ])
  })

  await test.step('Combo: Female, Ages 25-49, Cell Phone, Married', async () => {
    const femaleCount = await probeCount(page, wizard, unfiltered, [
      ['Gender', 'Female'],
    ])
    const comboCount = await probeCount(page, wizard, unfiltered, [
      ['Gender', 'Female'],
      ['Age', '25-34'],
      ['Age', '35-49'],
      ['Cell Phone', 'Has Cell Phone'],
      ['Marital Status', 'Married'],
    ])
    // AND semantics across groups: the combo can never exceed its gender
    // baseline.
    expect(comboCount).toBeLessThanOrEqual(femaleCount)
  })

  await test.step('Combo: Male, Married, Homeowner, Higher Education', async () => {
    const comboCount = await probeCount(page, wizard, unfiltered, [
      ['Gender', 'Male'],
      ['Marital Status', 'Married'],
      ['Marital Status', 'Likely Married'],
      ['Homeowner', 'Yes'],
      ['Level of Education', 'College Degree'],
      ['Level of Education', 'Graduate Degree'],
    ])
    expect(comboCount).toBeLessThanOrEqual(maleCount)
  })

  await test.step('Combo: Ages 35+, Landline, Children, Income $75-125k, Ethnicity', async () => {
    await probeCount(page, wizard, unfiltered, [
      ['Age', '35-49'],
      ['Age', '50-64'],
      ['Age', '65+'],
      ['Landline', 'Has Landline'],
      ['Children', 'Yes'],
      ['Household Income Range', '$75k - $100k'],
      ['Household Income Range', '$100k - $125k'],
      ['Ethnicity', 'European'],
      ['Ethnicity', 'Hispanic'],
    ])
  })

  await test.step('Gender + Age combo: count + list detail + person record', async () => {
    await selectWizardPill(wizard, 'Gender', 'Male')
    await selectWizardPill(wizard, 'Age', '25-34')
    const comboCount = await readSettledWizardCount(page, {
      differentFrom: unfiltered,
    })
    expect(comboCount).toBeGreaterThan(0)
    expect(comboCount).toBeLessThanOrEqual(Math.min(maleCount, age2534Count))

    const listId = await buildListFromSelection(
      page,
      comboCount,
      `E2E male 25-34 ${Date.now()}`,
    )

    const members = await fetchListMembers(client, listId)
    expect(members.length).toBeGreaterThan(0)
    for (const member of members) {
      expect(member.gender).toBe('Male')
      // Not every matched row carries a displayable age (documented live-data
      // gap for this district), but any that does must be inside the range.
      if (member.age !== null) {
        expect(member.age).toBeGreaterThanOrEqual(25)
        expect(member.age).toBeLessThanOrEqual(34)
      }
    }

    const member = pickNamedMember(members, { requireAge: true })
    const panel = await openPersonViaTypeahead(page, member)
    await expect(panel.locator('p.text-xl').first()).toHaveText(
      /Male.*\b(2[5-9]|3[0-4]) years old\b/,
    )
    await closePersonPanel(panel)
  })
})
