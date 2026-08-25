import { expect, test } from '@playwright/test'
import { blockSlowScripts } from 'src/helpers/navigation.helper'
import {
  closeCrmSheet,
  crmSheet,
  enableCrmFlags,
  gotoCrmContacts,
  listCard,
  openListCardMenu,
  readSettledWizardCount,
  saveWizardList,
  selectWizardPill,
  statTileValue,
  wizardBuildButton,
} from 'src/helpers/crm-contacts-e2e'
import { setupElectedOfficeUser } from 'src/helpers/organizations'

// The flag-on CRM contacts page in Serve mode (ENG-10756 port of the legacy
// contacts.spec). The legacy member table / pagination / segment combobox are
// gone by design — the universe stat card, lists index, bottom-sheet wizard,
// and card kebab lifecycle are the rebuilt equivalents. The legacy flag-off
// flow stays covered by contacts-legacy-smoke.spec.ts.
test.describe('CRM Contacts Page (Serve)', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
    await enableCrmFlags(page)
  })

  test('universe, wizard, and list lifecycle', async ({ page }) => {
    test.setTimeout(5 * 60 * 1000)
    await setupElectedOfficeUser(page)

    await gotoCrmContacts(page)

    // --- Chrome: mode header + universe column (ENG-10747/10746) ---
    await expect(
      page.getByRole('heading', { name: 'Constituent Data' }),
    ).toBeVisible({ timeout: 20_000 })
    await expect(
      page.getByRole('heading', { name: 'Your Constituent Universe' }),
    ).toBeVisible({ timeout: 20_000 })
    const statRow = page
      .getByText('Total constituents in your district')
      .locator('xpath=..')
    await expect(statRow).toBeVisible({ timeout: 20_000 })
    // The card renders a skeleton until GET /v1/contacts/stats resolves; a
    // real district count is a formatted integer, never 'Unavailable'.
    await expect(statRow.getByText(/^[\d,]+$/)).toBeVisible({
      timeout: 30_000,
    })

    // --- Lists index: universe pseudo-row first (ENG-10725) ---
    await expect(
      page.getByRole('heading', { name: 'Constituent Lists' }),
    ).toBeVisible()
    await expect(listCard(page, 'All constituents')).toBeVisible({
      timeout: 20_000,
    })

    // --- Serve gating (ENG-10749): no send-outreach affordance anywhere ---
    await expect(page.getByRole('link', { name: 'Send outreach' })).toHaveCount(
      0,
    )

    // --- Wizard: Serve opens directly on the constituent filters as a
    // 2-step flow — no branch chooser, no activity branch (ENG-10750) ---
    await page.getByRole('button', { name: 'Create new list' }).click()
    const wizard = crmSheet(page)
    await expect(wizard).toBeVisible({ timeout: 15_000 })
    await expect(
      wizard.getByText('Build a constituent list', { exact: true }),
    ).toBeVisible({ timeout: 10_000 })
    await expect(wizard.getByText('Step 1 of 2')).toBeVisible()
    await expect(
      wizard.getByText('How do you want to build this list?'),
    ).toHaveCount(0)
    await expect(wizard.getByText(/previous campaign activity/i)).toHaveCount(0)

    // --- Zero-filter guard (ENG-10751): the build CTA is natively disabled
    // with nothing selected, while the count still shows the full universe ---
    await expect(wizardBuildButton(page)).toBeDisabled()
    const unfilteredCount = await readSettledWizardCount(page)
    expect(unfilteredCount).toBeGreaterThan(0)
    await expect(wizardBuildButton(page)).toBeDisabled()

    // --- Pill selection updates the running total (ENG-10752 age ranges) ---
    await selectWizardPill(wizard, 'Age', '25-34')
    const filteredCount = await readSettledWizardCount(page, {
      differentFrom: unfilteredCount,
    })
    expect(filteredCount).toBeGreaterThan(0)
    expect(filteredCount).toBeLessThan(unfilteredCount)
    await expect(wizardBuildButton(page)).toBeEnabled()

    // --- Name step: 40-char counter (crm/wizard/NameStep.tsx) ---
    await wizardBuildButton(page).click()
    await expect(wizard.getByText('Name your list')).toBeVisible({
      timeout: 10_000,
    })
    await expect(wizard.getByText('Step 2 of 2')).toBeVisible()
    await expect(
      wizard.getByText(/constituents match\. Give this list a name/),
    ).toBeVisible({ timeout: 30_000 })
    const nameInput = page.getByLabel('List name')
    await nameInput.fill('x'.repeat(45))
    // The controlled input slices to MAX_SEGMENT_NAME_LENGTH (40).
    await expect(nameInput).toHaveValue('x'.repeat(40))
    await expect(wizard.getByText('40/40')).toBeVisible()

    // --- Save: the list lands on its detail sheet and joins the index ---
    const listName = `E2E Serve list ${Date.now()}`
    await saveWizardList(page, listName)
    const detailSheet = crmSheet(page)
    await expect(detailSheet.getByText(listName, { exact: true })).toBeVisible({
      timeout: 20_000,
    })
    await expect(
      detailSheet.getByRole('heading', { name: 'Constituent list details' }),
    ).toBeVisible({ timeout: 20_000 })
    // The demographics People tile reflects the same count the wizard showed.
    await expect(statTileValue(detailSheet, 'People')).toHaveText(
      filteredCount.toLocaleString('en-US'),
      { timeout: 30_000 },
    )
    await expect(
      detailSheet.getByRole('heading', { name: 'Outreach history' }),
    ).toBeVisible()
    await expect(detailSheet.getByText('No outreach yet.')).toBeVisible({
      timeout: 30_000,
    })
    // Serve gating holds inside the detail sheet footer too (ENG-10749).
    await expect(
      detailSheet.getByRole('link', { name: 'Send outreach' }),
    ).toHaveCount(0)
    await closeCrmSheet(page)

    await expect(listCard(page, listName)).toBeVisible({ timeout: 20_000 })

    // --- Lifecycle via the card kebab (ENG-10707): rename ---
    // Kept short: the duplicate step appends " (copy)" and
    // trimCustomSegmentName truncates past 40 chars, which would break the
    // exact-name card lookups below.
    const renamedName = `E2E renamed ${Date.now()}`
    await openListCardMenu(page, listName)
    await page.getByRole('menuitem', { name: 'Rename' }).click()
    const renameDialog = page.getByRole('dialog', { name: /rename list/i })
    await expect(renameDialog).toBeVisible({ timeout: 10_000 })
    await renameDialog.getByLabel('List name').fill(renamedName)
    await renameDialog.getByRole('button', { name: 'Save' }).click()
    await expect(renameDialog).toBeHidden({ timeout: 10_000 })
    await expect(listCard(page, renamedName)).toBeVisible({ timeout: 20_000 })
    await expect(listCard(page, listName)).toHaveCount(0)

    // --- Duplicate: confirms first (ENG-10943), then opens the copy's
    // detail sheet and adds a card ---
    await openListCardMenu(page, renamedName)
    await page.getByRole('menuitem', { name: 'Duplicate' }).click()
    const duplicateDialog = page.getByRole('alertdialog')
    await expect(duplicateDialog).toBeVisible({ timeout: 10_000 })
    await expect(
      duplicateDialog.getByText(/re-runs this list's filters/i),
    ).toBeVisible()
    await duplicateDialog.getByRole('button', { name: 'Duplicate' }).click()
    const copyName = `${renamedName} (copy)`
    const copySheet = crmSheet(page)
    await expect(copySheet.getByText(copyName, { exact: true })).toBeVisible({
      timeout: 30_000,
    })
    await expect(duplicateDialog).toBeHidden()
    await closeCrmSheet(page)
    await expect(listCard(page, copyName)).toBeVisible({ timeout: 20_000 })

    // --- Delete via kebab + confirm dialog ---
    await openListCardMenu(page, copyName)
    await page.getByTestId('list-card-delete-trigger').click()
    const deleteDialog = page.getByRole('alertdialog')
    await expect(deleteDialog).toBeVisible({ timeout: 10_000 })
    await deleteDialog.getByRole('button', { name: 'Delete' }).click()
    await expect(deleteDialog).toBeHidden({ timeout: 15_000 })
    await expect(listCard(page, copyName)).toHaveCount(0, { timeout: 20_000 })
    // The sibling list survives — delete removed exactly the confirmed list.
    await expect(listCard(page, renamedName)).toBeVisible()
  })
})
