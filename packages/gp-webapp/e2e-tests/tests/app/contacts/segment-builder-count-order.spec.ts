import { expect, type Locator, test } from '@playwright/test'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import {
  filtersSheet,
  waitForContactsTableReady,
} from 'src/helpers/contacts-e2e'
import {
  setupElectedOfficeUser,
  switchOrganization,
  getSelectedOrgName,
  getOrgPickerOptions,
} from 'src/helpers/organizations'

// Select a checkbox inside a filters/segment sheet by its section heading (an
// <h4>, e.g. "Gender") and the option label (e.g. "Male"). Mirrors the helper
// in contacts-filters.spec.ts; kept local because spec files don't import from
// one another.
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

// The live "N voters match" affordance (ENG-10517) renders the number in the
// sheet footer's aria-live region; extract the integer so we can compare the
// filtered count against the unfiltered total. Returns null while the count is
// still settling ("Counting voters…" / no number yet) so callers can poll.
const readVotersMatchCount = async (sheet: Locator): Promise<number | null> => {
  const text = await sheet.getByText(/voters match/i).textContent()
  const digits = text?.match(/([\d,]+)\s+voters match/i)?.[1]
  if (!digits) return null
  return Number(digits.replace(/,/g, ''))
}

// The canonical Voter Likely option order (least → most likely), read from
// filters.config.ts ("Voter Likely" field): Unknown, First Time, Unlikely,
// Likely, Super. This is the ENG-10516 ordering the builder must render.
const VOTER_LIKELY_ORDER = [
  'Unknown',
  'First Time',
  'Unlikely',
  'Likely',
  'Super',
]

// @dev-only: this spec exercises the Win Contacts segment builder for a pro
// campaign org, reachable only when win-voter-data is on for the user AND the
// campaign is pro — and the live count endpoint (POST /v1/contacts/count) is
// itself pro-gated. The warm dev stack enables win-voter-data for internal/
// @test.goodparty.org users and provisions pro; an ephemeral per-PR preview
// can't guarantee that flag state or the pro provisioning, so this runs on the
// post-merge develop e2e (and on demand), not on PRs. Same pattern as
// win-contacts. See e2e-tests/CLAUDE.md ("@dev-only").
test.describe('Segment builder count + order @dev-only', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  test('live voter count updates with a filter and Voter Likely renders in order', async ({
    page,
  }) => {
    test.setTimeout(3 * 60 * 1000)

    // setupElectedOfficeUser leaves the elected-office org selected; the Win
    // context (with the segment builder + party/audience filters and the pro-
    // gated count) is the campaign org, so switch to it. The EO org resolves as
    // Serve and would change the available filter surface.
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

    // Open the create-segment sheet (the segment builder).
    const createListButton = page.getByRole('button', { name: /create list/i })
    await createListButton.scrollIntoViewIfNeeded()
    await expect(createListButton).toBeVisible({ timeout: 10000 })
    await createListButton.click({ force: true })

    const sheet = filtersSheet(page, /create segment/i)
    await expect(sheet).toBeVisible({ timeout: 30000 })

    // --- Voter Likely option order (ENG-10516) ---
    // The Voter Likely section renders one option label per row; assert they
    // appear in the exact least-→-most-likely order from filters.config.ts.
    const voterLikelyHeading = sheet.locator('h4', { hasText: 'Voter Likely' })
    await expect(voterLikelyHeading).toBeVisible({ timeout: 10000 })
    const voterLikelyContainer = voterLikelyHeading.locator('xpath=../..')
    // Each option label is a Body2, which renders a `<div>` (not a `<p>`)
    // carrying the passed-in `font-medium` class (Body2.tsx). Within this field
    // container the only other text node is the "Select All" control, which
    // uses `font-semibold` (not `font-medium`) — so `div.font-medium` selects
    // exactly the five option-label rows. Reading them in DOM order and
    // matching the canonical list asserts the EXACT order.
    const renderedLabels = (
      await voterLikelyContainer
        .locator('div.font-medium')
        .filter({ hasText: /\S/ })
        .allTextContents()
    ).map((t) => t.trim())
    expect(renderedLabels).toEqual(VOTER_LIKELY_ORDER)

    // --- Live count: capture the unfiltered total, then filter and assert the
    // count drops below it (ENG-10517) ---
    // The count only renders once a filter is set, so capture the total first
    // from the "Total Voters" stat card (testid contact-stats-totalConstituents
    // in ContactsStatsSection), which derives from the real district
    // totalResults. The card behind the sheet is still in the DOM.
    const totalText = await page
      .getByTestId('contact-stats-totalConstituents')
      .textContent()
    const totalDigits = totalText?.match(/([\d,]+)/)?.[1]
    expect(totalDigits).toBeTruthy()
    const totalCount = Number(totalDigits!.replace(/,/g, ''))
    expect(totalCount).toBeGreaterThan(0)

    // Toggle Gender=Male. The count query is debounced (~600ms), so poll the
    // aria-live footer until it settles on a number rather than asserting
    // immediately.
    await selectFilterCheckbox(sheet, 'Gender', 'Male')

    await expect
      .poll(async () => readVotersMatchCount(sheet), {
        timeout: 30000,
        message: 'live voter count never settled on a number',
      })
      .not.toBeNull()

    const filteredCount = await readVotersMatchCount(sheet)
    expect(filteredCount).not.toBeNull()
    // A single-gender filter must match strictly fewer voters than the whole
    // district. Asserting the VALUE changed (< total), not just that text
    // appeared, is the ENG-10517 acceptance criterion.
    expect(filteredCount!).toBeGreaterThan(0)
    expect(filteredCount!).toBeLessThan(totalCount)

    // The builder count is a display affordance only; close the sheet without
    // saving so the test leaves no segment behind.
    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden({ timeout: 15000 })
  })
})
