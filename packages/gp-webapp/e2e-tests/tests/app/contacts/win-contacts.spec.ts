import { expect, type Locator, test } from '@playwright/test'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import { filtersSheet, personContactPanel } from 'src/helpers/contacts-e2e'
import {
  setupElectedOfficeUser,
  switchOrganization,
  getSelectedOrgName,
  getOrgPickerOptions,
} from 'src/helpers/organizations'

// Select a checkbox inside a filters/segment sheet by its section heading (an
// <h4>, e.g. "Political Party") and the option label (e.g. "Independent").
// Mirrors the helper in contacts-filters.spec.ts; kept local because spec files
// don't import from one another.
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

// @dev-only: this spec exercises the Win Contacts surface for a pro campaign
// org — real people rows are pro-gated, and the flow needs the warm dev
// stack's real district voter data. An ephemeral per-PR preview can't
// guarantee the pro provisioning or the data, so this runs on the post-merge
// develop e2e (and on demand), not on PRs. Same pattern as polls-onboarding.
// See e2e-tests/CLAUDE.md ("@dev-only").
test.describe('Win Contacts @dev-only', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  test('list, party filter, segment, download, and outreach timeline', async ({
    page,
  }) => {
    test.setTimeout(3 * 60 * 1000)

    // setupElectedOfficeUser creates a pro campaign org and a derived elected-
    // office org for the same race, then leaves the EO org selected. The Win
    // context is the campaign (non-eo) org, so switch to it: the EO org would
    // resolve as Serve (isElectedOfficial), which hides the party filter and
    // uses the poll-interaction timeline instead of the Win outreach timeline.
    await setupElectedOfficeUser(page)

    const eoOrgName = await getSelectedOrgName(page)
    const allOrgs = await getOrgPickerOptions(page)
    const campaignOrgName = allOrgs.find((name) => name !== eoOrgName)
    expect(campaignOrgName).toBeTruthy()
    await switchOrganization(page, campaignOrgName!)

    await page.goto('/dashboard/contacts', { waitUntil: 'domcontentloaded' })
    await NavigationHelper.dismissOverlays(page)
    await expect(page).toHaveURL(/\/dashboard\/contacts/)

    // --- List: the contacts table loads with at least one row ---
    const table = page.locator('table').first()
    await expect(table).toBeVisible({ timeout: 20000 })
    const firstRow = table.locator('tbody tr').first()
    await expect(firstRow).toBeVisible({ timeout: 25000 })
    await expect(firstRow.locator('td').first()).toHaveText(/.+/, {
      timeout: 25000,
    })

    // --- Filter incl. party: open the create-segment sheet and confirm the
    // Political Party section (Win-only; hidden for elected office) is present,
    // then build a segment that filters on a party option. ---
    const createListButton = page.getByRole('button', { name: /create list/i })
    await createListButton.scrollIntoViewIfNeeded()
    await expect(createListButton).toBeVisible({ timeout: 10000 })
    await createListButton.click({ force: true })

    const sheet = filtersSheet(page, /create segment/i)
    await expect(sheet).toBeVisible({ timeout: 30000 })

    // The party section is the Win-specific filter surface (ENG-10423).
    await expect(
      sheet.locator('h4', { hasText: 'Political Party' }),
    ).toBeVisible({ timeout: 10000 })

    await selectFilterCheckbox(sheet, 'Political Party', 'Independent')

    // --- Save/use a segment: create it and confirm it becomes the active,
    // reusable Custom Segment. ---
    const createSegmentButton = sheet.getByRole('button', {
      name: /create segment/i,
    })
    await expect(createSegmentButton).toBeEnabled({ timeout: 5000 })
    await createSegmentButton.click({ force: true })
    await expect(sheet).toBeHidden({ timeout: 15000 })

    await expect(
      table.locator('tbody tr').first().locator('td').filter({ hasText: /.+/ }),
    ).not.toHaveCount(0, { timeout: 35000 })

    const segmentSelectTrigger = page.getByRole('combobox').first()
    await segmentSelectTrigger.click({ timeout: 5000 })
    await expect(page.getByText('Custom Segments')).toBeVisible({
      timeout: 5000,
    })
    await expect(page.getByText(/Custom Segment 1/i).first()).toBeVisible({
      timeout: 5000,
    })
    await page.keyboard.press('Escape')

    // --- Download a channel file: clicking download triggers a top-level
    // navigation to the gp-api CSV endpoint. Assert the request succeeds
    // (pro-gated on the server) rather than the streamed file event, which is
    // not deterministically observable for a streamed response. ---
    const downloadResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/v1/contacts/download') &&
        response.request().method() === 'GET',
      { timeout: 30000 },
    )
    // The download control is the icon-only IconButton in the toolbar. Select
    // by its testid rather than a class selector: once a custom segment is
    // active, SegmentSection's edit-list IconButton also carries
    // data-slot="icon-button" + "hidden md:flex" and renders first, so a
    // class-based locator would match it instead of Download.
    const downloadIconButton = page.getByTestId('contacts-download-button')
    await downloadIconButton.scrollIntoViewIfNeeded()
    await expect(downloadIconButton).toBeVisible({ timeout: 10000 })
    await downloadIconButton.click({ force: true })
    const downloadResponse = await downloadResponsePromise
    expect(downloadResponse.ok()).toBeTruthy()

    // --- Open a person and see the Win outreach timeline ---
    // Reset to the full list so any person opens (the party segment can be
    // small in a given district's live L2 data).
    await page.goto('/dashboard/contacts', { waitUntil: 'domcontentloaded' })
    await NavigationHelper.dismissOverlays(page)
    await expect(table).toBeVisible({ timeout: 20000 })
    const personRow = table.locator('tbody tr').first()
    await expect(personRow).toBeVisible({ timeout: 25000 })
    await expect(personRow.locator('td').first()).toHaveText(/.+/, {
      timeout: 25000,
    })

    const personSheet = personContactPanel(page)
    for (let attempt = 0; attempt < 3; attempt++) {
      await personRow.locator('td').first().click({ force: true })
      try {
        await expect(personSheet).toBeVisible({ timeout: 12000 })
        break
      } catch {
        if (attempt === 2) await expect(personSheet).toBeVisible()
      }
    }

    await expect(
      personSheet.getByText('Contact Information', { exact: true }),
    ).toBeVisible({ timeout: 30000 })

    // Win context shows the Political Party field on the person overlay
    // (hidden for elected office) — ENG-10423.
    await expect(
      personSheet.getByText('Political Party', { exact: true }),
    ).toBeVisible({ timeout: 10000 })

    // Win context renders the outreach Activity Feed section, keyed on the
    // person's lalVoterId (ENG-10432). The section header proves the Win
    // timeline is wired for this org. We assert the section renders, not a
    // specific attributed activity row: VoterOutreachActivity rows come from
    // outreach sync (eCanvasser door-knocks, etc.) and are not seedable from
    // e2e, so a fresh test campaign has zero rows and the feed shows its
    // "Data not available." empty state. Asserting a concrete attributed row
    // would be non-deterministic; see contacts-staged-rollout.md ("e2e
    // coverage scope").
    await expect(
      personSheet.getByText('Activity Feed', { exact: true }),
    ).toBeVisible({ timeout: 15000 })
  })
})
