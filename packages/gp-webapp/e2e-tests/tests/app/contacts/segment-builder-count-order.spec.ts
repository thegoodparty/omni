import { expect, type Locator, test } from '@playwright/test'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import {
  filtersSheet,
  waitForContactsTableReady,
} from 'src/helpers/contacts-e2e'
import { setupProCampaignUser } from 'src/helpers/organizations'
import { disableCrmFlags } from 'src/helpers/crm-contacts-e2e'

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
  // While the count is debouncing/loading the footer shows "Counting voters…",
  // so no element matches /voters match/i. Use timeout:0 so the locator throws
  // immediately instead of blocking on Playwright's 30s default — otherwise the
  // first expect.poll attempt would consume the whole poll budget before any
  // retry. The catch returns null, which the polling caller treats as "not
  // settled yet" and re-polls.
  const text = await sheet
    .getByText(/voters match/i)
    .textContent({ timeout: 0 })
    .catch(() => null)
  const digits = text?.match(/([\d,]+)\s+voters match/i)?.[1]
  if (!digits) return null
  return Number(digits.replace(/,/g, ''))
}

// The canonical Voter Likelihood option order (least → most likely), read from
// filters.config.ts ("Voter Likelihood" field): Unknown, First Time, Unlikely,
// Likely, Super. This is the ENG-10516 ordering the builder must render.
const VOTER_LIKELY_ORDER = [
  'Unknown',
  'First Time',
  'Unlikely',
  'Likely',
  'Super',
]

// Exercises the Win Contacts segment builder for a pro campaign org — the live
// count endpoint (POST /v1/contacts/count) is pro-gated. setupProCampaignUser
// provisions Pro without the Stripe webhook, so this runs on PR previews now.
// See e2e-tests/CLAUDE.md ("@dev-only") for what still earns the tag.
test.describe('Segment builder count + order', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
    // Legacy flag-off spec: pin the CRM flags OFF so a live ramp can't flip
    // this onto the new CRM surface mid-test (e2e-tests/CLAUDE.md).
    await disableCrmFlags(page)
  })

  test('live voter count updates with a filter and Voter Likelihood renders in order', async ({
    page,
  }) => {
    test.setTimeout(3 * 60 * 1000)

    await setupProCampaignUser(page)

    await page.goto('/dashboard/contacts', { waitUntil: 'domcontentloaded' })
    await NavigationHelper.dismissOverlays(page)
    await expect(page).toHaveURL(/\/dashboard\/contacts/)

    const table = page.locator('table').first()
    await expect(table).toBeVisible({ timeout: 20000 })
    await waitForContactsTableReady(page)

    // Capture the unfiltered district total from the "Total Voters" stat card
    // (testid contact-stats-totalConstituents in ContactsStatsSection) BEFORE
    // opening the sheet, while the card is unambiguously visible and its query
    // has settled — its React Query renders an animate-pulse skeleton until
    // success, so reading too early returns ''. Guard with toBeVisible +
    // not.toHaveText('--'), mirroring door-knocking-household-dedupe.spec.ts.
    const totalCard = page.getByTestId('contact-stats-totalConstituents')
    await expect(totalCard).toBeVisible({ timeout: 20000 })
    await expect(totalCard).not.toHaveText('--', { timeout: 20000 })
    const totalText = await totalCard.textContent()
    const totalDigits = totalText?.match(/([\d,]+)/)?.[1]
    expect(totalDigits).toBeTruthy()
    const totalCount = Number(totalDigits!.replace(/,/g, ''))
    expect(totalCount).toBeGreaterThan(0)

    // Open the create-segment sheet (the segment builder).
    const createListButton = page.getByRole('button', { name: /create list/i })
    await createListButton.scrollIntoViewIfNeeded()
    await expect(createListButton).toBeVisible({ timeout: 10000 })
    await createListButton.click({ force: true })

    const sheet = filtersSheet(page, /create segment/i)
    await expect(sheet).toBeVisible({ timeout: 30000 })

    // --- Voter Likelihood option order (ENG-10516) ---
    // The Voter Likelihood section renders one option label per row; assert they
    // appear in the exact least-→-most-likely order from filters.config.ts.
    const voterLikelyHeading = sheet.locator('h4', {
      hasText: 'Voter Likelihood',
    })
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

    // --- Live count: filter and assert the count drops below the total
    // captured above (ENG-10517) ---
    // Toggle Gender=Male. The count query is debounced (~600ms), so poll the
    // aria-live footer until it settles on a number rather than asserting
    // immediately.
    await selectFilterCheckbox(sheet, 'Gender', 'Male')

    // Poll the settled count directly against the acceptance criterion: a
    // single-gender filter must match strictly fewer (but more than zero)
    // voters than the whole district. Asserting the VALUE relative to the total
    // (not just that "voters match" text appeared) is the ENG-10517 criterion.
    // Each attempt is instant (readVotersMatchCount returns null while loading),
    // so the 30s budget governs how long the debounced count has to settle.
    await expect
      .poll(async () => readVotersMatchCount(sheet), {
        timeout: 30000,
        message: 'live voter count never settled below the district total',
      })
      .toBeGreaterThan(0)

    const filteredCount = await readVotersMatchCount(sheet)
    expect(filteredCount).not.toBeNull()
    expect(filteredCount!).toBeLessThan(totalCount)

    // The builder count is a display affordance only; close the sheet without
    // saving so the test leaves no segment behind.
    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden({ timeout: 15000 })
  })
})
