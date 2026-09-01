import { expect, test } from '@playwright/test'
import { blockSlowScripts } from 'src/helpers/navigation.helper'
import { setFlagOverrides } from 'src/helpers/campaignStory.helper'
import {
  closePersonPanel,
  crmSheet,
  fetchListMembers,
  fullPersonName,
  gotoCrmContacts,
  openPersonViaTypeahead,
  readSettledWizardCount,
  typeaheadInput,
} from 'src/helpers/crm-contacts-e2e'
import {
  setupElectedOfficeUser,
  setupProCampaignUser,
} from 'src/helpers/organizations'

// ENG-11010: win-crm hit 100% and was removed (ENG-11009) — Win CRM is now
// unconditional. Cases 1-3 pin that contract with ZERO flag overrides. Case 4
// is the Win/Serve asymmetry regression guard: serve-crm is still dark and
// ramping, so it must keep deciding the Serve surface exactly as before.
test.describe('Win CRM renders with no flag overrides', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  test('the CRM page renders for a Win Pro user with zero overrides', async ({
    page,
  }) => {
    test.setTimeout(3 * 60 * 1000)

    await setupProCampaignUser(page)
    await gotoCrmContacts(page)

    // CRM anatomy: the persistent typeahead is the rebuilt page's search
    // affordance, replacing the legacy member table entirely.
    await expect(typeaheadInput(page)).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('table')).toHaveCount(0)
  })

  test('the create-list wizard opens with zero overrides', async ({ page }) => {
    test.setTimeout(3 * 60 * 1000)

    await setupProCampaignUser(page)
    await gotoCrmContacts(page)

    await page.getByRole('button', { name: 'Create new list' }).click()
    const wizard = crmSheet(page)
    await expect(wizard).toBeVisible({ timeout: 15_000 })

    // The branch chooser is step 1 of the Win wizard; picking the
    // demographics branch reaches the filter step whose footer CTA settles
    // on a live "Build your list (N)" count.
    await wizard
      .getByText('Build a list using voter demographics and data')
      .click()
    await wizard.getByRole('button', { name: 'Continue' }).click()

    const count = await readSettledWizardCount(page)
    expect(count).toBeGreaterThan(0)
  })

  test('the person overlay shows Win CRM affordances with zero overrides', async ({
    page,
  }) => {
    test.setTimeout(3 * 60 * 1000)

    const { client } = await setupProCampaignUser(page)
    await gotoCrmContacts(page)

    const people = await fetchListMembers(client, 'all')
    const person = people.find(
      (candidate) => fullPersonName(candidate).length >= 3,
    )
    expect(person).toBeTruthy()

    const panel = await openPersonViaTypeahead(page, person!)

    // StatusRow: Win + CRM-on only (self-gates on useCrmEnabled(), which
    // reads isWin unconditionally now — no flag).
    await expect(
      panel.getByText('Voter Likelihood', { exact: true }),
    ).toBeVisible({ timeout: 10_000 })
    // NotesSection: the same useCrmEnabled() gate, shared with Serve.
    await expect(panel.getByRole('button', { name: 'Add a note' })).toBeVisible(
      { timeout: 10_000 },
    )

    await closePersonPanel(panel)
  })
})

// The one place win-crm's removal could silently break serve-crm: if
// useCrmEnabled's Serve branch ever collapsed to "always true" like Win's
// did, this is the test that would catch it — serve-crm must keep deciding
// the Serve surface on its own, still-ramping cadence.
test.describe('Serve CRM stays flag-controlled', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  test('renders the legacy page (no CRM affordances) when serve-crm is off', async ({
    page,
  }) => {
    test.setTimeout(3 * 60 * 1000)

    // ContactsPageGate reads the SAME useCrmEnabled() gate that decides the
    // person-record affordances, so serve-crm off means the whole page falls
    // back to the pre-CRM ContactsPage — there is no CRM typeahead to open a
    // person through at all (docs/../contacts/AGENTS.md "Whole-page CRM
    // gate"). The legacy page's member table is the observable signal.
    await setFlagOverrides(page, { 'serve-crm': 'off' })
    await setupElectedOfficeUser(page)
    await gotoCrmContacts(page)

    await expect(page.locator('table').first()).toBeVisible({
      timeout: 20_000,
    })
    await expect(typeaheadInput(page)).toHaveCount(0)
  })

  test('shows CRM affordances when serve-crm is on', async ({ page }) => {
    test.setTimeout(3 * 60 * 1000)

    await setFlagOverrides(page, { 'serve-crm': 'on' })
    const { client } = await setupElectedOfficeUser(page)
    await gotoCrmContacts(page)

    const people = await fetchListMembers(client, 'all')
    const person = people.find(
      (candidate) => fullPersonName(candidate).length >= 3,
    )
    expect(person).toBeTruthy()

    const panel = await openPersonViaTypeahead(page, person!)
    await expect(panel.getByRole('button', { name: 'Add a note' })).toBeVisible(
      { timeout: 10_000 },
    )

    await closePersonPanel(panel)
  })
})
