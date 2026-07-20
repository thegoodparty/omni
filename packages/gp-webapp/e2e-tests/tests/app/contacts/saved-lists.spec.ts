import { expect, type Locator, type Page, test } from '@playwright/test'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import {
  applyContactsQuery,
  filtersSheet,
  waitForContactsTableReady,
} from 'src/helpers/contacts-e2e'
import { setupProCampaignUser } from 'src/helpers/organizations'
import { disableCrmFlags } from 'src/helpers/crm-contacts-e2e'

// The Win contacts surface (segment selector, search-as-list, per-row delete)
// lives on the pro campaign org. setupProCampaignUser provisions one directly.
const goToWinContacts = async (page: Page): Promise<void> => {
  await setupProCampaignUser(page)

  await page.goto('/dashboard/contacts', { waitUntil: 'domcontentloaded' })
  await NavigationHelper.dismissOverlays(page)
  await expect(page).toHaveURL(/\/dashboard\/contacts/)
  await waitForContactsTableReady(page)
}

// The desktop search box (xl:w-[400px], hidden md:flex) is first in DOM order
// and visible at Playwright's default 1280px viewport; the mobile duplicate
// (flex md:hidden) is in the DOM but hidden. Scope to the first match.
const searchInput = (page: Page): Locator =>
  page.getByPlaceholder('Search contacts').first()

// The list/segment selector — a single Radix combobox in SegmentSection.
const segmentSelect = (page: Page): Locator =>
  page.getByRole('combobox').first()

// Select a checkbox inside the filters sheet by section heading (an <h4>, e.g.
// "Political Party") and option label (e.g. "Independent"). Mirrors the helper
// in win-contacts.spec.ts; kept local because spec files don't import from one
// another.
const selectFilterCheckbox = async (
  sheet: Locator,
  section: string,
  option: string,
) => {
  const heading = sheet.locator('h4', { hasText: section })
  const container = heading.locator('xpath=../..')
  const optionLabel = container.getByText(option, { exact: true })
  await optionLabel.locator('xpath=..').getByRole('checkbox').click()
}

