import { expect, type Locator, type Page, test } from '@playwright/test'
import { blockSlowScripts } from 'src/helpers/navigation.helper'
import { setFlagOverrides } from 'src/helpers/campaignStory.helper'
import {
  closeCrmSheet,
  crmSheet,
  gotoCrmContacts,
  readSettledWizardCount,
  saveWizardList,
  selectWizardPill,
  statTileValue,
  wizardBuildButton,
  wizardPillGroup,
} from 'src/helpers/crm-contacts-e2e'
import { setupProCampaignUser } from 'src/helpers/organizations'

// win-recommended-lists: independent affinity and ideology are Win-only
// (gp-api 400s both for an eo- org via
// assertNoRecommendedListFilterForElectedOffice), so they can only be
// exercised against a real Win Pro org — contacts-filters.spec.ts covers the
// third new dimension (hasAnyPhone, available to both Win and Serve) and the
// Win-only gate's negative space (both groups absent from the Serve wizard)
// against its existing elected-office user. This file is the positive half:
// a Win user actually selecting affinity and ideology.
test.describe('Win contacts filters: independent affinity + ideology', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
    // Force the flag BEFORE auth/navigation so the first SSR render already
    // sees it (e2e-tests/CLAUDE.md "Flag-gated surfaces") — no serve-crm
    // involved here, so setFlagOverrides is called directly rather than
    // through enableCrmFlags.
    await setFlagOverrides(page, { 'win-recommended-lists': 'on' })
  })

  // Select one pill, read the settled narrowed count, then reset to the
  // unfiltered universe via Clear filters so the next probe starts clean —
  // same shape as contacts-filters.spec.ts's probeCount, kept local here
  // since this is the only spec in this file.
  const probe = async (
    page: Page,
    wizard: Locator,
    unfiltered: number,
    group: string,
    option: string,
  ): Promise<number> => {
    await selectWizardPill(wizard, group, option)
    const count = await readSettledWizardCount(page, {
      differentFrom: unfiltered,
    })
    await wizard.getByRole('button', { name: 'Clear filters' }).click()
    await expect(wizardBuildButton(page)).toContainText(
      `(${unfiltered.toLocaleString('en-US')})`,
      { timeout: 30_000 },
    )
    return count
  }

  test('affinity and ideology each narrow the universe, Unknown is selectable, and the saved list round-trips', async ({
    page,
  }) => {
    test.setTimeout(5 * 60 * 1000)

    await setupProCampaignUser(page)
    await gotoCrmContacts(page)

    await page.getByRole('button', { name: 'Create new list' }).click()
    const wizard = crmSheet(page)
    await expect(wizard).toBeVisible({ timeout: 15_000 })
    await wizard
      .getByText('Build a list using voter demographics and data')
      .click()
    await wizard.getByRole('button', { name: 'Continue' }).click()
    await expect(
      wizard.getByText('Build a voter list', { exact: true }),
    ).toBeVisible({ timeout: 10_000 })

    const unfiltered = await readSettledWizardCount(page)
    expect(unfiltered).toBeGreaterThan(0)

    await expect(wizardPillGroup(wizard, 'Independent Affinity')).toBeVisible({
      timeout: 10_000,
    })
    await expect(wizardPillGroup(wizard, 'Ideology')).toBeVisible({
      timeout: 10_000,
    })

    const affinityCount = await probe(
      page,
      wizard,
      unfiltered,
      'Independent Affinity',
      'Open to Independents',
    )
    expect(affinityCount).toBeGreaterThan(0)
    expect(affinityCount).toBeLessThan(unfiltered)

    const conservativeCount = await probe(
      page,
      wizard,
      unfiltered,
      'Ideology',
      'Conservative',
    )
    expect(conservativeCount).toBeGreaterThan(0)
    expect(conservativeCount).toBeLessThan(unfiltered)

    // Unknown covers the ~40% of the file with no modeled ideology and must
    // not be silently dropped — it still has to return a real settled count.
    // Left selected (no Clear filters after) so the build below saves it.
    await selectWizardPill(wizard, 'Ideology', 'Unknown')
    const unknownCount = await readSettledWizardCount(page, {
      differentFrom: unfiltered,
    })
    expect(unknownCount).toBeGreaterThan(0)

    // Save the Unknown-ideology selection and confirm it round-trips: the
    // detail sheet re-reads the persisted row, so this can only match if the
    // filter actually saved rather than living only in client state.
    await wizardBuildButton(page).click()
    const listName = `E2E ideology unknown ${Date.now()}`
    await saveWizardList(page, listName)
    const detailSheet = crmSheet(page)
    await expect(statTileValue(detailSheet, 'People')).toHaveText(
      unknownCount.toLocaleString('en-US'),
      { timeout: 30_000 },
    )
    await closeCrmSheet(page)
  })
})
