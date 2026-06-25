import { expect, type Page, test } from '@playwright/test'
import type { AxiosInstance } from 'axios'
import { format } from 'date-fns'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import {
  setupElectedOfficeUser,
  switchOrganization,
  getSelectedOrgName,
  getOrgPickerOptions,
} from 'src/helpers/organizations'
import {
  seedEinAndFiled,
  seedFilingComplete,
  seedTextingApproved,
} from 'src/helpers/pro-upgrade.helper'

// The texting flow's AudienceStep only opens when the campaign is isPro AND its
// TcrCompliance is `approved` (OutreachCreateCards). The exact throwaway-filter
// create path the step POSTs on a build-new audience.
const FILTER_CREATE_RE = /\/voters\/voter-file\/filter$/

type OrgListResponse = { organizations: { slug: string }[] }

// setupElectedOfficeUser leaves the elected-office org selected and points its
// returned client at the EO org. The texting surface is the campaign (non-eo)
// org, so re-point the client there for seeding and switch the page to it, the
// same way win-contacts.spec.ts does.
const setupProTextingCampaign = async (
  page: Page,
): Promise<{ client: AxiosInstance; email: string }> => {
  const { user, client } = await setupElectedOfficeUser(page)

  const { data } = await client.get<OrgListResponse>('/v1/organizations')
  const campaignOrg = data.organizations.find(
    (org) => !org.slug.startsWith('eo-'),
  )
  expect(campaignOrg).toBeTruthy()
  client.defaults.headers['x-organization-slug'] = campaignOrg!.slug

  await seedEinAndFiled(client)
  await seedFilingComplete(client, user.email)
  await seedTextingApproved(client)

  const eoOrgName = await getSelectedOrgName(page)
  const allOrgs = await getOrgPickerOptions(page)
  const campaignOrgName = allOrgs.find((name) => name !== eoOrgName)
  expect(campaignOrgName).toBeTruthy()
  await switchOrganization(page, campaignOrgName!)

  return { client, email: user.email }
}

// Open the texting TaskFlow from the outreach page and advance the intro step
// so the AudienceStep is showing.
const openTextingAudienceStep = async (page: Page): Promise<void> => {
  await page.goto('/dashboard/outreach', { waitUntil: 'domcontentloaded' })
  await NavigationHelper.dismissOverlays(page)

  await page.getByText('Text message', { exact: true }).click()

  const modal = page.getByRole('dialog')
  await expect(modal).toBeVisible({ timeout: 20000 })

  // intro -> audience
  await modal.getByRole('button', { name: 'Next' }).click()
  await expect(
    page.getByRole('heading', { name: 'Select target audience' }),
  ).toBeVisible({ timeout: 20000 })
}

// @dev-only: reaching the texting AudienceStep needs isPro + an `approved`
// TcrCompliance record, forced via the non-prod-only dev-approve seam
// (seedTextingApproved), and a live L2 voter count for the seeded Cheyenne race
// to enable Next on a build-new audience. Both depend on the warm dev stack and
// win-voter-data flag state, which an ephemeral per-PR preview can't guarantee,
// so this runs on the post-merge develop e2e (and on demand), not on PRs. Same
// gate as win-contacts.spec.ts. See e2e-tests/CLAUDE.md ("@dev-only").
test.describe('Texting audience step @dev-only', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  // ENG-10514: a saved Voter Data list is selectable as the texting audience,
  // and selecting it reuses the existing list id rather than POSTing a new
  // throwaway filter (AudienceStep.handleOnNext spreads selectedList as the
  // voterFileFilter).
  test('reuses a saved list as the audience without a throwaway filter', async ({
    page,
  }) => {
    test.setTimeout(3 * 60 * 1000)

    const { client } = await setupProTextingCampaign(page)

    // A saved list the candidate built (non-auto name) so it shows in the
    // AudienceStep selector, which hides only auto-dated lists.
    const listName = `E2E Texting Saved List ${Date.now()}`
    const { data: savedList } = await client.post<{ id: number }>(
      '/v1/voters/voter-file/filter',
      { name: listName, partyIndependent: true },
    )
    expect(savedList.id).toBeGreaterThan(0)

    await openTextingAudienceStep(page)

    // Select the saved list in the Audience selector.
    const audienceSelect = page.getByRole('combobox').first()
    await audienceSelect.click()
    await page.getByRole('option', { name: listName }).click()
    await expect(page.getByText('Using your saved list:')).toBeVisible({
      timeout: 10000,
    })
    await expect(page.getByText(listName)).toBeVisible({ timeout: 10000 })

    // Collect any throwaway-filter create POST; a reused saved list must make
    // none. The phone-list create POST is the signal that Next progressed.
    const filterCreatePosts: string[] = []
    page.on('request', (req) => {
      if (req.method() === 'POST' && FILTER_CREATE_RE.test(req.url())) {
        filterCreatePosts.push(req.url())
      }
    })
    const phoneListPost = page.waitForRequest(
      (req) => req.method() === 'POST' && req.url().includes('/p2p/phone-list'),
      { timeout: 30000 },
    )

    await page.getByRole('dialog').getByRole('button', { name: 'Next' }).click()
    await phoneListPost

    expect(filterCreatePosts).toEqual([])
  })

  // ENG-10521: a build-new audience auto-creates a throwaway list named with the
  // send date — `${DISPLAY_TASK_TYPES.text} outreach — ${MMM d, yyyy}` from
  // flowHandlers.util.ts. Asserted against a date-tolerant matcher.
  test('auto-creates an outreach list named with the send date', async ({
    page,
  }) => {
    test.setTimeout(3 * 60 * 1000)

    await setupProTextingCampaign(page)
    await openTextingAudienceStep(page)

    // Build a new audience from the checkboxes (no saved list selected) so Next
    // POSTs the auto-named throwaway filter. Independent has live voters in the
    // seeded Cheyenne race, enabling Next once the count resolves.
    const independent = page
      .getByText('Independent', { exact: true })
      .locator('xpath=..')
      .getByRole('checkbox')
    await independent.click()

    const nextButton = page
      .getByRole('dialog')
      .getByRole('button', { name: 'Next' })
    await expect(nextButton).toBeEnabled({ timeout: 30000 })

    const filterCreatePost = page.waitForRequest(
      (req) => req.method() === 'POST' && FILTER_CREATE_RE.test(req.url()),
      { timeout: 30000 },
    )
    await nextButton.click()
    const request = await filterCreatePost

    const body = request.postDataJSON() as { name?: string }
    // Date-tolerant: the test may straddle midnight, so accept today or
    // yesterday rather than hardcoding a single date.
    const today = `Texting outreach — ${format(new Date(), 'MMM d, yyyy')}`
    const yesterday = `Texting outreach — ${format(
      new Date(Date.now() - 24 * 60 * 60 * 1000),
      'MMM d, yyyy',
    )}`
    expect([today, yesterday]).toContain(body.name)
  })
})