// The saved-list lifecycle lives on the Win contacts surface — Create-list /
// search / named-segment actions are pro-gated. setupProCampaignUser provisions
// Pro without the Stripe webhook, so this runs on PR previews now. See
// e2e-tests/CLAUDE.md ("@dev-only") for what still earns the tag.
test.describe('Saved list lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
    // Legacy flag-off spec: pin the CRM flags OFF so a live ramp can't flip
    // this onto the new CRM surface mid-test (e2e-tests/CLAUDE.md).
    await disableCrmFlags(page)
  })

  // ENG-10519: name a list at creation. The create sheet has an always-visible
  // name input, and Create stays disabled until the list is both named AND has
  // a filter (or search) defining it.
  test('names a list at creation and gates Create on name + a filter', async ({
    page,
  }) => {
    test.setTimeout(3 * 60 * 1000)
    await goToWinContacts(page)

    const createListButton = page.getByRole('button', { name: /create list/i })
    await createListButton.scrollIntoViewIfNeeded()
    await expect(createListButton).toBeVisible({ timeout: 10000 })
    await createListButton.click({ force: true })

    const sheet = filtersSheet(page, /create segment/i)
    await expect(sheet).toBeVisible({ timeout: 30000 })

    // The name input is always visible in create mode (not behind an edit
    // pencil like the edit sheet's heading). It seeds a default "Custom Segment
    // N" name, so Create is enabled-by-name but disabled until a filter exists.
    const nameInput = sheet.locator('#segment-name')
    await expect(nameInput).toBeVisible({ timeout: 10000 })

    const createSegmentButton = sheet.getByRole('button', {
      name: /create segment/i,
    })

    // Named (seeded default) but no filter/search yet -> disabled.
    await expect(createSegmentButton).toBeDisabled()

    // Clearing the name keeps it disabled even once a filter is added below.
    await nameInput.fill('')
    await expect(createSegmentButton).toBeDisabled()

    const listName = `E2E Named List ${Date.now()}`
    await nameInput.fill(listName)
    // Named but still no filter -> still disabled.
    await expect(createSegmentButton).toBeDisabled()

    await expect(
      sheet.locator('h4', { hasText: 'Political Party' }),
    ).toBeVisible({ timeout: 10000 })
    await selectFilterCheckbox(sheet, 'Political Party', 'Independent')

    // Named + a filter -> enabled. Create it.
    await expect(createSegmentButton).toBeEnabled({ timeout: 5000 })
    await applyContactsQuery(page, async () => {
      await createSegmentButton.click({ force: true })
      await expect(sheet).toBeHidden({ timeout: 15000 })
    })

    // The created list is selected and shows its NAME in the selector.
    await expect(segmentSelect(page)).toContainText(listName, {
      timeout: 15000,
    })

    // It's listed under Custom Segments by that name when the selector opens.
    await segmentSelect(page).click({ timeout: 5000 })
    await expect(page.getByText('Custom Segments')).toBeVisible({
      timeout: 5000,
    })
    await expect(page.getByText(listName).first()).toBeVisible({
      timeout: 5000,
    })
    await page.keyboard.press('Escape')
  })

  // ENG-10518: create a list directly from an active search, with no filters,
  // and confirm selecting it reproduces the search.
  test('saves an active search as a list and re-applies it on select', async ({
    page,
  }) => {
    test.setTimeout(3 * 60 * 1000)
    await goToWinContacts(page)

    // Run a search so the create sheet carries it as a search-derived list.
    const searchValue = 'Smith'
    await applyContactsQuery(page, async () => {
      await searchInput(page).fill(searchValue)
      await searchInput(page).press('Enter')
      await expect(page).toHaveURL(/[?&]query=Smith/, { timeout: 15000 })
    })

    const createListButton = page.getByRole('button', { name: /create list/i })
    await createListButton.scrollIntoViewIfNeeded()
    await createListButton.click({ force: true })

    const sheet = filtersSheet(page, /create segment/i)
    await expect(sheet).toBeVisible({ timeout: 30000 })

    // The sheet acknowledges it will save the active search.
    await expect(sheet.getByText(new RegExp(searchValue))).toBeVisible({
      timeout: 10000,
    })

    // Name it and save with NO filters: the saved search alone defines the
    // list, so Create is enabled on name + search.
    const listName = `E2E Search List ${Date.now()}`
    const nameInput = sheet.locator('#segment-name')
    await nameInput.fill(listName)

    const createSegmentButton = sheet.getByRole('button', {
      name: /create segment/i,
    })
    await expect(createSegmentButton).toBeEnabled({ timeout: 5000 })
    await applyContactsQuery(page, async () => {
      await createSegmentButton.click({ force: true })
      await expect(sheet).toBeHidden({ timeout: 15000 })
    })

    await expect(segmentSelect(page)).toContainText(listName, {
      timeout: 15000,
    })

    // Switch away to All Contacts: the search clears (default segments carry no
    // stored search).
    await applyContactsQuery(page, async () => {
      await segmentSelect(page).click({ timeout: 5000 })
      await page.getByRole('option', { name: 'All Contacts' }).click()
    })
    await expect(page).not.toHaveURL(/[?&]query=Smith/, { timeout: 15000 })
    await expect(searchInput(page)).toHaveValue('', { timeout: 10000 })

    // Re-select the saved list: it reproduces the searched-down view by
    // re-applying the stored search to the query param and the search box.
    await applyContactsQuery(page, async () => {
      await segmentSelect(page).click({ timeout: 5000 })
      await page.getByRole('option', { name: listName }).click()
    })
    await expect(page).toHaveURL(/[?&]query=Smith/, { timeout: 15000 })
    await expect(searchInput(page)).toHaveValue(searchValue, { timeout: 10000 })
  })

  // ENG-10520: delete a custom list via the per-row trash + confirm dialog, and
  // confirm it disappears from the selector and the active segment falls back
  // to All Contacts.
  test('deletes a custom list and falls back to All Contacts', async ({
    page,
  }) => {
    test.setTimeout(3 * 60 * 1000)
    await goToWinContacts(page)

    // Create a filter-derived list to delete, and leave it active.
    const createListButton = page.getByRole('button', { name: /create list/i })
    await createListButton.scrollIntoViewIfNeeded()
    await createListButton.click({ force: true })

    const sheet = filtersSheet(page, /create segment/i)
    await expect(sheet).toBeVisible({ timeout: 30000 })

    const listName = `E2E Delete List ${Date.now()}`
    await sheet.locator('#segment-name').fill(listName)
    await expect(
      sheet.locator('h4', { hasText: 'Political Party' }),
    ).toBeVisible({ timeout: 10000 })
    await selectFilterCheckbox(sheet, 'Political Party', 'Independent')

    const createSegmentButton = sheet.getByRole('button', {
      name: /create segment/i,
    })
    await expect(createSegmentButton).toBeEnabled({ timeout: 5000 })
    await applyContactsQuery(page, async () => {
      await createSegmentButton.click({ force: true })
      await expect(sheet).toBeHidden({ timeout: 15000 })
    })

    // The new list is the active segment.
    await expect(segmentSelect(page)).toContainText(listName, {
      timeout: 15000,
    })

    // Open the selector and click the per-row trash for this list. The trash
    // IconButton stops propagation so it doesn't select the row.
    await segmentSelect(page).click({ timeout: 5000 })
    const trash = page.getByRole('button', { name: `Delete ${listName}` })
    await expect(trash).toBeVisible({ timeout: 5000 })
    await trash.click()

    // Confirmation dialog names the list; cancel does not delete.
    await expect(
      page.getByText(/are you sure you want to delete your custom segment/i),
    ).toBeVisible({ timeout: 10000 })
    const confirmDelete = page.getByRole('button', { name: 'Delete Segment' })
    await expect(confirmDelete).toBeVisible({ timeout: 5000 })

    // Confirm: the list is removed and the active segment falls back to All
    // Contacts (the selector shows the default again).
    await applyContactsQuery(page, async () => {
      await confirmDelete.click()
    })

    await expect(segmentSelect(page)).not.toContainText(listName, {
      timeout: 15000,
    })
    await expect(segmentSelect(page)).toContainText('All Contacts', {
      timeout: 15000,
    })

    // It's gone from the selector list too.
    await segmentSelect(page).click({ timeout: 5000 })
    await expect(page.getByText(listName)).toHaveCount(0, { timeout: 5000 })
    await page.keyboard.press('Escape')
  })
})
