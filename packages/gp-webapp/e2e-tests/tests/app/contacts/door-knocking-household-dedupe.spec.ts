import { expect, type Locator, type Page, test } from '@playwright/test'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import { applyContactsQuery } from 'src/helpers/contacts-e2e'
import { setupProCampaignUser } from 'src/helpers/organizations'
import { disableCrmFlags } from 'src/helpers/crm-contacts-e2e'

// The Door Knocking segment's URL/query-param value, from
// crm/configs/defaultSegments.config.ts. The label below is what the Select
// renders; this is what the segment param and the list request carry.
const DOOR_KNOCKING_SEGMENT = 'doorKnocking'

// The "Total Voters" stat card renders the active segment's count (it reads
// pagination.totalResults for the current segment, formatted with commas by
// numberFormatter — e.g. "85,696"). Parse the digits back to a number so the
// two segment reads can be compared.
//
// The `--` guard is a real pre-settled sentinel on FIRST load only: until the
// list query resolves, pagination is null and the card renders `--`. After a
// segment switch the pre-settled state is the PREVIOUS segment's number, which
// satisfies `not --` just fine — so this read is only as sound as the wait that
// precedes it. That wait is selectSegment's, below.
const readTotalVoters = async (page: Page): Promise<number> => {
  const card = page.getByTestId('contact-stats-totalConstituents')
  await expect(card).toBeVisible({ timeout: 30000 })
  await expect(card).not.toHaveText('--', { timeout: 30000 })
  const text = (await card.innerText()).trim()
  return parseInt(text.replace(/[^0-9]/g, ''), 10)
}

// Select a default segment from the "Current list" Radix Select by its option
// label. Gated through applyContactsQuery WITH the segment value, so the wait
// is pinned to the list response for this segment's first page rather than to
// any /v1/contacts response — the provider's page+1 prefetch for the segment
// we're leaving is routinely still in flight at click time and would otherwise
// resolve the wait before the navigation had even committed, leaving the stat
// card showing the previous segment.
const selectSegment = async (
  page: Page,
  optionLabel: string,
  segment: string,
): Promise<void> => {
  const trigger = page.getByRole('combobox').first()
  await expect(trigger).toBeVisible({ timeout: 20000 })
  await applyContactsQuery(
    page,
    async () => {
      await trigger.click()
      await page.getByRole('option', { name: optionLabel, exact: true }).click()
    },
    { segment },
  )
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

// Selecting a non-default segment (Door Knocking) is pro-gated.
// setupProCampaignUser provisions Pro without the Stripe webhook and the pinned
// district has real voter data on the preview's gp-api, so this runs on PR
// previews now. See e2e-tests/CLAUDE.md ("@dev-only") for what still earns the tag.
test.describe('Door Knocking household dedupe', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
    // Legacy flag-off spec: pin the CRM flags OFF so a live ramp can't flip
    // this onto the new CRM surface mid-test (e2e-tests/CLAUDE.md).
    await disableCrmFlags(page)
  })

  test('Door Knocking total is below All Contacts and rows are one-per-household', async ({
    page,
  }) => {
    test.setTimeout(3 * 60 * 1000)

    await setupProCampaignUser(page)

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
    await selectSegment(page, 'Door Knocking', DOOR_KNOCKING_SEGMENT)
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
