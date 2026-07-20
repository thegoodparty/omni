import { expect, type Page, type Response, test } from '@playwright/test'
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
import { authenticateTestUser } from 'tests/utils/api-registration'

// The contacts list endpoint (GET /v1/contacts), not the per-person detail
// (/v1/contacts/:id), the stats (/v1/contacts/stats) or download
// (/v1/contacts/download), which all carry a trailing path segment. Mirrors
// CONTACTS_LIST_RESPONSE in contacts-e2e.ts; kept local because spec files
// don't import from one another.
const CONTACTS_LIST_RESPONSE = /\/v1\/contacts(\?|$)/

const isContactsListResponse = (res: Response): boolean =>
  CONTACTS_LIST_RESPONSE.test(res.url()) &&
  res.request().method() === 'GET' &&
  res.ok()

// The non-pro base list returns fabricated rows from gp-api's
// previewContacts.utils (ENG-10508): every person's lalVoterId is `preview-<n>`
// and cellPhone is in the 202-555 fictional exchange. Real L2 voters never have
// either, so these are the deterministic real-vs-synthetic distinguishers. We
// assert on the parsed JSON response rather than the rendered cells so the
// check is robust to the upsell blur and never reproduces a real voter record
// in the DOM snapshot / trace (org data policy).
type ContactsListBody = {
  people: { lalVoterId: string; cellPhone: string | null }[]
  pagination: { totalResults: number }
}

const SYNTHETIC_VOTER_ID = /^preview-\d+$/
const SYNTHETIC_PHONE = /^\(202\) 555-\d{4}$/

// Navigate to the contacts page and resolve the parsed GET /v1/contacts body.
// The waiter is armed before goto so a fast list response can't land first.
const gotoContactsAndCaptureList = async (
  page: Page,
): Promise<ContactsListBody> => {
  const listResponse = page.waitForResponse(isContactsListResponse, {
    timeout: 30000,
  })
  await page.goto('/dashboard/contacts', { waitUntil: 'domcontentloaded' })
  await NavigationHelper.dismissOverlays(page)
  await expect(page).toHaveURL(/\/dashboard\/contacts/)
  return (await (await listResponse).json()) as ContactsListBody
}

