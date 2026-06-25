import { expect, test } from '@playwright/test'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import {
  applyContactsQuery,
  waitForContactsTableReady,
} from 'src/helpers/contacts-e2e'
import {
  setupElectedOfficeUser,
  switchOrganization,
  getSelectedOrgName,
  getOrgPickerOptions,
} from 'src/helpers/organizations'

// @dev-only: the Voter Data search box is reachable only on the Win Contacts
// surface for a pro campaign org, which requires win-voter-data ON (enabled for
// internal/@test.goodparty.org users on the warm dev stack, not on ephemeral
// per-PR previews) AND a pro campaign (gp-api findContacts hard-rejects search
// requests for non-pro). Same gating as win-contacts.spec.ts. The CI workflow
// greps @dev-only out on pull_request runs and includes it post-merge on
// develop. See e2e-tests/CLAUDE.md ("@dev-only") and contacts-staged-rollout.md.
test.describe('Voter Data contact search @dev-only', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  test('full-name, case-insensitive, and partial search return the matching row without stale state', async ({
    page,
  }) => {
    test.setTimeout(3 * 60 * 1000)

    // setupElectedOfficeUser leaves the EO org selected; the Win context is the
    // campaign (non-eo) org, so switch to it. Mirrors win-contacts.spec.ts.
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
    await waitForContactsTableReady(page)

    // Read a real name from the first row's Name cell (the first column) so the
    // search query is deterministic against the seeded race's live L2 data (a
    // hardcoded name may not exist in this district).
    const firstRow = table.locator('tbody tr').first()
    const nameCell = firstRow.locator('td').first()
    await expect(nameCell).toHaveText(/.+/, { timeout: 25000 })
    const fullName = ((await nameCell.textContent()) ?? '').trim()
    expect(fullName.length).toBeGreaterThan(0)

    const searchBox = page.getByPlaceholder('Search contacts')
    await expect(searchBox).toBeVisible({ timeout: 10000 })

    // Drive the search box for real and gate every assertion on the new
    // GET /v1/contacts landing + the skeleton clearing, so the rows asserted are
    // the freshly-queried ones (not the previous list's stale rows). Press Enter
    // to skip the 1s debounce in ContactSearch.

    // Full name, lowercased: case-insensitivity is the ENG-10513 fix under test.
    const lowerFullName = fullName.toLowerCase()
    await applyContactsQuery(page, async () => {
      await searchBox.fill(lowerFullName)
      await searchBox.press('Enter')
    })
    await expect(
      table.locator('tbody tr', { hasText: fullName }).first(),
    ).toBeVisible({ timeout: 25000 })

    // Partial / prefix query (lowercase): the full name minus its last
    // character still returns the matching row (case-insensitive prefix + LIKE
    // behavior). Dropping just the last char keeps both name tokens intact, so
    // the query stays as selective as the full-name search and the target row is
    // reliably on page 1 (resultsPerPage defaults to 50). A short first-name
    // prefix like "joh" would match thousands of voters in the API's own sort
    // order, pushing the target off page 1 (false negative) or surfacing it by
    // luck (tautology); see PR #384 review.
    const prefix = lowerFullName.slice(0, -1)
    await applyContactsQuery(page, async () => {
      await searchBox.fill(prefix)
      await searchBox.press('Enter')
    })
    await expect(
      table.locator('tbody tr', { hasText: fullName }).first(),
    ).toBeVisible({ timeout: 25000 })
  })
})
