import { expect, type Locator, type Page, test } from '@playwright/test'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import { applyContactsQuery } from 'src/helpers/contacts-e2e'
import {
  setupElectedOfficeUser,
  switchOrganization,
  getSelectedOrgName,
  getOrgPickerOptions,
} from 'src/helpers/organizations'

// The "Total Voters" stat card renders the active segment's count (it reads
// pagination.totalResults for the current segment, formatted with commas by
// numberFormatter — e.g. "85,696"). Parse the digits back to a number so the
// two segment reads can be compared.
const readTotalVoters = async (page: Page): Promise<number> => {
  const card = page.getByTestId('contact-stats-totalConstituents')
  await expect(card).toBeVisible({ timeout: 30000 })
  await expect(card).not.toHaveText('--', { timeout: 30000 })
  const text = (await card.innerText()).trim()
  return parseInt(text.replace(/[^0-9]/g, ''), 10)
}

// Select a default segment from the "Current list" Radix Select by its option
// label, gated through applyContactsQuery so the read happens after the segment
// re-query lands and the table skeleton clears.
const selectSegment = async (
  page: Page,
  optionLabel: string,
): Promise<void> => {
  const trigger = page.getByRole('combobox').first()
  await expect(trigger).toBeVisible({ timeout: 20000 })
  await applyContactsQuery(page, async () => {
    await trigger.click()
    await page.getByRole('option', { name: optionLabel, exact: true }).click()
  })
}

// The Address column is the 4th column in ContactsTable; read its rendered text
// per visible row.
const readVisibleAddresses = async (table: Locator): Promise<string[]> => {
  const cells = table.locator('tbody tr td:nth-child(4)')
  const count = await cells.count()
  const addresses: string[] = []
  for (let i = 0; i < count; i++) {
    addresses.push((await cells.nth(i).innerText()).trim())
  }
  return addresses
}

// @dev-only: same gating as win-contacts.spec.ts — selecting a non-default
// segment is pro-gated, and the flow needs the warm dev stack's real district
// voter data. An ephemeral per-PR preview can't guarantee the pro provisioning
// or the data, so this runs on the post-merge develop e2e (and on demand), not
// on PRs. See e2e-tests/CLAUDE.md ("@dev-only").
test.describe('Door Knocking household dedupe @dev-only', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  test('Door Knocking total is below All Contacts and rows are one-per-household', async ({
    page,
  }) => {
    test.setTimeout(3 * 60 * 1000)

    // setupElectedOfficeUser leaves the elected-office org selected; the Win
    // context is the campaign (non-eo) org, so switch to it (mirrors
    // win-contacts.spec.ts — the EO org resolves as Serve).
    await setupElectedOfficeUser(page)

    const eoOrgName = await getSelectedOrgName(page)
    const allOrgs = await getOrgPickerOptions(page)
    const campaignOrgName = allOrgs.find((name) => name !== eoOrgName)
    expect(campaignOrgName).toBeTruthy()
    await switchOrganization(page, campaignOrgName!)

    await page.goto('/dashboard/contacts', { waitUntil: 'domcontentloaded' })
    await NavigationHelper.dismissOverlays(page)
    await expect(page).toHaveURL(/\/dashboard\/contacts/)

    const table = page.locator('table').first()
    await expect(table).toBeVisible({ timeout: 20000 })
    await expect(table.locator('tbody tr').first()).toBeVisible({
      timeout: 25000,
    })

    // All Contacts is the default segment on load — read its total.
    const allTotal = await readTotalVoters(page)
    expect(allTotal).toBeGreaterThan(0)

    // Switch to the Door Knocking segment (#375 groups/dedupes by residence
    // household) and read its total for the SAME district.
    await selectSegment(page, 'Door Knocking')
    const doorKnockingTotal = await readTotalVoters(page)
    expect(doorKnockingTotal).toBeGreaterThan(0)

    // Household dedupe collapses voters who share an address into one row, so
    // the Door Knocking count must be strictly below All Contacts.
    expect(doorKnockingTotal).toBeLessThan(allTotal)

    // And the visible rows are one-per-household: no residence address repeats
    // within the page.
    const addresses = await readVisibleAddresses(table)
    const populated = addresses.filter((address) => address && address !== '--')
    expect(populated.length).toBeGreaterThan(0)
    expect(new Set(populated).size).toBe(populated.length)
  })
})