// @dev-only: pro-gating behavior on the Win Contacts surface needs the warm
// dev stack's real district voter data and provisioned users; an ephemeral
// per-PR preview can't guarantee either. Same gate as win-contacts.spec.
test.describe('Contacts pro gating @dev-only', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  // A non-pro Win candidate must never receive real voter PII (ENG-10508 /
  // ENG-10495 — a CSS blur is not a boundary, blurred values are copy-pastable
  // straight out of the DOM). The base list is served as a synthetic preview
  // and every pro action (download here) surfaces the upsell instead.
  test('non-pro Win gets synthetic preview rows and a pro-gated download', async ({
    page,
  }) => {
    test.setTimeout(3 * 60 * 1000)

    // A fresh launched campaign is non-pro (authenticateTestUser never upgrades
    // it), and its campaign-<id> org is the active Win context. No elected
    // office is created, so canUseProFeatures is false both client- and server-
    // side (gp-api isProAccess reads campaign.isPro for a campaign org).
    await authenticateTestUser(page, { isolated: true })

    const list = await gotoContactsAndCaptureList(page)

    // Every served row is fabricated: synthetic lalVoterId AND 202-555 phone.
    // Asserting on all rows (not just the first) proves no real record leaked
    // anywhere in the page, which is the exact regression ENG-10508 fixed.
    expect(list.people.length).toBeGreaterThan(0)
    for (const person of list.people) {
      expect(person.lalVoterId).toMatch(SYNTHETIC_VOTER_ID)
      expect(person.cellPhone).toMatch(SYNTHETIC_PHONE)
    }

    // The table still renders those rows (blurred) as an upsell cue.
    const table = page.locator('table').first()
    await expect(table).toBeVisible({ timeout: 20000 })
    await expect(table.locator('tbody tr').first()).toBeVisible({
      timeout: 25000,
    })

    // Download is pro-gated: the control renders for non-pro but clicking it
    // opens the Pro upgrade modal and fires NO /v1/contacts/download request
    // (Download.tsx short-circuits to showProUpgradeModal when not pro). Arm a
    // rejected-on-timeout download waiter so a leaked request would fail the
    // test, then assert the upsell modal instead.
    let downloadRequested = false
    const onDownloadRequest = (response: Response): void => {
      if (response.url().includes('/v1/contacts/download')) {
        downloadRequested = true
      }
    }
    page.on('response', onDownloadRequest)

    const downloadIconButton = page.getByTestId('contacts-download-button')
    await downloadIconButton.scrollIntoViewIfNeeded()
    await expect(downloadIconButton).toBeVisible({ timeout: 10000 })
    await downloadIconButton.click({ force: true })

    // The non-pro contacts upsell modal is ProUpgradeModal variant
    // Second_NonViable (ContactsPage.tsx); its title is stable copy.
    await expect(
      page.getByRole('heading', { name: 'Get Pro voter data and tools' }),
    ).toBeVisible({ timeout: 10000 })

    page.off('response', onDownloadRequest)
    expect(downloadRequested).toBe(false)
  })

  // The mirror case: a pro-access account is served REAL voter rows from
  // people-api, never the synthetic preview. An elected-office (eo-) org is the
  // deterministic pro-access context — gp-api isProAccess short-circuits true
  // for it via hasElectedOfficeAccess, so findContacts skips the preview branch
  // and returns real L2 people. A Win campaign's isPro can only be flipped
  // through the Stripe upgrade webhook (no test/admin API sets it), so the eo-
  // org is the reliable way to exercise the real-people branch in e2e.
  test('pro account is served real voter rows, not the preview', async ({
    page,
  }) => {
    test.setTimeout(3 * 60 * 1000)

    // Leaves the eo- org selected (pro-access) after winning the race.
    await setupElectedOfficeUser(page)

    const list = await gotoContactsAndCaptureList(page)

    // Real rows: no fabricated lalVoterId / 202-555 phone anywhere. This is the
    // negation of the non-pro preview's distinguishers, so a regression that
    // re-routed a pro account through buildPreviewContacts would fail here.
    expect(list.people.length).toBeGreaterThan(0)
    for (const person of list.people) {
      expect(person.lalVoterId).not.toMatch(SYNTHETIC_VOTER_ID)
      if (person.cellPhone) {
        expect(person.cellPhone).not.toMatch(SYNTHETIC_PHONE)
      }
    }
  })

  // Guard against the eo- precondition silently regressing: if setup ever
  // stopped leaving a pro-access org selected, the real-rows assertion above
  // could pass for the wrong reason. Confirm the active org is the eo- one a
  // campaign org would be non-pro and get the synthetic preview instead.
  test('pro real-rows precondition: active org is elected office', async ({
    page,
  }) => {
    test.setTimeout(3 * 60 * 1000)

    await setupElectedOfficeUser(page)

    const eoOrgName = await getSelectedOrgName(page)
    const allOrgs = await getOrgPickerOptions(page)
    const campaignOrgName = allOrgs.find((name) => name !== eoOrgName)
    expect(campaignOrgName).toBeTruthy()

    // Switching to the campaign (non-pro) org must flip the base list back to
    // the synthetic preview, proving the real rows above were a property of the
    // pro-access org and not of the district's data.
    await switchOrganization(page, campaignOrgName!)
    const campaignList = await gotoContactsAndCaptureList(page)
    expect(campaignList.people.length).toBeGreaterThan(0)
    for (const person of campaignList.people) {
      expect(person.lalVoterId).toMatch(SYNTHETIC_VOTER_ID)
    }
  })
})
