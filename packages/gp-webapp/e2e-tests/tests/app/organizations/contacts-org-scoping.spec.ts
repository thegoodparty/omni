import { expect, test } from '@playwright/test'
import {
  setupElectedOfficeUser,
  switchOrganization,
  getSelectedOrgName,
  getOrgPickerOptions,
} from 'src/helpers/organizations'
import { blockSlowScripts } from 'src/helpers/navigation.helper'
import {
  closePersonPanel,
  crmSheet,
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

// ENG-10756 port: the same org-scoping semantics through the CRM chrome —
// the Serve person record hides the party field, and saved lists are scoped
// to the org that created them (the lists INDEX replaces the legacy segment
// combobox as the org-scoped surface).
test.describe('Contacts Organization Scoping', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  test('hides Political Party field for elected office org', async ({
    page,
  }) => {
    test.setTimeout(4 * 60 * 1000)
    const { client } = await setupElectedOfficeUser(page)
    await gotoCrmContacts(page)

    // The Serve wizard also never offers the party filter (VoterFileStep
    // strips it for isElectedOfficial) — the create-side mirror of the
    // person-record rule below.
    await page.getByRole('button', { name: 'Create new list' }).click()
    const wizard = crmSheet(page)
    await expect(wizard).toBeVisible({ timeout: 15_000 })
    await expect(wizardPillGroup(wizard, 'Gender')).toBeVisible({
      timeout: 10_000,
    })
    await expect(wizardPillGroup(wizard, 'Political Party')).toHaveCount(0)
    await wizard.getByRole('button', { name: 'Close' }).click()
    await expect(wizard).toBeHidden({ timeout: 10_000 })

    // Open a person record through the typeahead (the member table is gone;
    // the name comes from the same GET /v1/contacts the table used to read).
    const people = await fetchListMembers(client, 'all')
    const person = people.find(
      (candidate) => fullPersonName(candidate).length >= 3,
    )
    expect(person).toBeTruthy()

    const panel = await openPersonViaTypeahead(page, person!)
    // The whole voter-file card is Win-only now. It carried a support status
    // Serve can never set (gp-api rejects the write for an `eo-` org) plus
    // registration and turnout propensity, and an official does not ask
    // whether a constituent votes or how reliably — so there was nothing left
    // to put in it. This spec used to assert the Win labels were VISIBLE
    // here, which is how they outlived a vocabulary pass on the one surface
    // named Constituent Data.
    for (const label of [
      'Political Party',
      'Support Status',
      'Registered Voter',
      'Registered to vote',
      'Voter Status',
      'Turnout likelihood',
      'Voter Demographics',
      'Constituent Demographics',
    ]) {
      await expect(panel.getByText(label)).not.toBeVisible()
    }
    // The personal-profile card below it is untouched on both surfaces, so a
    // panel that rendered nothing at all would still fail here.
    await expect(panel.getByText('Demographic Information')).toBeVisible()
    await closePersonPanel(panel)
  })

  test('custom lists are scoped per organization', async ({ page }) => {
    test.setTimeout(4 * 60 * 1000)
    await setupElectedOfficeUser(page)
    await gotoCrmContacts(page)
    await expect(
      page.getByRole('heading', { name: 'Constituent Lists' }),
    ).toBeVisible({ timeout: 20_000 })

    // Create a list in the EO org via the wizard.
    await page.getByRole('button', { name: 'Create new list' }).click()
    const wizard = crmSheet(page)
    await expect(wizard).toBeVisible({ timeout: 15_000 })
    await selectWizardPill(wizard, 'Gender', 'Male')
    const count = await readSettledWizardCount(page)
    expect(count).toBeGreaterThan(0)
    await wizardBuildButton(page).click()
    const listName = `E2E org scoped ${Date.now()}`
    await saveWizardList(page, listName)
    const detailSheet = crmSheet(page)
    await detailSheet.getByRole('button', { name: 'Close' }).click()
    await expect(detailSheet).toBeHidden({ timeout: 10_000 })

    await expect(listCard(page, listName)).toBeVisible({ timeout: 20_000 })

    // Switch to the campaign org: the list must not follow (lists are
    // org-scoped server-side — GET /v1/voters/voter-file/filters is keyed to
    // the active org).
    const eoOrgName = await getSelectedOrgName(page)
    const allOrgs = await getOrgPickerOptions(page)
    const campaignOrgName = allOrgs.find((name) => name !== eoOrgName)!
    expect(campaignOrgName).toBeTruthy()

    await switchOrganization(page, campaignOrgName)
    await gotoCrmContacts(page)

    // The Win lists index renders (its universe row proves the segments
    // fetch resolved) without the EO org's list.
    await expect(
      page.getByRole('heading', { name: 'Voter Lists', exact: true }),
    ).toBeVisible({ timeout: 20_000 })
    await expect(listCard(page, 'All voters')).toBeVisible({
      timeout: 20_000,
    })
    await expect(
      page.getByText("You haven't created any lists yet."),
    ).toBeVisible({ timeout: 20_000 })
    await expect(listCard(page, listName)).toHaveCount(0)
  })
})
