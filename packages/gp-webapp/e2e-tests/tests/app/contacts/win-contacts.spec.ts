import { expect, test } from '@playwright/test'
import { blockSlowScripts } from 'src/helpers/navigation.helper'
import {
  closePersonPanel,
  crmSheet,
  enableCrmFlags,
  fetchListMembers,
  fullPersonName,
  gotoCrmContacts,
  listCard,
  openPersonViaTypeahead,
  readSettledWizardCount,
  saveWizardList,
  selectWizardPill,
  wizardBuildButton,
  wizardPillGroup,
} from 'src/helpers/crm-contacts-e2e'
import {
  setupElectedOfficeUser,
  switchOrganization,
  getSelectedOrgName,
  getOrgPickerOptions,
} from 'src/helpers/organizations'

// @dev-only: this spec exercises the Win Contacts surface for a pro campaign
// org — real people rows are pro-gated, and the flow needs the warm dev
// stack's real district voter data. An ephemeral per-PR preview can't
// guarantee the pro provisioning or the data, so this runs on the post-merge
// develop e2e (and on demand), not on PRs. See e2e-tests/CLAUDE.md.
//
// ENG-10756 port: the Win-mode CRM page — branch step (Win-only), the
// Political Party filter group (Win-only, ENG-10423), the send-outreach
// affordances (Win-only, ENG-10749), the list-detail download, and the Win
// person record (party field + outreach Activity Feed, ENG-10432).
test.describe('Win Contacts @dev-only', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
    await enableCrmFlags(page)
  })

  test('universe, branch step, party list, download, and person record', async ({
    page,
  }) => {
    test.setTimeout(5 * 60 * 1000)

    // setupElectedOfficeUser creates a pro campaign org and a derived
    // elected-office org for the same race, then leaves the EO org selected.
    // The Win context is the campaign (non-eo) org, so switch to it: the EO
    // org would resolve as Serve, which drops the branch step and the party
    // filter.
    const { client } = await setupElectedOfficeUser(page)

    const eoOrgName = await getSelectedOrgName(page)
    const allOrgs = await getOrgPickerOptions(page)
    const campaignOrgName = allOrgs.find((name) => name !== eoOrgName)
    expect(campaignOrgName).toBeTruthy()
    await switchOrganization(page, campaignOrgName!)

    // Repoint the API client at the campaign org for the member lookup below.
    const { data: orgsResponse } = await client.get<{
      organizations: { slug: string }[]
    }>('/v1/organizations')
    const campaignSlug = orgsResponse.organizations.find(
      (org) => !org.slug.startsWith('eo-'),
    )?.slug
    expect(campaignSlug).toBeTruthy()
    client.defaults.headers['x-organization-slug'] = campaignSlug!

    await gotoCrmContacts(page)

    // --- Win chrome: mode header + universe copy (never "constituent") ---
    await expect(page.getByRole('heading', { name: 'Voter Data' })).toBeVisible(
      { timeout: 20_000 },
    )
    await expect(
      page.getByRole('heading', { name: 'Your Voter Universe' }),
    ).toBeVisible({ timeout: 20_000 })
    await expect(
      page.getByRole('heading', { name: 'Voter Lists' }),
    ).toBeVisible()
    await expect(listCard(page, 'All voters')).toBeVisible({
      timeout: 20_000,
    })

    // --- Win keeps the send-outreach affordance (ENG-10749) ---
    await expect(
      listCard(page, 'All voters').getByRole('link', {
        name: 'Send outreach',
      }),
    ).toBeVisible({ timeout: 20_000 })

    // --- Wizard: Win opens on the branch chooser (3-step flow) ---
    await page.getByRole('button', { name: 'Create new list' }).click()
    const wizard = crmSheet(page)
    await expect(wizard).toBeVisible({ timeout: 15_000 })
    await expect(
      wizard.getByText('How do you want to build this list?'),
    ).toBeVisible({ timeout: 10_000 })
    await expect(wizard.getByText('Step 1 of 3')).toBeVisible()
    await expect(
      wizard.getByText('Build my list using outreach activity.'),
    ).toBeVisible()
    await expect(
      wizard.getByText('Build my list using the voter file.'),
    ).toBeVisible()

    // Continue is disabled until a branch is chosen.
    const continueButton = wizard.getByRole('button', { name: 'Continue' })
    await expect(continueButton).toBeDisabled()
    await wizard.getByText('Build my list using the voter file.').click()
    await expect(continueButton).toBeEnabled()
    await continueButton.click()

    // --- Voter-file step: Win renders the Political Party group
    // (Win-only; hidden for elected office — ENG-10423) ---
    await expect(
      wizard.getByText('Build a voter list', { exact: true }),
    ).toBeVisible({ timeout: 10_000 })
    await expect(wizardPillGroup(wizard, 'Political Party')).toBeVisible({
      timeout: 10_000,
    })

    const unfiltered = await readSettledWizardCount(page)
    expect(unfiltered).toBeGreaterThan(0)

    await selectWizardPill(wizard, 'Political Party', 'Independent')
    const partyCount = await readSettledWizardCount(page, {
      differentFrom: unfiltered,
    })
    expect(partyCount).toBeGreaterThan(0)
    expect(partyCount).toBeLessThan(unfiltered)

    // --- Save the party list: it lands on its detail sheet and joins the
    // index (the CRM equivalent of "becomes the active Custom Segment") ---
    await wizardBuildButton(page).click()
    const listName = `E2E party ${Date.now()}`
    await saveWizardList(page, listName)
    const detailSheet = crmSheet(page)
    await expect(detailSheet.getByText(listName, { exact: true })).toBeVisible({
      timeout: 20_000,
    })
    await expect(
      detailSheet.getByRole('heading', { name: 'Voter list details' }),
    ).toBeVisible({ timeout: 20_000 })

    // Win detail sheet keeps Send outreach in the footer (ENG-10749).
    await expect(
      detailSheet.getByRole('link', { name: 'Send outreach' }),
    ).toBeVisible({ timeout: 20_000 })

    // --- Download from the detail-sheet footer: the request must succeed
    // (pro-gated on the server). Assert the response rather than the
    // streamed file event, which is not deterministically observable. ---
    const downloadResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/v1/contacts/download') &&
        response.request().method() === 'GET',
      { timeout: 30000 },
    )
    await detailSheet.getByRole('button', { name: 'Download list' }).click()
    const downloadResponse = await downloadResponsePromise
    expect(downloadResponse.ok()).toBeTruthy()

    await detailSheet.getByRole('button', { name: 'Close' }).click()
    await expect(detailSheet).toBeHidden({ timeout: 10_000 })
    await expect(listCard(page, listName)).toBeVisible({ timeout: 20_000 })

    // --- Open a person and see the Win record: party field + outreach
    // Activity Feed. Sourced from the full universe (the party segment can
    // be small in a district's live L2 data), through the typeahead. ---
    const people = await fetchListMembers(client, 'all')
    const person = people.find(
      (candidate) => fullPersonName(candidate).length >= 3,
    )
    expect(person).toBeTruthy()

    const panel = await openPersonViaTypeahead(page, person!)
    await expect(
      panel.getByText('Contact Information', { exact: true }),
    ).toBeVisible({ timeout: 30_000 })

    // Win context shows the Political Party field on the person record
    // (hidden for elected office) — ENG-10423.
    await expect(
      panel.getByText('Political Party', { exact: true }),
    ).toBeVisible({ timeout: 10_000 })

    // Win context renders the outreach Activity Feed section (ENG-10432).
    // The section header proves the Win timeline is wired for this org; a
    // fresh campaign has zero outreach rows, so the feed's empty state is
    // expected — asserting a concrete attributed row would be
    // non-deterministic (rows come from outreach sync, not seedable in e2e).
    await expect(panel.getByText('Activity Feed', { exact: true })).toBeVisible(
      { timeout: 15_000 },
    )

    await closePersonPanel(panel)
  })
})
